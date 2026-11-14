import type { RawActivity } from './intervals';
import { addDays } from './dates';
import { kindOf } from './workout';

/** Totales semanales de carrera (semanas de lunes a domingo). */

export interface WeekTotals {
  /** Lunes y domingo de la semana (YYYY-MM-DD). */
  start: string;
  end: string;
  km: number;
  secs: number;
  elev: number;
  runs: number;
}

/** Lunes de la semana de `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Las últimas `weeks` semanas hasta la que contiene `until` (incluida), de la más antigua a la más reciente. */
export function weeklyRuns(acts: RawActivity[], until: string, weeks = 12): WeekTotals[] {
  const first = addDays(mondayOf(until), -7 * (weeks - 1));
  const out: WeekTotals[] = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, 7 * i);
    return { start, end: addDays(start, 6), km: 0, secs: 0, elev: 0, runs: 0 };
  });
  for (const a of acts) {
    const day = typeof a.start_date_local === 'string' ? a.start_date_local.slice(0, 10) : '';
    if (!day || day < first || day > until || kindOf(String(a.type ?? '')) !== 'run') continue;
    const w = out[Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (7 * 86_400_000))];
    if (!w) continue;
    w.km += num(a.distance) / 1000;
    w.secs += num(a.moving_time) || num(a.elapsed_time);
    w.elev += num(a.total_elevation_gain);
    w.runs += 1;
  }
  return out;
}
