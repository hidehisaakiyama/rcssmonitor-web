import { describe, expect, it } from 'vitest';
import { PITCH, PlayerStateBit, PlayMode } from '../../src/core/constants';
import { disabledPlayer, type Frame, type PlayerState } from '../../src/core/frame';
import { DEG2RAD, RAD2DEG } from '../../src/core/geometry';
import { DEFAULT_PLAYER_TYPE, DEFAULT_SERVER_PARAM } from '../../src/core/params';
import {
  applySettings,
  closeupOptions,
  defaultTargets,
  resetView3d,
  settingsFromUrl,
} from '../../src/options/settings';
import { DEFAULT_PALETTE } from '../../src/view/palette';
import { playerStyle } from '../../src/view/player-style';
import {
  broadcastPose,
  CAMERA_FOV,
  CAMERA_MODES,
  CLOSEUP_PLAYER_HEIGHT,
  closeupPose,
  closeupTimeConstant,
  DEFAULT_CLOSEUP,
  goalPose,
  isCloseup,
  nextCameraMode,
  smoothToward,
  topHalfSize,
} from '../../src/view/render3d/cameras';
import { interpolateFrame, lerpAngle, MAX_PLAYER_STEP } from '../../src/view/render3d/interpolate';
import { DEFAULT_VIEW_OPTIONS } from '../../src/view/view-state';

const alive = (i: number, extra: Partial<PlayerState> = {}): PlayerState => ({
  ...disabledPlayer(i),
  state: PlayerStateBit.Stand,
  stamina: 8000,
  effort: 1,
  recovery: 1,
  viewWidth: 120,
  ...extra,
});

const frame = (time: number, players: PlayerState[], extra: Partial<Frame> = {}): Frame => ({
  time,
  stime: 0,
  mode: PlayMode.PlayOn,
  teams: [
    { name: 'L', score: 0, penScore: 0, penMiss: 0 },
    { name: 'R', score: 0, penScore: 0, penMiss: 0 },
  ],
  ball: { x: 0, y: 0, vx: 0, vy: 0 },
  players,
  ...extra,
});

describe('interpolation', () => {
  it('turns the short way round', () => {
    expect(lerpAngle(170, -170, 0.5)).toBeCloseTo(180, 6);
    expect(lerpAngle(-170, 170, 0.25)).toBeCloseTo(-175);
    expect(lerpAngle(10, 50, 0.5)).toBe(30);
  });

  it('moves the players and the ball linearly, also the height', () => {
    const a = frame(1, [alive(0, { x: 0, y: 0, body: 170, neck: -20 })], {
      ball: { x: 0, y: 0, vx: 1, vy: 0, z: 2 },
    });
    const b = frame(2, [alive(0, { x: 1, y: 2, body: -170, neck: 20 })], {
      ball: { x: 1, y: 0, vx: 1, vy: 0 },
    });
    const m = interpolateFrame(a, b, 0.5);
    expect(m.players[0]).toMatchObject({ x: 0.5, y: 1, neck: 0 });
    expect(Math.abs(m.players[0]?.body ?? 0)).toBeCloseTo(180, 6);
    expect(m.ball).toMatchObject({ x: 0.5, z: 1 }); // the ground has no z: 0
    expect(m.time).toBe(1); // the rest is the first frame's
    expect(interpolateFrame(a, b, 0)).toBe(a);
    expect(interpolateFrame(a, undefined, 0.5)).toBe(a);
  });

  it('does not interpolate a play mode change or a jump', () => {
    const a = frame(1, [alive(0, { x: 0 }), alive(1, { x: 0 })], {
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
    });
    const b = frame(2, [alive(0, { x: MAX_PLAYER_STEP + 1 }), alive(1, { x: 1 })], {
      ball: { x: 10, y: 0, vx: 0, vy: 0 },
    });
    const m = interpolateFrame(a, b, 0.5);
    expect(m.players.map((p) => p.x)).toEqual([0, 0.5]); // the first one jumped
    expect(m.ball.x).toBe(0); // so did the ball
    expect(interpolateFrame(a, { ...b, mode: PlayMode.FreeKickLeft }, 0.5)).toBe(a);
  });
});

