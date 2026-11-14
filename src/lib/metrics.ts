/**
 * Catálogo de métricas del reloj. Para añadir una métrica:
 *   1. añade una columna REAL a `entries` (nueva migración)
 *   2. añade su definición aquí.
 */
export type MetricKey =
  | 'hrv'
  | 'resting_hr'
  | 'sleep_score'
  | 'sleep_hours'
  | 'stress_avg'
  | 'body_battery'
  | 'respiration'
  | 'spo2'
  | 'skin_temp_delta'
  | 'ctl'
  | 'atl'
  | 'form'
  | 'load_prev';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Estrés medio diario de Garmin (0-100) en la fila de wellness de intervals.icu. El nombre del campo depende de
 * la integración, así que se prueban varios. `stress` a secas es también la escala subjetiva 1-4 de intervals:
 * solo se acepta si el valor no cabe en esa escala.
 */
function garminStress(r: Record<string, unknown>): number | undefined {
  for (const k of ['avgStress', 'stressAvg', 'averageStress', 'garminStress']) if (num(r[k]) !== undefined) return num(r[k]);
  const s = num(r.stress);
  return s !== undefined && s > 4 ? s : undefined;
}

/** Forma (TSB) = CTL − ATL. */
function tsb(r: Record<string, unknown>): number | undefined {
  const c = num(r.ctl);
  const a = num(r.atl);
  return c !== undefined && a !== undefined ? Math.round((c - a) * 10) / 10 : undefined;
}

export type Direction = 'higher' | 'lower' | 'deviation' | 'none';

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Qué es "mejor": más alto, más bajo, cualquier desviación de lo normal es mala, o solo informativa. */
  direction: Direction;
  /** Peso dentro de la parte objetiva del readiness (0 = no puntúa). */
  weight: number;
  /** Umbral de alerta en desviaciones típicas respecto a la línea base (0 = sin alertas). */
  alertZ: number;
  /**
   * Cómo se importa de intervals.icu: un campo de la fila de wellness (o `read` para calcularlo a partir de la fila),
   * conversión opcional, y `prevDay` si el valor del día D sale de la fila del día D-1.
   */
  intervals?: {
    field?: string;
    read?: (row: Record<string, unknown>) => number | undefined;
    transform?: (v: number) => number;
    prevDay?: boolean;
  };
  group: 'recuperacion' | 'sueno' | 'fisiologia' | 'carga';
  help?: string;
}

export const METRICS: MetricDef[] = [
  { key: 'hrv', label: 'HRV', unit: 'ms', min: 5, max: 300, step: 1, direction: 'higher', weight: 0.3, alertZ: 1.5,
    intervals: { field: 'hrv' }, group: 'recuperacion', help: 'Media nocturna (rMSSD)' },
  { key: 'resting_hr', label: 'FC reposo', unit: 'lpm', min: 25, max: 120, step: 1, direction: 'lower', weight: 0.25, alertZ: 1.5,
    intervals: { field: 'restingHR' }, group: 'recuperacion' },
  { key: 'sleep_score', label: 'Puntuación sueño', unit: '/100', min: 0, max: 100, step: 1, direction: 'higher', weight: 0.15, alertZ: 2,
    intervals: { field: 'sleepScore' }, group: 'sueno' },
  { key: 'sleep_hours', label: 'Horas de sueño', unit: 'h', min: 0, max: 16, step: 0.1, direction: 'higher', weight: 0.1, alertZ: 2,
    intervals: { field: 'sleepSecs', transform: (s) => Math.round((s / 3600) * 100) / 100 }, group: 'sueno' },
  { key: 'stress_avg', label: 'Estrés medio', unit: '/100', min: 0, max: 100, step: 1, direction: 'lower', weight: 0.1, alertZ: 1.5,
    intervals: { read: garminStress, prevDay: true }, group: 'recuperacion', help: 'Estrés medio de ayer' },
  { key: 'body_battery', label: 'Body Battery', unit: '/100', min: 0, max: 100, step: 1, direction: 'higher', weight: 0.1, alertZ: 1.5,
    group: 'recuperacion', help: 'Valor al despertar' },
  { key: 'respiration', label: 'Respiración', unit: 'rpm', min: 4, max: 40, step: 0.1, direction: 'deviation', weight: 0, alertZ: 2,
    intervals: { field: 'respiration' }, group: 'fisiologia' },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 70, max: 100, step: 0.1, direction: 'higher', weight: 0, alertZ: 2,
    intervals: { field: 'spO2' }, group: 'fisiologia' },
  { key: 'skin_temp_delta', label: 'Temp. piel (Δ)', unit: '°C', min: -5, max: 5, step: 0.1, direction: 'deviation', weight: 0, alertZ: 2,
    group: 'fisiologia', help: 'Variación respecto a tu base' },
  { key: 'ctl', label: 'Fitness (CTL)', unit: '', min: 0, max: 250, step: 0.1, direction: 'none', weight: 0, alertZ: 0,
    intervals: { field: 'ctl', transform: (v) => Math.round(v * 10) / 10 }, group: 'carga', help: 'De intervals.icu' },
  { key: 'atl', label: 'Fatiga (ATL)', unit: '', min: 0, max: 300, step: 0.1, direction: 'none', weight: 0, alertZ: 0,
    intervals: { field: 'atl', transform: (v) => Math.round(v * 10) / 10 }, group: 'carga', help: 'De intervals.icu' },
  { key: 'form', label: 'Forma (TSB)', unit: '', min: -300, max: 250, step: 0.1, direction: 'none', weight: 0, alertZ: 0,
    intervals: { read: tsb }, group: 'carga', help: 'Fitness − fatiga' },
  // `_dayLoad` lo añade fetchWellness sumando la carga de las actividades de cada día.
  { key: 'load_prev', label: 'Carga de ayer', unit: '', min: 0, max: 2000, step: 1, direction: 'none', weight: 0, alertZ: 0,
    intervals: { read: (r) => num(r._dayLoad), prevDay: true }, group: 'carga', help: 'Training load de ayer (0 = descanso)' },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

export const GROUP_LABELS: Record<MetricDef['group'], string> = {
  recuperacion: 'Recuperación',
  sueno: 'Sueño',
  fisiologia: 'Fisiología',
  carga: 'Carga (intervals)',
};

/** Valida y normaliza un valor de entrada. Devuelve null si está vacío o fuera de rango. */
export function parseMetric(def: MetricDef, raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < def.min || n > def.max) return null;
  return n;
}
