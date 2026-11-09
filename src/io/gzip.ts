import { isGzip } from './format';

/**
 * Uncompressed size stored in the last 4 bytes of a gzip member (ISIZE,
 * modulo 2^32). Used only as a progress estimate.
 */
export function gzipSizeHint(bytes: Uint8Array): number {
  const n = bytes.length;
  if (n < 18) {
    return 0;
  }
  return (
    ((bytes[n - 4] ?? 0) |
      ((bytes[n - 3] ?? 0) << 8) |
      ((bytes[n - 2] ?? 0) << 16) |
      ((bytes[n - 1] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Decompresses gzip data with the platform's DecompressionStream.
 * @param onProgress called with the estimated fraction done (0-1)
 */
export async function gunzip(
  bytes: Uint8Array<ArrayBuffer>,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const hint = gzipSizeHint(bytes);
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
    if (onProgress && hint > 0) {
      onProgress(Math.min(1, total / hint));
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Returns the bytes unchanged unless they are gzip data. */
export async function decompressIfGzip(
  bytes: Uint8Array<ArrayBuffer>,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  return isGzip(bytes) ? gunzip(bytes, onProgress) : bytes;
}
