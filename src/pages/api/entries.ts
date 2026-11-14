import type { APIRoute } from 'astro';
import { deleteDay, getAnswers, getEntries, getQuestions, saveDay, type MetricValues } from '../../lib/db';
import { isIsoDate } from '../../lib/dates';
import { bad, json, readJson } from '../../lib/http';
import { METRICS, parseMetric } from '../../lib/metrics';

export const GET: APIRoute = async ({ url }) => {
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return bad('Fechas inválidas');
  const [entries, answers] = await Promise.all([getEntries(from, to), getAnswers(from, to)]);
  return json({ entries, answers });
};

interface Body {
  date?: unknown;
  metrics?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  notes?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<Body>(request);
  if (!body || !isIsoDate(body.date)) return bad('Fecha inválida');

  const metrics: MetricValues = {};
  const errors: string[] = [];
  for (const m of METRICS) {
    const raw = body.metrics?.[m.key];
    const v = parseMetric(m, raw);
    if (raw !== undefined && raw !== null && raw !== '' && v === null) errors.push(`${m.label}: entre ${m.min} y ${m.max}`);
    metrics[m.key] = v;
  }

  const validIds = new Set((await getQuestions(true)).map((q) => q.id));
  const answers: Record<number, number> = {};
  for (const [qid, raw] of Object.entries(body.answers ?? {})) {
    if (raw === null || raw === undefined || raw === '') continue;
    const v = Number(raw);
    if (!validIds.has(Number(qid)) || !Number.isInteger(v) || v < 0 || v > 4) {
      errors.push(`Respuesta inválida para la pregunta ${qid}`);
      continue;
    }
    answers[Number(qid)] = v;
  }
  if (errors.length) return bad(errors.join('. '));

  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
  await saveDay(body.date, metrics, answers, notes);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date');
  if (!isIsoDate(date)) return bad('Fecha inválida');
  await deleteDay(date);
  return json({ ok: true });
};
