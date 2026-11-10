import { describe, expect, it } from 'vitest';
import { PITCH, PlayMode, Side } from '../../src/core/constants';
import { disabledPlayer, type Frame, type PlayerState } from '../../src/core/frame';
import { handleViewKey } from '../../src/ui/shortcuts';
import { scoreBoardText } from '../../src/view/hud/score-board';
import { darker } from '../../src/view/palette';
import { offsideLines, qtNumber } from '../../src/view/overlay-math';
import { layoutViewport } from '../../src/view/render2d/viewport';
import { ViewState } from '../../src/view/view-state';
import { loadFixture } from './helpers';

const player = (index: number, x: number, y: number, state = 1): PlayerState => ({
  ...disabledPlayer(index),
  state,
  x,
  y,
});

const frameWith = (players: PlayerState[], ball = { x: 0, y: 0 }): Frame => ({
  time: 1,
  stime: 0,
  mode: PlayMode.PlayOn,
  teams: [
    { name: 'L', score: 0, penScore: 0, penMiss: 0 },
    { name: 'R', score: 0, penScore: 0, penMiss: 0 },
  ],
  ball: { ...ball, vx: 0, vy: 0 },
  players: Array.from(
    { length: 22 },
    (_, i) =>
      players.find((p) => p.unum === (i % 11) + 1 && i < 11 === (p.side === Side.Left)) ??
      disabledPlayer(i),
  ),
});

describe('layoutViewport', () => {
  // Values measured on rcssmonitor with a 1000 x 677 canvas and a score
  // board font whose ascent is 18 pixels.
  it('fits the pitch like rcssmonitor', () => {
    const view = new ViewState();
    const vp = layoutViewport(view, 1000, 677, 18);
    expect(vp.fieldScale).toBe(8.04);
    expect(view.fieldScale).toBe(8.04);
    expect([vp.centerX, vp.centerY]).toEqual([500, 345]);
    expect(vp.screenX(PITCH.length / 2)).toBe(922); // right goal line
    expect(vp.screenX(-PITCH.length / 2 - PITCH.goalDepth) - 1).toBe(57); // left goal
    expect(vp.screenY(-PITCH.width / 2)).toBe(72); // top line
  });

  it('keeps no room for hidden logos and score board', () => {
    const view = new ViewState();
    view.options.showTeamGraphic = false;
    view.options.showScoreBoard = false;
    const vp = layoutViewport(view, 1000, 677, 18);
    expect(vp.fieldScale).toBe(8.62); // limited by the width: 1000 / 116
    expect(vp.centerY).toBe(338);
  });

  it('keeps the scale once zoomed and follows the focus point', () => {
    const view = new ViewState();
    layoutViewport(view, 1000, 677, 18);
    view.zoomIn();
    expect(view.fieldScale).toBeCloseTo(12.06);
    view.setFocusPoint(10, -5);
    const vp = layoutViewport(view, 1000, 677, 18);
    expect(vp.fieldScale).toBeCloseTo(12.06);
    expect(vp.screenX(10)).toBe(500);
    expect(vp.screenY(-5)).toBe(345);
    // The center is a whole pixel, so the focus point moves by up to half a pixel.
    expect(vp.fieldX(500)).toBeCloseTo(10, 1);

    view.fitToScreen();
    expect(layoutViewport(view, 1000, 677, 18).fieldScale).toBe(8.04);
  });

  it('limits the scale', () => {
    const view = new ViewState();
    view.setFieldScale(1000);
    expect(view.fieldScale).toBe(400);
    for (let i = 0; i < 30; ++i) {
      view.zoomOut();
    }
    expect(view.fieldScale).toBe(1);
  });
});

describe('ViewState selection and focus', () => {
  it('selects players by number', () => {
    const view = new ViewState();
    view.selectPlayer(3);
    expect(view.selected).toEqual({ side: Side.Left, unum: 3 });
    expect(view.isSelected(Side.Left, 3)).toBe(true);
    view.selectPlayer(22);
    expect(view.selected).toEqual({ side: Side.Right, unum: 11 });
    expect(view.selectType).toBe('fix');
    view.selectPlayer(0);
    expect([view.selected, view.selectType]).toEqual([null, 'unselect']);
  });

  it('selects the player nearest to the ball automatically', () => {
    const view = new ViewState();
    const frame = frameWith(
      [player(0, -10, 0), player(1, 5, 0), player(11, 2, 0), player(12, 1, 0, 0)],
      { x: 0, y: 0 },
    );
    view.toggleAutoSelect('autoAll');
    view.updateForFrame(frame);
    expect(view.selected).toEqual({ side: Side.Right, unum: 1 }); // the disabled one is skipped
    view.toggleAutoSelect('autoLeft');
    view.updateForFrame(frame);
    expect(view.selected).toEqual({ side: Side.Left, unum: 2 });
    view.toggleAutoSelect('autoLeft'); // again: unselect
    expect(view.selectType).toBe('unselect');
    expect(view.selected).toBeNull();
  });

  it('follows the ball or the selected player', () => {
    const view = new ViewState();
    const frame = frameWith([player(4, 7, 8)], { x: 3, y: -2 });
    view.toggleFocusBall();
    view.updateForFrame(frame);
    expect(view.focusPoint).toEqual({ x: 3, y: -2 });
    view.selectPlayer(5);
    view.toggleFocusPlayer();
    view.updateForFrame(frame);
    expect(view.focusPoint).toEqual({ x: 7, y: 8 });
    view.toggleFocusPlayer();
    expect(view.focusType).toBe('point');
  });

  it('notifies listeners', () => {
    const view = new ViewState();
    let calls = 0;
    const off = view.onChange(() => ++calls);
    view.toggle('showFlag');
    view.zoomIn();
    off();
    view.toggle('showFlag');
    expect(calls).toBe(2);
    expect(view.options.showFlag).toBe(false);
  });
});

