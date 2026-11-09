import { describe, expect, it } from 'vitest';
import {
  PLAYMODE_STRINGS,
  PlayMode,
  playModeFromNumber,
  playModeFromString,
  playModeToString,
  Side,
} from '../../src/core/constants';
import {
  disabledPlayer,
  isAlive,
  isCatching,
  isCollidedBall,
  isGoalie,
  isKicking,
  isTackling,
  playerIndex,
  type PlayerState,
} from '../../src/core/frame';
import {
  coerce,
  DEFAULT_SERVER_PARAM,
  makePlayerType,
  makeServerParam,
} from '../../src/core/params';

describe('play modes', () => {
  it('has 52 names, indexed by the enum value', () => {
    expect(PLAYMODE_STRINGS).toHaveLength(52);
    expect(playModeToString(PlayMode.PlayOn)).toBe('play_on');
    expect(playModeToString(PlayMode.IllegalDefenseRight)).toBe('illegal_defense_r');
  });

  it('converts every name back to its enum value', () => {
    PLAYMODE_STRINGS.forEach((name, i) => {
      if (name !== '') {
        expect(playModeFromString(name)).toBe(i);
      }
    });
  });

  it('maps foul_push_r to FoulPushRight (rcssmonitor maps it to Null)', () => {
    expect(playModeFromString('foul_push_r')).toBe(PlayMode.FoulPushRight);
  });

  it('maps unknown names and numbers to Null', () => {
    expect(playModeFromString('no_such_mode')).toBe(PlayMode.Null);
    expect(playModeFromString('')).toBe(PlayMode.Null);
    expect(playModeFromNumber(52)).toBe(PlayMode.Null);
    expect(playModeFromNumber(-1)).toBe(PlayMode.Null);
    expect(playModeFromNumber(48)).toBe(PlayMode.PenaltyScoreLeft);
  });
});

describe('players', () => {
  it('places left 1-11 at 0-10 and right 1-11 at 11-21', () => {
    expect(playerIndex(Side.Left, 1)).toBe(0);
    expect(playerIndex(Side.Left, 11)).toBe(10);
    expect(playerIndex(Side.Right, 1)).toBe(11);
    expect(playerIndex(Side.Right, 11)).toBe(21);
    expect(playerIndex(Side.Right, 0)).toBe(-1);
    expect(playerIndex(Side.Left, 12)).toBe(-1);
    expect(playerIndex(Side.Neutral, 1)).toBe(-1);
  });

  it('builds disabled placeholders', () => {
    expect(disabledPlayer(0)).toMatchObject({ side: Side.Left, unum: 1, state: 0 });
    expect(disabledPlayer(21)).toMatchObject({ side: Side.Right, unum: 11, state: 0 });
  });

  const withState = (state: number) => ({ ...disabledPlayer(0), state }) as PlayerState;

  it('reads the state bits like rcssmonitor', () => {
    expect(isAlive(withState(0))).toBe(false);
    expect(isAlive(withState(0x1))).toBe(true);
    expect(isGoalie(withState(0x9))).toBe(true);
    expect(isKicking(withState(0x3))).toBe(true);
    expect(isKicking(withState(0x7))).toBe(false); // kick fault
    expect(isCatching(withState(0x11))).toBe(true);
    expect(isCatching(withState(0x31))).toBe(false); // catch fault
    expect(isTackling(withState(0x1001))).toBe(true);
    expect(isTackling(withState(0x3001))).toBe(false); // tackle fault
    expect(isCollidedBall(withState(0x401))).toBe(true);
    expect(isCollidedBall(withState(0x41))).toBe(true);
    expect(isCollidedBall(withState(0x81))).toBe(true);
    expect(isCollidedBall(withState(0x801))).toBe(false);
  });
});

describe('parameters', () => {
  it('has the rcssserver 19 defaults', () => {
    expect(DEFAULT_SERVER_PARAM.player_speed_max).toBe(1.05);
    expect(DEFAULT_SERVER_PARAM.stamina_max).toBe(8000);
    expect(DEFAULT_SERVER_PARAM.ball_size).toBe(0.085);
    expect(DEFAULT_SERVER_PARAM.ws_port).toBe(0);
    expect(DEFAULT_SERVER_PARAM.coach).toBe(false);
  });

  it('converts values to the type of the default', () => {
    expect(coerce(1.0, '0.25')).toBe(0.25);
    expect(coerce(1.0, true)).toBe(1);
    expect(coerce(1.0, 'abc')).toBeUndefined();
    expect(coerce(1.0, '')).toBeUndefined();
    expect(coerce(false, '1')).toBe(true);
    expect(coerce(true, 'off')).toBe(false);
    expect(coerce(false, 0)).toBe(false);
    expect(coerce(false, 'maybe')).toBeUndefined();
    expect(coerce('', 3)).toBe('3');
    expect(coerce(undefined, 'kept')).toBe('kept');
  });

  it('overlays received values on the defaults and keeps unknown names', () => {
    const p = makeServerParam({
      ball_size: 0.1,
      coach_w_referee: 1,
      half_time: '300',
      future_param: 42,
      goal_width: 'broken',
    });
    expect(p.ball_size).toBe(0.1);
    expect(p.coach_w_referee).toBe(true);
    expect(p.half_time).toBe(300);
    expect(p['future_param']).toBe(42);
    expect(p.goal_width).toBe(DEFAULT_SERVER_PARAM.goal_width);
    expect(p.stamina_max).toBe(8000);
  });

  it('builds player types', () => {
    const t = makePlayerType({ id: 3, player_size: 0.35 });
    expect(t.id).toBe(3);
    expect(t.player_size).toBe(0.35);
    expect(t.kickable_margin).toBe(0.7);
  });
});
