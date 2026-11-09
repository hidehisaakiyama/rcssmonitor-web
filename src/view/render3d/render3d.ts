// The 3D renderer (Phase 6), with three.js. It is loaded with a dynamic
// import, so the 2D view does not pay for it.
//
// - The ground is the 2D field painter's drawing, as a texture, unlit so that
//   it keeps the 2D colors. The goals have posts, a crossbar and a net.
// - Each part of the players (body, head, the circles on the ground, the
//   body and face direction marks) is one instanced mesh for all 22. The
//   colors follow the 2D view (player-style.ts): the state colors (kick,
//   tackle, collisions, fouls...), the stamina, the decayed effort or
//   recovery, the selected player. Cards and numbers are sprites.
// - The ball stands at its height when the show has one (the planned 2.5D
//   simulator), with a shadow on the ground.
// - Between two frames, positions and directions are interpolated
//   (interpolate.ts).
// - Cameras (cameras.ts): free (orbit with the mouse: left drag turns,
//   Shift / Ctrl + left drag pans, the wheel zooms), broadcast, top, behind
//   either goal, and the selected player's eyes. Dragging in the broadcast or
//   goal camera turns it into the free camera. The right button is left for
//   the referee menu.
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MAX_PLAYER, PITCH, Side } from '../../core/constants';
import {
  hasRedCard,
  hasYellowCard,
  headDirection,
  isAlive,
  type Frame,
  type PlayerState,
} from '../../core/frame';
import type { GameStore } from '../../core/game-store';
import { DEG2RAD, type Vec2 } from '../../core/geometry';
import { DEFAULT_SERVER_PARAM, type ServerParam } from '../../core/params';
import { playerStyle } from '../player-style';
import type { FieldRenderer, SceneSnapshot } from '../renderer';
import type { ViewState } from '../view-state';
import {
  broadcastPose,
  CAMERA_FOV,
  distance,
  goalPose,
  playerPose,
  smoothToward,
  topHalfSize,
  type CameraMode,
  type CameraPose,
} from './cameras';
import { fieldTextureKey, paintFieldTexture } from './field-texture';
import { interpolateFrame } from './interpolate';
import {
  ballCenterHeight,
  ballRadius,
  fitCameraPosition,
  GOAL_HEIGHT,
  playerSize,
  shadowOpacity,
  TEXTURE_AREA,
  yaw,
  type World,
} from './scene-math';

const PLAYERS = 2 * MAX_PLAYER;
const BODY_HEIGHT = 1.4;
const HEAD_RADIUS = 0.22;
const HEAD_HEIGHT = BODY_HEIGHT + HEAD_RADIUS + 0.03;
const NUMBER_HEIGHT = HEAD_HEIGHT + 0.75;
/** The smoothing cameras count as still within this distance of where they go. */
const SETTLED = 0.02;

/** What the end-to-end tests read. */
export interface Render3DState {
  readonly ball: { readonly visible: boolean } & World;
  readonly shadow: { readonly visible: boolean } & World;
  readonly players: number;
  readonly rings: number;
  readonly cards: number;
  readonly viewAreas: number;
  readonly camera: { readonly mode: CameraMode; readonly position: World; readonly target: World };
  /** The frame drawn last (before interpolation), or -1. */
  readonly frameIndex: number;
  readonly drawCalls: number;
}

const index = (p: PlayerState) => (p.side === Side.Right ? MAX_PLAYER : 0) + p.unum - 1;
const world = (v: { x: number; y: number; z: number }): World => ({ x: v.x, y: v.y, z: v.z });

