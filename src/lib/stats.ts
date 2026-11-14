export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Desviación típica muestral. */
export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

export const BASELINE_DAYS = 60;
export const BASELINE_MIN_N = 7;

/**
 * Línea base de una serie diaria (un valor o null por día, en orden) para el índice `i`:
 * usa los días anteriores dentro de la ventana, excluido el propio día.
 */
export function baselineAt(series: (number | null)[], i: number, window = BASELINE_DAYS, minN = BASELINE_MIN_N): Baseline | null {
  const vals: number[] = [];
  for (let j = Math.max(0, i - window); j < i; j++) {
    const v = series[j];
    if (v !== null && v !== undefined) vals.push(v);
  }
  if (vals.length < minN) return null;
  const m = mean(vals)!;
  // Suelo para la DE: evita z-scores enormes con series muy planas.
  const s = Math.max(sd(vals) ?? 0, Math.abs(m) * 0.02, 0.1);
  return { mean: m, sd: s, n: vals.length };
}

/** Media móvil sobre `window` días naturales (ignora huecos; null si no hay datos). */
export function rollingMean(series: (number | null)[], window = 7): (number | null)[] {
  return series.map((_, i) => {
    const vals = series.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return vals.length ? mean(vals) : null;
  });
}

export function round(v: number | null, digits = 1): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const RECENT_DAYS = 7;

/** Media de los `days` días anteriores a `i` (sin incluirlo). null si hay menos de `minN` valores. */
export function recentMean(series: (number | null)[], i: number, days = RECENT_DAYS, minN = 3): number | null {
  const vals = series.slice(Math.max(0, i - days), Math.max(0, i)).filter((v): v is number => v !== null && v !== undefined);
  return vals.length >= minN ? mean(vals) : null;
}
