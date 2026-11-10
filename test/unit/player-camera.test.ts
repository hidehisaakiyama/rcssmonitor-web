import { describe, expect, it } from 'vitest';
import { PlayerStateBit, Side } from '../../src/core/constants';
import { disabledPlayer, type PlayerState } from '../../src/core/frame';
import { normalizeAngle, RAD2DEG } from '../../src/core/geometry';
import { DEFAULT_PLAYER_TYPE, DEFAULT_SERVER_PARAM } from '../../src/core/params';
import {
  applySettings,
  defaultTargets,
  playerCameraOptions,
  resetPlayerCamera,
  settingsFromUrl,
} from '../../src/options/settings';
import type { CameraPose } from '../../src/view/render3d/cameras';
import {
  DEFAULT_PLAYER_CAMERA,
  EYE_HEIGHT,
  PlayerCamera,
  playerCameraPose,
  referenceDirection,
  SHOULDER,
  turnToward,
  type PlayerCameraOptions,
} from '../../src/view/render3d/player-camera';
import { omitProbability, perceiveBall, perceivePlayer } from '../../src/view/render3d/sight';

const alive = (i: number, extra: Partial<PlayerState> = {}): PlayerState => ({
  ...disabledPlayer(i),
  state: PlayerStateBit.Stand,
  stamina: 8000,
  effort: 1,
  recovery: 1,
  viewWidth: 120,
  ...extra,
});

const options = (o: Partial<PlayerCameraOptions> = {}): PlayerCameraOptions => ({
  ...DEFAULT_PLAYER_CAMERA,
  ...o,
});

/** The horizontal direction the pose looks in, in degrees. */
const heading = (p: CameraPose) =>
  Math.atan2(p.target.z - p.position.z, p.target.x - p.position.x) * RAD2DEG;

const FPS = 60;
const STEP = 0.1; // simulator_step

/**
 * Runs the camera for `seconds` at 60 frames per second over a player whose
 * state at a time is `at(t)`, as the view interpolates it; returns the
 * direction and the field of view of every frame.
 */
function run(
  camera: PlayerCamera,
  o: PlayerCameraOptions,
  seconds: number,
  at: (t: number) => PlayerState,
): { direction: number; fov: number; settled: boolean }[] {
  const out: { direction: number; fov: number; settled: boolean }[] = [];
  for (let i = 0; i <= seconds * FPS; ++i) {
    const { pose, settled } = camera.update(at(i / FPS), 1, o, i === 0 ? 0 : 1 / FPS);
    out.push({ direction: heading(pose), fov: pose.fov, settled });
  }
  return out;
}

/** The largest turn between two frames, in degrees per second. */
function fastestTurn(frames: { direction: number }[]): number {
  let max = 0;
  for (let i = 1; i < frames.length; ++i) {
    const a = frames[i - 1]?.direction ?? 0;
    const b = frames[i]?.direction ?? 0;
    max = Math.max(max, Math.abs(normalizeAngle(b - a)) * FPS);
  }
  return max;
}

/** The neck from +90 to -90 and back every cycle, interpolated linearly as the 3D view does. */
const lookingAround = (t: number) => {
  const cycle = Math.floor(t / STEP + 1e-9);
  const alpha = t / STEP - cycle;
  const neck = (c: number) => (c % 2 === 0 ? 90 : -90);
  return alive(0, { neck: neck(cycle) + (neck(cycle + 1) - neck(cycle)) * alpha });
};

