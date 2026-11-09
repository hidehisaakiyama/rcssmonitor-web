// Settings kept in localStorage. Every access is guarded: storage may be
// unavailable (blocked, private windows, some file:// setups), and then the
// defaults are used.

const PREFIX = 'rcssmonitor-web.';

export function readSetting(key: string): unknown {
  try {
    const text = localStorage.getItem(PREFIX + key);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

export function writeSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // not saved
  }
}
