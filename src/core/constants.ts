// Constants shared by the parsers, the game store and the renderers.
// Values follow rcssserver's src/types.h and rcssmonitor's rcss/rcg/types.h.

/** Players per team. */
export const MAX_PLAYER = 11;

/** Team side. The values match rcssserver's Side enum. */
export const Side = {
  Left: 1,
  Neutral: 0,
  Right: -1,
} as const;
export type Side = (typeof Side)[keyof typeof Side];

/** Side as written in logs and in the monitor protocol. */
export type SideChar = 'l' | 'r';

export function sideFromChar(c: string): Side {
  return c === 'l' ? Side.Left : c === 'r' ? Side.Right : Side.Neutral;
}

export function sideToChar(side: Side): SideChar | 'n' {
  return side === Side.Left ? 'l' : side === Side.Right ? 'r' : 'n';
}

/**
 * Play modes. The numbers are the enum values of rcssserver and are also the
 * indices of PLAYMODE_STRINGS.
 */
export const PlayMode = {
  Null: 0,
  BeforeKickOff: 1,
  TimeOver: 2,
  PlayOn: 3,
  KickOffLeft: 4,
  KickOffRight: 5,
  KickInLeft: 6,
  KickInRight: 7,
  FreeKickLeft: 8,
  FreeKickRight: 9,
  CornerKickLeft: 10,
  CornerKickRight: 11,
  GoalKickLeft: 12,
  GoalKickRight: 13,
  AfterGoalLeft: 14,
  AfterGoalRight: 15,
  DropBall: 16,
  OffSideLeft: 17,
  OffSideRight: 18,
  PenaltyKickLeft: 19,
  PenaltyKickRight: 20,
  FirstHalfOver: 21,
  Pause: 22,
  Human: 23,
  FoulChargeLeft: 24,
  FoulChargeRight: 25,
  FoulPushLeft: 26,
  FoulPushRight: 27,
  FoulMultipleAttackerLeft: 28,
  FoulMultipleAttackerRight: 29,
  FoulBallOutLeft: 30,
  FoulBallOutRight: 31,
  BackPassLeft: 32,
  BackPassRight: 33,
  FreeKickFaultLeft: 34,
  FreeKickFaultRight: 35,
  CatchFaultLeft: 36,
  CatchFaultRight: 37,
  IndFreeKickLeft: 38,
  IndFreeKickRight: 39,
  PenaltySetupLeft: 40,
  PenaltySetupRight: 41,
  PenaltyReadyLeft: 42,
  PenaltyReadyRight: 43,
  PenaltyTakenLeft: 44,
  PenaltyTakenRight: 45,
  PenaltyMissLeft: 46,
  PenaltyMissRight: 47,
  PenaltyScoreLeft: 48,
  PenaltyScoreRight: 49,
  IllegalDefenseLeft: 50,
  IllegalDefenseRight: 51,
} as const;
export type PlayMode = (typeof PlayMode)[keyof typeof PlayMode];

/** Play mode names indexed by PlayMode. Index 0 (Null) is the empty string. */
export const PLAYMODE_STRINGS: readonly string[] = [
  '',
  'before_kick_off',
  'time_over',
  'play_on',
  'kick_off_l',
  'kick_off_r',
  'kick_in_l',
  'kick_in_r',
  'free_kick_l',
  'free_kick_r',
  'corner_kick_l',
  'corner_kick_r',
  'goal_kick_l',
  'goal_kick_r',
  'goal_l',
  'goal_r',
  'drop_ball',
  'offside_l',
  'offside_r',
  'penalty_kick_l',
  'penalty_kick_r',
  'first_half_over',
  'pause',
  'human_judge',
  'foul_charge_l',
  'foul_charge_r',
  'foul_push_l',
  'foul_push_r',
  'foul_multiple_attack_l',
  'foul_multiple_attack_r',
  'foul_ballout_l',
  'foul_ballout_r',
  'back_pass_l',
  'back_pass_r',
  'free_kick_fault_l',
  'free_kick_fault_r',
  'catch_fault_l',
  'catch_fault_r',
  'indirect_free_kick_l',
  'indirect_free_kick_r',
  'penalty_setup_l',
  'penalty_setup_r',
  'penalty_ready_l',
  'penalty_ready_r',
  'penalty_taken_l',
  'penalty_taken_r',
  'penalty_miss_l',
  'penalty_miss_r',
  'penalty_score_l',
  'penalty_score_r',
  'illegal_defense_l',
  'illegal_defense_r',
];

const PLAYMODE_BY_NAME = new Map<string, PlayMode>(
  PLAYMODE_STRINGS.map((name, i) => [name, i as PlayMode]),
);
PLAYMODE_BY_NAME.delete('');

/**
 * Converts a play mode name to PlayMode. Unknown names give PlayMode.Null.
 * Unlike rcssmonitor's to_playmode_enum, "foul_push_r" maps to FoulPushRight.
 */
export function playModeFromString(name: string): PlayMode {
  return PLAYMODE_BY_NAME.get(name) ?? PlayMode.Null;
}

/** Converts a play mode number (as in the text protocol's "(pm N)") to PlayMode. */
export function playModeFromNumber(n: number): PlayMode {
  return Number.isInteger(n) && n >= 0 && n < PLAYMODE_STRINGS.length
    ? (n as PlayMode)
    : PlayMode.Null;
}

export function playModeToString(mode: PlayMode): string {
  return PLAYMODE_STRINGS[mode] ?? '';
}

/** Player state bits. */
export const PlayerStateBit = {
  Disable: 0x0,
  Stand: 0x1,
  Kick: 0x2,
  KickFault: 0x4,
  Goalie: 0x8,
  Catch: 0x10,
  CatchFault: 0x20,
  BallToPlayer: 0x40,
  PlayerToBall: 0x80,
  Discard: 0x100,
  Lost: 0x200,
  BallCollide: 0x400,
  PlayerCollide: 0x800,
  Tackle: 0x1000,
  TackleFault: 0x2000,
  BackPass: 0x4000,
  FreeKickFault: 0x8000,
  PostCollide: 0x10000,
  FoulCharged: 0x20000,
  YellowCard: 0x40000,
  RedCard: 0x80000,
  IllegalDefense: 0x100000,
} as const;

/**
 * Pitch dimensions in meters. They are fixed in rcssserver and are not part
 * of server_param (rcssmonitor src/options.cpp).
 */
export const PITCH = {
  length: 105.0,
  width: 68.0,
  margin: 5.0,
  centerCircleRadius: 9.15,
  penaltyAreaLength: 16.5,
  penaltyAreaWidth: 40.32,
  penaltyCircleRadius: 9.15,
  penaltySpotDist: 11.0,
  goalWidth: 14.02,
  goalAreaLength: 5.5,
  goalAreaWidth: 18.32,
  goalDepth: 2.44,
  cornerArcRadius: 1.0,
  goalPostRadius: 0.06,
} as const;