describe('shortcuts', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
    ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    }) as KeyboardEvent;

  it('maps the rcssmonitor keys', () => {
    const view = new ViewState();
    expect(handleViewKey(view, key('v'))).toBe(true);
    expect(view.options.showViewArea).toBe(true);
    expect(handleViewKey(view, key('s', { ctrlKey: true }))).toBe(true);
    expect(view.options.showScoreBoard).toBe(false);
    handleViewKey(view, key('0'));
    expect(view.selected).toEqual({ side: Side.Left, unum: 10 });
    handleViewKey(view, key('-'));
    expect(view.selected).toEqual({ side: Side.Left, unum: 11 });
    handleViewKey(view, key('3', { ctrlKey: true }));
    expect(view.selected).toEqual({ side: Side.Right, unum: 3 });
    handleViewKey(view, key('-', { metaKey: true }));
    expect(view.selected).toEqual({ side: Side.Right, unum: 11 });
    handleViewKey(view, key('b'));
    expect(view.focusType).toBe('ball');
  });

  it('leaves other keys alone', () => {
    const view = new ViewState();
    expect(handleViewKey(view, key('q'))).toBe(false);
    expect(handleViewKey(view, key('v', { altKey: true }))).toBe(false);
    expect(handleViewKey(view, key('V', { shiftKey: true }))).toBe(false);
  });
});

describe('painter helpers', () => {
  it('darkens like QColor::darker', () => {
    expect(darker('#ffd700', 200)).toBe('#806c00');
    expect(darker('#ffd700', 100)).toBe('#ffd700');
  });

  it('formats numbers like QString::arg(v, 0, "g", 3)', () => {
    expect(qtNumber(0.5)).toBe('0.5');
    expect(qtNumber(0.123456)).toBe('0.123');
    expect(qtNumber(1)).toBe('1');
    expect(qtNumber(0)).toBe('0');
    expect(qtNumber(0.000123456)).toBe('0.000123');
    expect(qtNumber(0.0000123456)).toBe('1.23e-05');
    expect(qtNumber(0.99999)).toBe('1');
    expect(qtNumber(1234.5)).toBe('1.23e+03');
  });

  it('finds the second last defender of each team', () => {
    const frame = frameWith(
      [
        player(0, -50, 0), // left goalie
        player(1, -30, 0),
        player(2, -20, 0),
        player(11, 48, 0), // right goalie
        player(12, 35, 0),
        player(13, 20, 0),
      ],
      { x: 10, y: 0 },
    );
    expect(offsideLines(frame)).toEqual([-30, 35]);
    // The ball beyond the line moves it.
    expect(offsideLines({ ...frame, ball: { x: -40, y: 0, vx: 0, vy: 0 } })[0]).toBe(-40);
  });
});

describe('scoreBoardText', async () => {
  const json = await loadFixture('json-sample.rcg.gz');
  const text = await loadFixture('text-v5-sample.rcg.gz');
  const pk = await loadFixture('json-pk.rcg.gz');

  it('formats the score board line like rcssmonitor', () => {
    // " %10s %d:%d %-10s %19s %6d    "
    expect(scoreBoardText(json.store, 0)).toBe(
      ' HELIOS2023 0:0 CYRUS' + ' '.repeat(5 + 1 + 9) + 'kick_off_l' + ' '.repeat(1 + 5) + '1    ',
    );
    expect(scoreBoardText(text.store, 248)).toBe(
      ' HELIOS2022 1:0 CYRUS' + ' '.repeat(5 + 1 + 13) + 'goal_l' + ' '.repeat(1 + 2) + '6713    ',
    );
  });

  it('shows the penalty shoot-out', () => {
    // Before the first kick and outside a penalty play mode: hidden.
    expect(scoreBoardText(pk.store, 0)).toContain('play_on');
    expect(scoreBoardText(pk.store, 0)).not.toContain('|');
    // penalty_setup_l of the first kick: shown, still empty.
    expect(scoreBoardText(pk.store, 2)).toBe(
      ' HELIOS2023 0:0 |     :     | CYRUS          penalty_setup_l   6000',
    );
    // The same frame as the rcssmonitor capture (tools/parity).
    expect(scoreBoardText(pk.store, 30)).toBe(
      ' HELIOS2023 0:0 |oxoo :oox  | CYRUS          penalty_setup_r   6028',
    );
    expect(scoreBoardText(pk.store, 42)).toContain('|oxooo:ooxox|');
  });
});
