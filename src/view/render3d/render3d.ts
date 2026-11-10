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
//   either goal, and the selected player's (player-camera.ts: at the eyes or
//   over the shoulder, in the styles to compare). Dragging in the broadcast
//   or goal camera turns it into the free camera. The right button is left
//   for the referee menu.
// - The player camera may draw only what the player perceives (sight.ts):
//   the others fade to gray when their team is not known, lose their number
//   and direction marks, or are not drawn.
// - The overlays of the 2D view (overlays.ts) on the ground: the focus
//   point, the catch, tackle and kick acceleration areas, the pointto
//   lines, the offside lines and the ball's path; their texts go to the
//   HUD (labels()). The player type is written with the number, which takes
//   the illegal defense color as in 2D. The stamina and the stamina
//   capacity are bars above the head, facing the camera (the 2D view writes
//   their numbers).
// - To tell the ends apart, the goal nets, the boards around the pitch and
//   the banners above and behind the goals are in the team colors
//   (stadium.ts; the boards and the banners can be hidden). The HUD may show
//   a compass and a minimap of where the camera is (guide()).
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
  isIllegalDefense,
  type Frame,
  type PlayerState,
} from '../../core/frame';
import type { GameStore } from '../../core/game-store';
import { DEG2RAD, RAD2DEG, type Vec2 } from '../../core/geometry';
import { DEFAULT_PLAYER_TYPE, DEFAULT_SERVER_PARAM, type ServerParam } from '../../core/params';
import { guideShown, type CameraGuide, type GuideMode } from '../hud/guides';
import type { FontSpec } from '../palette';
import { playerStyle } from '../player-style';
import type { FieldRenderer, PlayerHit, SceneSnapshot, ScreenLabel } from '../renderer';
import type { ViewState } from '../view-state';
import {
  broadcastPose,
  CAMERA_FOV,
  CLOSEUP_PLAYER_HEIGHT,
  CLOSEUP_RANGE,
  closeupPose,
  closeupTimeConstant,
  DEFAULT_CLOSEUP,
  distance,
  goalPose,
  isCloseup,
  smoothToward,
  topHalfSize,
  viewpointPose,
  type CameraMode,
  type CameraPose,
  type CloseupOptions,
  type Viewpoint,
} from './cameras';
import { fieldTextureKey, paintFieldTexture } from './field-texture';
import {
  type FigureInput,
  type Figures,
  type FigureState,
  type PlayerModel,
} from './figures/figures';
import { interpolateFrame } from './interpolate';
import { Overlays, type OverlayState } from './overlays';
import { DEFAULT_PLAYER_CAMERA, PlayerCamera, type PlayerCameraOptions } from './player-camera';
import {
  ballCenterHeight,
  capacityRate,
  staminaHue,
  staminaRate,
  ballRadius,
  fitCameraPosition,
  GOAL_HEIGHT,
  playerSize,
  shadowOpacity,
  TEXTURE_AREA,
  yaw,
  type World,
} from './scene-math';
import { FULL, perceiveBall, perceivePlayer, type Perception } from './sight';
import { Stadium, type StadiumState } from './stadium';

const PLAYERS = 2 * MAX_PLAYER;
/** A player whose team is not known (the player camera's sight). */
const UNKNOWN_TEAM_COLOR = '#9a9a9a';
/** As figures/gltf.ts FIGURE_SCALE: the figures are this much larger than life (loaded with it). */
const FIGURE_SCALE = 1.2;
const BODY_HEIGHT = 1.4;
const HEAD_RADIUS = 0.22;
const HEAD_HEIGHT = BODY_HEIGHT + HEAD_RADIUS + 0.03;
const NUMBER_HEIGHT = HEAD_HEIGHT + 0.75;
/**
 * The stamina bars under the number, as the camera sees it: the stamina,
 * and below it, thinner, the stamina capacity. The number and the card go
 * up by BAR_LIFT, so that from the side the bars are above the head.
 */
const BAR = Object.freeze({
  width: 1.4,
  stamina: 0.2,
  capacity: 0.1,
  /** Between the number's text and the bars, and between the bars. */
  gap: 0.08,
  /** The frame of the background around the fill. */
  frame: 0.03,
});
const BAR_LIFT = 0.45;
/** The capacity bar's fill. */
const CAPACITY_COLOR = '#4aa3ff';
/** The smoothing cameras count as still within this distance of where they go. */
const SETTLED = 0.02;

/** The number labels: canvas pixels, and meters per 64 pixels. */
const LABEL_WIDTH = 192;
const LABEL_HEIGHT = 64;
const LABEL_SCALE = 1.3;
/** The size of the label's text on its canvas (px). */
const LABEL_FONT = 40;
/** From the top camera, between the circle on the ground and the number (m). */
const LABEL_GAP = 0.25;
/** Half the height of the number's text (40 px of the 64 px label). */
const NUMBER_TEXT_HALF = (LABEL_SCALE * 40) / 64 / 2;
/**
 * From the cameras other than the top one, the most a number's text is
 * high on the screen: times the 2D player font (the Font tab). Nearer
 * labels keep that size (fitLabels).
 */
const LABEL_MAX_FONT = 2;
const CARD_WIDTH = 0.42;

