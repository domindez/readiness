import { env } from 'cloudflare:workers';
import { METRICS, parseMetric } from './metrics';
import type { MetricValues } from './db';
import { addDays, dayRange } from './dates';

/** Docs: https://intervals.icu/api-docs.html — Basic auth con usuario "API_KEY" y la clave personal. */
const BASE = 'https://intervals.icu/api/v1';

export function intervalsConfigured(): boolean {
  return Boolean(env.INTERVALS_API_KEY);
}

export class IntervalsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface ImportedDay {
  date: string;
  metrics: MetricValues;
}

export interface WellnessResult {
  days: ImportedDay[];
  /** Campos con algún valor en la respuesta (sirve para ver qué envía Garmin→intervals). */
  fieldsSeen: string[];
}

async function getJson(path: string, timeoutMs = 15_000): Promise<unknown> {
  const athlete = encodeURIComponent(env.INTERVALS_ATHLETE_ID || '0');
  const res = await fetch(`${BASE}/athlete/${athlete}/${path}`, {
    headers: {
      Authorization: `Basic ${btoa(`API_KEY:${env.INTERVALS_API_KEY}`)}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? 'intervals.icu ha rechazado la clave o el ID de atleta'
        : `intervals.icu ha respondido ${res.status}`;
    throw new IntervalsError(msg, res.status);
  }
  return res.json();
}

export type RawActivity = Record<string, unknown>;

/** Actividades de intervals.icu entre dos fechas (ambas incluidas), tal cual las devuelve la API. */
export async function fetchActivities(oldest: string, newest: string, timeoutMs?: number): Promise<RawActivity[]> {
  const acts = await getJson(`activities?oldest=${oldest}&newest=${newest}`, timeoutMs);
  if (!Array.isArray(acts)) throw new IntervalsError('Respuesta inesperada de intervals.icu (actividades)');
  return acts as RawActivity[];
}

/** Carga de entrenamiento total por día (suma de `icu_training_load` de las actividades; 0 = descanso). */
async function fetchDailyLoad(oldest: string, newest: string): Promise<Map<string, number>> {
  const acts = await fetchActivities(oldest, newest);
  const load = new Map(dayRange(oldest, newest).map((d) => [d, 0]));
  for (const a of acts) {
    const date = typeof a.start_date_local === 'string' ? a.start_date_local.slice(0, 10) : null;
    const l = typeof a.icu_training_load === 'number' ? a.icu_training_load : 0;
    if (date && load.has(date)) load.set(date, load.get(date)! + l);
  }
  return load;
}

export async function fetchWellness(oldest: string, newest: string): Promise<WellnessResult> {
  if (!intervalsConfigured()) throw new IntervalsError('Falta INTERVALS_API_KEY');
  // Un día extra al principio para las métricas que salen del día anterior (estrés y carga de ayer).
  const first = addDays(oldest, -1);
  const [body, load] = await Promise.all([
    getJson(`wellness?oldest=${first}&newest=${newest}`),
    // Si fallan las actividades, se importa el resto igualmente.
    fetchDailyLoad(first, newest).catch(() => null),
  ]);
  if (!Array.isArray(body)) throw new IntervalsError('Respuesta inesperada de intervals.icu');

  const seen = new Set<string>();
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of body as Record<string, unknown>[]) {
    if (typeof row.id !== 'string') continue;
    rows.set(row.id, row);
    for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined && k !== 'id') seen.add(k);
  }
  if (load) {
    for (const [date, l] of load) rows.set(date, { ...(rows.get(date) ?? { id: date }), _dayLoad: Math.round(l) });
    seen.add('actividades (carga)');
  }

  const days: ImportedDay[] = [];
  for (const date of dayRange(oldest, newest)) {
    const today = rows.get(date);
    const yesterday = rows.get(addDays(date, -1));
    if (!today && !yesterday) continue;
    const metrics: MetricValues = {};
    for (const m of METRICS) {
      const src = m.intervals;
      const row = src?.prevDay ? yesterday : today;
      if (!src || !row) continue;
      const raw = src.read ? src.read(row) : src.field ? row[src.field] : undefined;
      if (typeof raw !== 'number') continue;
      const v = parseMetric(m, src.transform ? src.transform(raw) : raw);
      if (v !== null) metrics[m.key] = v;
    }
    days.push({ date, metrics });
  }
  return { days, fieldsSeen: [...seen].sort() };
}
