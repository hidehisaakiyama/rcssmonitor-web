import { describe, expect, it } from 'vitest';
import { PlayMode, Side } from '../../src/core/constants';
import { formatG } from '../../src/core/number-format';
import {
  cardTargetError,
  CHANGE_PLAYMODE_MODES,
  changeMode,
  changePlayModeCommands,
  dispCard,
  dispFoul,
  moveBall,
} from '../../src/io/live/commands';

describe('formatG', () => {
  it('writes numbers like a C++ ostream', () => {
    expect(formatG(0)).toBe('0');
    expect(formatG(-0)).toBe('-0');
    expect(formatG(52.5)).toBe('52.5');
    expect(formatG(-34)).toBe('-34');
    expect(formatG(12.3456789)).toBe('12.3457');
    expect(formatG(0.0001)).toBe('0.0001');
    expect(formatG(0.00001234)).toBe('1.234e-05');
    expect(formatG(1234567)).toBe('1.23457e+06');
    expect(formatG(999999.5)).toBe('1e+06');
    expect(formatG(0.123456, 3)).toBe('0.123');
  });
});

describe('monitor commands', () => {
  it('scales the foul position by 16 and rounds halves to even', () => {
    expect(dispFoul(10, -5, Side.Left)).toBe('(dispfoul 160 -80 1)');
    expect(dispFoul(0.03125, 0.09375, Side.Right)).toBe('(dispfoul 0 2 -1)'); // 0.5 -> 0, 1.5 -> 2
    expect(dispFoul(-0.01, 0, Side.Neutral)).toBe('(dispfoul 0 0 0)'); // no "-0"
  });

  it('checks the player of a card before sending', () => {
    expect(dispCard(Side.Left, 3, 'yellow')).toBe('(dispcard 1 3 yellow)');
    expect(dispCard(Side.Right, 11, 'red')).toBe('(dispcard -1 11 red)');
    expect(cardTargetError(Side.Left, 0)).toMatch(/uniform number/);
    expect(cardTargetError(Side.Right, 12)).toMatch(/uniform number/);
    expect(cardTargetError(Side.Left, 2.5)).toMatch(/uniform number/);
    expect(cardTargetError(Side.Neutral, 1)).toMatch(/team/);
    expect(() => dispCard(Side.Left, 12, 'red')).toThrow(RangeError);
  });

  it('writes the play mode and the ball move of the coach mode', () => {
    expect(changeMode(PlayMode.FreeKickLeft)).toBe('(change_mode free_kick_l)');
    expect(() => changeMode(PlayMode.Null)).toThrow(RangeError);
    expect(moveBall(1.5, -2)).toBe('(move (ball) 1.5 -2 0 0 0)');
  });
});

describe('Change Playmode', () => {
  const at = (mode: PlayMode, x: number, y: number) => changePlayModeCommands(mode, { x, y });

  it('offers the modes of rcssmonitor', () => {
    expect(CHANGE_PLAYMODE_MODES).toHaveLength(16);
    expect(at(PlayMode.FreeKickLeft, 0, 0)).toBeNull();
    expect(at(PlayMode.DropBall, 0, 0)).toBeNull();
  });

  it('moves the ball where the mode needs it', () => {
    const ball = (mode: PlayMode, x: number, y: number) => at(mode, x, y)?.[0];
    expect(at(PlayMode.BeforeKickOff, 10, 10)).toEqual([
      '(move (ball) 0 0 0 0 0)',
      '(change_mode before_kick_off)',
    ]);
    expect(ball(PlayMode.PlayOn, 12.25, -3.5)).toBe('(move (ball) 12.25 -3.5 0 0 0)');
    // Clamped to the pitch.
    expect(ball(PlayMode.PlayOn, 60, -40)).toBe('(move (ball) 52.5 -34 0 0 0)');
    expect(ball(PlayMode.KickInLeft, 10, 3)).toBe('(move (ball) 10 34 0 0 0)');
    expect(ball(PlayMode.KickInRight, 10, -3)).toBe('(move (ball) 10 -34 0 0 0)');
    expect(ball(PlayMode.CornerKickLeft, 0, -1)).toBe('(move (ball) 51.5 -33 0 0 0)');
    expect(ball(PlayMode.CornerKickRight, 0, 1)).toBe('(move (ball) -51.5 33 0 0 0)');
    expect(ball(PlayMode.GoalKickLeft, 0, 1)).toBe('(move (ball) -47 9.16 0 0 0)');
    expect(ball(PlayMode.GoalKickRight, 0, -1)).toBe('(move (ball) 47 -9.16 0 0 0)');
    expect(ball(PlayMode.FoulChargeRight, -20, 5)).toBe('(move (ball) -20 5 0 0 0)');
    expect(ball(PlayMode.IllegalDefenseLeft, 3, 4)).toBe('(move (ball) -41.5 0 0 0 0)');
    expect(ball(PlayMode.IllegalDefenseRight, 3, 4)).toBe('(move (ball) 41.5 0 0 0 0)');
  });

  it('keeps an indirect free kick out of the goal area', () => {
    const ball = (mode: PlayMode, x: number, y: number) => at(mode, x, y)?.[0];
    expect(ball(PlayMode.IndFreeKickLeft, 50, 2)).toBe('(move (ball) 47 2 0 0 0)');
    expect(ball(PlayMode.IndFreeKickLeft, 50, 20)).toBe('(move (ball) 50 20 0 0 0)');
    expect(ball(PlayMode.IndFreeKickRight, -50, -2)).toBe('(move (ball) -47 -2 0 0 0)');
  });

  it('sends back passes, which rcssmonitor computes but does not send', () => {
    expect(at(PlayMode.BackPassLeft, 0, 30)).toEqual([
      '(move (ball) -36 20.16 0 0 0)',
      '(change_mode back_pass_l)',
    ]);
    expect(at(PlayMode.BackPassRight, 45, -5)).toEqual([
      '(move (ball) 45 -5 0 0 0)',
      '(change_mode back_pass_r)',
    ]);
  });
});
