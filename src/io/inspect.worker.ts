// Decompresses a log file off the main thread and reports its format.
// Phase 0 placeholder for the parsing worker of Phase 1.
import { detectRcgFormat, isGzip } from './format';
import { decompressIfGzip } from './gzip';
import type { InspectRequest, InspectResponse } from './inspect-types';

// The app is type-checked with the DOM library, where `self` is a Window.
interface WorkerScope {
  onmessage: ((event: MessageEvent<InspectRequest>) => void) | null;
  postMessage(message: InspectResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const raw = new Uint8Array(event.data.buffer);
  const gzip = isGzip(raw);
  decompressIfGzip(raw).then(
    (bytes) => {
      scope.postMessage({ ok: true, gzip, size: bytes.length, format: detectRcgFormat(bytes) });
    },
    (error: unknown) => {
      scope.postMessage({ ok: false, error: String(error) });
    },
  );
};
