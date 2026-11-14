import type { AllData, Question } from './db';
import { dayRange } from './dates';
import { METRICS, METRIC_BY_KEY, type MetricKey } from './metrics';
import { BASELINE_DAYS, baselineAt, clamp, round, type Baseline } from './stats';

/** Pesos y umbrales del readiness: ajústalos a tu criterio. */
export const SCORE_CONFIG = {
  objectiveWeight: 0.6,
  subjectiveWeight: 0.4,
  /** Puntuación de un día "en tu media" y puntos por cada DE. */
  objectiveCenter: 70,
  pointsPerSd: 15,
  zClamp: 2.5,
  green: 65,
  amber: 45,
};

export type Zone = 'green' | 'amber' | 'red' | 'none';

export interface DayScore {
  date: string;
  score: number | null;
  objective: number | null;
  subjective: number | null;
  zone: Zone;
  /** z-score crudo (sin signo de dirección) de cada métrica respecto a su base. */
  z: Partial<Record<MetricKey, number>>;
  baselines: Partial<Record<MetricKey, Baseline>>;
}

export interface Analysis {
  days: string[];
  series: Record<MetricKey, (number | null)[]>;
  answers: Record<number, (number | null)[]>;
  scores: DayScore[];
}

export function zoneOf(score: number | null): Zone {
  if (score === null) return 'none';
  if (score >= SCORE_CONFIG.green) return 'green';
  if (score >= SCORE_CONFIG.amber) return 'amber';
  return 'red';
}

/** Escala de las sensaciones: 0-4. */
export const ANSWER_MAX = 4;

/** "Bondad" de una respuesta (0 = peor, 4 = mejor): las preguntas de cantidad se invierten. */
export function goodness(q: Pick<Question, 'inverted'>, value: number): number {
  return q.inverted ? ANSWER_MAX - value : value;
}

/** Respuesta → 0-100, donde 100 siempre es lo mejor. */
export function answerToPct(q: Pick<Question, 'inverted'>, value: number): number {
  return (goodness(q, value) / ANSWER_MAX) * 100;
}

/** Media de sensaciones 0-100 → escala 0-4. */
export function pctToAnswer(pct: number | null): number | null {
  return pct === null ? null : round((pct / 100) * ANSWER_MAX, 1);
}

/** Calcula series diarias, líneas base y readiness de todo el histórico hasta `until`. */
export function analyze(data: AllData, until: string): Analysis {
  const firstDates = [data.entries[0]?.date, data.answers[0]?.date].filter(Boolean) as string[];
  const first = firstDates.length ? firstDates.sort()[0] : until;
  const days = dayRange(first < until ? first : until, until);
  const idx = new Map(days.map((d, i) => [d, i]));

  const series = Object.fromEntries(METRICS.map((m) => [m.key, days.map(() => null)])) as Analysis['series'];
  for (const e of data.entries) {
    const i = idx.get(e.date);
    if (i === undefined) continue;
    for (const m of METRICS) series[m.key][i] = e[m.key];
  }

  const qById = new Map(data.questions.map((q) => [q.id, q]));
  const answers: Analysis['answers'] = Object.fromEntries(data.questions.map((q) => [q.id, days.map(() => null)]));
  for (const a of data.answers) {
    const i = idx.get(a.date);
    if (i !== undefined && answers[a.question_id]) answers[a.question_id][i] = a.value;
  }

  const scores: DayScore[] = days.map((date, i) => {
    const z: DayScore['z'] = {};
    const baselines: DayScore['baselines'] = {};
    let wSum = 0;
    let oSum = 0;
    for (const m of METRICS) {
      const v = series[m.key][i];
      const b = baselineAt(series[m.key], i);
      if (b) baselines[m.key] = b;
      if (v === null || !b) continue;
      z[m.key] = (v - b.mean) / b.sd;
      if (m.weight > 0 && (m.direction === 'higher' || m.direction === 'lower')) {
        const signed = clamp(m.direction === 'higher' ? z[m.key]! : -z[m.key]!, -SCORE_CONFIG.zClamp, SCORE_CONFIG.zClamp);
        oSum += m.weight * clamp(SCORE_CONFIG.objectiveCenter + SCORE_CONFIG.pointsPerSd * signed, 0, 100);
        wSum += m.weight;
      }
    }
    const objective = wSum > 0 ? oSum / wSum : null;

    const pcts: number[] = [];
    for (const [qid, vals] of Object.entries(answers)) {
      const v = vals[i];
      const q = qById.get(Number(qid));
      if (v !== null && q) pcts.push(answerToPct(q, v));
    }
    const subjective = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

    let score: number | null = null;
    if (objective !== null && subjective !== null) {
      score = SCORE_CONFIG.objectiveWeight * objective + SCORE_CONFIG.subjectiveWeight * subjective;
    } else {
      score = objective ?? subjective;
    }
    score = round(score, 0);
    return { date, score, objective: round(objective, 0), subjective: round(subjective, 0), zone: zoneOf(score), z, baselines };
  });

  return { days, series, answers, scores };
}

