import { describe, expect, it } from 'vitest';
import { PlayerStateBit, Side } from '../../src/core/constants';
import { disabledPlayer, type Frame, type PlayerState } from '../../src/core/frame';
import { DEFAULT_PLAYER_TYPE, DEFAULT_SERVER_PARAM } from '../../src/core/params';
import {
  arcThrough,
  ballPath,
  catchAreaRadii,
  focusPointOf,
  kickAccel,
  tackleChances,
  tackleText,
} from '../../src/view/overlay-math';
import { Overlays } from '../../src/view/render3d/overlays';
import { capacityRate, staminaHue, staminaRate } from '../../src/view/render3d/scene-math';
import { ViewState } from '../../src/view/view-state';

const sp = DEFAULT_SERVER_PARAM;
const type = DEFAULT_PLAYER_TYPE;
const alive = (i: number, extra: Partial<PlayerState> = {}): PlayerState => ({
  ...disabledPlayer(i),
  state: PlayerStateBit.Stand,
  stamina: 8000,
  effort: 1,
  recovery: 1,
  viewWidth: 90,
  ...extra,
});
const ball = (x: number, y: number, vx = 0, vy = 0) => ({ x, y, vx, vy });

describe('the overlays of the players and the ball', () => {
  it('find the focus point from the face direction', () => {
    const p = alive(0, { x: 1, y: 2, body: 30, neck: 60, focusPoint: { dist: 10, dir: 0 } });
    const fp = focusPointOf(p);
    expect(fp?.x).toBeCloseTo(1);
    expect(fp?.y).toBeCloseTo(12); // 90 degrees: +y
    expect(focusPointOf(alive(0, { focusPoint: { dist: 0, dir: 0 } }))).toBeNull();
    expect(focusPointOf(alive(0))).toBeNull();
  });

  it('give the catch area, and the stretched ones only with a stretch', () => {
    const r = catchAreaRadii(sp, type);
    expect(r.catchable).toBeCloseTo(Math.hypot(sp.catchable_area_w / 2, sp.catchable_area_l));
    expect(r.stretched).toBeNull();
    const stretched = catchAreaRadii(sp, { ...type, catchable_area_l_stretch: 1.2 });
    const [max, min] = stretched.stretched ?? [0, 0];
    expect(max).toBeCloseTo(Math.hypot(sp.catchable_area_w / 2, sp.catchable_area_l * 1.2));
    expect(min).toBeCloseTo(Math.hypot(sp.catchable_area_w / 2, sp.catchable_area_l * 0.8));
  });

  it('give the tackle and foul chances in the tackle box, turned with the body', () => {
    // Facing +y, the ball 1 m ahead.
    const p = alive(0, { body: 90 });
    const chances = tackleChances(sp, p, ball(0, 1));
    expect(chances?.tackle).toBeCloseTo(1 - (1 / sp.tackle_dist) ** sp.tackle_exponent);
    expect(chances?.foul).toBeCloseTo(1 - (1 / sp.tackle_dist) ** sp.foul_exponent);
    expect(tackleText({ tackle: 0.5, foul: 0.25 })).toBe('T=0.5,F=0.25');
    expect(tackleText({ tackle: 0.5, foul: null })).toBe('Tackle=0.5');
    expect(tackleText({ tackle: null, foul: 0.123456 })).toBe('Foul=0.123');
    // Far away, or beside it beyond the width: none.
    expect(tackleChances(sp, p, ball(0, 5))).toBeNull();
    expect(tackleChances(sp, p, ball(sp.tackle_width + 0.5, 0.5))).toBeNull();
  });

  it('turn an arc clockwise through a direction', () => {
    expect(arcThrough(-30, 30, 0)).toEqual({ start: -30, span: 60 });
    expect(arcThrough(30, -30, 0)).toEqual({ start: -30, span: 60 });
    expect(arcThrough(-30, 30, 180)).toEqual({ start: 30, span: 300 });
  });

  it('give where the selected player can kick the ball to, when it is kickable', () => {
    const p = alive(0, { body: 0 });
    const kick = kickAccel(sp, type, p, ball(0.5, 0, 1, 0));
    const reach = type.player_size + type.kickable_margin + sp.ball_size;
    const expected =
      sp.maxpower *
      type.kick_power_rate *
      (1 - (0.25 * (0.5 - type.player_size - sp.ball_size)) / type.kickable_margin);
    expect(kick?.maxAccel).toBeCloseTo(Math.min(expected, sp.ball_accel_max));
    expect(kick?.next).toEqual({ x: 1.5, y: 0 });
    // The speed limit around the ball and the acceleration around its next place cross.
    expect(kick?.arcs).toHaveLength(2);
    expect(kick?.arcs[0]?.radius).toBe(sp.ball_speed_max);
    // Still: only the circle of the acceleration.
    const still = kickAccel(sp, type, p, ball(0.5, 0));
    expect(still?.arcs).toEqual([
      { center: { x: 0.5, y: 0 }, radius: still?.maxAccel, start: 0, span: 360 },
    ]);
    expect(kickAccel(sp, type, p, ball(reach + 0.1, 0))).toBeNull();
  });

  it("give the ball's path without noise, until it nearly stops", () => {
    const path = ballPath(sp, ball(0, 0, 1, 0), 3, 0.01);
    expect(path.map((q) => q.x)).toEqual([
      1,
      1 + sp.ball_decay,
      1 + sp.ball_decay + sp.ball_decay ** 2,
    ]);
    expect(ballPath(sp, ball(0, 0, 0.005, 0), 10, 0.01)).toEqual([]);
    expect(ballPath(sp, ball(0, 0, 3, 0), 500, 0.01).length).toBeLessThanOrEqual(100);
  });
});

