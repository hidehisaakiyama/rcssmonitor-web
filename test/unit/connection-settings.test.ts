import { describe, expect, it } from 'vitest';
import { PlayerStateBit, Side } from '../../src/core/constants';
import { disabledPlayer, type Frame } from '../../src/core/frame';
import { PlayMode } from '../../src/core/constants';
import {
  connectionFromUrl,
  DEFAULT_CONNECTION,
  loadConnection,
  mergeConnection,
} from '../../src/options/connection';
import { nearestPlayer } from '../../src/ui/referee';

describe('connection settings', () => {
  it('falls back to the defaults without localStorage', () => {
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
  });

  it('takes the URL parameters over the settings', () => {
    const params = new URLSearchParams(
      'connect=1&host=192.168.0.10&port=6000&path=player&auto_reconnect_mode=on&auto_reconnect_wait=10',
    );
    expect(connectionFromUrl(DEFAULT_CONNECTION, params)).toEqual({
      settings: {
        host: '192.168.0.10',
        port: 6000,
        path: 'player',
        autoReconnect: true,
        reconnectWait: 10,
      },
      connect: true,
    });
    expect(connectionFromUrl(DEFAULT_CONNECTION, new URLSearchParams('connect'))).toEqual({
      settings: DEFAULT_CONNECTION,
      connect: true,
    });
    expect(connectionFromUrl(DEFAULT_CONNECTION, new URLSearchParams(''))).toEqual({
      settings: DEFAULT_CONNECTION,
      connect: false,
    });
  });

  it('ignores invalid values', () => {
    const params = new URLSearchParams('connect=maybe&port=70000&auto_reconnect_wait=0&host=');
    expect(connectionFromUrl(DEFAULT_CONNECTION, params)).toEqual({
      settings: DEFAULT_CONNECTION,
      connect: false,
    });
    expect(mergeConnection(DEFAULT_CONNECTION, { port: '6000', autoReconnect: 1 })).toEqual(
      DEFAULT_CONNECTION,
    );
  });
});

describe('card target', () => {
  const frame: Frame = {
    time: 1,
    stime: 0,
    mode: PlayMode.PlayOn,
    teams: [
      { name: 'L', score: 0, penScore: 0, penMiss: 0 },
      { name: 'R', score: 0, penScore: 0, penMiss: 0 },
    ],
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    players: Array.from({ length: 22 }, (_, i) => {
      const p = disabledPlayer(i);
      // Left 1 at (-10, 0), right 2 at (-8, 0); right 1 is not connected.
      if (i === 0) {
        return { ...p, state: PlayerStateBit.Stand, x: -10 };
      }
      if (i === 12) {
        return { ...p, state: PlayerStateBit.Stand, x: -8 };
      }
      return { ...p, x: -9 };
    }),
  };

  it('is the connected player nearest to the click', () => {
    expect(nearestPlayer(frame, { x: -9.5, y: 0 })).toEqual({ side: Side.Left, unum: 1 });
    expect(nearestPlayer(frame, { x: -8.5, y: 0.5 })).toEqual({ side: Side.Right, unum: 2 });
    expect(nearestPlayer(frame, { x: 0, y: 0 })).toBeNull();
  });
});
