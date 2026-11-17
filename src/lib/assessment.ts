import type { MetricKey } from './metrics';
import type { DayScore } from './readiness';
import { ANSWER_MAX } from './readiness';
import { round } from './stats';

/**
 * Valoración del día: combina las métricas nocturnas del reloj (frente a tu base), el cuestionario,
 * la carga de entrenamiento de ayer, la forma (TSB) y posibles signos de enfermedad en una recomendación.
 * Es una regla orientativa y transparente: cada factor suma "puntos de precaución" y se muestra el porqué.
 */

export type Level = 'quality' | 'normal' | 'easy' | 'recovery' | 'rest' | 'unknown';
export type Tone = 'good' | 'meh' | 'bad' | 'neutral';

export interface Assessment {
  level: Level;
  title: string;
  session: string;
  reasons: { tone: Tone; text: string }[];
}

type Values = Partial<Record<MetricKey, number | null>>;

export interface AssessInput {
  score: DayScore | undefined;
  /** Valores del día. */
  values: Values;
  /** Media de los 7 días anteriores por métrica. */
  mean7: Values;
  /** Media del cuestionario en "bondad" 0-4 (null si no hay respuestas). */
  subjAvg: number | null;
}

/** Umbrales: ajústalos a tu criterio. */
export const ASSESS_CONFIG = {
  /** Puntuación del reloj (0-100, 70 = en tu media). */
  physBad: 50,
  physMeh: 62,
  physGood: 72,
  /** Cuestionario 0-4. */
  subjBad: 1.8,
  subjMeh: 2.6,
  subjGood: 3.2,
  /** Carga de ayer respecto a tu carga diaria habitual (CTL). */
  loadHardRatio: 1.5,
  loadModerateRatio: 0.8,
  /** Si no hay CTL, umbrales absolutos. */
  loadHardAbs: 120,
  loadModerateAbs: 60,
  /** Forma (TSB). */
  formVeryTired: -30,
  formTired: -15,
  formFresh: 5,
};

const LEVELS: Record<Exclude<Level, 'unknown'>, { title: string; session: string }> = {
  quality: {
    title: 'Día para calidad',
    session: 'Buen momento para intensidad (series, umbral) o fuerza pesada. Calienta bien y aprovecha.',
  },
  normal: {
    title: 'Entrena según el plan',
    session: 'Haz la sesión prevista. Si es intensa, valora las sensaciones en el calentamiento y ajusta si no responden.',
  },
  easy: {
    title: 'Entrenamiento suave',
    session: 'Aeróbico en Z2, técnica o fuerza ligera con volumen moderado. Evita series de alta intensidad y cargas máximas.',
  },
  recovery: {
    title: 'Recuperación activa',
    session: '20-40 min muy suave (Z1, ritmo de conversación fácil), movilidad o estiramientos. Nada de intensidad.',
  },
  rest: {
    title: 'Descanso',
    session: 'Descanso o, como mucho, movilidad suave 15-20 min. Prioriza dormir, hidratarte y comer bien.',
  },
};