describe('the player camera', () => {
  it('is by default the first, plain one: the eyes, the face at once, as wide as the view', () => {
    const camera = new PlayerCamera();
    const { pose, settled } = camera.update(
      alive(0, { x: 3, y: 4, body: 60, neck: 30, viewWidth: 120 }),
      1,
      DEFAULT_PLAYER_CAMERA,
      0,
    );
    expect(pose.position).toEqual({ x: 3, y: EYE_HEIGHT, z: 4 });
    expect(pose.target.x).toBeCloseTo(3);
    expect(pose.target.z).toBeCloseTo(14); // 90 degrees: toward +y, world +Z
    expect(pose.fov).toBeCloseTo(120); // aspect 1: vertical = horizontal
    expect(settled).toBe(true);
    // 180 degrees is capped.
    const wide = camera.update(alive(0, { viewWidth: 180 }), 1, DEFAULT_PLAYER_CAMERA, 0);
    expect(wide.pose.fov).toBeCloseTo(120);
    // And it swings as fast as the neck: 180 degrees a cycle.
    const plain = run(new PlayerCamera(), DEFAULT_PLAYER_CAMERA, 2, lookingAround);
    expect(fastestTurn(plain)).toBeCloseTo(1800, 0);
  });

  it('follows the head, the body or between them', () => {
    const p = alive(0, { body: 40, neck: -60 });
    expect(referenceDirection(p, 'head')).toBe(-20);
    expect(referenceDirection(p, 'body')).toBe(40);
    expect(referenceDirection(p, 'middle')).toBe(10);
    const body = new PlayerCamera().update(p, 1, options({ direction: 'body' }), 0);
    expect(heading(body.pose)).toBeCloseTo(40);
  });

  it('looks over the shoulder from behind and above', () => {
    const pose = playerCameraPose({ x: 10, y: -5 }, 'shoulder', 90, 90, 1);
    expect(pose.position.x).toBeCloseTo(10);
    expect(pose.position.y).toBe(SHOULDER.height);
    expect(pose.position.z).toBeCloseTo(-5 - SHOULDER.behind);
    expect(pose.target.z).toBeCloseTo(-5 + SHOULDER.ahead);
    expect(pose.target.y).toBe(SHOULDER.targetHeight);
  });

  it('turns no faster than the limit when smooth', () => {
    const smooth = options({ motion: 'smooth', maxTurn: 90, timeConstant: 0.5 });
    expect(fastestTurn(run(new PlayerCamera(), smooth, 5, lookingAround))).toBeLessThanOrEqual(
      90 + 1e-6,
    );
    // The body turning 170 degrees a cycle, then the other way.
    const spinning = (t: number) => {
      const c = t / STEP;
      return alive(0, { body: normalizeAngle(c < 20 ? 170 * c : 170 * (40 - c)) });
    };
    expect(fastestTurn(run(new PlayerCamera(), smooth, 4, spinning))).toBeLessThanOrEqual(
      90 + 1e-6,
    );
    const faster = options({ motion: 'smooth', maxTurn: 120, timeConstant: 0.2 });
    expect(fastestTurn(run(new PlayerCamera(), faster, 5, lookingAround))).toBeLessThanOrEqual(
      120 + 1e-6,
    );
  });

  it('turns smoothly a quarter turn in about a second and a half, and settles', () => {
    const smooth = options({ motion: 'smooth', maxTurn: 90, timeConstant: 0.5 });
    const frames = run(new PlayerCamera(), smooth, 6, (t) => alive(0, { body: t > 0 ? 90 : 0 }));
    const at = (s: number) => frames[Math.round(s * FPS)];
    expect(at(0.5)?.direction).toBeLessThan(46); // the limit: 90 degrees a second
    expect(90 - (at(1.5)?.direction ?? 0)).toBeLessThan(8);
    expect(90 - (at(2)?.direction ?? 0)).toBeLessThan(3);
    expect(at(1)?.settled).toBe(false);
    expect(at(6)).toMatchObject({ direction: 90, settled: true });
    // The step itself: the short way round, capped.
    expect(turnToward(170, -170, 0.1, 0, 90)).toBe(179);
    expect(turnToward(170, -170, 0.1, 0, 1000)).toBe(-170);
  });

  it('widens the view at once, eased or not at all', () => {
    const wider = (t: number) => alive(0, { viewWidth: t > 0 ? 120 : 60 });
    const at = (o: PlayerCameraOptions, s: number) =>
      run(new PlayerCamera(), o, 3, wider)[Math.round(s * FPS)]?.fov ?? 0;
    expect(at(options(), 0.1)).toBeCloseTo(120);
    const eased = options({ fov: 'eased', timeConstant: 0.5 });
    expect(at(eased, 0)).toBeCloseTo(60);
    expect(at(eased, 0.5)).toBeCloseTo(60 + 60 * (1 - Math.exp(-1)), 0);
    expect(at(eased, 3)).toBeCloseTo(120, 0);
    expect(at(options({ fov: 'fixed', fixedFov: 75 }), 2)).toBeCloseTo(75);
  });

  it('starts again at once for another player, after a jump or a reset', () => {
    const smooth = options({ motion: 'smooth' });
    const camera = new PlayerCamera();
    camera.update(alive(0, { body: 0 }), 1, smooth, 0);
    expect(camera.update(alive(0, { body: 90 }), 1, smooth, 0.1).settled).toBe(false);
    // Another player.
    const other = alive(1, { body: 90 });
    expect(heading(camera.update(other, 1, smooth, 0.1).pose)).toBeCloseTo(90);
    // A jump (e.g. moved by the referee) of more than 3 m.
    camera.update(alive(1, { x: 0, body: 90 }), 1, smooth, 0.1);
    const moved = camera.update(alive(1, { x: 5, body: -90 }), 1, smooth, 0.1);
    expect(heading(moved.pose)).toBeCloseTo(-90);
    // A reset (the camera or its style changed).
    camera.reset();
    expect(heading(camera.update(alive(1, { x: 5, body: 0 }), 1, smooth, 0.1).pose)).toBeCloseTo(0);
  });
});

