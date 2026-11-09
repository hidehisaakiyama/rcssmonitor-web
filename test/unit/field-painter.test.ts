import { describe, expect, it } from 'vitest';
import { makeServerParam, type ServerParam } from '../../src/core/params';
import { drawField } from '../../src/view/render2d/field-painter';
import type { QtPainter } from '../../src/view/render2d/qt-painter';
import { Viewport } from '../../src/view/render2d/viewport';
import { ViewState } from '../../src/view/view-state';

/** The drawing calls of the field painter, from a painter that only records them. */
function drawCalls(sp: ServerParam, view = new ViewState()): [string, unknown[]][] {
  const calls: [string, unknown[]][] = [];
  const painter = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, name) =>
      name in target
        ? target[name]
        : (...args: unknown[]) => {
            calls.push([String(name), args]);
            return 0;
          },
  });
  // 8 pixels per meter, the center at (500, 350).
  drawField(painter as unknown as QtPainter, new Viewport(1000, 700, 8, 500, 350), view, sp);
  return calls;
}

const has = (calls: [string, unknown[]][], name: string, args: unknown[]) =>
  calls.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));

describe('field painter', () => {
  // The 20 m x 20 m keepaway area, and the 9.15 m center circle.
  const area = [420, 270, 160, 160];
  const circle = [427, 277, 146, 146];

  it('draws the keepaway area in a keepaway game', () => {
    const calls = drawCalls(makeServerParam({ keepaway: true }));
    expect(has(calls, 'drawRect', area)).toBe(true);
    expect(has(calls, 'drawEllipse', circle)).toBe(false);
  });

  it('draws the center line and circle otherwise, unless the option asks for the area', () => {
    const calls = drawCalls(makeServerParam({ keepaway: false }));
    expect(has(calls, 'drawRect', area)).toBe(false);
    expect(has(calls, 'drawEllipse', circle)).toBe(true);

    const view = new ViewState();
    view.options.showKeepawayArea = true;
    expect(has(drawCalls(makeServerParam({ keepaway: false }), view), 'drawRect', area)).toBe(true);
  });
});
