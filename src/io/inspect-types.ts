import type { RcgFormat } from './format';

export interface InspectRequest {
  buffer: ArrayBuffer;
}

export type InspectResponse =
  { ok: true; gzip: boolean; size: number; format: RcgFormat } | { ok: false; error: string };