/** What the end-to-end tests read. */
export interface Render3DState {
  readonly ball: { readonly visible: boolean } & World;
  readonly shadow: { readonly visible: boolean } & World;
  readonly players: number;
  /** Of them, drawn as cylinders (the others as figures). */
  readonly cylinders: number;
  /** The numbers drawn, and how many of them partly (fading). */
  readonly numbers: number;
  readonly fadingNumbers: number;
  /** The players drawn with the body and face direction marks. */
  readonly facings: number;
  /** The players drawn in gray: their team is not known. */
  readonly unknownTeams: number;
  readonly rings: number;
  readonly cards: number;
  readonly viewAreas: number;
  /** The stamina bars: the stamina and the capacity drawn (0-1; null: no capacity bar). */
  readonly staminaBars: readonly {
    readonly side: Side;
    readonly unum: number;
    readonly stamina: number | null;
    readonly capacity: number | null;
    /** Near the top of the first bar, in world coordinates. */
    readonly at: World;
  }[];
  readonly camera: {
    readonly mode: CameraMode;
    readonly position: World;
    readonly target: World;
    /** Vertical, in degrees. */
    readonly fov: number;
  };
  /** The overlays drawn: how many of each, and their texts. */
  readonly overlays: OverlayState;
  /** The human figures (the prototype), or null with the simple ones. */
  readonly figures: FigureState | null;
  /** The number labels shown (number, player type), by player index. */
  readonly labels: readonly string[];
  /** Where they are (their centers), by player index; null: not shown. */
  readonly numberPositions: readonly (World | null)[];
  /** The height of a number label in meters (its text is 40 / 64 of it), before fitLabels. */
  readonly numberHeight: number;
  /** The highest number's text on the screen, in CSS pixels (0: none shown). */
  readonly largestNumber: number;
  /** The ends in the team colors: the nets (left, right), the boards and the banners. */
  readonly stadium: StadiumState & { readonly nets: readonly string[] };
  /** The frame drawn last (before interpolation), or -1. */
  readonly frameIndex: number;
  readonly drawCalls: number;
}

const index = (p: PlayerState) => (p.side === Side.Right ? MAX_PLAYER : 0) + p.unum - 1;
const world = (v: { x: number; y: number; z: number }): World => ({ x: v.x, y: v.y, z: v.z });

/**
 * The label over a player: its number and its type, as the 2D view writes
 * them (player_painter.cpp drawText; not the stamina in 3D).
 */
function numberText(p: PlayerState, o: ViewState['options']): string {
  const parts: string[] = [];
  if (o.showPlayerNumber) {
    parts.push(String(p.unum));
  }
  if (o.showPlayerType) {
    parts.push(`t${p.type}`);
  }
  return parts.join(',');
}

/** The selected player in `frame`, if it is connected. */
function selectedPlayer(frame: Frame | null, view: ViewState): PlayerState | null {
  const s = view.selected;
  const p = s ? frame?.players.find((q) => q.side === s.side && q.unum === s.unum) : undefined;
  return p && isAlive(p) ? p : null;
}

