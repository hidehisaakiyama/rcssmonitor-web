// The connection to rcssserver over WebSocket (rcssmonitor
// src/monitor_client.cpp, and the connect / disconnect / reconnect slots of
// src/main_window.cpp).
//
// - On open, sends "(dispinit version -1)". The server does not confirm; the
//   first JSON message (server_param) means the monitor was accepted, and
//   an S-expression such as "(error no_more_monitor)" that it was refused.
// - Without data for 5 seconds, disconnects (in the auto reconnect mode,
//   for the reconnect wait instead).
// - In the auto reconnect mode, any disconnection that the user did not ask
//   for is followed by a new connection 1 second later.
// - Each connection starts a new GameStore when its first JSON message
//   arrives. rcssmonitor clears its data when it starts connecting; keeping
//   the old game until the server answers lets one look at it while
//   reconnecting, and keeps a log open if the connection fails.
import type { GameStore } from '../../core/game-store';
import { DISP_BYE, DISP_INIT, MAX_COMMAND_LENGTH } from './commands';
import { LiveReceiver } from './protocol';

export interface LiveTarget {
  readonly host: string;
  readonly port: number;
  /** Request path, "/monitor" (or "/player"). */
  readonly path: string;
}

/** Prepends '/' if missing, as rcssmonitor does. */
export function normalizePath(path: string): string {
  const p = path.trim();
  return p.startsWith('/') ? p : `/${p}`;
}

export function liveUrl(target: LiveTarget): string {
  const host = target.host.trim();
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `ws://${bracketed}:${target.port}${normalizePath(target.path)}`;
}

/**
 * idle: not connected. connecting: opening the socket, or waiting for the
 * first message. connected: receiving the game. waiting: waiting to reconnect.
 */
export type LiveState = 'idle' | 'connecting' | 'connected' | 'waiting';

export interface LiveClientListener {
  state?(state: LiveState): void;
  /** A connection was accepted and starts this game. */
  game?(store: GameStore): void;
  /** A message for the status bar, shown for `timeout` milliseconds. */
  message?(text: string, timeout: number): void;
}

/** rcssmonitor: disconnect after 5 seconds without data. */
export const NO_DATA_TIMEOUT = 5000;
/** rcssmonitor: reconnect 1 second after a disconnection. */
export const RECONNECT_DELAY = 1000;
const MESSAGE_TIME = 5000;

export class LiveClient {
  /** Reconnect after a disconnection that the user did not ask for. */
  autoReconnect = false;
  /** Seconds without data before reconnecting, in the auto reconnect mode. */
  reconnectWait = 5;
  /** Milliseconds without data before disconnecting, otherwise. */
  timeout = NO_DATA_TIMEOUT;
  reconnectDelay = RECONNECT_DELAY;

  private readonly listener: LiveClientListener;
  private socket: WebSocket | null = null;
  private receiver: LiveReceiver | null = null;
  private targetValue: LiveTarget | null = null;
  private stateValue: LiveState = 'idle';
  private noDataTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(listener: LiveClientListener = {}) {
    this.listener = listener;
  }

  get state(): LiveState {
    return this.stateValue;
  }

  /** The server of the current or last connection. */
  get target(): LiveTarget | null {
    return this.targetValue;
  }

  get url(): string {
    return this.targetValue ? liveUrl(this.targetValue) : '';
  }

  /** The game of the current connection, once accepted. */
  get store(): GameStore | null {
    return this.stateValue === 'connected' ? (this.receiver?.store ?? null) : null;
  }

  /** True while commands can be sent. */
  get connected(): boolean {
    return this.stateValue === 'connected' && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Disconnects first if connected. */
  connect(target: LiveTarget): void {
    this.close();
    this.targetValue = target;
    this.open();
  }

  /** Disconnects as the user asked: sends (dispbye) and does not reconnect. */
  disconnect(): void {
    this.close();
    this.setState('idle');
  }

  /** Sends a command; false if not connected or too long. */
  send(command: string): boolean {
    if (!this.connected || !this.socket || command.length > MAX_COMMAND_LENGTH) {
      return false;
    }
    this.socket.send(command);
    return true;
  }

  private open(): void {
    const url = this.url;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      // A malformed address, or ws:// refused on an https page.
      this.message(`Cannot connect to ${url}: ${e instanceof Error ? e.message : String(e)}`);
      this.setState('idle');
      return;
    }
    const receiver = new LiveReceiver();
    let opened = false;
    this.socket = socket;
    this.receiver = receiver;

    socket.onopen = () => {
      opened = true;
      socket.send(DISP_INIT);
    };
    socket.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        this.receive(receiver, e.data);
      }
    };
    socket.onclose = () => {
      // The server closes without a close frame (code 1006), and the
      // browser does not tell why a connection failed.
      this.fail(
        opened
          ? 'Disconnected from the server.'
          : `Failed to connect to ${url}. Check server::ws_port and server::ws_allowed_origins.`,
      );
    };

    this.setState('connecting');
    this.message(`Connecting to ${url} ...`);
    this.armNoDataTimer();
  }

  private receive(receiver: LiveReceiver, data: string): void {
    this.armNoDataTimer();
    const m = receiver.receive(data);
    if (m.kind === 'text') {
      if (receiver.jsonMessages === 0) {
        this.fail(`Connection refused by the server: ${m.text}`);
      } else {
        this.message(m.text);
      }
      return;
    }
    if (m.kind !== 'json') {
      return;
    }
    if (this.stateValue !== 'connected') {
      this.setState('connected');
      this.message(`Connected to ${this.url}`);
      this.listener.game?.(receiver.store);
    }
    for (const notice of m.notices) {
      this.message(notice);
    }
  }

  /** A disconnection the user did not ask for (MonitorClient::requestDisconnect). */
  private fail(reason: string): void {
    this.message(reason);
    this.close();
    if (this.autoReconnect && this.targetValue) {
      this.setState('waiting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.open();
      }, this.reconnectDelay);
    } else {
      this.setState('idle');
    }
  }

  /** Stops the timers and closes the socket, saying (dispbye) if it is open. */
  private close(): void {
    clearTimeout(this.noDataTimer);
    clearTimeout(this.reconnectTimer);
    this.noDataTimer = undefined;
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN) {
      // Sent before the close frame.
      socket.send(DISP_BYE);
    }
    socket.close();
  }

  private armNoDataTimer(): void {
    clearTimeout(this.noDataTimer);
    const limit = this.autoReconnect ? this.reconnectWait * 1000 : this.timeout;
    this.noDataTimer = setTimeout(() => {
      this.noDataTimer = undefined;
      this.fail('No response from the server.');
    }, limit);
  }

  private setState(state: LiveState): void {
    if (state !== this.stateValue) {
      this.stateValue = state;
      this.listener.state?.(state);
    }
  }

  private message(text: string): void {
    this.listener.message?.(text, MESSAGE_TIME);
  }
}
