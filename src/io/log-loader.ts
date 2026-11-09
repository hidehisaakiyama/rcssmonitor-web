// Main-thread side of the parsing Worker.
import { GameStore } from '../core/game-store';
import type { LoadPhase, LoadResult, LogInfo } from './load';
import type { ParseIssue } from './parse-types';
import RcgWorker from './rcg.worker?worker&inline';
import type { RcgWorkerMessage } from './rcg-worker-types';

export interface LoadedLog {
  readonly store: GameStore;
  readonly result: LoadResult;
  /** The first warnings; result.warnings has the total count. */
  readonly warnings: readonly ParseIssue[];
}

export interface LogLoaderCallbacks {
  readonly progress?: (phase: LoadPhase, fraction: number, store: GameStore) => void;
  readonly info?: (info: LogInfo) => void;
}

/**
 * Parses a log file in a Worker and fills a new GameStore with it.
 * The buffer is transferred to the Worker and cannot be used afterwards.
 */
export function loadLogFile(buffer: ArrayBuffer, cb: LogLoaderCallbacks = {}): Promise<LoadedLog> {
  const store = new GameStore();
  const worker = new RcgWorker();
  return new Promise<LoadedLog>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<RcgWorkerMessage>) => {
      const m = event.data;
      switch (m.type) {
        case 'records':
          store.applyAll(m.records);
          break;
        case 'progress':
          cb.progress?.(m.phase, m.fraction, store);
          break;
        case 'info':
          cb.info?.(m.info);
          break;
        case 'done':
          resolve({ store, result: m.result, warnings: m.warnings });
          break;
        case 'error':
          reject(new Error(m.message));
          break;
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || 'the log parser stopped unexpectedly'));
    };
    worker.postMessage({ buffer }, [buffer]);
  }).finally(() => {
    worker.terminate();
  });
}