export class Render3D implements FieldRenderer {
  readonly kind = '3d';
  readonly canvas: HTMLCanvasElement;
  onInvalidate: (() => void) | null = null;
  /** Called when the camera mode changes by itself (a drag makes it free). */
  onCameraModeChange: ((mode: CameraMode) => void) | null = null;
  /** Called when the wheel changes the close-up cameras' distance. */
  onCloseupDistanceChange: ((distance: number) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly perspective = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  private controls: OrbitControls | null = null;
  /** The element the mouse is listened to on, for the close-up cameras' wheel. */
  private controlled: HTMLElement | null = null;
  private readonly wheelListener = (e: WheelEvent) => this.closeupWheel(e);
  private readonly disposables: { dispose(): void }[] = [];
  private width = 1;
  private height = 1;

  private mode: CameraMode = 'broadcast';
  private closeup: CloseupOptions = DEFAULT_CLOSEUP;
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
  /** Every player drawn, as a figure or not, unseen: what playerAt casts its ray at. */
  private readonly pickBodies: InstancedMesh;
  private readonly pickHeads: InstancedMesh;
  private readonly discs: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly decayRings: InstancedMesh;
  /** The stamina and capacity bars: their backgrounds and fills, two per player. */
  private readonly barBacks: InstancedMesh;
  private readonly barFills: InstancedMesh;
  /** The players to draw bars for, found while drawing the players, drawn facing the camera. */
  private barred: PlayerState[] = [];
  /** Where each player's bars go (the top of their column), by player index. */
  private readonly barAnchors: World[] = [];
  private staminaBars: Render3DState['staminaBars'] = [];
  private readonly noses: InstancedMesh;
  private readonly faces: InstancedMesh;
  private readonly noseMaterial: MeshLambertMaterial;
  private readonly faceMaterial: MeshLambertMaterial;
  private readonly numbers: Sprite[] = [];
  /** What each number label says. */
  private readonly numberTexts: string[] = [];
  /** The width of each number label's text, in meters (at scale 1). */
  private readonly numberWidths: number[] = [];
  /** What each number label was drawn with: the font and the text. */
  private readonly numberKeys: string[] = [];
  /** How many times their size in meters the labels are drawn (labelScaleFor). */
  private labelK = 1;
  /** As labelK, for each player's labels (fitLabels), by player index. */
  private readonly labelKs: number[] = [];
  /** How high each player's head is (m), where its labels shrink toward (fitLabels). */
  private readonly labelBases: number[] = [];
  private largestNumber = 0;
  private readonly overlays = new Overlays();
  /** The players as human figures (figures/), or null: the cylinders. */
  private playerModel: PlayerModel = 'simple';
  private figures: Figures | null = null;
  private figureInputs: FigureInput[] = [];
  private readonly cards: Sprite[] = [];
  private readonly sectors: Mesh[] = [];
  private readonly sectorGeometries = new Map<number, BufferGeometry>();
  private readonly sectorMaterial: MeshBasicMaterial;
  private readonly largeView: LineSegments;
  private largeViewWidth = -1;
  private readonly stadium: Stadium;
  /** The goal nets, left and right, in the colors of the teams that keep them. */
  private readonly nets: MeshBasicMaterial[] = [];
  private guides: { compass: GuideMode; minimap: GuideMode } = { compass: 'off', minimap: 'off' };
  private readonly ball: Mesh;
  private readonly ballMaterial: MeshLambertMaterial;
  private readonly shadow: Mesh;
  private readonly shadowMaterial: MeshBasicMaterial;
  /** The players drawn, by instance of the bodies and heads, for playerAt(). */
  private drawnPlayers: PlayerState[] = [];
  private counts = {
    players: 0,
    cylinders: 0,
    numbers: 0,
    fadingNumbers: 0,
    facings: 0,
    unknownTeams: 0,
    rings: 0,
    cards: 0,
    viewAreas: 0,
  };
  private drawnFrame = -1;

  private playerCameraOptions: PlayerCameraOptions = DEFAULT_PLAYER_CAMERA;
  private readonly playerCamera = new PlayerCamera();
  /** What the player camera's player perceives, by player index; null: everything. */
  private perceptions: (Perception | undefined)[] | null = null;
  private ballPerceived = true;

  // Reused every frame.
  private readonly o = new Object3D();
  private readonly color = new Color();
  private readonly unknownTeam = new Color(UNKNOWN_TEAM_COLOR);

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

    this.scene.add(this.goal(-1), this.goal(1), this.overlays.group);
    this.stadium = new Stadium(this.fieldTexture.anisotropy);
    this.scene.add(this.stadium.group);

    // Players.
    const lambert = () => this.track(new MeshLambertMaterial({ color: 0xffffff }));
    const flat = (opacity: number) =>
      this.track(
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }),
      );
    this.bodies = this.instanced(new CylinderGeometry(1, 1, 1, 20), lambert());
    this.heads = this.instanced(new SphereGeometry(HEAD_RADIUS, 16, 12), lambert());
    const unseen = () => this.track(new MeshBasicMaterial({ visible: false }));
    this.pickBodies = this.instanced(new CylinderGeometry(1, 1, 1, 8), unseen());
    this.pickHeads = this.instanced(new SphereGeometry(HEAD_RADIUS, 8, 6), unseen());
    this.discs = this.instanced(new CircleGeometry(1, 32).rotateX(-Math.PI / 2), flat(0.45), 1);
    this.rings = this.instanced(new RingGeometry(0.92, 1.08, 40).rotateX(-Math.PI / 2), flat(1), 2);
    this.decayRings = this.instanced(
      new RingGeometry(1.1, 1.22, 40).rotateX(-Math.PI / 2),
      flat(1),
      2,
    );
    // Over everything, as the numbers.
    const barMaterial = (color: number, opacity: number) =>
      this.track(new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    this.barBacks = this.instanced(new PlaneGeometry(1, 1), barMaterial(0x000000, 0.6), 3, 2);
    this.barFills = this.instanced(new PlaneGeometry(1, 1), barMaterial(0xffffff, 1), 4, 2);
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
      const number = this.numberSprite();
      const card = new Sprite(this.track(new SpriteMaterial({ depthTest: false })));
      card.scale.set(CARD_WIDTH, 0.6, 1);
      card.center.set(-1.3, 0.5); // to the right of the number (setNumberText)
      card.renderOrder = 3;
      card.visible = false;
      const sector = new Mesh(undefined, this.sectorMaterial);
      sector.renderOrder = 1;
      sector.visible = false;
      this.numbers.push(number);
      this.numberTexts.push('');
      this.numberWidths.push(0);
      this.cards.push(card);
      this.sectors.push(sector);
      this.scene.add(number, card, sector);
    }
    this.largeView = new LineSegments(
      new BufferGeometry(),
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
    this.detach();
    // Before the controls': with a close-up camera, the wheel is its distance.
    element.addEventListener('wheel', this.wheelListener, { passive: false });
    this.controlled = element;
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
    this.controlled?.removeEventListener('wheel', this.wheelListener);
    this.controlled = null;
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
    this.updateSight(scene, view, sp);
    this.updateField(view, sp);
    this.updateStadium(scene, view);
    this.updatePlayers(frame, store, view, sp);
    this.updateViewAreas(frame, view, sp);
    this.updateBall(frame, view, sp);
    this.updateFigures(scene, sp);
    this.overlays.update(
      frame,
      view,
      sp,
      (id) => store?.playerType(id) ?? DEFAULT_PLAYER_TYPE,
      (p) => !this.perceptions || (this.perceptions[index(p)]?.facing ?? false),
      this.ballPerceived,
    );
    this.updateCamera(frame, view, dt);
    this.fitLabels(view);
    this.updateBars(view, sp);
    this.renderer.render(this.scene, this.camera);
  }

  /** The overlays' texts where they are on the canvas (CSS pixels), for the HUD. */
  labels(): ScreenLabel[] {
    const out: ScreenLabel[] = [];
    for (const l of this.overlays.labels) {
      const s = this.fieldToScreen(l.x, l.y);
      if (s && s.x >= 0 && s.y >= 0 && s.x < this.width && s.y < this.height) {
        out.push({ x: s.x, y: s.y, text: l.text, color: l.color });
      }
    }
    return out;
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

  /** The canvas point of a field point, at `height` above the ground. */
  fieldToScreen(x: number, y: number, height = 0): Vec2 | null {
    this.camera.updateMatrixWorld();
    const v = new Vector3(x, height, y).project(this.camera);
    if (v.z > 1) {
      return null; // behind the camera
    }
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /**
   * The player whose body or head is under a canvas point, the nearest to
   * the camera: as drawn, so with the player camera's sight only those it
   * perceives. Without it, a click on a player would aim at the ground
   * behind it, or at nothing from the eyes.
   */
  playerAt(x: number, y: number): PlayerHit | null {
    const ndc = new Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
    const ray = new Raycaster();
    this.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, this.camera);
    // The instances move: their bounds, which the ray tests first, too.
    for (const mesh of [this.pickBodies, this.pickHeads]) {
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
    const hit = ray.intersectObjects([this.pickBodies, this.pickHeads], false)[0];
    const p = hit?.instanceId === undefined ? undefined : this.drawnPlayers[hit.instanceId];
    return p ? { side: p.side, unum: p.unum, x: p.x, y: p.y } : null;
  }

  dispose(): void {
    this.detach();
    this.largeView.geometry.dispose();
    this.stadium.dispose();
    this.overlays.dispose();
    this.figures?.dispose();
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

  /**
   * Puts the free camera at a viewpoint of the whole pitch (cameras.ts
   * VIEWPOINTS), from where the mouse moves it on; the mode becomes free.
   */
  viewFrom(viewpoint: Viewpoint): void {
    this.setCameraMode('free');
    const pose = viewpointPose(viewpoint, this.width / this.height);
    this.cameraPosition = pose.position;
    this.cameraTarget = pose.target;
    this.perspective.fov = CAMERA_FOV;
    this.perspective.updateProjectionMatrix();
    this.applyPerspective();
    this.updateControls();
    this.settled = true;
    this.onInvalidate?.();
  }

  /** How far from what they follow and how high the close-up cameras are; they glide there. */
  setCloseup(options: CloseupOptions): void {
    if (
      options.distance === this.closeup.distance &&
      options.elevation === this.closeup.elevation
    ) {
      return;
    }
    this.closeup = { ...options };
    this.settled = false;
    this.onInvalidate?.();
  }

  /**
   * The wheel over a close-up camera: about 1.1 times as far (or near) a
   * notch, within the distance's range. Other cameras leave the wheel to the
   * controls, which make them free.
   */
  private closeupWheel(e: WheelEvent): void {
    if (!isCloseup(this.mode)) {
      return;
    }
    e.preventDefault();
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE;
    const pixels =
      e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * 400 : e.deltaY * (lines ? 33 : 1);
    if (pixels === 0) {
      return;
    }
    const { min, max } = CLOSEUP_RANGE.distance;
    const d = Math.min(max, Math.max(min, this.closeup.distance * Math.exp(pixels * 0.001)));
    this.setCloseup({ ...this.closeup, distance: d });
    this.onCloseupDistanceChange?.(d);
  }

  /** The styles of the selected player's camera and what it draws; it starts again at once. */
  setPlayerCamera(options: PlayerCameraOptions): void {
    const o = this.playerCameraOptions;
    const same = (Object.keys(options) as (keyof PlayerCameraOptions)[]).every(
      (k) => options[k] === o[k],
    );
    if (same) {
      return;
    }
    this.playerCameraOptions = { ...options };
    this.playerCamera.reset();
    this.settled = false;
    this.onInvalidate?.();
  }

  /**
   * The players as the cylinders (simple) or as human figures (figures/),
   * whose model is loaded when chosen (the cylinders until it is ready).
   */
  setPlayerModel(model: PlayerModel): void {
    if (model === this.playerModel) {
      return;
    }
    this.playerModel = model;
    if (this.figures) {
      this.scene.remove(this.figures.group);
      this.figures.dispose();
      this.figures = null;
    }
    const use = (f: Figures) => {
      if (this.playerModel !== model) {
        f.dispose();
        return;
      }
      this.figures = f;
      this.scene.add(f.group);
      this.onInvalidate?.();
    };
    if (model === 'figure') {
      void import('./figures/gltf').then((m) => {
        use(new m.GltfFigures(m.MANNEQUIN, () => this.onInvalidate?.()));
      });
    }
    this.onInvalidate?.();
  }

  /** Shows or hides the boards around the pitch and the banners behind the goals. */
  setStadium(shown: { boards: boolean; banners: boolean }): void {
    this.stadium.show(shown);
    this.onInvalidate?.();
  }

  /** Which guides (the compass, the minimap) the HUD draws with which cameras. */
  setGuides(guides: { compass: GuideMode; minimap: GuideMode }): void {
    if (guides.compass !== this.guides.compass || guides.minimap !== this.guides.minimap) {
      this.guides = { ...guides };
      this.onInvalidate?.();
    }
  }

  guide(): CameraGuide | null {
    const compass = guideShown(this.guides.compass, this.mode);
    const minimap = guideShown(this.guides.minimap, this.mode);
    if (!compass && !minimap) {
      return null;
    }
    const p = this.cameraPosition;
    const t = this.cameraTarget;
    const tan = Math.tan((this.perspective.fov / 2) * DEG2RAD) * this.perspective.aspect;
    return {
      x: p.x,
      y: p.z,
      direction: Math.atan2(t.z - p.z, t.x - p.x) * RAD2DEG,
      fov: 2 * Math.atan(tan) * RAD2DEG,
      compass,
      minimap,
    };
  }

  /** For the end-to-end tests. */
  inspect(): Render3DState {
    const at = (o: Object3D) => ({ visible: o.visible, ...world(o.position) });
    return {
      ball: at(this.ball),
      shadow: at(this.shadow),
      ...this.counts,
      staminaBars: this.staminaBars,
      overlays: this.overlays.inspect(),
      figures: this.figures?.inspect() ?? null,
      labels: this.numbers.map((s, i) => (s.visible ? (this.numberTexts[i] ?? '') : '')),
      numberPositions: this.numbers.map((s) => (s.visible ? world(s.position) : null)),
      numberHeight: LABEL_SCALE * this.labelK,
      largestNumber: this.largestNumber,
      stadium: {
        ...this.stadium.inspect(),
        nets: this.nets.map((m) => `#${m.color.getHexString()}`),
      },
      camera: {
        mode: this.mode,
        position: this.cameraPosition,
        target: this.cameraTarget,
        fov: this.mode === 'top' ? 0 : this.perspective.fov,
      },
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
    // The close-up cameras take the wheel for their distance (closeupWheel).
    c.enableZoom = !isCloseup(this.mode);
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
    const aspect = this.width / this.height;
    const player = this.mode === 'player' ? selectedPlayer(frame, view) : null;
    if (this.snap || !player) {
      this.playerCamera.reset();
    }
    if (player) {
      // The player's place interpolates already; the direction and the field
      // of view follow its style.
      this.snap = false;
      const { pose, settled } = this.playerCamera.update(
        player,
        aspect,
        this.playerCameraOptions,
        dt,
      );
      this.settled = settled;
      this.cameraPosition = pose.position;
      this.cameraTarget = pose.target;
      this.setFov(pose.fov);
      this.applyPerspective();
      return;
    }
    // Without a selected, connected player, the player camera is the broadcast one.
    const pose = this.pose(frame, view, aspect);
    // These glide after the ball (or the player), the close-up ones closer behind.
    const glide = !this.snap;
    this.snap = false;
    const tau = isCloseup(this.mode) ? closeupTimeConstant(this.closeup.distance) : undefined;
    const position = glide
      ? smoothToward(this.cameraPosition, pose.position, dt, tau)
      : pose.position;
    const target = glide ? smoothToward(this.cameraTarget, pose.target, dt, tau) : pose.target;
    this.settled =
      distance(position, pose.position) < SETTLED && distance(target, pose.target) < SETTLED;
    // Once still, exactly where it goes.
    this.cameraPosition = this.settled ? pose.position : position;
    this.cameraTarget = this.settled ? pose.target : target;
    this.setFov(pose.fov);
    this.applyPerspective();
  }

  private setFov(fov: number): void {
    if (Math.abs(this.perspective.fov - fov) > 1e-6) {
      this.perspective.fov = fov;
      this.perspective.updateProjectionMatrix();
    }
  }

  private pose(frame: Frame | null, view: ViewState, aspect: number): CameraPose {
    const ball = frame?.ball ?? { x: 0, y: 0 };
    switch (this.mode) {
      case 'goal-left':
        return goalPose(-1, ball);
      case 'goal-right':
        return goalPose(1, ball);
      case 'closeup-player': {
        // Without a selected, connected player, the ball's.
        const p = selectedPlayer(frame, view);
        return p
          ? closeupPose(p, CLOSEUP_PLAYER_HEIGHT, this.closeup)
          : closeupPose(ball, 0, this.closeup);
      }
      case 'closeup-ball':
        return closeupPose(ball, 0, this.closeup);
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

  private instanced(
    geometry: BufferGeometry,
    material: Material,
    renderOrder = 0,
    perPlayer = 1,
  ): InstancedMesh {
    const mesh = new InstancedMesh(this.track(geometry), material, PLAYERS * perPlayer);
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

    // The net: translucent back, sides and roof, in the color of the team that keeps it.
    const net = this.track(
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.nets.push(net);
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

  /** A label above a player's head for its number (and type), written by setNumberText. */
  private numberSprite(): Sprite {
    const c = document.createElement('canvas');
    c.width = LABEL_WIDTH;
    c.height = LABEL_HEIGHT;
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set((LABEL_SCALE * LABEL_WIDTH) / LABEL_HEIGHT, LABEL_SCALE, 1);
    sprite.renderOrder = 3;
    sprite.visible = false;
    return sprite;
  }

  /**
   * Writes a number label again when its text or the player font (the Font
   * tab's family and weight) changes, and puts the card to its right.
   */
  private setNumberText(i: number, text: string, font: FontSpec): void {
    const sprite = this.numbers[i];
    const map = sprite?.material.map;
    const css = `${font.bold ? 'bold ' : ''}${LABEL_FONT}px ${font.family}`;
    const key = `${css}|${text}`;
    if (!sprite || !map || this.numberKeys[i] === key) {
      return;
    }
    this.numberKeys[i] = key;
    this.numberTexts[i] = text;
    const c = map.image as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = css;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, c.width / 2, 34, c.width - 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, c.width / 2, 34, c.width - 8);
    map.needsUpdate = true;
    const width = (Math.min(c.width - 8, ctx.measureText(text).width) * LABEL_SCALE) / LABEL_HEIGHT;
    this.numberWidths[i] = width;
    this.cards[i]?.center.set(-(width / 2 + 0.08) / CARD_WIDTH, 0.5);
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
    // A new geometry: a new attribute on the old one would leave its GPU buffer behind.
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(points, 3));
    g.computeBoundingSphere();
    this.largeView.geometry.dispose();
    this.largeView.geometry = g;
  }

  // ---- updating

  /** The ends in the team colors, with the team names and logos. */
  private updateStadium(scene: SceneSnapshot | null, view: ViewState): void {
    const colors = [view.colors.leftTeam, view.colors.rightTeam] as const;
    this.nets.forEach((m, i) => m.color.set(colors[i] ?? '#ffffff'));
    const look = (i: 0 | 1) => ({
      color: colors[i],
      name: scene?.frame.teams[i].name ?? '',
      logo: view.options.showTeamGraphic ? (scene?.store.teamGraphics[i] ?? null) : null,
    });
    this.stadium.update([look(0), look(1)]);
  }

  private updateField(view: ViewState, sp: ServerParam): void {
    const key = fieldTextureKey(view, sp);
    if (key !== this.fieldKey) {
      this.fieldKey = key;
      paintFieldTexture(this.fieldCanvas, view, sp);
      this.fieldTexture.needsUpdate = true;
    }
  }

  /**
   * What the player camera's player perceives (sight.ts), decided on the
   * frame of the cycle, not between frames. Everything for the other cameras.
   */
  private updateSight(scene: SceneSnapshot | null, view: ViewState, sp: ServerParam): void {
    this.perceptions = null;
    this.ballPerceived = true;
    const sight = this.playerCameraOptions.sight;
    if (!scene || this.mode !== 'player' || sight === 'all') {
      return;
    }
    const observer = selectedPlayer(scene.frame, view);
    if (!observer) {
      return;
    }
    const type = scene.store.playerType(observer.type);
    const list = new Array<Perception | undefined>(PLAYERS);
    for (const p of scene.frame.players) {
      if (isAlive(p)) {
        list[index(p)] = p === observer ? FULL : perceivePlayer(sight, observer, p, type, sp);
      }
    }
    this.perceptions = list;
    this.ballPerceived = perceiveBall(sight, observer, scene.frame.ball, type, sp);
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
    // The labels' size: from the top camera, the 2D player font's on the screen.
    // The sprites take it (or their own, nearer the camera) in fitLabels.
    const k = this.labelScaleFor(view);
    this.labelK = k;
    const color = this.color;
    // Figures, once loaded, but not from above (the cylinders show more
    // there) and not for players whose directions the player camera's
    // player does not know (a figure would show them).
    const figures = (this.figures?.inspect().ready ?? false) && this.mode !== 'top';
    let n = 0;
    let cylinders = 0;
    let facings = 0;
    let rings = 0;
    let decays = 0;
    let cards = 0;
    let unknownTeams = 0;
    const drawn: PlayerState[] = [];
    const figureInputs: FigureInput[] = [];
    const barred: PlayerState[] = [];
    const o2 = view.options;
    // Others' stamina is not in what the server tells a player.
    const hasBars = (p: PlayerState, selected: boolean) =>
      (o2.showStamina || (o2.showStaminaCapacity && capacityRate(p, sp) !== null)) &&
      (!this.perceptions || selected);
    /** The numbers to draw and their opacity. */
    const numbered = new Map<number, { opacity: number; text: string; illegal: boolean }>();
    const carded = new Set<number>();
    // At the eyes, the player camera does not see its own head.
    const self =
      this.mode === 'player' && this.playerCameraOptions.position === 'eye' ? view.selected : null;
    for (const p of players) {
      const type = store?.playerType(p.type);
      if (!type || (self && p.side === self.side && p.unum === self.unum)) {
        continue;
      }
      const i = index(p);
      const seen = this.perceptions ? this.perceptions[i] : FULL;
      if (!seen?.seen) {
        continue;
      }
      // Only felt (outside the view, near), or too far to tell the team.
      const known = seen.team > 0;
      if (seen.team < 1) {
        ++unknownTeams;
      }
      const size = playerSize(view.options, sp, type);
      const selected = view.isSelected(p.side, p.unum);
      const barsOver = hasBars(p, selected);
      const asFigure = figures && seen.facing;
      const s = asFigure ? FIGURE_SCALE : 1;
      const labelHeight = NUMBER_HEIGHT * s + (barsOver ? BAR_LIFT : 0);
      const style = playerStyle(view.colors, view.options, sp, type, p, selected);
      const teamColor = (c: string) => color.set(c).lerp(this.unknownTeam, 1 - seen.team);

      o.rotation.set(0, 0, 0);
      o.position.set(p.x, (BODY_HEIGHT * s) / 2, p.y);
      o.scale.set(size.body * s, BODY_HEIGHT * s, size.body * s);
      o.updateMatrix();
      teamColor(style.body);
      this.pickBodies.setMatrixAt(n, o.matrix);
      if (!asFigure) {
        this.bodies.setMatrixAt(cylinders, o.matrix);
        this.bodies.setColorAt(cylinders, color);
      } else {
        figureInputs.push({ index: i, player: p, color: color.clone() });
      }

      o.position.set(p.x, HEAD_HEIGHT * s, p.y);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.pickHeads.setMatrixAt(n, o.matrix);
      if (!asFigure) {
        this.heads.setMatrixAt(cylinders, o.matrix);
        this.heads.setColorAt(cylinders, color);
        ++cylinders;
      }

      // The circle on the ground, in the team or state color, as the 2D outer circle.
      o.position.set(p.x, 0.02, p.y);
      o.scale.set(size.ground, 1, size.ground);
      o.updateMatrix();
      teamColor(style.brush);
      this.discs.setMatrixAt(n, o.matrix);
      this.discs.setColorAt(n, color);
      // Its outline when highlighted (kick, tackle, illegal defense, selected).
      if (known && style.pen.width >= 2) {
        o.position.y = 0.03;
        o.updateMatrix();
        color.set(style.pen.color);
        this.rings.setMatrixAt(rings, o.matrix);
        this.rings.setColorAt(rings, color);
        ++rings;
      }
      if (known && style.decay) {
        o.position.y = 0.03;
        o.updateMatrix();
        color.set(style.decay);
        this.decayRings.setMatrixAt(decays, o.matrix);
        this.decayRings.setColorAt(decays, color);
        ++decays;
      }

      // The figures show where they face themselves.
      if (seen.facing && !asFigure) {
        o.scale.set(1, 1, 1);
        o.position.set(p.x, BODY_HEIGHT * 0.7, p.y);
        o.rotation.set(0, yaw(p.body), 0);
        o.translateX(size.body * 0.8);
        o.updateMatrix();
        this.noses.setMatrixAt(facings, o.matrix);

        o.position.set(p.x, HEAD_HEIGHT, p.y);
        o.rotation.set(0, yaw(headDirection(p)), 0);
        o.translateX(HEAD_RADIUS * 0.8);
        o.updateMatrix();
        this.faces.setMatrixAt(facings, o.matrix);
        ++facings;
      }

      const text = numberText(p, view.options);
      const shown = seen.unum > 0 && text !== '';
      if (shown) {
        // Now, for its width.
        this.setNumberText(i, text, view.fonts.player);
      }
      const place = this.labelPlace(
        p,
        k,
        size.ground,
        shown ? (this.numberWidths[i] ?? 0) : 0,
        labelHeight,
      );
      this.barAnchors[i] = place.bars;
      this.labelBases[i] = (HEAD_HEIGHT + HEAD_RADIUS) * s;
      if (shown) {
        const illegal = view.options.showIllegalDefense && isIllegalDefense(p);
        numbered.set(i, { opacity: seen.unum, text, illegal });
        this.numbers[i]?.position.set(place.number.x, place.number.y, place.number.z);
      }
      const card = this.cards[i];
      if (card && known) {
        const red = hasRedCard(p);
        if (view.options.showCard && (red || hasYellowCard(p))) {
          carded.add(i);
          card.position.set(place.number.x, place.number.y, place.number.z);
          card.material.color.set(red ? '#ff0000' : '#ffff00');
          ++cards;
        }
      }
      if (barsOver) {
        barred.push(p);
      }
      drawn.push(p);
      ++n;
    }
    this.drawnPlayers = drawn;
    this.figureInputs = figureInputs;
    this.barred = barred;
    const done = (mesh: InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    };
    for (const mesh of [this.pickBodies, this.pickHeads, this.discs]) {
      done(mesh, n);
    }
    done(this.bodies, cylinders);
    done(this.heads, cylinders);
    done(this.noses, facings);
    done(this.faces, facings);
    done(this.rings, rings);
    done(this.decayRings, decays);
    this.noseMaterial.color.set(view.colors.playerPen);
    this.faceMaterial.color.set(view.colors.neck);
    let numbers = 0;
    let fadingNumbers = 0;
    this.numbers.forEach((s, i) => {
      const label = numbered.get(i);
      const opacity = label?.opacity ?? 0;
      s.visible = opacity > 0;
      s.material.opacity = opacity;
      if (label) {
        this.setNumberText(i, label.text, view.fonts.player);
        s.material.color.set(label.illegal ? view.colors.illegalDefense : '#ffffff');
      }
      if (s.visible) {
        ++numbers;
        fadingNumbers += opacity < 1 ? 1 : 0;
      }
    });
    this.cards.forEach((c, i) => {
      c.visible = carded.has(i);
    });
    this.counts = {
      ...this.counts,
      players: n,
      cylinders,
      numbers,
      fadingNumbers,
      facings,
      unknownTeams,
      rings,
      cards,
    };
  }

  /**
   * Where a player's number label (its center) and its bars (the center of
   * their column, before going down) are. From the side, above the head.
   * From above (the top camera), as the 2D view writes the number: to the
   * right of the circle on the ground (the kickable area, or the Player
   * Size; `ground` m), the foot of the text at the player's center; the
   * bars under it, from the same left end.
   */
  private labelPlace(
    p: PlayerState,
    k: number,
    ground: number,
    textWidth: number,
    height: number,
  ): { number: World; bars: World } {
    if (this.mode !== 'top') {
      const above = { x: p.x, y: height, z: p.y };
      return { number: above, bars: above };
    }
    // The top camera's screen: right is +X, up is -Z.
    const left = p.x + ground + LABEL_GAP * k;
    const z = p.y - NUMBER_TEXT_HALF * k;
    return {
      number: { x: left + (textWidth * k) / 2, y: height, z },
      bars: { x: left + (BAR.width / 2 + BAR.frame) * k, y: height, z },
    };
  }

  /**
   * How many times their size in meters the labels (the numbers, the cards
   * and the stamina bars) are drawn: 1, but from the top camera, so that the
   * number's text is as high on the screen as the 2D view's player font
   * (the Font tab), whatever the size of the canvas.
   */
  private labelScaleFor(view: ViewState): number {
    if (this.mode !== 'top') {
      return 1;
    }
    const perMeter = this.height / Math.max(1e-6, this.ortho.top - this.ortho.bottom);
    const labelHeight = (view.fonts.player.size * LABEL_HEIGHT) / LABEL_FONT / perMeter;
    return labelHeight / LABEL_SCALE;
  }

  /**
   * The size of each player's labels (its number, card and bars), once the
   * camera has moved. From the top camera, labelScaleFor's for all. From
   * the others, their size in meters, but at most so large that the
   * number's text is LABEL_MAX_FONT times the 2D player font high on the
   * screen: nearer, they shrink toward the head, so that the labels of the
   * players near the camera (the close-up and player cameras) do not cover
   * what it looks at.
   */
  private fitLabels(view: ViewState): void {
    const top = this.mode === 'top';
    const camera = this.perspective;
    const eye = camera.position;
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    // Pixels per meter, 1 m in front of the camera; per meter from the top camera.
    const focal = this.height / (2 * Math.tan((camera.fov / 2) * DEG2RAD));
    const perMeter = this.height / Math.max(1e-6, this.ortho.top - this.ortho.bottom);
    const text = 2 * NUMBER_TEXT_HALF;
    const most = LABEL_MAX_FONT * view.fonts.player.size;
    let largest = 0;
    for (const p of this.drawnPlayers) {
      const i = index(p);
      const a = this.barAnchors[i];
      if (!a) {
        continue;
      }
      let k = this.labelK;
      let pixels = text * k * perMeter;
      if (!top) {
        const depth =
          (a.x - eye.x) * forward.x + (a.y - eye.y) * forward.y + (a.z - eye.z) * forward.z;
        // Behind the camera: not drawn.
        const full = depth > 0.01 ? (text * focal) / depth : 0;
        k = full > most ? most / full : 1;
        pixels = full * k;
        const base = this.labelBases[i] ?? 0;
        const at = { x: a.x, y: base + k * (a.y - base), z: a.z };
        this.barAnchors[i] = at;
        this.numbers[i]?.position.set(at.x, at.y, at.z);
        this.cards[i]?.position.set(at.x, at.y, at.z);
      }
      this.labelKs[i] = k;
      const number = this.numbers[i];
      number?.scale.set((LABEL_SCALE * k * LABEL_WIDTH) / LABEL_HEIGHT, LABEL_SCALE * k, 1);
      this.cards[i]?.scale.set(CARD_WIDTH * k, 0.6 * k, 1);
      if (number?.visible) {
        largest = Math.max(largest, pixels);
      }
    }
    this.largestNumber = largest;
  }

  /**
   * The stamina bars of the players found by updatePlayers, facing the
   * camera (after it moved): a dark background, and the fill from the left,
   * colored by the stamina (staminaHue); the capacity bar below it. They are
   * under the number as the camera sees it, along the camera's down: from
   * above (the top camera), a height would put them on the number.
   */
  private updateBars(view: ViewState, sp: ServerParam): void {
    const o = this.o;
    const q = this.camera.quaternion;
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    const down = new Vector3(0, -1, 0).applyQuaternion(q);
    const at = new Vector3();
    const color = this.color;
    let backs = 0;
    let fills = 0;
    const bars: Render3DState['staminaBars'][number][] = [];
    // With the number's size (fitLabels).
    let k = this.labelK;
    let width = BAR.width;
    let frame = BAR.frame;
    /** A bar whose top is `from` below the number's center; returns how far below it ends. */
    const bar = (from: number, height: number, rate: number, fill: Color): number => {
      o.quaternion.copy(q);
      o.position.copy(at).addScaledVector(down, from + height / 2);
      o.scale.set(width + 2 * frame, height + 2 * frame, 1);
      o.updateMatrix();
      this.barBacks.setMatrixAt(backs++, o.matrix);
      if (rate > 0) {
        // From the left end of the bar.
        o.position.addScaledVector(right, (-(1 - rate) * width) / 2);
        o.scale.set(width * rate, height, 1);
        o.updateMatrix();
        this.barFills.setMatrixAt(fills, o.matrix);
        this.barFills.setColorAt(fills, fill);
        ++fills;
      }
      return from + height + BAR.gap * k;
    };
    for (const p of this.barred) {
      const capacity = view.options.showStaminaCapacity ? capacityRate(p, sp) : null;
      const stamina = view.options.showStamina ? staminaRate(p, sp) : null;
      // Under the number (updatePlayers placed it, fitLabels sized it).
      const anchor = this.barAnchors[index(p)] ?? { x: p.x, y: NUMBER_HEIGHT + BAR_LIFT, z: p.y };
      k = this.labelKs[index(p)] ?? this.labelK;
      width = BAR.width * k;
      frame = BAR.frame * k;
      at.set(anchor.x, anchor.y, anchor.z);
      let from = (NUMBER_TEXT_HALF + BAR.gap) * k;
      if (stamina !== null) {
        const hue = staminaHue(stamina, sp) / 360;
        from = bar(from, BAR.stamina * k, stamina, color.setHSL(hue, 0.85, 0.5));
      }
      if (capacity !== null) {
        bar(from, BAR.capacity * k, capacity, color.set(CAPACITY_COLOR));
      }
      // The first bar's center, for the tests.
      const center = at.clone().addScaledVector(down, (NUMBER_TEXT_HALF + BAR.gap + 0.05) * k);
      bars.push({ side: p.side, unum: p.unum, stamina, capacity, at: world(center) });
    }
    for (const [mesh, count] of [
      [this.barBacks, backs],
      [this.barFills, fills],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.staminaBars = bars;
  }

  /**
   * The human figures of the players updatePlayers chose for them, by the
   * game's time: the animations stop with the pause and speed up with fast
   * forward.
   */
  private updateFigures(scene: SceneSnapshot | null, sp: ServerParam): void {
    const figures = this.figures;
    const step = (sp.simulator_step || 100) / 1000;
    if (!figures) {
      return;
    }
    figures.update(this.figureInputs, {
      store: scene?.store ?? null,
      frameIndex: scene?.frameIndex ?? 0,
      next: scene?.next,
      alpha: scene?.alpha ?? 0,
      step,
      catchCycles: sp.catch_ban_cycle,
    });
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
      // With the player camera's sight, only the players whose face direction it knows.
      if (!isAlive(p) || (this.perceptions && !this.perceptions[index(p)]?.facing)) {
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
    const shown = ball !== undefined && view.options.showBall && this.ballPerceived;
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
