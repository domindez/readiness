import type { RawActivity } from './intervals';
import { mean, round } from './stats';

/** Resumen del último entrenamiento a partir de las actividades de intervals.icu. */

export type WorkoutKind = 'run' | 'strength' | 'other';

export interface WorkoutStat {
  label: string;
  value: string;
  unit?: string;
  /** Texto pequeño bajo el valor (p. ej. comparación con tu media). */
  sub?: string;
  tone?: 'good' | 'bad' | '';
}

export interface WorkoutSummary {
  kind: WorkoutKind;
  name: string;
  type: string;
  /** YYYY-MM-DD y HH:MM locales. */
  date: string;
  time: string;
  stats: WorkoutStat[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const fmtDec = (v: number, d: number) => v.toFixed(d).replace('.', ',');

export function kindOf(type: string): WorkoutKind {
  if (/run/i.test(type)) return 'run';
  if (/weight|strength|fuerza/i.test(type)) return 'strength';
  return 'other';
}

/** 3725 s → "1:02:05"; 1520 s → "25:20". */
export function fmtDuration(secs: number): string {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Segundos por km → "5:12". */
export function fmtPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Eficiencia de carrera: metros recorridos por latido (velocidad en m/min ÷ FC media). Más alto = mejor. */
function efficiency(a: RawActivity): number | null {
  const dist = num(a.distance);
  const t = num(a.moving_time) ?? num(a.elapsed_time);
  const hr = num(a.average_heartrate);
  if (!dist || !t || !hr) return null;
  return dist / (t / 60) / hr;
}

/** Nº de series de una sesión de fuerza, si intervals.icu lo incluye (el nombre del campo puede variar). */
function setsOf(a: RawActivity): number | null {
  for (const k of ['sets', 'total_sets', 'num_sets', 'active_sets', 'strength_sets', 'icu_sets']) {
    const v = a[k];
    if (Array.isArray(v) && v.length) return v.length;
    if (num(v)) return num(v);
  }
  return null;
}

const startOf = (a: RawActivity) => (typeof a.start_date_local === 'string' ? a.start_date_local : '');

/**
 * Último entrenamiento hasta el día `until` (incluido). `acts` puede traer más días: se usan para comparar
 * la eficiencia con tus carreras recientes.
 */
export function lastWorkout(acts: RawActivity[], until: string, only?: WorkoutKind): WorkoutSummary | null {
  return recentWorkouts(acts, until, 1, only)[0] ?? null;
}

/** Los `n` entrenamientos más recientes hasta `until` (incluido), del más nuevo al más antiguo. */
export function recentWorkouts(acts: RawActivity[], until: string, n: number, only?: WorkoutKind): WorkoutSummary[] {
  const valid = acts.filter(
    (a) =>
      startOf(a) &&
      startOf(a).slice(0, 10) <= until &&
      (num(a.moving_time) || num(a.elapsed_time)) &&
      (!only || kindOf(String(a.type ?? '')) === only),
  );
  valid.sort((x, y) => startOf(y).localeCompare(startOf(x)));
  return valid.slice(0, n).map((a, i) => summarize(a, valid.slice(i + 1)));
}

/** Resumen de una actividad; `older` son las actividades anteriores a ella (para comparar la eficiencia). */
function summarize(a: RawActivity, older: RawActivity[]): WorkoutSummary {

  const type = typeof a.type === 'string' ? a.type : 'Actividad';
  const kind = kindOf(type);
  const stats: WorkoutStat[] = [];
  const kcal = num(a.calories);

  if (kind === 'run') {
    const dist = num(a.distance);
    const t = num(a.moving_time) ?? num(a.elapsed_time)!;
    const hr = num(a.average_heartrate);
    const elev = typeof a.total_elevation_gain === 'number' ? a.total_elevation_gain : null;
    stats.push({ label: 'Tiempo', value: fmtDuration(t) });
    if (dist) stats.push({ label: 'Distancia', value: fmtDec(dist / 1000, 2), unit: 'km' });
    if (dist) stats.push({ label: 'Ritmo medio', value: fmtPace(t / (dist / 1000)), unit: '/km' });
    if (hr) stats.push({ label: 'FC media', value: String(Math.round(hr)), unit: 'lpm' });
    if (elev !== null) stats.push({ label: 'Desnivel +', value: String(Math.round(elev)), unit: 'm' });
    const ef = efficiency(a);
    if (ef !== null) {
      const prev = older.filter((x) => kindOf(String(x.type ?? '')) === 'run').map(efficiency).filter((v): v is number => v !== null);
      const avg = prev.length >= 3 ? mean(prev)! : null;
      const diffPct = avg ? ((ef - avg) / avg) * 100 : null;
      stats.push({
        label: 'Eficiencia',
        value: fmtDec(ef, 2),
        unit: 'm/latido',
        sub: avg ? `${diffPct! >= 0 ? '+' : '−'}${Math.abs(round(diffPct!, 0)!)} % vs. tus últimas carreras (${fmtDec(avg, 2)})` : 'metros por latido · más es mejor',
        tone: diffPct === null || Math.abs(diffPct) < 2 ? '' : diffPct > 0 ? 'good' : 'bad',
      });
    }
    if (kcal) stats.push({ label: 'Calorías', value: String(Math.round(kcal)), unit: 'kcal' });
  } else if (kind === 'strength') {
    const t = num(a.elapsed_time) ?? num(a.moving_time)!;
    const sets = setsOf(a);
    stats.push({ label: 'Tiempo', value: fmtDuration(t) });
    if (sets !== null) stats.push({ label: 'Series', value: String(sets) });
    stats.push({ label: 'Calorías', value: kcal ? String(Math.round(kcal)) : '–', unit: kcal ? 'kcal' : undefined });
  } else {
    const t = num(a.moving_time) ?? num(a.elapsed_time)!;
    const dist = num(a.distance);
    const hr = num(a.average_heartrate);
    stats.push({ label: 'Tiempo', value: fmtDuration(t) });
    if (dist) stats.push({ label: 'Distancia', value: fmtDec(dist / 1000, 2), unit: 'km' });
    if (hr) stats.push({ label: 'FC media', value: String(Math.round(hr)), unit: 'lpm' });
    if (kcal) stats.push({ label: 'Calorías', value: String(Math.round(kcal)), unit: 'kcal' });
  }
  const load = num(a.icu_training_load);
  if (load) stats.push({ label: 'Carga', value: String(Math.round(load)) });

  return {
    kind,
    name: typeof a.name === 'string' && a.name ? a.name : type,
    type,
    date: startOf(a).slice(0, 10),
    time: startOf(a).slice(11, 16),
    stats,
  };
}
