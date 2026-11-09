// The score board text (rcssmonitor src/score_board_painter.cpp).
import { PlayMode, playModeToString, Side } from '../../core/constants';
import type { GameStore } from '../../core/game-store';

const PENALTY_IN_PROGRESS: ReadonlySet<PlayMode> = new Set([
  PlayMode.PenaltySetupLeft,
  PlayMode.PenaltySetupRight,
  PlayMode.PenaltyReadyLeft,
  PlayMode.PenaltyReadyRight,
  PlayMode.PenaltyTakenLeft,
  PlayMode.PenaltyTakenRight,
]);

const right = (s: string, w: number) => s.padStart(w);
const left = (s: string, w: number) => s.padEnd(w);

/**
 * The score board line for a frame, e.g.
 * " HELIOS2023 0:0 CYRUS               kick_off_l      1    ".
 * During a penalty shoot-out the kicks are shown as o (goal) and x (miss).
 */
export function scoreBoardText(store: GameStore, frameIndex: number): string {
  const frame = store.frame(frameIndex);
  if (!frame) {
    return '';
  }
  const [teamL, teamR] = frame.teams;
  const sp = store.serverParam;
  const nameL = sp.fixed_teamname_l === '' ? teamL.name : `${sp.fixed_teamname_l}(${teamL.name})`;
  const nameR = sp.fixed_teamname_r === '' ? teamR.name : `${sp.fixed_teamname_r}(${teamR.name})`;
  const mode = right(playModeToString(frame.mode), 19);
  const time = right(String(frame.time), 6);

  const kicksL = store.penaltyKicks(Side.Left);
  const kicksR = store.penaltyKicks(Side.Right);
  const firstL = kicksL[0];
  const firstR = kicksR[0];
  const showPenalties =
    (firstL !== undefined || firstR !== undefined) &&
    !(
      firstL !== undefined &&
      frameIndex < firstL.frameIndex &&
      firstR !== undefined &&
      frameIndex < firstR.frameIndex &&
      !PENALTY_IN_PROGRESS.has(frame.mode)
    );

  if (!showPenalties) {
    return ` ${right(nameL, 10)} ${teamL.score}:${teamR.score} ${left(nameR, 10)} ${mode} ${time}    `;
  }
  const marks = (side: Side) =>
    store
      .penaltyKicks(side)
      .filter((k) => k.frameIndex <= frameIndex)
      .map((k) => (k.scored ? 'o' : 'x'))
      .join('');
  return (
    ` ${right(nameL, 10)} ${teamL.score}:${teamR.score} ` +
    `|${left(marks(Side.Left), 5)}:${left(marks(Side.Right), 5)}| ` +
    `${left(nameR, 10)} ${mode} ${time}`
  );
}
