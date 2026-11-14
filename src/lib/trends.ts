import type { AllData } from './db';
import { addDays } from './dates';
import { GROUP_LABELS, METRICS } from './metrics';
import { analyze, ANSWER_MAX, pctToAnswer } from './readiness';
import { mean, rollingMean, round } from './stats';

export const RANGES = [
  { key: '7', label: '7 d', days: 7 },
  { key: '14', label: '14 d', days: 14 },
  { key: '30', label: '30 d', days: 30 },
  { key: '60', label: '60 d', days: 60 },
  { key: '90', label: '90 d', days: 90 },
  { key: '365', label: '1 año', days: 365 },
  { key: 'all', label: 'Todo', days: 0 },
] as const;

export interface SeriesPayload {
  id: string;
  label: string;
  unit: string;
  group: string;
  /** 'higher' | 'lower' | 'deviation' | 'none' — para colorear el resumen. */
  direction: string;
  kind: 'metric' | 'question' | 'readiness';
  /** Límites duros del eje (el eje se ajusta a los datos pero nunca los sobrepasa). */
  floor?: number;
  ceil?: number;
  min?: number;
  max?: number;
  values: (number | null)[];
  ma7: (number | null)[];
  bandLo?: (number | null)[];
  bandHi?: (number | null)[];
  zones?: string[];
  summary: { last: number | null; avg: number | null; prevAvg: number | null; n: number };
}

export interface TrendsPayload {
  labels: string[];
  series: SeriesPayload[];
}

function summarize(full: (number | null)[], start: number, len: number, hasPrev: boolean) {
  const cur = full.slice(start).filter((v): v is number => v !== null);
  const prev = hasPrev ? full.slice(Math.max(0, start - len), start).filter((v): v is number => v !== null) : [];
  const last = [...full.slice(start)].reverse().find((v) => v !== null) ?? null;
  return { last, avg: round(mean(cur), 1), prevAvg: prev.length >= Math.min(3, len) ? round(mean(prev), 1) : null, n: cur.length };
}

export function buildTrends(data: AllData, today: string, rangeKey: string): TrendsPayload {
  const a = analyze(data, today);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  const n = a.days.length;
  const len = range.days ? Math.min(range.days, n) : n;
  // Para rangos fijos mostramos siempre el periodo completo aunque falten días al inicio.
  const pad = range.days ? Math.max(0, range.days - n) : 0;
  const start = n - len;
  const hasPrev = range.days > 0;

  const padNull = <T,>(arr: T[], fill: T) => [...Array<T>(pad).fill(fill), ...arr.slice(start)];
  const labels = padNull(a.days, '');
  for (let i = pad - 1; i >= 0; i--) labels[i] = addDays(labels[i + 1] || today, -1);

  const series: SeriesPayload[] = [];

  const scores = a.scores.map((s) => s.score);
  series.push({
    id: 'readiness',
    label: 'Readiness',
    unit: '/100',
    group: 'Readiness',
    direction: 'higher',
    kind: 'readiness',
    min: 0,
    max: 100,
    values: padNull(scores, null),
    ma7: padNull(rollingMean(scores), null),
    zones: padNull(a.scores.map((s) => s.zone), 'none'),
    summary: summarize(scores, start, len, hasPrev),
  });

  for (const m of METRICS) {
    const full = a.series[m.key];
    if (!full.some((v) => v !== null)) continue;
    const lo = a.scores.map((s) => (s.baselines[m.key] ? s.baselines[m.key]!.mean - s.baselines[m.key]!.sd : null));
    const hi = a.scores.map((s) => (s.baselines[m.key] ? s.baselines[m.key]!.mean + s.baselines[m.key]!.sd : null));
    series.push({
      id: m.key,
      label: m.label,
      unit: m.unit,
      group: GROUP_LABELS[m.group],
      direction: m.direction,
      kind: 'metric',
      floor: m.min,
      ceil: m.max,
      values: padNull(full, null),
      ma7: padNull(rollingMean(full).map((v) => round(v, 1)), null),
      bandLo: padNull(lo.map((v) => round(v, 1)), null),
      bandHi: padNull(hi.map((v) => round(v, 1)), null),
      summary: summarize(full, start, len, hasPrev),
    });
  }

  // Sensaciones: media diaria de todas las preguntas (0-4, más alto = mejor) + cada pregunta por separado.
  const subj = a.scores.map((s) => pctToAnswer(s.subjective));
  if (subj.some((v) => v !== null)) {
    series.push({
      id: 'subjective',
      label: 'Sensaciones (media)',
      unit: `/${ANSWER_MAX}`,
      group: 'Sensaciones',
      direction: 'higher',
      kind: 'metric',
      min: 0,
      max: ANSWER_MAX,
      values: padNull(subj, null),
      ma7: padNull(rollingMean(subj).map((v) => round(v, 2)), null),
      summary: summarize(subj, start, len, hasPrev),
    });
  }
  for (const q of data.questions) {
    const full = a.answers[q.id];
    if (!full?.some((v) => v !== null)) continue;
    series.push({
      id: `q${q.id}`,
      label: q.label + (q.active ? '' : ' (inactiva)'),
      unit: `0 ${q.low_label.toLowerCase()} · ${ANSWER_MAX} ${q.high_label.toLowerCase()}`,
      group: 'Sensaciones',
      direction: q.inverted ? 'lower' : 'higher',
      kind: 'question',
      min: 0,
      max: ANSWER_MAX,
      values: padNull(full, null),
      ma7: padNull(rollingMean(full).map((v) => round(v, 2)), null),
      summary: summarize(full, start, len, hasPrev),
    });
  }

  return { labels, series };
}
