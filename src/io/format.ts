/**
 * Game log (rcg) formats. Binary v1-v3 are detected only so that they can be
 * reported as unsupported.
 */
export type RcgFormat =
  | { kind: 'json' }
  | { kind: 'text'; version: 4 | 5 | 6 }
  | { kind: 'binary'; version: 1 | 2 | 3 }
  | { kind: 'unknown' };

/** True if the bytes start with the gzip magic number (1f 8b). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Detects the format from the first bytes of an uncompressed log.
 *
 * Follows rcssmonitor's rcss/rcg/parser.cpp: "[" means JSON, "ULG" followed by
 * '4'-'6' means text, "ULG" followed by the byte 2 or 3 means binary, and
 * anything else is a headerless binary v1 log. Unlike rcssmonitor, a UTF-8 BOM
 * and whitespace before the "[" of a JSON log are tolerated.
 */
export function detectRcgFormat(head: Uint8Array): RcgFormat {
  if (head.length === 0) {
    return { kind: 'unknown' };
  }
  if (head[skipBomAndSpace(head)] === 0x5b /* [ */) {
    return { kind: 'json' };
  }
  if (head.length >= 4 && head[0] === 0x55 && head[1] === 0x4c && head[2] === 0x47 /* ULG */) {
    switch (head[3]) {
      case 0x34:
        return { kind: 'text', version: 4 };
      case 0x35:
        return { kind: 'text', version: 5 };
      case 0x36:
        return { kind: 'text', version: 6 };
      case 2:
        return { kind: 'binary', version: 2 };
      case 3:
        return { kind: 'binary', version: 3 };
      default:
        return { kind: 'unknown' };
    }
  }
  return { kind: 'binary', version: 1 };
}

/** True for the formats this monitor can read. */
export function isSupportedFormat(format: RcgFormat): boolean {
  return format.kind === 'json' || format.kind === 'text';
}

export function describeFormat(format: RcgFormat): string {
  switch (format.kind) {
    case 'json':
      return 'JSON';
    case 'text':
      return `text v${format.version}`;
    case 'binary':
      return `binary v${format.version} (not supported)`;
    case 'unknown':
      return 'unknown format';
  }
}

function skipBomAndSpace(bytes: Uint8Array): number {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (i < bytes.length) {
    const c = bytes[i];
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
      break;
    }
    ++i;
  }
  return i;
}
