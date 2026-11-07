import { isGzip } from './format';

/** Decompresses gzip data with the platform's DecompressionStream. */
export async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns the bytes unchanged unless they are gzip data. */
export async function decompressIfGzip(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}