describe('3D cameras', () => {
  it('follow the ball on the ground', () => {
    const p = broadcastPose(1.8, { x: 20, y: 5 });
    expect(p.target).toEqual({ x: 20, y: 0, z: 5 });
    expect(p.position.x).toBe(20);
    expect(p.position.z).toBeGreaterThan(PITCH.width / 2); // beyond the near touch line
    // Not off the pitch at a corner.
    expect(broadcastPose(1.8, { x: 60, y: 40 }).target).toEqual({ x: 42.5, y: 0, z: 24 });
    const g = goalPose(-1, { x: 0, y: 0 });
    expect(g.position.x).toBeLessThan(-PITCH.length / 2);
    expect(g.target.x).toBeLessThan(0);
  });

  it('fit the pitch from above and settle smoothly', () => {
    const wide = topHalfSize(2);
    expect(wide.halfWidth).toBeGreaterThanOrEqual(57.5);
    expect(wide.halfHeight * 0.85).toBeGreaterThanOrEqual(39 - 1e-9);
    let p = { x: 0, y: 0, z: 0 };
    // 3 s at 60 frames per second.
    for (let i = 0; i < 180; ++i) {
      p = smoothToward(p, { x: 10, y: 0, z: 0 }, 1 / 60);
    }
    expect(p.x).toBeCloseTo(10, 2);
    expect(nextCameraMode(CAMERA_MODES[CAMERA_MODES.length - 1] ?? 'free')).toBe(CAMERA_MODES[0]);
  });

  it('is a setting', () => {
    const t = defaultTargets();
    expect(t.app.camera3d).toBe('broadcast');
    expect(settingsFromUrl(new URLSearchParams('camera_3d=top&camera-3d=bogus'))).toEqual({
      camera_3d: 'top',
    });
    expect(applySettings(t, { camera_3d: 'player' })).toEqual(['camera_3d']);
    expect(applySettings(t, { camera_3d: 'sky' })).toEqual([]);
    expect(t.app.camera3d).toBe('player');
  });
});

describe('the close-up cameras', () => {
  it('come after the broadcast one', () => {
    expect(nextCameraMode('broadcast')).toBe('closeup-ball');
    expect(nextCameraMode('closeup-ball')).toBe('closeup-player');
    expect(nextCameraMode('closeup-player')).toBe('top');
    expect(CAMERA_MODES.filter(isCloseup)).toEqual(['closeup-ball', 'closeup-player']);
  });

  it('look at what they follow from the near touch line, the distance and elevation set', () => {
    for (const o of [DEFAULT_CLOSEUP, { distance: 30, elevation: 60 }]) {
      for (const height of [0, CLOSEUP_PLAYER_HEIGHT]) {
        const pose = closeupPose({ x: 20, y: -10 }, height, o);
        expect(pose.target).toEqual({ x: 20, y: height, z: -10 });
        const d = {
          x: pose.position.x - pose.target.x,
          y: pose.position.y - pose.target.y,
          z: pose.position.z - pose.target.z,
        };
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(o.distance, 9);
        expect(Math.atan2(d.y, Math.hypot(d.x, d.z)) * RAD2DEG).toBeCloseTo(o.elevation, 9);
        // From the near touch line's side (+y, +Z), as the broadcast camera.
        expect(d.x).toBe(0);
        expect(d.z).toBeGreaterThan(0);
        expect(pose.fov).toBe(CAMERA_FOV);
      }
    }
    // Over the ground that is drawn, even when the ball is far out.
    const out = closeupPose({ x: 100, y: -60 }, 0, DEFAULT_CLOSEUP).target;
    expect(out.x).toBe(PITCH.length / 2 + PITCH.margin);
    expect(out.z).toBe(-(PITCH.width / 2 + PITCH.margin));
  });

  it('follow closer behind the nearer they are, a fast ball still in view', () => {
    expect(closeupTimeConstant(DEFAULT_CLOSEUP.distance)).toBeCloseTo(0.1068, 9);
    expect(closeupTimeConstant(3)).toBe(0.05);
    expect(closeupTimeConstant(60)).toBe(0.35); // as the broadcast camera
    const halfWidth = (d: number) => d * Math.tan((CAMERA_FOV / 2) * DEG2RAD) * (16 / 9);
    for (const d of [6, 12, 20, 38]) {
      // The lag behind 25 m/s: v·τ.
      expect(25 * closeupTimeConstant(d)).toBeLessThanOrEqual(0.4 * halfWidth(d) + 1e-9);
    }
  });

  it('are settings of the 3D tab', () => {
    const t = defaultTargets();
    expect(closeupOptions(t.app)).toEqual(DEFAULT_CLOSEUP);
    expect(
      applySettings(t, {
        closeup_distance_3d: 25,
        closeup_elevation_3d: 45,
        camera_3d: 'closeup-player',
      }),
    ).toEqual(['closeup_distance_3d', 'closeup_elevation_3d', 'camera_3d']);
    expect(closeupOptions(t.app)).toEqual({ distance: 25, elevation: 45 });
    // Out of the ranges (3–60 m, 5–85°): not taken.
    expect(applySettings(t, { closeup_distance_3d: 1, closeup_elevation_3d: 90 })).toEqual([]);
    resetView3d(t.app);
    expect(closeupOptions(t.app)).toEqual(DEFAULT_CLOSEUP);
    expect(t.app.camera3d).toBe('closeup-player'); // the camera is not one of the tab's
  });
});

