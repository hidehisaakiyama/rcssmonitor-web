import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySettings,
  defaultTargets,
  SETTINGS,
  SettingsStore,
  settingsFromUrl,
  snapshot,
} from '../../src/options/settings';
import { DEFAULT_PALETTE } from '../../src/view/palette';

/** A localStorage stand-in for Node. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('settings', () => {
  it('use the names of rcssmonitor, each once', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('show_player_number');
    expect(keys).toContain('field_brush');
    expect(keys).toContain('score_board_font');
    expect(SETTINGS.filter((s) => s.kind === 'color')).toHaveLength(35);
  });

  it('apply only valid values', () => {
    const t = defaultTargets();
    const applied = applySettings(t, {
      show_flag: true,
      ball_size: 0.5,
      grid_step: -1, // out of range
      ball_vel_cycle: 2.5, // not an integer
      field_brush: '#FF0000',
      line_pen: 'white', // not #rrggbb
      player_font: { family: 'serif', size: 15, bold: false },
      measure_font: { family: '', size: 12, bold: false },
      no_such_setting: 1,
    });
    expect(applied).toEqual(['show_flag', 'ball_size', 'field_brush', 'player_font']);
    expect(t.options.showFlag).toBe(true);
    expect(t.colors.field).toBe('#ff0000');
    expect(t.colors.line).toBe(DEFAULT_PALETTE.line);
    expect(t.fonts.player).toEqual({ family: 'serif', size: 15, bold: false });
  });

  it('read URL parameters like rcssmonitor command line options', () => {
    const params = new URLSearchParams(
      'show-view-area=on&show_flag=0&ball-size=0.2&field_brush=1fa01f&' +
        'score_board_font=DejaVu%20Sans,12,bold&timer_interval=50&bogus=1&connect=1',
    );
    expect(settingsFromUrl(params)).toEqual({
      show_view_area: true,
      show_flag: false,
      ball_size: 0.2,
      field_brush: '#1fa01f',
      score_board_font: { family: 'DejaVu Sans', size: 16, bold: true }, // 12 pt
      timer_interval: 50,
    });
  });
});

describe('SettingsStore', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves the settings and loads them again', () => {
    const t = defaultTargets();
    const store = new SettingsStore(t);
    store.load();
    t.options.showOffsideLine = true;
    t.colors.ball = '#123456';
    store.save();
    expect(JSON.parse(storage.data.get('rcssmonitor-web.settings') ?? '{}')).toMatchObject({
      show_offside_line: true,
      ball_pen: '#123456',
    });

    const u = defaultTargets();
    new SettingsStore(u).load();
    expect(snapshot(u)).toEqual(snapshot(t));
  });

  it('does not save what the URL set, unless it is changed', () => {
    storage.setItem('rcssmonitor-web.settings', JSON.stringify({ show_flag: false, ball_size: 1 }));
    const t = defaultTargets();
    const store = new SettingsStore(t);
    expect(store.load(new URLSearchParams('show_flag=on&ball_size=2'))).toEqual([
      'show_flag',
      'ball_size',
    ]);
    expect([t.options.showFlag, t.options.ballSize]).toEqual([true, 2]);
    // The user changes the ball size, not the flags.
    t.options.ballSize = 3;
    expect(store.toSave()).toMatchObject({ show_flag: false, ball_size: 3 });
  });

  it('uses the defaults when the storage fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const t = defaultTargets();
    const store = new SettingsStore(t);
    expect(() => store.load()).not.toThrow();
    expect(() => store.save()).not.toThrow();
    expect(snapshot(t)).toEqual(snapshot(defaultTargets()));
  });
});