export class Render3D implements FieldRenderer {
  readonly kind = '3d';
  readonly canvas: HTMLCanvasElement;
  onInvalidate: (() => void) | null = null;
  /** Called when the camera mode changes by itself (a drag makes it free). */
  onCameraModeChange: ((mode: CameraMode) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly perspective = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  private controls: OrbitControls | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  private width = 1;
  private height = 1;

  private mode: CameraMode = 'broadcast';
  private cameraPosition: World = { x: 0, y: 60, z: 100 };
  private cameraTarget: World = { x: 0, y: 0, z: 0 };
  private settled = true;
  private snap = true;
  /** The free camera starts where the whole pitch fits, once the size is known. */
  private fitted = false;
  private lastRender: number | null = null;

  private readonly fieldCanvas = document.createElement('canvas');
  private readonly fieldTexture: CanvasTexture;
  private fieldKey = '';

  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly discs: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly decayRings: InstancedMesh;
  private readonly noses: InstancedMesh;
  private readonly faces: InstancedMesh;
  private readonly noseMaterial: MeshLambertMaterial;
  private readonly faceMaterial: MeshLambertMaterial;
  private readonly numbers: Sprite[] = [];
  private readonly cards: Sprite[] = [];
  private readonly sectors: Mesh[] = [];
  private readonly sectorGeometries = new Map<number, BufferGeometry>();
  private readonly sectorMaterial: MeshBasicMaterial;
  private readonly largeView: LineSegments;
  private largeViewWidth = -1;
  private readonly ball: Mesh;
  private readonly ballMaterial: MeshLambertMaterial;
  private readonly shadow: Mesh;
  private readonly shadowMaterial: MeshBasicMaterial;
  private counts = { players: 0, rings: 0, cards: 0, viewAreas: 0 };
  private drawnFrame = -1;

  // Reused every frame.
  private readonly o = new Object3D();
  private readonly color = new Color();

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'field-layer';
    this.renderer.setClearColor(new Color('#87a96b'));
    this.ortho.up.set(0, 0, -1); // -Z up on the screen, as the 2D view

    this.scene.add(new HemisphereLight(0xffffff, 0x3a5f3a, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.4));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-30, 80, 40);
    this.scene.add(sun);

