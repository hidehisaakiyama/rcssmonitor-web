// The 3D renderer (Phase 6), with three.js. It is loaded with a dynamic
// import, so the 2D view does not pay for it.
//
// - The ground is the 2D field painter's drawing, as a texture, unlit so that
//   it keeps the 2D colors. The goals have posts, a crossbar and a net.
// - Each part of the players (body, head, the circle on the ground, the
//   body and face direction marks) is one instanced mesh for all 22.
// - The ball stands at its height when the show has one (the planned 2.5D
//   simulator), with a shadow on the ground.
// - The camera orbits a point on the ground (mouse: left drag turns,
//   Shift / Ctrl + left drag pans, the wheel zooms). The right button is left
//   for the referee menu.
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MAX_PLAYER, PITCH } from '../../core/constants';
import { headDirection, type PlayerState } from '../../core/frame';
import type { Vec2 } from '../../core/geometry';
import { DEFAULT_SERVER_PARAM, type ServerParam } from '../../core/params';
import type { FieldRenderer, SceneSnapshot } from '../renderer';
import type { ViewState } from '../view-state';
import { fieldTextureKey, paintFieldTexture } from './field-texture';
import {
  ballCenterHeight,
  ballRadius,
  fitCameraPosition,
  GOAL_HEIGHT,
  playerColor,
  playerSize,
  shadowOpacity,
  TEXTURE_AREA,
  yaw,
} from './scene-math';

const PLAYERS = 2 * MAX_PLAYER;
const BODY_HEIGHT = 1.4;
const HEAD_RADIUS = 0.22;
const HEAD_HEIGHT = BODY_HEIGHT + HEAD_RADIUS + 0.03;
const NUMBER_HEIGHT = HEAD_HEIGHT + 0.75;