describe('the 3D overlays', () => {
  const frame = (players: PlayerState[], b = ball(0.5, 0, 1, 0)): Frame =>
    ({
      time: 1,
      stime: 0,
      ball: b,
      players: Array.from(
        { length: 22 },
        (_, i) =>
          players.find(
            (p) => p.side === (i < 11 ? Side.Left : Side.Right) && p.unum === (i % 11) + 1,
          ) ?? disabledPlayer(i),
      ),
      mode: 2,
      teams: [
        { name: 'L', score: 0, penScore: 0, penMiss: 0 },
        { name: 'R', score: 0, penScore: 0, penMiss: 0 },
      ],
    }) as unknown as Frame;

  const view = () => {
    const v = new ViewState();
    Object.assign(v.options, {
      showFocusPoint: true,
      showCatchArea: true,
      showTackleArea: true,
      showKickAccelArea: true,
      showPointto: true,
      showOffsideLine: true,
      ballVelCycle: 5,
    });
    v.selectPlayer(1);
    return v;
  };

  it('draw what the Show options turn on, for the players it may', () => {
    const goalie = alive(0, {
      body: 0,
      state: PlayerStateBit.Stand | PlayerStateBit.Goalie,
      focusPoint: { dist: 5, dir: 0 },
      point: { x: 10, y: 10 },
    });
    const other = alive(13, { x: -1, y: 0, body: 0, point: { x: -10, y: 0 } });
    const o = new Overlays();
    const v = view();
    o.update(
      frame([goalie, other]),
      v,
      sp,
      () => type,
      () => true,
      true,
    );
    expect(o.inspect()).toEqual({
      focusPoints: 1,
      catchAreas: 1,
      tackleAreas: 2,
      kickAccelAreas: 1,
      pointtos: 2,
      offsideLines: 2,
      ballPath: 5,
      labels: [
        expect.stringMatching(/^T=/),
        expect.stringMatching(/^MaxAccel=/),
        expect.stringMatching(/^T=/),
      ],
    });
    // Those whose directions the player camera's player does not see have none,
    // nor the ball's path when it does not see the ball; the offside lines stay.
    o.update(
      frame([goalie, other]),
      v,
      sp,
      () => type,
      (p) => p === goalie,
      false,
    );
    expect(o.inspect()).toMatchObject({
      tackleAreas: 1,
      pointtos: 1,
      offsideLines: 2,
      ballPath: 0,
    });
    // All off.
    Object.assign(v.options, {
      showFocusPoint: false,
      showCatchArea: false,
      showTackleArea: false,
      showKickAccelArea: false,
      showPointto: false,
      showOffsideLine: false,
      ballVelCycle: 0,
    });
    o.update(
      frame([goalie, other]),
      v,
      sp,
      () => type,
      () => true,
      true,
    );
    expect(o.inspect()).toEqual({
      focusPoints: 0,
      catchAreas: 0,
      tackleAreas: 0,
      kickAccelAreas: 0,
      pointtos: 0,
      offsideLines: 0,
      ballPath: 0,
      labels: [],
    });
    o.dispose();
  });
});

describe('the stamina bars', () => {
  it('are as long as the stamina and the capacity left, red where recovery falls', () => {
    const p = alive(0, { stamina: 6000, capacity: 65300 });
    expect(staminaRate(p, sp)).toBeCloseTo(6000 / sp.stamina_max);
    expect(staminaRate(alive(0, { stamina: 9000 }), sp)).toBe(1);
    expect(capacityRate(p, sp)).toBeCloseTo(65300 / sp.stamina_capacity);
    expect(capacityRate(alive(0), sp)).toBeNull(); // text v4 logs
    expect(capacityRate(p, { ...sp, stamina_capacity: -1 })).toBeNull();
    // Red at or below recover_dec_thr / effort_dec_thr (0.3), green when full.
    expect(staminaHue(0.2, sp)).toBe(0);
    expect(staminaHue(0.3, sp)).toBe(0);
    expect(staminaHue(0.65, sp)).toBeCloseTo(60);
    expect(staminaHue(1, sp)).toBe(120);
  });
});
