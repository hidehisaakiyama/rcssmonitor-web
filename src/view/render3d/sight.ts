// What the selected player perceives, for the player camera of the 3D view
// (DEVELOPMENT_PLAN.md, Phase 6):
//
// - `view`: what is inside the view cone (the view width around the face
//   direction, body + neck).
// - `server`: rcssserver's visual sensor (visualsenderplayer.cpp,
//   VisualSenderPlayerV1::sendHighPlayer / sendHighBall, with the v18
//   player_type values):
//   - Players and the ball in the cone are seen up to
//     player_max_observation_length / ball_max_observation_length (by
//     default the diagonal of the pitch).
//   - The server leaves out the team with the probability
//     (dist - team_far_length) / (team_too_far_length - team_far_length),
//     and otherwise the number with the probability
//     (dist - unum_far_length) / (unum_too_far_length - unum_far_length)
//     (by default 20 m and 40 m). Without the number, it does not send the
//     body and face directions either. Here the probabilities are not drawn
//     at random: they are how likely the team and the number are known,
//     which the view shows as the team colors fading to gray and as the
//     number's opacity.
//   - Outside the cone, objects within visible_distance (3 m) are felt: only
//     their kind is known.
//
// Not as the server: it decides with the noisy distance (this uses the true
// one), visual information comes once in a few cycles by the view width
// (in synch_see mode every 1, 2 or 3 cycles; this decides every cycle) and
// a low view quality (directions only) is not handled.
import { headDirection, type BallState, type PlayerState } from '../../core/frame';
import { normalizeAngle, vectorAngle } from '../../core/geometry';
import type { PlayerType, ServerParam } from '../../core/params';
import type { PlayerSight } from './player-camera';

export interface Perception {
  /** Drawn at all. */
  readonly seen: boolean;
  /** How likely the team is known (0-1). */
  readonly team: number;
  /** How likely the number is known (0-1). */
  readonly unum: number;
  /** Whether the body and face directions are known. */
  readonly facing: boolean;
}

export const FULL: Perception = Object.freeze({ seen: true, team: 1, unum: 1, facing: true });
const UNSEEN: Perception = Object.freeze({ seen: false, team: 0, unum: 0, facing: false });
/** Felt: outside the view but near, only that a player is there. */
const FELT: Perception = Object.freeze({ seen: true, team: 0, unum: 0, facing: false });

/** The probability that the server leaves the team or the number out at this distance. */
export function omitProbability(dist: number, far: number, tooFar: number): number {
  if (tooFar <= far) {
    return dist > far ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (dist - far) / (tooFar - far)));
}

/** The distance from the observer and whether it is inside the view cone. */
function relative(
  observer: PlayerState,
  x: number,
  y: number,
  sp: ServerParam,
): { dist: number; inView: boolean } {
  const dx = x - observer.x;
  const dy = y - observer.y;
  const dir = normalizeAngle(vectorAngle(dx, dy) - headDirection(observer));
  const width = observer.viewWidth || sp.visible_angle;
  return { dist: Math.hypot(dx, dy), inView: Math.abs(dir) < width / 2 };
}

/** How `observer` (of player type `type`) perceives `other`. */
export function perceivePlayer(
  sight: PlayerSight,
  observer: PlayerState,
  other: PlayerState,
  type: PlayerType,
  sp: ServerParam,
): Perception {
  if (sight === 'all') {
    return FULL;
  }
  const { dist, inView } = relative(observer, other.x, other.y, sp);
  if (sight === 'view') {
    return inView ? FULL : UNSEEN;
  }
  if (inView && dist < type.player_max_observation_length) {
    const team = 1 - omitProbability(dist, type.team_far_length, type.team_too_far_length);
    // Without the team, the number is left out too.
    const unum = team * (1 - omitProbability(dist, type.unum_far_length, type.unum_too_far_length));
    return { seen: true, team, unum, facing: unum > 0 };
  }
  return dist <= sp.visible_distance ? FELT : UNSEEN;
}

/** Whether `observer` perceives the ball. */
export function perceiveBall(
  sight: PlayerSight,
  observer: PlayerState,
  ball: BallState,
  type: PlayerType,
  sp: ServerParam,
): boolean {
  if (sight === 'all') {
    return true;
  }
  const { dist, inView } = relative(observer, ball.x, ball.y, sp);
  if (sight === 'view') {
    return inView;
  }
  return (inView && dist < type.ball_max_observation_length) || dist <= sp.visible_distance;
}
