// Number formatting shared by the painters and the monitor commands.

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
