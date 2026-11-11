// The overlays of the players and the ball in the 3D view, on the ground,
// as the 2D view draws them: the players' body and face directions within
// the kickable area (always, as PlayerPainter drawDir), and those of the
// Show tab's options (overlay-math.ts): the focus point and the kick acceleration area of the selected player,
// the goalies' catch areas, the tackle areas, the pointto lines, the
// offside lines and the ball's path. The stamina bars are in render3d.ts.
//
// All the lines are one LineSegments (one draw call), the dotted ones
// another, and the ball's path points a Points, written every frame into
// buffers that are kept (Vertices). Their texts (the tackle and
// foul chances, the largest kick acceleration) are labels that the HUD
// writes in the player font, as the 2D view does.
//
// With the player camera's sight, only the players whose directions the
// player perceives have overlays (also the direction lines), and the ball's path only when it sees the
// ball. The offside lines are the game's, whatever the sight.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';
import { PITCH, Side } from '../../core/constants';
import { isAlive, isGoalie, type Frame, type PlayerState } from '../../core/frame';
import { DEG2RAD, rotate, type Vec2 } from '../../core/geometry';
import type { PlayerType, ServerParam } from '../../core/params';
import {
  ballPath,
  catchAreaRadii,
  focusPointOf,
  kickAccel,
  offsideLines,
  tackleChances,
  tackleText,
} from '../overlay-math';
import { darker } from '../palette';
import type { ViewState } from '../view-state';

/** Above the ground, the circles and the view areas. */
const HEIGHT = 0.045;
/** Segments of a whole circle. */
const CIRCLE = 48;
/** The ball's path ends when it moves less than this a cycle (m). */
const MIN_STEP = 0.01;
/** Half the size of the pointto cross (m). */
const CROSS = 0.4;

/** A text at a field point, for the HUD. */
export interface OverlayLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: string;
}

/** What the end-to-end tests read: how many of each overlay, and the labels. */
export interface OverlayState {
  /** The players with their body's direction drawn, and with their face's. */
  readonly bodyLines: number;
  readonly neckLines: number;
  readonly focusPoints: number;
  readonly catchAreas: number;
  readonly tackleAreas: number;
  readonly kickAccelAreas: number;
  readonly pointtos: number;
  readonly offsideLines: number;
  readonly ballPath: number;
  readonly labels: readonly string[];
}

/**
 * Vertices written every frame into buffers that are kept: a new attribute
 * every frame would leave its GPU buffer behind, as three.js frees the
 * buffers of the attributes a geometry has when it is disposed. When a frame
 * needs more, a geometry twice as large replaces it (the old one disposed).
 */
class Vertices {
  geometry = new BufferGeometry();
  private capacity = 0;

  constructor(
    private readonly names: readonly (readonly [string, number])[],
    initial = 1024,
  ) {
    this.allocate(initial);
  }

  /** Writes the vertices (by attribute name) and returns the geometry to draw, which may be new. */
  write(data: Readonly<Record<string, readonly number[]>>, count: number): BufferGeometry {
    if (count > this.capacity) {
      this.allocate(Math.max(count, this.capacity * 2));
    }
    const g = this.geometry;
    if (count > 0) {
      for (const [name, size] of this.names) {
        const a = g.getAttribute(name) as BufferAttribute;
        (a.array as Float32Array).set(data[name] ?? [], 0);
        a.clearUpdateRanges();
        a.addUpdateRange(0, count * size);
        a.needsUpdate = true;
      }
    }
    g.setDrawRange(0, count);
    return g;
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private allocate(capacity: number): void {
    this.geometry.dispose();
    const g = new BufferGeometry();
    for (const [name, size] of this.names) {
      const a = new BufferAttribute(new Float32Array(capacity * size), size);
      g.setAttribute(name, a.setUsage(DynamicDrawUsage));
    }
    this.geometry = g;
    this.capacity = capacity;
  }
}

/** Line segments built every frame; dashed ones with their distances along the line. */
class Segments {
  readonly object: LineSegments;
  private readonly vertices: Vertices;
  private readonly dashed: boolean;
  private positions: number[] = [];
  private colors: number[] = [];

  constructor(material: LineBasicMaterial) {
    this.dashed = material instanceof LineDashedMaterial;
    this.vertices = new Vertices([
      ['position', 3],
      ['color', 3],
      ...(this.dashed ? [['lineDistance', 1] as const] : []),
    ]);
    this.object = new LineSegments(this.vertices.geometry, material);
    this.object.frustumCulled = false; // the geometry changes every frame
    this.object.renderOrder = 2;
  }

  clear(): void {
    this.positions = [];
    this.colors = [];
  }

  line(a: Vec2, b: Vec2, c: Color): void {
    this.positions.push(a.x, HEIGHT, a.y, b.x, HEIGHT, b.y);
    this.colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }

