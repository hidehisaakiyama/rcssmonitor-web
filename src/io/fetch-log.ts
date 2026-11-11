// Downloads a game log from a URL (File > Open Game Log from URL, ?log=).
// The bytes go to the same parsing Worker as a file's.
//
// A page may read another site's file only if that server allows it (CORS),
// and a page served over https may not read http:// URLs (mixed content).
// Neither can be worked around here; the app asks the user to download the
// file with the browser and open it instead.
//
// Files on GitHub: github.com lets no other site read its file pages, nor
// follow its raw links (the redirect has no CORS header), but the hosts of
// the raw files do. A github.com URL is read from raw.githubusercontent.com,
// and a file stored with Git LFS, which is a pointer there, from
// media.githubusercontent.com (where files not in LFS are 404).

/**
 * The URL of a log, from what the user typed or the `log` URL parameter.
 * Relative URLs are read against `base`, the page's URL, and a GitHub file
 * page or raw link becomes the URL of its raw file. Throws if it is not an
 * http:// or https:// URL that fetch() can take.
 */
export function parseLogUrl(text: string, base: string): URL {
  const t = text.trim();
  if (t === '') {
    throw new Error('no URL given');
  }
  let url: URL;
  try {
    url = new URL(t, base);
  } catch {
    throw new Error(`not a URL: ${t}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`not an http:// or https:// URL: ${t}`);
  }
  if (url.username !== '' || url.password !== '') {
    // fetch() refuses them.
    throw new Error(`a URL with a user name or password cannot be opened: ${t}`);
  }
  return githubRawUrl(url) ?? url;
}

/**
 * The raw file of a GitHub file page or raw link, github.com/OWNER/REPO/
 * blob/REF/PATH or …/raw/REF/PATH, as GitHub's own raw link redirects to
 * (the branch may have slashes; GitHub resolves it). Null for other URLs.
 */
export function githubRawUrl(url: URL): URL | null {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null;
  }
  const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
  return m ? new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`) : null;
}

/** Where GitHub serves the Git LFS object of a raw.githubusercontent.com URL; null for others. */
export function githubLfsUrl(url: URL): URL | null {
  return url.hostname === 'raw.githubusercontent.com'
    ? new URL(`https://media.githubusercontent.com/media${url.pathname}`)
    : null;
}

const LFS_VERSION = 'version https://git-lfs.github.com/spec/v1\n';

/**
 * The size of the file a Git LFS pointer stands for, if `bytes` is one
 * (a few lines of text under 1024 bytes: version, oid, size). Null otherwise.
 */
export function lfsPointerSize(bytes: Uint8Array): number | null {
  if (bytes.length >= 1024 || bytes.length < LFS_VERSION.length) {
    return null;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(LFS_VERSION)) {
    return null;
  }
  const size = /^size (\d+)$/m.exec(text);
  return size ? Number(size[1]) : null;
}

/** The name to show for a log at `url`: the last part of its path, or its host. */
export function logNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').findLast((part) => part !== '') ?? '';
  try {
    return decodeURIComponent(last) || url.host;
  } catch {
    return last;
  }
}

/** Hosts that a page served over https may still read over http (the local machine). */
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Whether the browser blocks a page at `page` from reading `url` because the
 * page is served over https and the URL is http:// to another machine.
 */
export function isMixedContent(url: URL, page: string): boolean {
  return url.protocol === 'http:' && page.startsWith('https:') && !isLoopback(url.hostname);
}

/** The server answered with an error instead of the file. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly status: number,
    statusText: string,
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
  }
}

export interface FetchLogOptions {
  readonly signal?: AbortSignal;
  /**
   * Bytes received so far, and the length the server gave if any. A server
   * that compresses the body on the way (Content-Encoding) gives the length
   * of the compressed body, so more than `total` may arrive.
   */
  readonly progress?: (received: number, total: number | undefined) => void;
}

/**
 * Downloads a log; for a Git LFS pointer on GitHub, the file it stands for.
 * Rejects with HttpError if the server answers with an error, and with a
 * TypeError if the browser does not let the page read the URL (CORS, mixed
 * content) or the network fails: the browser does not tell which. An abort
 * through `signal` rejects with an AbortError.
 */
export async function fetchLog(url: URL, options: FetchLogOptions = {}): Promise<ArrayBuffer> {
  const first = await download(url, options);
  const size = lfsPointerSize(first.bytes);
  if (size === null) {
    return first.bytes.buffer;
  }
  const media = githubLfsUrl(first.url);
  if (!media) {
    throw new Error('the server gave a Git LFS pointer instead of the file');
  }
  return (await download(media, options, size)).bytes.buffer;
}

/** Reads the body of `url`, and where it came from after redirects. */
async function download(
  url: URL,
  options: FetchLogOptions,
  size?: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; url: URL }> {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText);
  }
  const from = response.url ? new URL(response.url) : url;
  if (!response.body) {
    return { bytes: new Uint8Array(await response.arrayBuffer()), url: from };
  }
  const length = Number(response.headers.get('content-length') ?? Number.NaN);
  const total = Number.isSafeInteger(length) && length > 0 ? length : size;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    options.progress?.(received, total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, url: from };
}