describe("the player camera's sight", () => {
  const sp = DEFAULT_SERVER_PARAM;
  const type = DEFAULT_PLAYER_TYPE;
  // At the origin, looking along +x, 90 degrees wide.
  const me = alive(0, { body: 30, neck: -30, viewWidth: 90 });
  const at = (x: number, y: number) => alive(12, { side: Side.Right, unum: 2, x, y });

  it('draws everything, or what is in the view cone', () => {
    expect(perceivePlayer('all', me, at(-10, 0), type, sp).seen).toBe(true);
    expect(perceivePlayer('view', me, at(10, 9), type, sp)).toEqual({
      seen: true,
      team: 1,
      unum: 1,
      facing: true,
    });
    expect(perceivePlayer('view', me, at(10, 11), type, sp).seen).toBe(false); // 47.7 degrees
    expect(perceivePlayer('view', me, at(-2, 0), type, sp).seen).toBe(false);
    expect(perceiveBall('view', me, { x: -1, y: 0, vx: 0, vy: 0 }, type, sp)).toBe(false);
  });

  it('follows the server: the number fades from 20 m to 40 m, then the directions go', () => {
    expect(perceivePlayer('server', me, at(15, 0), type, sp)).toMatchObject({ unum: 1 });
    const mid = perceivePlayer('server', me, at(30, 0), type, sp);
    expect(mid).toMatchObject({ seen: true, team: 1, facing: true });
    expect(mid.unum).toBeCloseTo(0.5);
    expect(perceivePlayer('server', me, at(45, 0), type, sp)).toEqual({
      seen: true,
      team: 1, // team_far_length: the diagonal of the pitch
      unum: 0,
      facing: false,
    });
  });

  it('feels the players and the ball near, outside the view', () => {
    const felt = { seen: true, team: 0, unum: 0, facing: false };
    expect(perceivePlayer('server', me, at(-2, 1), type, sp)).toEqual(felt);
    expect(perceivePlayer('server', me, at(0, -3), type, sp)).toEqual(felt); // just 3 m
    expect(perceivePlayer('server', me, at(-4, 0), type, sp).seen).toBe(false);
    expect(perceiveBall('server', me, { x: -1, y: 1, vx: 0, vy: 0 }, type, sp)).toBe(true);
    expect(perceiveBall('server', me, { x: -5, y: 0, vx: 0, vy: 0 }, type, sp)).toBe(false);
    expect(perceiveBall('server', me, { x: 50, y: 10, vx: 0, vy: 0 }, type, sp)).toBe(true);
  });

  it('loses the team as the older servers did, between 40 m and 60 m', () => {
    const old = { ...type, team_far_length: 40, team_too_far_length: 60 };
    const p = perceivePlayer('server', me, at(50, 0), old, sp);
    expect(p.team).toBeCloseTo(0.5);
    expect(p.unum).toBe(0);
    expect(perceivePlayer('server', me, at(30, 0), old, sp).team).toBe(1);
    expect(omitProbability(30, 40, 40)).toBe(0);
    expect(omitProbability(41, 40, 40)).toBe(1);
  });
});

describe("the player camera's settings", () => {
  it('start as the plain camera and take the URL', () => {
    const t = defaultTargets();
    expect(playerCameraOptions(t.app)).toEqual(DEFAULT_PLAYER_CAMERA);
    const url = settingsFromUrl(
      new URLSearchParams(
        'player-camera-position=shoulder&player_camera_motion=smooth&player_camera_max_turn=120' +
          '&player_camera_fov=wide&player_camera_sight=server&player_camera_time_constant=9',
      ),
    );
    expect(url).toEqual({
      player_camera_position: 'shoulder',
      player_camera_motion: 'smooth',
      player_camera_max_turn: 120,
      player_camera_sight: 'server',
      player_camera_time_constant: 9,
    });
    // At most 5 s.
    expect(applySettings(t, url)).not.toContain('player_camera_time_constant');
    expect(playerCameraOptions(t.app)).toMatchObject({
      position: 'shoulder',
      motion: 'smooth',
      maxTurn: 120,
      sight: 'server',
      fov: 'view',
    });
    resetPlayerCamera(t.app);
    expect(playerCameraOptions(t.app)).toEqual(DEFAULT_PLAYER_CAMERA);
  });
});