    // The ground: the field texture over the margin, plain green beyond.
    this.fieldTexture = this.track(new CanvasTexture(this.fieldCanvas));
    this.fieldTexture.colorSpace = SRGBColorSpace;
    this.fieldTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new Mesh(
      this.track(new PlaneGeometry(TEXTURE_AREA.length, TEXTURE_AREA.width)),
      this.track(new MeshBasicMaterial({ map: this.fieldTexture })),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const outside = new Mesh(
      this.track(new PlaneGeometry(1000, 1000)),
      this.track(new MeshBasicMaterial({ color: '#1a8a1a' })),
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.02;
    this.scene.add(outside);

    this.scene.add(this.goal(-1), this.goal(1));

    // Players.
    const lambert = () => this.track(new MeshLambertMaterial({ color: 0xffffff }));
    const flat = (opacity: number) =>
      this.track(
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }),
      );
    this.bodies = this.instanced(new CylinderGeometry(1, 1, 1, 20), lambert());
    this.heads = this.instanced(new SphereGeometry(HEAD_RADIUS, 16, 12), lambert());
    this.discs = this.instanced(new CircleGeometry(1, 32).rotateX(-Math.PI / 2), flat(0.45), 1);
    this.rings = this.instanced(new RingGeometry(0.92, 1.08, 40).rotateX(-Math.PI / 2), flat(1), 2);
    this.decayRings = this.instanced(
      new RingGeometry(1.1, 1.22, 40).rotateX(-Math.PI / 2),
      flat(1),
      2,
    );
    // Cones along +X: the body direction at the chest, the face direction at the head.
    const cone = (radius: number, length: number) =>
      new ConeGeometry(radius, length, 12).rotateZ(-Math.PI / 2).translate(length / 2, 0, 0);
    this.noseMaterial = this.track(new MeshLambertMaterial({ color: 0x000000 }));
    this.faceMaterial = this.track(new MeshLambertMaterial({ color: 0xff0000 }));
    this.noses = this.instanced(cone(0.14, 0.45), this.noseMaterial);
    this.faces = this.instanced(cone(0.09, 0.3), this.faceMaterial);
    this.sectorMaterial = this.track(
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    for (let i = 0; i < PLAYERS; ++i) {
      const number = this.numberSprite(String((i % MAX_PLAYER) + 1));
      const card = new Sprite(this.track(new SpriteMaterial({ depthTest: false })));
      card.scale.set(0.42, 0.6, 1);
      card.center.set(-1.3, 0.5); // to the right of the number
      card.renderOrder = 3;
      card.visible = false;
      const sector = new Mesh(undefined, this.sectorMaterial);
      sector.renderOrder = 1;
      sector.visible = false;
      this.numbers.push(number);
      this.cards.push(card);
      this.sectors.push(sector);
      this.scene.add(number, card, sector);
    }
    this.largeView = new LineSegments(
      this.track(new BufferGeometry()),
      this.track(new LineBasicMaterial({ color: 0xffffff })),
    );
    this.largeView.visible = false;
    this.scene.add(this.largeView);

    // The ball and its shadow.
    this.ballMaterial = this.track(new MeshLambertMaterial({ color: 0xffffff }));
    this.ball = new Mesh(this.track(new SphereGeometry(1, 24, 16)), this.ballMaterial);
    this.scene.add(this.ball);
    this.shadowMaterial = this.track(
      new MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false }),
    );
    this.shadow = new Mesh(
      this.track(new CircleGeometry(1, 24).rotateX(-Math.PI / 2)),
      this.shadowMaterial,
    );
    this.shadow.renderOrder = 2;
    this.scene.add(this.shadow);
  }

  // ---- FieldRenderer

  /** Listens to the mouse on the element that holds the canvas (the HUD covers it). */
  attach(element: HTMLElement): void {
    this.controls?.dispose();
    const c = new OrbitControls(this.perspective, element);
    c.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
    c.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the ground
    c.minDistance = 3;
    c.maxDistance = 400;
    // Left: turn (with Shift / Ctrl / Meta: pan); middle: zoom; right: free for the menu.
    c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: null };
    c.addEventListener('start', () => {
      if (this.mode !== 'free') {
        this.setCameraMode('free');
        this.onCameraModeChange?.('free');
      }
    });
    c.addEventListener('change', () => {
      if (this.mode === 'free') {
        this.cameraPosition = world(this.perspective.position);
        this.cameraTarget = world(c.target);
      }
      this.onInvalidate?.();
    });
    this.controls = c;
    this.updateControls();
  }

  detach(): void {
    this.controls?.dispose();
    this.controls = null;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(this.width, this.height);
    this.perspective.aspect = this.width / this.height;
    this.perspective.updateProjectionMatrix();
    this.fitTop();
    if (!this.fitted) {
      this.fitted = true;
      const fit = fitCameraPosition(CAMERA_FOV, this.width / this.height);
      this.cameraPosition = fit.position;
      this.cameraTarget = fit.target;
      this.snap = true;
    }
  }

  render(scene: SceneSnapshot | null, view: ViewState): void {
    const now = performance.now();
    // A long pause (nothing drawn) must not jump: at most 0.1 s per frame.
    const dt = this.lastRender === null ? 0 : Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;

    const store = scene?.store ?? null;
    const sp = store?.serverParam ?? DEFAULT_SERVER_PARAM;
    const frame = scene ? interpolateFrame(scene.frame, scene.next, scene.alpha) : null;
    this.drawnFrame = scene?.frameIndex ?? -1;
    this.updateField(view, sp);
    this.updatePlayers(frame, store, view, sp);
    this.updateViewAreas(frame, view, sp);
    this.updateBall(frame, view, sp);
    this.updateCamera(frame, view, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** True while a camera is still moving toward where it goes. */
  animating(): boolean {
    return !this.settled;
  }

  screenToField(x: number, y: number): Vec2 | null {
    const ndc = new Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
    const ray = new Raycaster();
    // The matrices are otherwise updated when drawing, which may not have happened yet.
    this.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  fieldToScreen(x: number, y: number): Vec2 | null {
    this.camera.updateMatrixWorld();
    const v = new Vector3(x, 0, y).project(this.camera);
    if (v.z > 1) {
      return null; // behind the camera
    }
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  dispose(): void {
    this.detach();
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const g of this.sectorGeometries.values()) {
      g.dispose();
    }
    for (const s of this.numbers) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- cameras

  get cameraMode(): CameraMode {
    return this.mode;
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.mode) {
      return;
    }
    // From the eyes or from above, the free camera starts with the whole pitch.
    if (mode === 'free' && (this.mode === 'player' || this.mode === 'top')) {
      const fit = fitCameraPosition(CAMERA_FOV, this.width / this.height);
      this.cameraPosition = fit.position;
      this.cameraTarget = fit.target;
    }
    this.mode = mode;
    this.snap = true;
    this.settled = mode === 'free' || mode === 'top';
    if (mode === 'free') {
      // Place the camera before the controls read it.
      this.perspective.fov = CAMERA_FOV;
      this.perspective.updateProjectionMatrix();
      this.applyPerspective();
    }
    this.updateControls();
    this.onInvalidate?.();
  }

  /** For the end-to-end tests. */
  inspect(): Render3DState {
    const at = (o: Object3D) => ({ visible: o.visible, ...world(o.position) });
    return {
      ball: at(this.ball),
      shadow: at(this.shadow),
      ...this.counts,
      camera: { mode: this.mode, position: this.cameraPosition, target: this.cameraTarget },
      frameIndex: this.drawnFrame,
      drawCalls: this.renderer.info.render.calls,
    };
  }

  private get camera(): Camera {
    return this.mode === 'top' ? this.ortho : this.perspective;
  }

  /** Only the free camera and the following ones take the mouse; dragging them makes them free. */
  private updateControls(): void {
    const c = this.controls;
    if (!c) {
      return;
    }
    c.enabled = this.mode !== 'top' && this.mode !== 'player';
    if (this.mode === 'free') {
      c.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
      c.update();
    }
  }

  private fitTop(): void {
    const { halfWidth, halfHeight } = topHalfSize(this.width / this.height);
    Object.assign(this.ortho, {
      left: -halfWidth,
      right: halfWidth,
      top: halfHeight,
      bottom: -halfHeight,
    });
    this.ortho.position.set(0, 300, 0);
    this.ortho.lookAt(0, 0, 0);
    this.ortho.updateProjectionMatrix();
  }

  private updateCamera(frame: Frame | null, view: ViewState, dt: number): void {
    if (this.mode === 'free' || this.mode === 'top') {
      // The free camera starts from where the last camera was.
      if (this.mode === 'free' && this.snap) {
        this.perspective.fov = CAMERA_FOV;
        this.perspective.updateProjectionMatrix();
        this.applyPerspective();
        this.updateControls();
      }
      this.snap = false;
      this.settled = true;
      return;
    }
    const pose = this.pose(frame, view);
    // The player camera is the player's eyes, which interpolate already; the
    // others glide after the ball.
    const glide = !this.snap && this.mode !== 'player';
    this.snap = false;
    const position = glide ? smoothToward(this.cameraPosition, pose.position, dt) : pose.position;
    const target = glide ? smoothToward(this.cameraTarget, pose.target, dt) : pose.target;
    this.settled =
      distance(position, pose.position) < SETTLED && distance(target, pose.target) < SETTLED;
    // Once still, exactly where it goes.
    this.cameraPosition = this.settled ? pose.position : position;
    this.cameraTarget = this.settled ? pose.target : target;
    if (Math.abs(this.perspective.fov - pose.fov) > 1e-6) {
      this.perspective.fov = pose.fov;
      this.perspective.updateProjectionMatrix();
    }
    this.applyPerspective();
  }

  private pose(frame: Frame | null, view: ViewState): CameraPose {
    const aspect = this.width / this.height;
    const ball = frame?.ball ?? { x: 0, y: 0 };
    switch (this.mode) {
      case 'goal-left':
        return goalPose(-1, ball);
      case 'goal-right':
        return goalPose(1, ball);
      case 'player': {
        const s = view.selected;
        const p = s && frame?.players.find((q) => q.side === s.side && q.unum === s.unum);
        // Without a selected, connected player, the broadcast view.
        return p && isAlive(p) ? playerPose(p, aspect) : broadcastPose(aspect, ball);
      }
      default:
        return broadcastPose(aspect, ball);
    }
  }

  private applyPerspective(): void {
    const p = this.cameraPosition;
    const t = this.cameraTarget;
    this.perspective.position.set(p.x, p.y, p.z);
    this.perspective.lookAt(t.x, t.y, t.z);
  }

  // ---- building

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private instanced(geometry: BufferGeometry, material: Material, renderOrder = 0): InstancedMesh {
    const mesh = new InstancedMesh(this.track(geometry), material, PLAYERS);
    mesh.frustumCulled = false; // the instances move; the geometry's bounds do not
    mesh.count = 0;
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return mesh;
  }

  /** A goal with its mouth on the goal line of `side` (-1 left, +1 right). */
  private goal(side: -1 | 1): Group {
    const g = new Group();
    const post = this.track(new MeshLambertMaterial({ color: 0xffffff }));
    const r = Math.max(PITCH.goalPostRadius, 0.06);
    const halfWidth = PITCH.goalWidth / 2;
    const depth = PITCH.goalDepth;
    const lineX = side * (PITCH.length / 2);
    const backX = lineX + side * depth;
    const upright = this.track(new CylinderGeometry(r, r, GOAL_HEIGHT, 12));
    for (const z of [-halfWidth, halfWidth]) {
      const m = new Mesh(upright, post);
      m.position.set(lineX, GOAL_HEIGHT / 2, z);
      g.add(m);
    }
    const bar = new Mesh(this.track(new CylinderGeometry(r, r, PITCH.goalWidth, 12)), post);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(lineX, GOAL_HEIGHT, 0);
    g.add(bar);

    // The net: translucent back, sides and roof.
    const net = this.track(
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    const plane = (w: number, h: number) => this.track(new PlaneGeometry(w, h));
    const back = new Mesh(plane(PITCH.goalWidth, GOAL_HEIGHT), net);
    back.rotation.y = Math.PI / 2;
    back.position.set(backX, GOAL_HEIGHT / 2, 0);
    g.add(back);
    for (const z of [-halfWidth, halfWidth]) {
      const s = new Mesh(plane(depth, GOAL_HEIGHT), net);
      s.position.set((lineX + backX) / 2, GOAL_HEIGHT / 2, z);
      g.add(s);
    }
    const roof = new Mesh(plane(depth, PITCH.goalWidth), net);
    roof.rotation.x = Math.PI / 2;
    roof.position.set((lineX + backX) / 2, GOAL_HEIGHT, 0);
    g.add(roof);
    // A dark floor, as the 2D view draws the goal.
    const floor = new Mesh(
      this.track(new BoxGeometry(depth, 0.01, PITCH.goalWidth)),
      this.track(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })),
    );
    floor.position.set((lineX + backX) / 2, 0.005, 0);
    g.add(floor);
    return g;
  }

  private numberSprite(text: string): Sprite {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(text, 32, 34);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, 32, 34);
    }
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(1.3, 1.3, 1);
    sprite.renderOrder = 3;
    sprite.visible = false;
    return sprite;
  }

  /** A sector of `width` degrees around +X, radius 1, on the ground. */
  private sectorGeometry(width: number): BufferGeometry {
    let g = this.sectorGeometries.get(width);
    if (!g) {
      const span = Math.max(1, width) * DEG2RAD;
      g = new CircleGeometry(1, 32, -span / 2, span).rotateX(-Math.PI / 2);
      this.sectorGeometries.set(width, g);
    }
    return g;
  }

  /** The selected player's view: 20 / 40 / 60 m arcs, the two edges, the visible distance circle. */
  private setLargeView(width: number, visible: number): void {
    const half = (width / 2) * DEG2RAD;
    const points: number[] = [];
    const push = (a: number, r: number, b: number, s: number) => {
      // Around +X; world (cos, 0, -sin) as CircleGeometry after rotateX.
      points.push(r * Math.cos(a), 0, -r * Math.sin(a), s * Math.cos(b), 0, -s * Math.sin(b));
    };
    for (const r of [20, 40, 60]) {
      const n = 48;
      for (let i = 0; i < n; ++i) {
        push(-half + (2 * half * i) / n, r, -half + (2 * half * (i + 1)) / n, r);
      }
    }
    push(-half, 60, -half, 0);
    push(half, 60, half, 0);
    for (let i = 0; i < 48; ++i) {
      push((2 * Math.PI * i) / 48, visible, (2 * Math.PI * (i + 1)) / 48, visible);
    }
    this.largeView.geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    this.largeView.geometry.computeBoundingSphere();
  }

  // ---- updating

  private updateField(view: ViewState, sp: ServerParam): void {
    const key = fieldTextureKey(view, sp);
    if (key !== this.fieldKey) {
      this.fieldKey = key;
      paintFieldTexture(this.fieldCanvas, view, sp);
      this.fieldTexture.needsUpdate = true;
    }
  }

  private updatePlayers(
    frame: Frame | null,
    store: GameStore | null,
    view: ViewState,
    sp: ServerParam,
  ): void {
    const players: readonly PlayerState[] =
      view.options.showPlayer && frame && store ? frame.players : [];
    const o = this.o;
    const color = this.color;
    let n = 0;
    let rings = 0;
    let decays = 0;
    let cards = 0;
    const shown = new Set<number>();
    // The player camera sees with the selected player's eyes, not its own head.
    const self = this.mode === 'player' ? view.selected : null;
    for (const p of players) {
      const type = store?.playerType(p.type);
      if (!type || (self && p.side === self.side && p.unum === self.unum)) {
        continue;
      }
      const size = playerSize(view.options, sp, type);
      const selected = view.isSelected(p.side, p.unum);
      const style = playerStyle(view.colors, view.options, sp, type, p, selected);

      o.rotation.set(0, 0, 0);
      o.position.set(p.x, BODY_HEIGHT / 2, p.y);
      o.scale.set(size.body, BODY_HEIGHT, size.body);
      o.updateMatrix();
      color.set(style.body);
      this.bodies.setMatrixAt(n, o.matrix);
      this.bodies.setColorAt(n, color);

      o.position.set(p.x, HEAD_HEIGHT, p.y);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      this.heads.setMatrixAt(n, o.matrix);
      this.heads.setColorAt(n, color);

      // The circle on the ground, in the team or state color, as the 2D outer circle.
      o.position.set(p.x, 0.02, p.y);
      o.scale.set(size.ground, 1, size.ground);
      o.updateMatrix();
      color.set(style.brush);
      this.discs.setMatrixAt(n, o.matrix);
      this.discs.setColorAt(n, color);
      // Its outline when highlighted (kick, tackle, illegal defense, selected).
      if (style.pen.width >= 2) {
        o.position.y = 0.03;
        o.updateMatrix();
        color.set(style.pen.color);
        this.rings.setMatrixAt(rings, o.matrix);
        this.rings.setColorAt(rings, color);
        ++rings;
      }
      if (style.decay) {
        o.position.y = 0.03;
        o.updateMatrix();
        color.set(style.decay);
        this.decayRings.setMatrixAt(decays, o.matrix);
        this.decayRings.setColorAt(decays, color);
        ++decays;
      }

      o.scale.set(1, 1, 1);
      o.position.set(p.x, BODY_HEIGHT * 0.7, p.y);
      o.rotation.set(0, yaw(p.body), 0);
      o.translateX(size.body * 0.8);
      o.updateMatrix();
      this.noses.setMatrixAt(n, o.matrix);

      o.position.set(p.x, HEAD_HEIGHT, p.y);
      o.rotation.set(0, yaw(headDirection(p)), 0);
      o.translateX(HEAD_RADIUS * 0.8);
      o.updateMatrix();
      this.faces.setMatrixAt(n, o.matrix);

      const i = index(p);
      shown.add(i);
      this.numbers[i]?.position.set(p.x, NUMBER_HEIGHT, p.y);
      const card = this.cards[i];
      if (card) {
        const red = hasRedCard(p);
        card.visible = view.options.showCard && (red || hasYellowCard(p));
        if (card.visible) {
          card.position.set(p.x, NUMBER_HEIGHT, p.y);
          card.material.color.set(red ? '#ff0000' : '#ffff00');
          ++cards;
        }
      }
      ++n;
    }
    const done = (mesh: InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    };
    for (const mesh of [this.bodies, this.heads, this.discs, this.noses, this.faces]) {
      done(mesh, n);
    }
    done(this.rings, rings);
    done(this.decayRings, decays);
    this.noseMaterial.color.set(view.colors.playerPen);
    this.faceMaterial.color.set(view.colors.neck);
    this.numbers.forEach((s, i) => {
      s.visible = view.options.showPlayerNumber && shown.has(i);
    });
    this.cards.forEach((c, i) => {
      c.visible &&= shown.has(i);
    });
    this.counts = { ...this.counts, players: n, rings, cards };
  }

  /** The view areas (V): every player's within the visible distance, the selected player's to 60 m. */
  private updateViewAreas(frame: Frame | null, view: ViewState, sp: ServerParam): void {
    const on = view.options.showViewArea && view.options.showPlayer && frame !== null;
    let count = 0;
    this.largeView.visible = false;
    this.sectorMaterial.color.set(view.colors.viewArea);
    for (const sector of this.sectors) {
      sector.visible = false;
    }
    if (!on || !frame) {
      this.counts = { ...this.counts, viewAreas: 0 };
      return;
    }
    for (const p of frame.players) {
      if (!isAlive(p)) {
        continue;
      }
      const head = yaw(headDirection(p));
      if (view.isSelected(p.side, p.unum)) {
        if (p.viewWidth !== this.largeViewWidth) {
          this.largeViewWidth = p.viewWidth;
          this.setLargeView(p.viewWidth, sp.visible_distance);
        }
        (this.largeView.material as LineBasicMaterial).color.set(view.colors.largeViewArea);
        this.largeView.position.set(p.x, 0.04, p.y);
        this.largeView.rotation.set(0, head, 0);
        this.largeView.visible = true;
        ++count;
        continue;
      }
      const sector = this.sectors[index(p)];
      if (sector) {
        sector.geometry = this.sectorGeometry(p.viewWidth);
        sector.position.set(p.x, 0.035, p.y);
        sector.rotation.set(0, head, 0);
        sector.scale.set(sp.visible_distance, 1, sp.visible_distance);
        sector.visible = true;
        ++count;
      }
    }
    this.counts = { ...this.counts, viewAreas: count };
  }

  private updateBall(frame: Frame | null, view: ViewState, sp: ServerParam): void {
    const ball = frame?.ball;
    const shown = ball !== undefined && view.options.showBall;
    this.ball.visible = shown;
    this.shadow.visible = shown;
    if (!ball || !shown) {
      return;
    }
    const r = ballRadius(view.options, sp);
    this.ball.scale.setScalar(r);
    this.ball.position.set(ball.x, ballCenterHeight(ball, r), ball.y);
    this.ballMaterial.color.set(view.colors.ball);
    this.shadow.scale.setScalar(r * 1.15);
    this.shadow.position.set(ball.x, 0.03, ball.y);
    this.shadowMaterial.opacity = shadowOpacity(ball);
  }
}
