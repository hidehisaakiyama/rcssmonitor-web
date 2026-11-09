// Messages of the JSON monitor protocol into a GameStore (docs/protocol.md
// §2-3). Each WebSocket message is one JSON object; replies that the server
// sends before accepting the monitor, such as "(error no_more_monitor)", are
// S-expressions instead.
import { GameStore } from '../../core/game-store';
import { jsonMessageToRecords } from '../rcg-json';

export type LiveMessage =
  /** Applied to the store. `notices` are the (error ...) / (warning ...) msg replies in it. */
  | { readonly kind: 'json'; readonly notices: readonly string[] }
  /** Not JSON, e.g. "(error no_more_monitor)". */
  | { readonly kind: 'text'; readonly text: string }
  /** Starts like JSON but does not parse; skipped. */
  | { readonly kind: 'broken' };

/** True for a server reply worth showing, e.g. "(error illegal_command_form)". */
export function isServerNotice(message: string): boolean {
  return /^\((error|warning)[\s)]/.test(message);
}

export class LiveReceiver {
  /** The game of this connection. */
  readonly store = new GameStore();
  /** JSON messages applied so far. */
  jsonMessages = 0;
  /** Messages or values skipped as malformed. */
  warnings = 0;
  lastWarning = '';
  private readonly unknownKeys = new Set<string>();

  receive(data: string): LiveMessage {
    // The server sends no terminating NUL, but strip it as rcssmonitor does.
    const text = data.replace(/\0+$/, '').trim();
    if (!text.startsWith('{')) {
      return { kind: 'text', text };
    }
    const value = parseJson(text);
    if (value === undefined) {
      this.warn('not a JSON message');
      return { kind: 'broken' };
    }
    const notices: string[] = [];
    jsonMessageToRecords(
      value,
      (r) => {
        this.store.apply(r);
        if (r.type === 'msg' && isServerNotice(r.message)) {
          notices.push(r.message);
        }
      },
      (m) => this.warn(m),
      this.unknownKeys,
    );
    ++this.jsonMessages;
    return { kind: 'json', notices };
  }

  private warn(message: string): void {
    ++this.warnings;
    this.lastWarning = message;
  }
}

/**
 * JSON.parse, retried with the control characters escaped: the server
 * escapes only '"' and '\' in strings, so a message with a newline, e.g. from
 * a coach, is not valid JSON. Its JSON has no white space between tokens, so
 * every control character is inside a string.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // retried below
  }
  // eslint-disable-next-line no-control-regex
  const escaped = text.replace(/[\u0000-\u001f]/g, (c) => {
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  if (escaped === text) {
    return undefined;
  }
  try {
    return JSON.parse(escaped) as unknown;
  } catch {
    return undefined;
  }
}