export interface Alert {
  level: 'warn' | 'danger';
  text: string;
}

function fmtZ(z: number) {
  return `${z > 0 ? '+' : '−'}${Math.abs(z).toFixed(1)} DE`;
}

/** Alertas del día: desviaciones respecto a la base y tendencias de 3 días. */
export function alertsFor(a: Analysis, date: string): Alert[] {
  const i = a.days.indexOf(date);
  if (i < 0) return [];
  const s = a.scores[i];
  const out: Alert[] = [];

  const bad = (k: MetricKey): number | null => {
    const z = s.z[k];
    const m = METRIC_BY_KEY[k];
    if (z === undefined || !m.alertZ) return null;
    const isBad = m.direction === 'higher' ? z <= -m.alertZ : m.direction === 'lower' ? z >= m.alertZ : Math.abs(z) >= m.alertZ;
    return isBad ? z : null;
  };

  const hrvBad = bad('hrv');
  const rhrBad = bad('resting_hr');
  if (hrvBad !== null && rhrBad !== null) {
    out.push({
      level: 'danger',
      text: `HRV baja (${fmtZ(hrvBad)}) y FC en reposo alta (${fmtZ(rhrBad)}) a la vez: posible enfermedad, sobrecarga o mala recuperación.`,
    });
  }
  for (const m of METRICS) {
    if ((m.key === 'hrv' && rhrBad !== null) || (m.key === 'resting_hr' && hrvBad !== null)) continue;
    const z = bad(m.key);
    if (z === null) continue;
    const v = a.series[m.key][i];
    const b = s.baselines[m.key]!;
    out.push({
      level: Math.abs(z) >= m.alertZ + 0.5 ? 'danger' : 'warn',
      text: `${m.label}: ${v}${m.unit && !m.unit.startsWith('/') ? ' ' + m.unit : ''} (${fmtZ(z)} vs. tu media de ${BASELINE_DAYS} días, ${round(b.mean, 1)}).`,
    });
  }

  // Tendencia: 3 días seguidos empeorando y por debajo de lo normal.
  for (const k of ['hrv', 'resting_hr'] as const) {
    const m = METRIC_BY_KEY[k];
    const v = [a.series[k][i - 2], a.series[k][i - 1], a.series[k][i]];
    if (i < 2 || v.some((x) => x === null || x === undefined)) continue;
    const [x0, x1, x2] = v as number[];
    const worsening = m.direction === 'higher' ? x2 < x1 && x1 < x0 : x2 > x1 && x1 > x0;
    const z = s.z[k];
    if (worsening && z !== undefined && (m.direction === 'higher' ? z < -0.5 : z > 0.5)) {
      out.push({ level: 'warn', text: `${m.label} empeorando 3 días seguidos (${x0} → ${x1} → ${x2}).` });
    }
  }

  // Readiness muy por debajo de su media de 7 días.
  const prev = a.scores.slice(Math.max(0, i - 7), i).map((x) => x.score).filter((x): x is number => x !== null);
  if (s.score !== null && prev.length >= 4) {
    const avg = prev.reduce((x, y) => x + y, 0) / prev.length;
    if (s.score <= avg - 15) out.push({ level: 'warn', text: `Readiness ${s.score}, ${Math.round(avg - s.score)} puntos por debajo de tu media semanal.` });
  }
  return out;
}

/** Recomendación orientativa según la zona. */
export function adviceFor(zone: Zone): string {
  switch (zone) {
    case 'green':
      return 'Buen día para cargar: calidad, intensidad o volumen según lo previsto.';
    case 'amber':
      return 'Entrena, pero modera: mantén el plan con menos intensidad o volumen, o prioriza técnica.';
    case 'red':
      return 'Prioriza la recuperación: descanso, movilidad o aeróbico muy suave.';
    default:
      return 'Aún faltan datos para calcular el readiness (hacen falta 7 días de histórico para la base del reloj).';
  }
}
