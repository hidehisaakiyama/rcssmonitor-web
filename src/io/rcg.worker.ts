// Parses a game log off the main thread. Records are posted in batches so
// that the main thread can build its GameStore while parsing goes on.
import type { RcgRecord } from '../core/records';
import { loadRcgBytes } from './load';
import type { ParseIssue } from './parse-types';
import type { RcgWorkerMessage, RcgWorkerRequest } from './rcg-worker-types';

// The app is type-checked with the DOM library, where `self` is a Window.
interface WorkerScope {
  onmessage: ((event: MessageEvent<RcgWorkerRequest>) => void) | null;
  postMessage(message: RcgWorkerMessage): void;
}
const scope = self as unknown as WorkerScope;

const BATCH_SHOWS = 200;
const MAX_WARNINGS = 50;

scope.onmessage = (event) => {
  let batch: RcgRecord[] = [];
  let shows = 0;
  const warnings: ParseIssue[] = [];
  const flush = () => {
    if (batch.length > 0) {
      scope.postMessage({ type: 'records', records: batch });
      batch = [];
      shows = 0;
    }
  };
  let lastProgress = -1;

  loadRcgBytes(new Uint8Array(event.data.buffer), {
    record: (r) => {
      batch.push(r);
      if (r.type === 'show' && ++shows >= BATCH_SHOWS) {
        flush();
      }
    },
    warning: (w) => {
      if (warnings.length < MAX_WARNINGS) {
        warnings.push(w);
      }
    },
    progress: (phase, fraction) => {
      // Report in steps of 1 %.
      const step = Math.floor(fraction * 100);
      if (step !== lastProgress) {
        lastProgress = step;
        scope.postMessage({ type: 'progress', phase, fraction });
      }
    },
    info: (info) => {
      lastProgress = -1;
      scope.postMessage({ type: 'info', info });
    },
  }).then(
    (result) => {
      flush();
      scope.postMessage({ type: 'done', result, warnings });
    },
    (error: unknown) => {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