/** What the end-to-end tests read. */
export interface Render3DState {
  readonly ball: {
    readonly visible: boolean;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly shadow: {
    readonly visible: boolean;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly players: number;
  readonly drawCalls: number;
}

export class Render3D implements FieldRenderer {
  readonly kind = '3d';
  readonly canvas: HTMLCanvasElement;
  onInvalidate: (() => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.5, 2000);
  private controls: OrbitControls | null = null;
  private readonly disposables: (BufferGeometry | Material | CanvasTexture)[] = [];
  private width = 1;
  private height = 1;
  /** Until the user moves the camera, it is fitted to the canvas. */
  private cameraMoved = false;

  private readonly fieldCanvas = document.createElement('canvas');
  private readonly fieldTexture: CanvasTexture;
  private readonly groundMaterial: MeshBasicMaterial;
  private fieldKey = '';

  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly discs: InstancedMesh;
  private readonly noses: InstancedMesh;
  private readonly faces: InstancedMesh;
  private readonly numbers: Sprite[] = [];
  private readonly ball: Mesh;
  private readonly ballMaterial: MeshLambertMaterial;
  private readonly shadow: Mesh;
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly noseMaterial: MeshLambertMaterial;
  private readonly faceMaterial: MeshLambertMaterial;
  private visiblePlayers = 0;

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'field-layer';
    this.renderer.setClearColor(new Color('#87a96b'));

    this.fitCamera();

    this.scene.add(new HemisphereLight(0xffffff, 0x3a5f3a, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.4));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-30, 80, 40);
    this.scene.add(sun);

    // The ground: the field texture over the margin, and a plain green
    // plane beyond it.
    this.fieldTexture = new CanvasTexture(this.fieldCanvas);
    this.fieldTexture.colorSpace = SRGBColorSpace;
    this.fieldTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.groundMaterial = this.track(new MeshBasicMaterial({ map: this.fieldTexture }));
    const ground = new Mesh(
      this.track(new PlaneGeometry(TEXTURE_AREA.length, TEXTURE_AREA.width)),
      this.groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.disposables.push(this.fieldTexture);
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
    this.bodies = this.instanced(new CylinderGeometry(1, 1, 1, 20), lambert());
    this.heads = this.instanced(new SphereGeometry(HEAD_RADIUS, 16, 12), lambert());
    this.discs = this.instanced(
      new CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      this.track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })),
    );
    this.discs.renderOrder = 1;
    // Cones along +X: the body direction at the chest, the face direction at the head.
    const cone = (radius: number, length: number) =>
      new ConeGeometry(radius, length, 12).rotateZ(-Math.PI / 2).translate(length / 2, 0, 0);
    this.noseMaterial = this.track(new MeshLambertMaterial({ color: 0x000000 }));
    this.faceMaterial = this.track(new MeshLambertMaterial({ color: 0xff0000 }));
    this.noses = this.instanced(cone(0.14, 0.45), this.noseMaterial);
    this.faces = this.instanced(cone(0.09, 0.3), this.faceMaterial);
    for (let i = 0; i < PLAYERS; ++i) {
      const sprite = this.numberSprite(String((i % MAX_PLAYER) + 1));
      this.numbers.push(sprite);
      this.scene.add(sprite);
    }

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

  /** Listens to the mouse on the element that holds the canvas (the HUD covers it). */
  attach(element: HTMLElement): void {
    this.controls?.dispose();
    const c = new OrbitControls(this.camera, element);
    c.target.set(0, 0, 0);
    c.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the ground
    c.minDistance = 3;
    c.maxDistance = 400;
    // Left: turn (with Shift / Ctrl / Meta: pan); middle: zoom; right: free for the menu.
    c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: null };
    c.addEventListener('start', () => {
      this.cameraMoved = true;
    });
    c.addEventListener('change', () => this.onInvalidate?.());
    c.update();
    this.controls = c;
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
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (!this.cameraMoved) {
      this.fitCamera();
    }
  }

  /**
   * Broadcast-like: from beyond the near touch line, looking down at the
   * center, far enough for the whole pitch to fit across the canvas.
   */
  private fitCamera(): void {
    const { position, target } = fitCameraPosition(this.camera.fov, this.width / this.height);
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.lookAt(target.x, target.y, target.z);
    if (this.controls) {
      this.controls.target.set(target.x, target.y, target.z);
      this.controls.update();
    }
  }

  render(scene: SceneSnapshot | null, view: ViewState): void {
    const sp = scene?.store.serverParam ?? DEFAULT_SERVER_PARAM;
    this.updateField(view, sp);
    this.updatePlayers(scene, view, sp);
    this.updateBall(scene, view, sp);
    this.renderer.render(this.scene, this.camera);
  }

  screenToField(x: number, y: number): Vec2 | null {
    const ndc = new Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  fieldToScreen(x: number, y: number): Vec2 | null {
    const v = new Vector3(x, 0, y).project(this.camera);
    if (v.z > 1) {
      return null; // behind the camera
    }
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** For the end-to-end tests: where the ball and its shadow are, in world coordinates. */
  inspect(): Render3DState {
    const at = (o: Object3D) => ({
      visible: o.visible,
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
    });
    return {
      ball: at(this.ball),
      shadow: at(this.shadow),
      players: this.visiblePlayers,
      drawCalls: this.renderer.info.render.calls,
    };
  }

  dispose(): void {
    this.detach();
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const s of this.numbers) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- building

  private track<T extends BufferGeometry | Material>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private instanced(geometry: BufferGeometry, material: Material): InstancedMesh {
    const mesh = new InstancedMesh(this.track(geometry), material, PLAYERS);
    mesh.frustumCulled = false; // the instances move; the geometry's bounds do not
    mesh.count = 0;
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

  // ---- updating

  private updateField(view: ViewState, sp: ServerParam): void {
    const key = fieldTextureKey(view, sp);
    if (key !== this.fieldKey) {
      this.fieldKey = key;
      paintFieldTexture(this.fieldCanvas, view, sp);
      this.fieldTexture.needsUpdate = true;
    }
  }

  private updatePlayers(scene: SceneSnapshot | null, view: ViewState, sp: ServerParam): void {
    const players: readonly PlayerState[] = view.options.showPlayer
      ? (scene?.frame.players ?? [])
      : [];
    const o = new Object3D();
    const color = new Color();
    let n = 0;
    for (const p of players) {
      const type = scene?.store.playerType(p.type);
      if (!type) {
        continue;
      }
      const size = playerSize(view.options, sp, type);
      color.set(playerColor(view.colors, p));

      o.rotation.set(0, 0, 0);
      o.position.set(p.x, BODY_HEIGHT / 2, p.y);
      o.scale.set(size.body, BODY_HEIGHT, size.body);
      o.updateMatrix();
      this.bodies.setMatrixAt(n, o.matrix);
      this.bodies.setColorAt(n, color);

      o.position.set(p.x, HEAD_HEIGHT, p.y);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      this.heads.setMatrixAt(n, o.matrix);
      this.heads.setColorAt(n, color);

      o.position.set(p.x, 0.02, p.y);
      o.scale.set(size.ground, 1, size.ground);
      o.updateMatrix();
      this.discs.setMatrixAt(n, o.matrix);
      this.discs.setColorAt(n, color);

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

      const sprite = this.numbers[p.side === -1 ? MAX_PLAYER + p.unum - 1 : p.unum - 1];
      if (sprite) {
        sprite.position.set(p.x, NUMBER_HEIGHT, p.y);
      }
      ++n;
    }
    for (const mesh of [this.bodies, this.heads, this.discs, this.noses, this.faces]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.noseMaterial.color.set(view.colors.playerPen);
    this.faceMaterial.color.set(view.colors.neck);
    const shown = new Set(players.map((p) => (p.side === -1 ? MAX_PLAYER : 0) + p.unum - 1));
    this.numbers.forEach((s, i) => {
      s.visible = view.options.showPlayerNumber && shown.has(i);
    });
    this.visiblePlayers = n;
  }

  private updateBall(scene: SceneSnapshot | null, view: ViewState, sp: ServerParam): void {
    const ball = scene?.frame.ball;
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