const fmt = (v: number, d = 1) => String(round(v, d)).replace('.', ',');
const signed = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v), d)}`;

export function assess({ score, values, mean7, subjAvg }: AssessInput): Assessment {
  const C = ASSESS_CONFIG;
  const reasons: Assessment['reasons'] = [];
  let caution = 0;
  let forceRest = false;

  // --- Métricas nocturnas del reloj ---
  const obj = score?.objective ?? null;
  const zH = score?.z.hrv;
  const zR = score?.z.resting_hr;
  const hrvRhrBoth = zH !== undefined && zR !== undefined && zH <= -1.5 && zR >= 1.5;
  let physBad = false;
  if (obj !== null) {
    const parts: string[] = [];
    const hrv = values.hrv;
    const rhr = values.resting_hr;
    if (hrv != null && mean7.hrv) parts.push(`HRV ${signed(((hrv - mean7.hrv) / mean7.hrv) * 100)} %`);
    if (rhr != null && mean7.resting_hr != null) parts.push(`FC reposo ${signed(rhr - mean7.resting_hr)} lpm`);
    const detail = parts.length ? ` (${parts.join(', ')} vs. tu media de 7 días)` : '';
    if (obj < C.physBad || hrvRhrBoth) {
      caution += 2;
      physBad = true;
      reasons.push({ tone: 'bad', text: `Métricas nocturnas claramente por debajo de lo normal${detail}.` });
    } else if (obj < C.physMeh) {
      caution += 1;
      reasons.push({ tone: 'meh', text: `Métricas nocturnas algo por debajo de lo normal${detail}.` });
    } else {
      reasons.push({ tone: obj >= C.physGood ? 'good' : 'neutral', text: `Métricas nocturnas ${obj >= C.physGood ? 'buenas' : 'normales'}${detail}.` });
    }
  }

  // Posible enfermedad: temperatura o respiración fuera de lo normal.
  const zT = score?.z.skin_temp_delta;
  const zResp = score?.z.respiration;
  if ((zT !== undefined && zT >= 2) || (zResp !== undefined && zResp >= 2)) {
    forceRest = physBad;
    caution += 2;
    reasons.push({ tone: 'bad', text: 'Temperatura o respiración nocturna por encima de lo normal: posible inicio de enfermedad.' });
  }

  // --- Cuestionario ---
  let subjBad = false;
  if (subjAvg !== null) {
    const txt = `Cuestionario: ${fmt(subjAvg)}/${ANSWER_MAX}`;
    if (subjAvg < C.subjBad) {
      caution += 2;
      subjBad = true;
      reasons.push({ tone: 'bad', text: `${txt}, sensaciones bajas.` });
    } else if (subjAvg < C.subjMeh) {
      caution += 1;
      reasons.push({ tone: 'meh', text: `${txt}, sensaciones regulares.` });
    } else {
      reasons.push({ tone: subjAvg >= C.subjGood ? 'good' : 'neutral', text: `${txt}, ${subjAvg >= C.subjGood ? 'buenas sensaciones' : 'sensaciones normales'}.` });
    }
  }

  // --- Carga de ayer ---
  let hardYesterday = false;
  const load = values.load_prev;
  const ctl = values.ctl;
  if (load != null) {
    const usual = ctl != null && ctl > 5 ? ctl : null;
    const hard = usual ? load >= usual * C.loadHardRatio && load >= 40 : load >= C.loadHardAbs;
    const moderate = usual ? load >= usual * C.loadModerateRatio : load >= C.loadModerateAbs;
    const ref = usual ? ` (tu carga diaria habitual ≈ ${Math.round(usual)})` : '';
    if (load === 0) {
      reasons.push({ tone: 'good', text: 'Ayer: descanso.' });
    } else if (hard) {
      hardYesterday = true;
      caution += 1;
      reasons.push({ tone: 'meh', text: `Ayer: carga alta, ${Math.round(load)}${ref}.` });
    } else {
      reasons.push({ tone: 'neutral', text: `Ayer: carga ${moderate ? 'moderada' : 'suave'}, ${Math.round(load)}${ref}.` });
    }
  }
  // Carga dura ayer + recuperación incompleta esta noche: se refuerza la precaución.
  if (hardYesterday && obj !== null && obj < C.physMeh) caution += 1;

  // --- Forma (TSB) ---
  const form = values.form;
  if (form != null) {
    if (form <= C.formVeryTired) {
      caution += 1;
      reasons.push({ tone: 'bad', text: `Forma ${signed(form, 1)}: fatiga acumulada alta.` });
    } else if (form <= C.formTired) {
      reasons.push({ tone: 'meh', text: `Forma ${signed(form, 1)}: algo de fatiga acumulada (normal en bloque de carga).` });
    } else if (form >= C.formFresh) {
      reasons.push({ tone: 'good', text: `Forma ${signed(form, 1)}: fresco.` });
    }
  }

  if (obj === null && subjAvg === null) {
    return {
      level: 'unknown',
      title: 'Faltan datos',
      session: 'Completa el cuestionario o importa los datos del reloj para tener una recomendación.',
      reasons,
    };
  }

  let level: Exclude<Level, 'unknown'> =
    caution >= 4 ? 'rest' : caution === 3 ? 'recovery' : caution === 2 ? 'easy' : caution === 1 ? 'normal' : 'quality';
  if (forceRest || (physBad && subjBad) || (physBad && hardYesterday)) level = 'rest';
  // No encadenar dos días duros aunque todo lo demás esté bien.
  if (level === 'quality' && hardYesterday) level = 'normal';
  // Con solo una fuente de datos, no recomendamos calidad.
  if (level === 'quality' && (obj === null || subjAvg === null)) level = 'normal';

  return { level, ...LEVELS[level], reasons };
}

export interface LoadAssessment {
  tone: Tone;
  title: string;
  text: string;
  points: string[];
}

/** Valoración de la carga de entrenamiento a partir de CTL (fitness), ATL (fatiga), TSB (forma) y la carga de ayer. */
export function assessLoad(v: Values): LoadAssessment | null {
  const { ctl, atl, form, load_prev: prev } = v;
  if (ctl == null && atl == null && form == null) return null;
  const f = form ?? (ctl != null && atl != null ? ctl - atl : null);
  const points: string[] = [];
  const ratio = ctl != null && atl != null && ctl > 5 ? atl / ctl : null;
  if (ctl != null) points.push(`Fitness (CTL) ${fmt(ctl)}: tu carga diaria media de las últimas semanas.`);
  if (ratio !== null) {
    points.push(
      `Fatiga/fitness ${fmt(ratio, 2)}: ${
        ratio > 1.5 ? 'subida de carga muy brusca, riesgo de sobrecarga' : ratio > 1.3 ? 'carga reciente alta frente a tu base' : ratio >= 0.8 ? 'carga reciente en línea con tu base' : 'carga reciente baja frente a tu base'
      }.`,
    );
  }
  if (prev != null) points.push(prev === 0 ? 'Ayer descansaste.' : `Carga de ayer: ${Math.round(prev)}.`);

  let tone: Tone;
  let title: string;
  let text: string;
  if (f === null) {
    tone = 'neutral';
    title = 'Carga registrada';
    text = 'Faltan datos para valorar tu forma.';
  } else if (f <= -30 || (ratio !== null && ratio > 1.5)) {
    tone = 'bad';
    title = 'Sobrecarga';
    text = `Forma ${signed(f, 1)}: fatiga acumulada muy alta. Baja el volumen o la intensidad unos días para evitar lesión o sobreentrenamiento.`;
  } else if (f <= -15) {
    tone = 'meh';
    title = 'Carga alta, zona productiva';
    text = `Forma ${signed(f, 1)}: estás cargando fuerte. Es normal en un bloque, pero vigila el descanso y programa una descarga pronto.`;
  } else if (f <= -5) {
    tone = 'good';
    title = 'Carga óptima';
    text = `Forma ${signed(f, 1)}: buen equilibrio entre estímulo y recuperación para seguir mejorando.`;
  } else if (f < 5) {
    tone = 'good';
    title = 'Carga equilibrada';
    text = `Forma ${signed(f, 1)}: mantienes el fitness sin acumular fatiga. Puedes subir algo la carga si buscas progresar.`;
  } else if (f < 15) {
    tone = 'good';
    title = 'Fresco';
    text = `Forma ${signed(f, 1)}: bien recuperado, buen momento para una sesión exigente o una competición.`;
  } else {
    tone = 'meh';
    title = 'Carga baja';
    text = `Forma ${signed(f, 1)}: llevas tiempo entrenando poco; si no es una descarga planificada, estás perdiendo fitness.`;
  }
  return { tone, title, text, points };
}