  /** An arc around `center` from `start` degrees clockwise on the 2D screen by `span`. */
  arc(center: Vec2, radius: number, c: Color, start = 0, span = 360): void {
    const n = Math.max(4, Math.ceil((CIRCLE * span) / 360));
    let last = point(center, radius, start);
    for (let i = 1; i <= n; ++i) {
      const next = point(center, radius, start + (span * i) / n);
      this.line(last, next, c);
      last = next;
    }
  }

  flush(): void {
    const count = this.positions.length / 3;
    const data: Record<string, number[]> = { position: this.positions, color: this.colors };
    if (this.dashed) {
      // As LineSegments.computeLineDistances: along each segment, on from the last.
      const p = this.positions;
      const d: number[] = [];
      for (let i = 0; i < count; i += 2) {
        const from = i === 0 ? 0 : (d[i - 1] ?? 0);
        const k = i * 3;
        const length = Math.hypot(
          (p[k + 3] ?? 0) - (p[k] ?? 0),
          (p[k + 4] ?? 0) - (p[k + 1] ?? 0),
          (p[k + 5] ?? 0) - (p[k + 2] ?? 0),
        );
        d.push(from, from + length);
      }
      data['lineDistance'] = d;
    }
    this.object.geometry = this.vertices.write(data, count);
    this.object.visible = count > 0;
  }

  dispose(): void {
    this.vertices.dispose();
  }
}

const point = (center: Vec2, radius: number, deg: number): Vec2 => ({
  x: center.x + radius * Math.cos(deg * DEG2RAD),
  y: center.y + radius * Math.sin(deg * DEG2RAD),
});

export class Overlays {
  readonly group = new Group();
  private readonly materials = {
    solid: new LineBasicMaterial({ vertexColors: true }),
    dotted: new LineDashedMaterial({ vertexColors: true, dashSize: 0.3, gapSize: 0.3 }),
    points: new PointsMaterial({ vertexColors: true, size: 4, sizeAttenuation: false }),
  };
  private readonly solid = new Segments(this.materials.solid);
  private readonly dotted = new Segments(this.materials.dotted);
  private readonly dotVertices = new Vertices([
    ['position', 3],
    ['color', 3],
  ]);
  private readonly dots = new Points(this.dotVertices.geometry, this.materials.points);
  private readonly color = new Color();
  private labelList: OverlayLabel[] = [];
  private state: OverlayState = {
    bodyLines: 0,
    neckLines: 0,
    focusPoints: 0,
    catchAreas: 0,
    tackleAreas: 0,
    kickAccelAreas: 0,
    pointtos: 0,
    offsideLines: 0,
    ballPath: 0,
    labels: [],
  };

  constructor() {
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 2;
    this.group.add(this.solid.object, this.dotted.object, this.dots);
  }

  /** The texts to write, at field points. */
  get labels(): readonly OverlayLabel[] {
    return this.labelList;
  }

  inspect(): OverlayState {
    return this.state;
  }

