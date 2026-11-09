// Default colors and fonts of rcssmonitor (src/options.cpp).

export interface Palette {
  field: string;
  line: string;
  measureLine: string;
  measureMark: string;
  measureFont: string;
  measureFont2: string;
  scoreBoardPen: string;
  scoreBoardBrush: string;
  ball: string;
  ballVel: string;
  playerPen: string;
  leftTeam: string;
  leftGoalie: string;
  rightTeam: string;
  rightGoalie: string;
  playerNumber: string;
  playerNumberInner: string;
  neck: string;
  viewArea: string;
  largeViewArea: string;
  focusPoint: string;
  ballCollide: string;
  playerCollide: string;
  effortDecayed: string;
  recoveryDecayed: string;
  kick: string;
  kickFault: string;
  kickAccel: string;
  catch: string;
  catchFault: string;
  tackle: string;
  tackleFault: string;
  foulCharged: string;
  pointto: string;
  illegalDefense: string;
}

const rgb = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export const DEFAULT_PALETTE: Readonly<Palette> = Object.freeze({
  field: rgb(31, 160, 31),
  line: rgb(255, 255, 255),
  measureLine: rgb(0, 255, 255),
  measureMark: rgb(255, 0, 0),
  measureFont: rgb(255, 191, 191),
  measureFont2: rgb(224, 224, 192),
  scoreBoardPen: rgb(255, 255, 255),
  scoreBoardBrush: rgb(0, 0, 0),
  ball: rgb(255, 255, 255),
  ballVel: rgb(255, 0, 0),
  playerPen: rgb(0, 0, 0),
  leftTeam: rgb(255, 215, 0),
  leftGoalie: rgb(39, 231, 31),
  rightTeam: rgb(0, 191, 255),
  rightGoalie: rgb(255, 153, 255),
  playerNumber: rgb(255, 255, 255),
  playerNumberInner: rgb(0, 0, 0),
  neck: rgb(255, 0, 0),
  viewArea: rgb(191, 239, 191),
  largeViewArea: rgb(255, 255, 255),
  focusPoint: rgb(255, 255, 255),
  ballCollide: rgb(255, 0, 0),
  playerCollide: rgb(105, 155, 235),
  effortDecayed: rgb(255, 0, 0),
  recoveryDecayed: rgb(255, 231, 31),
  kick: rgb(255, 255, 255),
  kickFault: rgb(255, 0, 0),
  kickAccel: rgb(0, 255, 0),
  catch: rgb(10, 80, 10),
  catchFault: rgb(10, 80, 150),
  tackle: rgb(255, 136, 127),
  tackleFault: rgb(79, 159, 159),
  foulCharged: rgb(0, 127, 0),
  pointto: rgb(255, 0, 191),
  illegalDefense: rgb(255, 0, 0),
});

export interface FontSpec {
  family: string;
  /** Size in whole pixels. rcssmonitor gives points; Qt rounds pt * 96 / 72 to pixels. */
  size: number;
  bold: boolean;
}

export interface Fonts {
  scoreBoard: FontSpec;
  player: FontSpec;
  measure: FontSpec;
}

const pt = (points: number) => Math.round((points * 4) / 3);

export const DEFAULT_FONTS: Readonly<Fonts> = Object.freeze({
  scoreBoard: { family: 'sans-serif', size: pt(16), bold: true },
  player: { family: 'sans-serif', size: pt(9), bold: true },
  measure: { family: 'sans-serif', size: pt(9), bold: false },
});

export function cssFont(f: FontSpec): string {
  return `${f.bold ? 'bold ' : ''}${f.size}px ${f.family}`;
}

/** Parses "#rrggbb". */
export function parseHex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * QColor::darker(factor): the HSV value divided by factor / 100. Scaling the
 * value of an HSV color scales the three RGB channels by the same ratio.
 */
export function darker(color: string, factor: number): string {
  if (factor <= 100) {
    return color;
  }
  const [r, g, b] = parseHex(color);
  return rgb(...([r, g, b].map((c) => Math.round((c * 100) / factor)) as [number, number, number]));
}
