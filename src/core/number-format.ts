// Number formatting shared by the painters, the monitor commands and the status bar.

/**
 * Formats like printf's %g (and the default C++ ostream output, with
 * precision 6): `precision` significant digits, no trailing zeros, and an
 * exponent when it is below -4 or at least `precision`.
 */
export function formatG(v: number, precision = 6): string {
  if (!Number.isFinite(v)) {
    return String(v);
  }
  if (v === 0) {
    return Object.is(v, -0) ? '-0' : '0';
  }
  const stripZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
  // The exponent after rounding to `precision` digits, as %g decides with.
  const [mantissa = '', e = '0'] = v.toExponential(precision - 1).split('e');
  const exp = Number(e);
  if (exp < -4 || exp >= precision) {
    const sign = exp < 0 ? '-' : '+';
    return `${stripZeros(mantissa)}e${sign}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return stripZeros(v.toFixed(precision - 1 - exp));
}

/** A byte count in SI units, as in the status bar: 512 B, 3.4 kB, 12.3 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  const kb = bytes / 1000;
  return kb < 999.95 ? `${kb.toFixed(1)} kB` : `${(kb / 1000).toFixed(1)} MB`;
}
