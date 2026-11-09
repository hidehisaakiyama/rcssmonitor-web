import { describe, expect, it } from 'vitest';
import { Playback } from '../../src/playback/playback';
import {
  handleMonitorKey,
  handlePlayerKey,
  handleViewKey,
  handleWindowKey,
  keyLabel,
  SHORTCUTS,
  type KeySpec,
} from '../../src/ui/shortcuts';
import { ViewState } from '../../src/view/view-state';

const noop = () => {};

/** True if one of the handlers uses the key. */
function handled(k: KeySpec): boolean {
  const e = {
    key: k.key,
    ctrlKey: k.ctrl ?? false,
    metaKey: false,
    altKey: k.alt ?? false,
    shiftKey: false,
  } as KeyboardEvent;
  const actions = {
    open: noop,
    toggle3d: noop,
    nextCamera: noop,
    toggleMenuBar: noop,
    playerTypes: noop,
    preference: noop,
    fullScreen: noop,
    connect: noop,
    live: noop,
    kickOff: noop,
  };
  return (
    handleWindowKey(actions, e) ||
    handleMonitorKey(actions, e) ||
    handlePlayerKey(new Playback(), e) ||
    handleViewKey(new ViewState(), e)
  );
}

const id = (k: KeySpec) => `${k.ctrl ? 'C-' : ''}${k.alt ? 'A-' : ''}${k.key.toLowerCase()}`;

describe('the shortcut list', () => {
  const listed = new Set(SHORTCUTS.flatMap((s) => s.keys.map(id)));

  it('lists only keys that work', () => {
    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        expect(handled(k), keyLabel(k)).toBe(true);
      }
    }
  });

  it('lists every key that works', () => {
    const names = [
      ...'abcdefghijklmnopqrstuvwxyz0123456789-',
      ' ',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'Enter',
      'F11',
      'Escape',
    ];
    for (const key of names) {
      for (const mods of [{}, { ctrl: true }, { alt: true }]) {
        const k: KeySpec = { key, ...mods };
        expect(listed.has(id(k)), keyLabel(k)).toBe(handled(k));
      }
    }
  });

  it('names the keys', () => {
    expect(keyLabel({ key: 'o', ctrl: true })).toBe('Ctrl+O');
    expect(keyLabel({ key: 'Enter', alt: true })).toBe('Alt+Enter');
    expect(keyLabel({ key: 'ArrowUp', ctrl: true })).toBe('Ctrl+↑');
    expect(keyLabel({ key: ' ' })).toBe('Space');
  });
});
