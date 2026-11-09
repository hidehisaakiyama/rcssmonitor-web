import { describe, expect, it } from 'vitest';
import { parseXpmColor, TeamGraphic } from '../../src/core/team-graphic';

const tile = (colors: string[], rows: string[]) => [`8 8 ${colors.length} 1`, ...colors, ...rows];
const solid = (ch: string) => Array<string>(8).fill(ch.repeat(8));

describe('parseXpmColor', () => {
  it.each([
    ['None', [0, 0, 0, 0]],
    ['none', [0, 0, 0, 0]],
    ['#FF8000', [255, 128, 0, 255]],
    ['#f80', [255, 136, 0, 255]],
    ['#FFFF80800000', [255, 128, 0, 255]],
    ['white', [255, 255, 255, 255]],
    ['green', [0, 255, 0, 255]],
    ['gray', [190, 190, 190, 255]],
    ['gray50', [127, 127, 127, 255]],
    ['grey100', [255, 255, 255, 255]],
    ['Light Gray', [211, 211, 211, 255]],
  ])('%s', (spec, rgba) => {
    expect(parseXpmColor(spec)).toEqual(rgba);
  });

  it('rejects unknown colors', () => {
    expect(parseXpmColor('nosuchcolor')).toBeUndefined();
    expect(parseXpmColor('#12345')).toBeUndefined();
    expect(parseXpmColor('gray101')).toBeUndefined();
  });
});

describe('TeamGraphic', () => {
  it('assembles tiles and grows to their bounding box', () => {
    const g = new TeamGraphic();
    expect(g.isEmpty()).toBe(true);
    expect(g.addTile(0, 0, tile(['a c #FF0000'], solid('a')))).toBeNull();
    expect([g.width, g.height]).toEqual([8, 8]);
    expect(g.isComplete()).toBe(true);
    expect(
      g.addTile(1, 1, tile(['  c None', 'b c blue'], ['b       ', ...solid(' ').slice(1)])),
    ).toBeNull();
    expect([g.width, g.height]).toEqual([16, 16]);
    expect(g.tileCount).toBe(2);
    expect(g.isComplete()).toBe(false);
    expect(g.revision).toBe(2);

    const rgba = g.toRgba();
    expect(rgba).toHaveLength(16 * 16 * 4);
    const px = (x: number, y: number) => [...rgba.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(7, 7)).toEqual([255, 0, 0, 255]);
    expect(px(8, 0)).toEqual([0, 0, 0, 0]); // missing tile
    expect(px(8, 8)).toEqual([0, 0, 255, 255]);
    expect(px(9, 8)).toEqual([0, 0, 0, 0]); // None
  });

  it('reads the "c" key among other keys', () => {
    const g = new TeamGraphic();
    expect(g.addTile(0, 0, tile(['x s background c #00FF00 m white'], solid('x')))).toBeNull();
    expect([...g.toRgba().subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it('draws unknown colors transparent and remembers them', () => {
    const g = new TeamGraphic();
    expect(g.addTile(0, 0, tile(['x c mystery'], solid('x')))).toBeNull();
    expect([...g.toRgba().subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...g.unknownColors]).toEqual(['mystery']);
  });

  it.each([
    ['position out of range', 32, 0, tile(['a c red'], solid('a'))],
    ['negative position', -1, 0, tile(['a c red'], solid('a'))],
    ['row out of range', 0, 8, tile(['a c red'], solid('a'))],
    ['wrong size', 0, 0, ['16 8 1 1', 'a c red', ...solid('a')]],
    ['two characters per pixel', 0, 0, ['8 8 1 2', 'a c red', ...solid('a')]],
    ['missing rows', 0, 0, tile(['a c red'], solid('a').slice(1))],
    ['short row', 0, 0, tile(['a c red'], [...solid('a').slice(1), 'aaa'])],
    ['color without value', 0, 0, tile(['a c'], solid('a'))],
  ])('rejects a tile: %s', (_, x, y, xpm) => {
    const g = new TeamGraphic();
    expect(g.addTile(x, y, xpm)).not.toBeNull();
    expect(g.isEmpty()).toBe(true);
  });
});
