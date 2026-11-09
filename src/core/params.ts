// server_param / player_param / player_type.
//
// A parameter set is a plain object: the default table overlaid with the
// values that arrived. Known names are typed from the default table; names
// this monitor does not know (from newer servers) are kept as they came.
import {
  PLAYER_PARAM_DEFAULTS,
  PLAYER_TYPE_DEFAULTS,
  SERVER_PARAM_DEFAULTS,
} from './param-defaults';

export type ParamValue = number | boolean | string;

/** Parameters as they arrive: JSON values, or strings and numbers from a text log. */
export type RawParams = Readonly<Record<string, ParamValue>>;

type Widen<T> = {
  readonly [K in keyof T]: T[K] extends number ? number : T[K] extends boolean ? boolean : string;
};

type ParamSet<T> = Widen<T> & Readonly<Record<string, ParamValue>>;

export type ServerParam = ParamSet<typeof SERVER_PARAM_DEFAULTS>;
export type PlayerParam = ParamSet<typeof PLAYER_PARAM_DEFAULTS>;
export type PlayerType = ParamSet<typeof PLAYER_TYPE_DEFAULTS>;

export const DEFAULT_SERVER_PARAM: ServerParam = SERVER_PARAM_DEFAULTS;
export const DEFAULT_PLAYER_PARAM: PlayerParam = PLAYER_PARAM_DEFAULTS;
export const DEFAULT_PLAYER_TYPE: PlayerType = PLAYER_TYPE_DEFAULTS;

export function makeServerParam(raw: RawParams): ServerParam {
  return overlay(SERVER_PARAM_DEFAULTS, raw) as ServerParam;
}

export function makePlayerParam(raw: RawParams): PlayerParam {
  return overlay(PLAYER_PARAM_DEFAULTS, raw) as PlayerParam;
}

export function makePlayerType(raw: RawParams): PlayerType {
  return overlay(PLAYER_TYPE_DEFAULTS, raw) as PlayerType;
}

function overlay(
  defaults: Readonly<Record<string, ParamValue>>,
  raw: RawParams,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...defaults };
  for (const [name, value] of Object.entries(raw)) {
    const v = coerce(defaults[name], value);
    if (v !== undefined) {
      out[name] = v;
    }
  }
  return out;
}

/**
 * Converts a value to the type of the default value, the way rcssmonitor's
 * set_value() does: booleans accept 0/1, true/false and on/off. Values that
 * cannot be converted are dropped, so the default stays.
 */
export function coerce(def: ParamValue | undefined, raw: ParamValue): ParamValue | undefined {
  switch (typeof def) {
    case 'number':
      if (typeof raw === 'number') {
        return raw;
      }
      if (typeof raw === 'boolean') {
        return raw ? 1 : 0;
      }
      return parseNumber(raw);
    case 'boolean':
      if (typeof raw === 'boolean') {
        return raw;
      }
      if (typeof raw === 'number') {
        return raw !== 0;
      }
      switch (raw.trim()) {
        case '1':
        case 'true':
        case 'on':
          return true;
        case '0':
        case 'false':
        case 'off':
          return false;
        default:
          return undefined;
      }
    case 'string':
      return typeof raw === 'string' ? raw : String(raw);
    default:
      return raw;
  }
}

function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (t === '') {
    return undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
