import InspectWorker from './inspect.worker?worker&inline';
import type { InspectResponse } from './inspect-types';

/** Runs the inspect worker on a log file. The buffer is transferred to the worker. */
export async function inspectRcg(buffer: ArrayBuffer): Promise<InspectResponse> {
  const worker = new InspectWorker();
  try {
    return await new Promise<InspectResponse>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<InspectResponse>) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message || 'worker error'));
      worker.postMessage({ buffer }, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
