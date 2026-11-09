import type { RcgRecord } from '../core/records';
import type { LoadPhase, LoadResult, LogInfo } from './load';
import type { ParseIssue } from './parse-types';

export interface RcgWorkerRequest {
  readonly buffer: ArrayBuffer;
}

export type RcgWorkerMessage =
  | { readonly type: 'info'; readonly info: LogInfo }
  | { readonly type: 'progress'; readonly phase: LoadPhase; readonly fraction: number }
  | { readonly type: 'records'; readonly records: readonly RcgRecord[] }
  /** The first warnings only; `result.warnings` has the total count. */
  | { readonly type: 'done'; readonly result: LoadResult; readonly warnings: readonly ParseIssue[] }
  | { readonly type: 'error'; readonly message: string };