  /**
   * Builds the overlays of `frame` (interpolated, as the figures). `facing`
   * tells whether the player camera's player perceives a player's
   * directions; `ballSeen` whether it sees the ball.
   */
  update(
    frame: Frame | null,
    view: ViewState,
    sp: ServerParam,
    playerType: (id: number) => PlayerType,
    facing: (p: PlayerState) => boolean,
    ballSeen: boolean,
  ): void {
    this.solid.clear();
    this.dotted.clear();
    this.labelList = [];
    const counts = {
      bodyLines: 0,
      neckLines: 0,
      focusPoints: 0,
      catchAreas: 0,
      tackleAreas: 0,
      kickAccelAreas: 0,
      pointtos: 0,
      offsideLines: 0,
      ballPath: 0,
    };
    const dots: number[] = [];
    const o = view.options;
    const colors = view.colors;
    const c = this.color;
    if (frame && o.showPlayer) {
      for (const p of frame.players) {
        if (!isAlive(p) || !facing(p)) {
          continue;
        }
        const type = playerType(p.type);
        const selected = view.isSelected(p.side, p.unum);
        // From the center to the kickable area's edge: the body's direction,
        // and the face's unless the view area shows it.
        const reach = type.player_size + type.kickable_margin + sp.ball_size;
        c.set(colors.playerPen);
        this.solid.line(p, point(p, reach, p.body), c);
        ++counts.bodyLines;
        if (!o.showViewArea) {
          c.set(colors.neck);
          this.solid.line(p, point(p, reach, p.body + p.neck), c);
          ++counts.neckLines;
        }
        const fp = o.showFocusPoint && selected ? focusPointOf(p) : null;
        if (fp) {
          c.set(colors.focusPoint);
          this.solid.line(p, fp, c);
          this.solid.arc(fp, o.focusPointSize, c);
          ++counts.focusPoints;
        }
        if (o.showCatchArea && isGoalie(p)) {
          this.catchArea(p, type, sp, view);
          ++counts.catchAreas;
        }
        if (o.showTackleArea && this.tackleArea(p, frame, sp, view)) {
          ++counts.tackleAreas;
        }
        if (o.showKickAccelArea && selected && this.kickAccelArea(p, type, frame, sp, view)) {
          ++counts.kickAccelAreas;
        }
        if (o.showPointto && p.point) {
          c.set(colors.pointto);
          const q = p.point;
          this.solid.line(p, q, c);
          this.solid.line(
            { x: q.x - CROSS, y: q.y - CROSS },
            { x: q.x + CROSS, y: q.y + CROSS },
            c,
          );
          this.solid.line(
            { x: q.x - CROSS, y: q.y + CROSS },
            { x: q.x + CROSS, y: q.y - CROSS },
            c,
          );
          ++counts.pointtos;
        }
      }
      if (o.showOffsideLine) {
        const half = PITCH.width / 2;
        offsideLines(frame).forEach((x, i) => {
          c.set(i === 0 ? colors.leftTeam : colors.rightTeam);
          this.solid.line({ x, y: -half }, { x, y: half }, c);
          ++counts.offsideLines;
        });
      }
    }
    if (frame && o.showBall && ballSeen && o.ballVelCycle > 0) {
      const path = ballPath(sp, frame.ball, o.ballVelCycle, MIN_STEP);
      const last = path.at(-1);
      if (last) {
        c.set(colors.ballVel);
        this.solid.line(frame.ball, last, c);
        for (const q of path) {
          dots.push(q.x, HEIGHT, q.y);
        }
        counts.ballPath = path.length;
      }
    }
    this.solid.flush();
    this.dotted.flush();
    const colorList: number[] = [];
    c.set(colors.ballVel);
    for (let i = 0; i < dots.length / 3; ++i) {
      colorList.push(c.r, c.g, c.b);
    }
    this.dots.geometry = this.dotVertices.write(
      { position: dots, color: colorList },
      dots.length / 3,
    );
    this.dots.visible = dots.length > 0;
    this.state = { ...counts, labels: this.labelList.map((l) => l.text) };
  }

  dispose(): void {
    this.solid.dispose();
    this.dotted.dispose();
    this.dotVertices.dispose();
    for (const m of Object.values(this.materials)) {
      m.dispose();
    }
  }

  /** The catchable circle, and the stretched ones dotted (player_painter.cpp drawCatchArea). */
  private catchArea(p: PlayerState, type: PlayerType, sp: ServerParam, view: ViewState): void {
    const color = p.side === Side.Left ? view.colors.leftGoalie : view.colors.rightGoalie;
    const radii = catchAreaRadii(sp, type);
    this.color.set(color);
    this.solid.arc(p, radii.catchable, this.color);
    if (radii.stretched) {
      this.color.set(darker(color, 200));
      for (const r of radii.stretched) {
        this.dotted.arc(p, r, this.color);
      }
    }
  }

  /** The tackle box, turned with the body, when a tackle or a foul may succeed. */
  private tackleArea(p: PlayerState, frame: Frame, sp: ServerParam, view: ViewState): boolean {
    const chances = tackleChances(sp, p, frame.ball);
    if (!chances) {
      return false;
    }
    const corner = (x: number, y: number) => {
      const r = rotate({ x, y }, p.body);
      return { x: p.x + r.x, y: p.y + r.y };
    };
    const corners = [
      corner(-sp.tackle_back_dist, -sp.tackle_width),
      corner(sp.tackle_dist, -sp.tackle_width),
      corner(sp.tackle_dist, sp.tackle_width),
      corner(-sp.tackle_back_dist, sp.tackle_width),
    ];
    this.color.set(view.colors.tackle);
    corners.forEach((a, i) => this.solid.line(a, corners[(i + 1) % 4] ?? a, this.color));
    this.labelList.push({ x: p.x, y: p.y, text: tackleText(chances), color: view.colors.tackle });
    return true;
  }

  /** Where the selected player can kick the ball to, when it can kick it. */
  private kickAccelArea(
    p: PlayerState,
    type: PlayerType,
    frame: Frame,
    sp: ServerParam,
    view: ViewState,
  ): boolean {
    const kick = kickAccel(sp, type, p, frame.ball);
    if (!kick) {
      return false;
    }
    this.color.set(view.colors.kickAccel);
    this.solid.line(frame.ball, kick.next, this.color);
    for (const arc of kick.arcs) {
      this.solid.arc(arc.center, arc.radius, this.color, arc.start, arc.span);
    }
    this.labelList.push({
      ...kick.next,
      text: `MaxAccel=${kick.maxAccel.toFixed(3)}`,
      color: view.colors.kickAccel,
    });
    return true;
  }
}
