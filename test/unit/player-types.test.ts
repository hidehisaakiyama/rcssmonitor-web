import { describe, expect, it } from 'vitest';
import {
  PLAYER_TYPE_COLUMNS,
  playerTypeRows,
  sortRows,
} from '../../src/ui/dialogs/player-type-dialog';
import { loadFixture } from './helpers';

describe('player type list', async () => {
  const { store } = await loadFixture('json-sample.rcg.gz');
  const rows = playerTypeRows(store);

  it('has the 16 columns of rcssmonitor for each type', () => {
    expect(PLAYER_TYPE_COLUMNS).toHaveLength(16);
    expect(rows).toHaveLength(18);
    expect(rows.every((r) => r.length === 16)).toBe(true);
  });

  it('computes the values as rcssmonitor does', () => {
    // The default type: speed max 1.05, but 100 * 0.006 * 1 / (1 - 0.4) = 1.0 reachable.
    expect(rows[0]).toEqual([
      '0',
      '0.300',
      '1.000 / 1.050',
      '0.600000',
      '0.006000',
      '0.400000',
      '5.000000',
      '1.085000', // 0.3 + 0.7 + ball 0.085
      '0.700000',
      '0.0270',
      '0.100000',
      '1.300 - 1.300', // sqrt(0.5^2 + 1.2^2)
      '45.0000',
      '50.0000',
      '1.000 - 0.600',
      '0.500',
    ]);
  });

  it('sorts by any column, also those with two numbers', () => {
    const bySpeed = sortRows(rows, 2, true).map((r) => r[2]);
    expect(bySpeed[0]).toBe('0.773 / 1.050');
    expect(bySpeed.at(-1)).toBe('1.000 / 1.050');
    const byDecay = sortRows(rows, 5, false).map((r) => Number(r[5]));
    expect(byDecay).toEqual([...byDecay].sort((a, b) => b - a));
    expect(sortRows(rows, 0, true)).toEqual(rows);
  });
});
