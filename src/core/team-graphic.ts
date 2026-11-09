// Team logos sent as 8x8 XPM tiles (rcssmonitor src/team_graphic.cpp).

export const TILE_SIZE = 8;
export const MAX_WIDTH = 256;
export const MAX_HEIGHT = 64;
const MAX_TILES_X = MAX_WIDTH / TILE_SIZE;

/** RGBA, 0-255 each. */
export type Rgba = readonly [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

interface Tile {
  readonly colors: ReadonlyMap<string, Rgba>;
  readonly lines: readonly string[];
}

/**
 * A team logo assembled from tiles. The size is the bounding box of the tiles
 * received so far, so it can grow while tiles arrive.
 */
export class TeamGraphic {
  private readonly tiles = new Map<number, Tile>();
  private widthPx = 0;
  private heightPx = 0;
  private rev = 0;
  /** Color specifications that could not be understood (drawn transparent). */
  readonly unknownColors = new Set<string>();

  get width(): number {
    return this.widthPx;
  }

  get height(): number {
    return this.heightPx;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Increases each time a tile is added. Renderers use it to cache images. */
  get revision(): number {
    return this.rev;
  }

  isEmpty(): boolean {
    return this.tiles.size === 0;
  }

  /** True if every tile inside the bounding box has arrived. */
  isComplete(): boolean {
    return (
      this.tiles.size > 0 &&
      this.tiles.size === (this.widthPx / TILE_SIZE) * (this.heightPx / TILE_SIZE)
    );
  }

  hasTile(x: number, y: number): boolean {
    return this.tiles.has(y * MAX_TILES_X + x);
  }

  /**
   * Adds a tile at tile position (x, y). xpm is the XPM data as strings:
   * the header "8 8 N 1", N color lines and 8 pixel lines. A tile already at
   * that position is replaced.
   *
   * @returns null on success, or the reason the tile was rejected.
   */
  addTile(x: number, y: number, xpm: readonly string[]): string | null {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      (x + 1) * TILE_SIZE > MAX_WIDTH ||
      (y + 1) * TILE_SIZE > MAX_HEIGHT
    ) {
      return `tile position out of range (${x}, ${y})`;
    }
    const header = (xpm[0] ?? '').trim().split(/\s+/).map(Number);
    const [w, h, nColors, cpp] = header;
    if (
      header.length < 4 ||
      w !== TILE_SIZE ||
      h !== TILE_SIZE ||
      nColors === undefined ||
      !Number.isInteger(nColors) ||
      nColors < 1 ||
      cpp !== 1
    ) {
      return `illegal XPM header "${xpm[0] ?? ''}"`;
    }
    if (xpm.length !== 1 + nColors + TILE_SIZE) {
      return `XPM has ${xpm.length} lines, expected ${1 + nColors + TILE_SIZE}`;
    }
    const colors = new Map<string, Rgba>();
    for (let i = 1; i <= nColors; ++i) {
      const line = xpm[i] ?? '';
      const ch = line.charAt(0);
      const spec = colorSpec(line.slice(1));
      if (ch === '' || spec === undefined) {
        return `illegal XPM color "${line}"`;
      }
      let rgba = parseXpmColor(spec);
      if (rgba === undefined) {
        this.unknownColors.add(spec);
        rgba = TRANSPARENT;
      }
      colors.set(ch, rgba);
    }
    const lines = xpm.slice(1 + nColors);
    if (lines.some((line) => line.length !== TILE_SIZE)) {
      return 'illegal XPM pixel line length';
    }
    this.tiles.set(y * MAX_TILES_X + x, { colors, lines });
    this.widthPx = Math.max(this.widthPx, (x + 1) * TILE_SIZE);
    this.heightPx = Math.max(this.heightPx, (y + 1) * TILE_SIZE);
    ++this.rev;
    return null;
  }

  /**
   * Decodes the logo to RGBA pixels, width * height * 4 bytes, row by row.
   * Missing tiles and pixels with an unknown character are transparent.
   */
  toRgba(): Uint8ClampedArray<ArrayBuffer> {
    const width = this.widthPx;
    const data = new Uint8ClampedArray(width * this.heightPx * 4);
    for (const [key, tile] of this.tiles) {
      const x0 = (key % MAX_TILES_X) * TILE_SIZE;
      const y0 = Math.floor(key / MAX_TILES_X) * TILE_SIZE;
      tile.lines.forEach((line, dy) => {
        for (let dx = 0; dx < TILE_SIZE; ++dx) {
          const c = tile.colors.get(line.charAt(dx)) ?? TRANSPARENT;
          data.set(c, ((y0 + dy) * width + x0 + dx) * 4);
        }
      });
    }
    return data;
  }
}

/**
 * Returns the color value of the "c" (color visual) key of an XPM color line
 * without its pixel character, e.g. " c #FF0000" or " s bg c light gray".
 * Falls back to the first key's value when there is no "c" key.
 */
function colorSpec(rest: string): string | undefined {
  const tokens = rest.trim().split(/\s+/);
  const keys = new Set(['c', 'm', 'g', 'g4', 's']);
  let firstValue: string | undefined;
  for (let i = 0; i < tokens.length;) {
    const key = tokens[i] ?? '';
    if (!keys.has(key)) {
      return undefined;
    }
    let j = i + 1;
    while (j < tokens.length && !keys.has(tokens[j] ?? '')) {
      ++j;
    }
    const value = tokens.slice(i + 1, j).join(' ');
    if (value === '') {
      return undefined;
    }
    if (key === 'c') {
      return value;
    }
    firstValue ??= value;
    i = j;
  }
  return firstValue;
}

/** Parses an XPM color value: None, #RGB, #RRGGBB, #RRRRGGGGBBBB or an X11 name. */
export function parseXpmColor(spec: string): Rgba | undefined {
  const s = spec.trim();
  if (s.toLowerCase() === 'none' || s.toLowerCase() === 'transparent') {
    return TRANSPARENT;
  }
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 3 !== 0 || hex.length > 12) {
      return undefined;
    }
    const n = hex.length / 3;
    const channel = (i: number) => {
      // Keep the most significant byte; a single digit d means dd.
      const part = hex.slice(i * n, (i + 1) * n);
      return n === 1 ? parseInt(part + part, 16) : parseInt(part.slice(0, 2), 16);
    };
    return [channel(0), channel(1), channel(2), 255];
  }
  const name = s.toLowerCase().replace(/\s+/g, '');
  const gray = /^gr[ae]y(\d{1,3})$/.exec(name);
  if (gray?.[1] !== undefined) {
    const level = Number(gray[1]);
    if (level > 100) {
      return undefined;
    }
    const v = Math.round(level * 2.55);
    return [v, v, v, 255];
  }
  const rgb = X11_COLORS[name];
  return rgb === undefined ? undefined : [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255];
}

