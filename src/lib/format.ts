// Number / unit formatting helpers.
// Centralized so the UI never renders raw floating-point artifacts.

/** Large integers with thousands separators, e.g. 12,480. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Fixed-decimal number, trimmed cleanly. */
export function fmtDec(n: number, decimals = 1): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Compact acres: 940, 12.4k, 1.2M. */
export function fmtAcres(n: number): string {
  if (n >= 1_000_000) return `${fmtDec(n / 1_000_000, 1)}M`;
  if (n >= 10_000) return `${fmtDec(n / 1_000, 1)}k`;
  return fmtInt(n);
}

/** Compact population: 1,240 or 24.6k or 1.2M. */
export function fmtPeople(n: number): string {
  if (n >= 1_000_000) return `${fmtDec(n / 1_000_000, 2)}M`;
  if (n >= 10_000) return `${fmtDec(n / 1_000, 1)}k`;
  return fmtInt(n);
}

/** Degrees to a cardinal/intercardinal label, e.g. 200 -> "SSW". */
export function degToCardinal(deg: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  // Normalize into [0, 360) first so negative degrees don't index out of range.
  const norm = ((deg % 360) + 360) % 360;
  const i = Math.round(norm / 22.5) % 16;
  return dirs[i];
}
