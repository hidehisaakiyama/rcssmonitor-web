// The overlays of the players and the ball in the 3D view, on the ground,
// as the 2D view draws them (overlay-math.ts; the Show tab's options):
// the focus point and the kick acceleration area of the selected player,
// the goalies' catch areas, the tackle areas, the pointto lines, the
// offside lines and the ball's path. Not the stamina (the user's choice).
//
// All the lines are one LineSegments (one draw call), the dotted ones
// another, and the ball's path points a Points. Their texts (the tackle and
// foul chances, the largest kick acceleration) are labels that the HUD
// writes in the player font, as the 2D view does.
//
// With the player camera's sight, only the players whose directions the
// player perceives have overlays, and the ball's path only when it sees the
// ball. The offside lines are the game's, whatever the sight.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
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
  readonly focusPoints: number;
  readonly catchAreas: number;
  readonly tackleAreas: number;
  readonly kickAccelAreas: number;
  readonly pointtos: number;
  readonly offsideLines: number;
  readonly ballPath: number;
  readonly labels: readonly string[];
}

/** Line segments built anew every frame. */
class Segments {
  readonly object: LineSegments;
  private positions: number[] = [];
  private colors: number[] = [];

  constructor(material: LineBasicMaterial) {
    this.object = new LineSegments(new BufferGeometry(), material);
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

  get count(): number {
    return this.positions.length / 6;
  }

  flush(): void {
    const g = this.object.geometry;
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    if (this.object.material instanceof LineDashedMaterial) {
      this.object.computeLineDistances();
    }
    this.object.visible = this.positions.length > 0;
  }

  dispose(): void {
    this.object.geometry.dispose();
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
  private readonly dots = new Points(new BufferGeometry(), this.materials.points);
  private readonly color = new Color();
  private labelList: OverlayLabel[] = [];
  private state: OverlayState = {
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
    this.dots.geometry.setAttribute('position', new Float32BufferAttribute(dots, 3));
    this.dots.geometry.setAttribute('color', new Float32BufferAttribute(colorList, 3));
    this.dots.visible = dots.length > 0;
    this.state = { ...counts, labels: this.labelList.map((l) => l.text) };
  }

  dispose(): void {
    this.solid.dispose();
    this.dotted.dispose();
    this.dots.geometry.dispose();
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