// Common X11 color names (rgb.txt values, which differ from CSS for gray,
// green, maroon and purple).
const X11_COLORS: Readonly<Record<string, number>> = {
  white: 0xffffff,
  black: 0x000000,
  red: 0xff0000,
  green: 0x00ff00,
  blue: 0x0000ff,
  yellow: 0xffff00,
  cyan: 0x00ffff,
  magenta: 0xff00ff,
  gray: 0xbebebe,
  grey: 0xbebebe,
  lightgray: 0xd3d3d3,
  lightgrey: 0xd3d3d3,
  darkgray: 0xa9a9a9,
  darkgrey: 0xa9a9a9,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  slategray: 0x708090,
  slategrey: 0x708090,
  orange: 0xffa500,
  orangered: 0xff4500,
  darkorange: 0xff8c00,
  purple: 0xa020f0,
  violet: 0xee82ee,
  pink: 0xffc0cb,
  hotpink: 0xff69b4,
  brown: 0xa52a2a,
  maroon: 0xb03060,
  navy: 0x000080,
  navyblue: 0x000080,
  darkblue: 0x00008b,
  royalblue: 0x4169e1,
  steelblue: 0x4682b4,
  skyblue: 0x87ceeb,
  lightblue: 0xadd8e6,
  darkgreen: 0x006400,
  forestgreen: 0x228b22,
  limegreen: 0x32cd32,
  lightgreen: 0x90ee90,
  darkred: 0x8b0000,
  firebrick: 0xb22222,
  gold: 0xffd700,
  khaki: 0xf0e68c,
  beige: 0xf5f5dc,
  tan: 0xd2b48c,
  chocolate: 0xd2691e,
  salmon: 0xfa8072,
  coral: 0xff7f50,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
};
