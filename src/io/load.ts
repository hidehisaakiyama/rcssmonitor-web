// Reads a game log file: gzip detection and decompression, format detection
// and parsing. Runs in the parsing Worker and in Node (tests, tools).
import type { RecordSink } from '../core/records';
import {
  describeFormat,
  detectRcgFormat,
  isGzip,
  isSupportedFormat,
  type RcgFormat,
} from './format';
import { decompressIfGzip } from './gzip';
import type { ParseIssue, ParseStats } from './parse-types';
import { parseJsonRcg } from './rcg-json';
import { parseTextRcg } from './rcg-text';

export interface LogInfo {
  readonly format: RcgFormat;
  readonly gzip: boolean;
  /** Size after decompression, in bytes. */
  readonly size: number;
}

export type LoadPhase = 'decompress' | 'parse';

export interface LoadCallbacks {
  readonly record: RecordSink;
  readonly warning?: (issue: ParseIssue) => void;
  readonly progress?: (phase: LoadPhase, fraction: number) => void;
  /** Called once the format is known, before parsing starts. */
  readonly info?: (info: LogInfo) => void;
}

export interface LoadResult extends ParseStats {
  readonly info: LogInfo;
}

/** A log that cannot be read at all (as opposed to a malformed line in it). */
export class LogFormatError extends Error {
  override name = 'LogFormatError';
}

export async function loadRcgBytes(
  raw: Uint8Array<ArrayBuffer>,
  cb: LoadCallbacks,
): Promise<LoadResult> {
  const gzip = isGzip(raw);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await decompressIfGzip(raw, (f) => cb.progress?.('decompress', f));
  } catch (e) {
    throw new LogFormatError(`cannot decompress the file: ${String(e)}`);
  }
  if (bytes.length === 0) {
    throw new LogFormatError('the file is empty');
  }
  const format = detectRcgFormat(bytes.subarray(0, 16));
  if (!isSupportedFormat(format)) {
    throw new LogFormatError(`unsupported log format: ${describeFormat(format)}`);
  }
  const info: LogInfo = { format, gzip, size: bytes.length };
  cb.info?.(info);

  const text = new TextDecoder('utf-8').decode(bytes);
  const parseCb = {
    record: cb.record,
    warning: cb.warning,
    progress: (f: number) => cb.progress?.('parse', f),
  };
  const stats = format.kind === 'json' ? parseJsonRcg(text, parseCb) : parseTextRcg(text, parseCb);
  if (stats.shows === 0) {
    throw new LogFormatError('no show record found in the log');
  }
  return { ...stats, info };
}
