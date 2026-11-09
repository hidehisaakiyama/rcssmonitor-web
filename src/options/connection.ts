// Where and how to connect (rcssmonitor's server_host, server_port,
// server_ws_path, auto_reconnect_mode, auto_reconnect_wait and --connect).
//
// Saved settings override the defaults, and URL parameters override both:
//   ?connect=1&host=192.168.0.10&port=6080&path=/monitor
//   &auto_reconnect_mode=on&auto_reconnect_wait=10
// rcssmonitor's option names work too (server_host, server_port,
// server_ws_path), also with '-' (server-host).
import { readSetting, writeSetting } from './storage';

export interface ConnectionSettings {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly autoReconnect: boolean;
  /** Seconds without data before reconnecting. */
  readonly reconnectWait: number;
}

/** rcssmonitor's README starts the server with server::ws_port=6080. */
export const DEFAULT_CONNECTION: ConnectionSettings = {
  host: 'localhost',
  port: 6080,
  path: '/monitor',
  autoReconnect: false,
  reconnectWait: 5,
};

const KEY = 'connection';

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isValidWait(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600;
}

/** Applies the valid fields of `values` over `base`. */
export function mergeConnection(
  base: ConnectionSettings,
  values: Partial<Record<keyof ConnectionSettings, unknown>>,
): ConnectionSettings {
  const { host, port, path, autoReconnect, reconnectWait } = values;
  return {
    host: typeof host === 'string' && host.trim() !== '' ? host.trim() : base.host,
    port: typeof port === 'number' && isValidPort(port) ? port : base.port,
    path: typeof path === 'string' && path.trim() !== '' ? path.trim() : base.path,
    autoReconnect: typeof autoReconnect === 'boolean' ? autoReconnect : base.autoReconnect,
    reconnectWait:
      typeof reconnectWait === 'number' && isValidWait(reconnectWait)
        ? reconnectWait
        : base.reconnectWait,
  };
}

export function loadConnection(): ConnectionSettings {
  const saved = readSetting(KEY);
  return typeof saved === 'object' && saved !== null
    ? mergeConnection(DEFAULT_CONNECTION, saved)
    : DEFAULT_CONNECTION;
}

export function saveConnection(settings: ConnectionSettings): void {
  writeSetting(KEY, settings);
}

/** "on", "true", "1" / "off", "false", "0"; undefined otherwise. */
function parseBool(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'on' || v === 'true' || v === 'yes') {
    return true;
  }
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') {
    return false;
  }
  return undefined;
}

function parseInteger(value: string | null): number | undefined {
  return value !== null && /^\s*\d+\s*$/.test(value) ? Number(value) : undefined;
}

/** The URL parameters over `base`, and whether to connect at start-up. */
export function connectionFromUrl(
  base: ConnectionSettings,
  params: URLSearchParams,
): { settings: ConnectionSettings; connect: boolean } {
  // The first of the names given, with '-' read as '_'.
  const named = new Map([...params].map(([k, v]) => [k.replace(/-/g, '_'), v]));
  const get = (...names: string[]) => {
    for (const n of names) {
      const v = named.get(n);
      if (v !== undefined) {
        return v;
      }
    }
    return null;
  };
  return {
    settings: mergeConnection(base, {
      host: get('host', 'server_host') ?? undefined,
      port: parseInteger(get('port', 'server_port')),
      path: get('path', 'server_ws_path') ?? undefined,
      autoReconnect: parseBool(get('auto_reconnect_mode')),
      reconnectWait: parseInteger(get('auto_reconnect_wait')),
    }),
    connect: parseBool(get('connect')) ?? false,
  };
}
