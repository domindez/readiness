import type { APIRoute } from 'astro';
import { createQuestion, deleteQuestion, getQuestions, moveQuestion, updateQuestion, type QuestionInput } from '../../lib/db';
import { bad, json, readJson } from '../../lib/http';

function parseInput(b: Record<string, unknown>): QuestionInput | string {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const label = str(b.label, 80);
  if (!label) return 'La pregunta necesita un nombre';
  return {
    label,
    description: str(b.description, 200) || null,
    low_label: str(b.low_label, 40) || 'Muy mal',
    high_label: str(b.high_label, 40) || 'Muy bien',
    inverted: b.inverted ? 1 : 0,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
}

export const GET: APIRoute = async () => json(await getQuestions(true));

export const POST: APIRoute = async ({ request }) => {
  const b = await readJson(request);
  if (!b) return bad('JSON inválido');
  const q = parseInput(b);
  if (typeof q === 'string') return bad(q);
  return json({ id: await createQuestion(q) }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const b = await readJson(request);
  const id = Number(b?.id);
  if (!b || !Number.isInteger(id)) return bad('Falta id');
  if (b.move === 'up' || b.move === 'down') {
    await moveQuestion(id, b.move === 'up' ? -1 : 1);
    return json({ ok: true });
  }
  const q = parseInput(b);
  if (typeof q === 'string') return bad(q);
  await updateQuestion(id, q);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return bad('Falta id');
  await deleteQuestion(id);
  return json({ ok: true });
};