describe('the shadows', () => {
  it('are on by default, a setting of the 3D tab', () => {
    const t = defaultTargets();
    expect(t.app.shadows3d).toBe(true);
    expect(settingsFromUrl(new URLSearchParams('shadows_3d=off'))).toEqual({ shadows_3d: false });
    expect(applySettings(t, { shadows_3d: false })).toEqual(['shadows_3d']);
    expect(t.app.shadows3d).toBe(false);
    resetView3d(t.app);
    expect(t.app.shadows3d).toBe(true);
  });
});

describe('player style', () => {
  const style = (p: PlayerState, selected = false) =>
    playerStyle(
      DEFAULT_PALETTE,
      DEFAULT_VIEW_OPTIONS,
      DEFAULT_SERVER_PARAM,
      DEFAULT_PLAYER_TYPE,
      p,
      selected,
    );

  it('follows the 2D state colors', () => {
    expect(style(alive(0))).toEqual({
      pen: { color: DEFAULT_PALETTE.playerPen, width: 0 },
      brush: DEFAULT_PALETTE.leftTeam,
      body: DEFAULT_PALETTE.leftTeam,
      decay: null,
    });
    expect(style(alive(0), true).pen.width).toBe(2);
    const kick = style(alive(0, { state: PlayerStateBit.Stand | PlayerStateBit.Kick }));
    expect(kick.pen).toEqual({ color: DEFAULT_PALETTE.kick, width: 2 });
    const tackle = style(alive(0, { state: PlayerStateBit.Stand | PlayerStateBit.Tackle }));
    expect([tackle.pen.color, tackle.brush]).toEqual([
      DEFAULT_PALETTE.tackle,
      DEFAULT_PALETTE.tackle,
    ]);
    const collide = style(alive(0, { state: PlayerStateBit.Stand | PlayerStateBit.BallCollide }));
    expect(collide.brush).toBe(DEFAULT_PALETTE.ballCollide);
    expect(style(disabledPlayer(0)).brush).toBe('#000000');
  });

  it('darkens the body with the stamina and rings a decayed effort', () => {
    const tired = style(alive(0, { stamina: 2000, effort: 0.8 }));
    expect(tired.brush).toBe(DEFAULT_PALETTE.leftTeam);
    expect(tired.body).not.toBe(DEFAULT_PALETTE.leftTeam);
    expect(tired.decay).toBe(DEFAULT_PALETTE.effortDecayed);
    expect(style(alive(0, { recovery: 0.9 })).decay).toBe(DEFAULT_PALETTE.recoveryDecayed);
  });
});
