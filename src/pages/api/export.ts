import type { APIRoute } from 'astro';
import { getAllData } from '../../lib/db';
import { METRICS } from '../../lib/metrics';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET ?format=csv|json — copia de seguridad / análisis en Excel. */
export const GET: APIRoute = async ({ url }) => {
  const data = await getAllData();
  const stamp = new Date().toISOString().slice(0, 10);

  if (url.searchParams.get('format') === 'json') {
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="readiness-${stamp}.json"`,
      },
    });
  }

  // CSV: una fila por día, métricas + una columna por pregunta.
  const dates = [...new Set([...data.entries.map((e) => e.date), ...data.answers.map((a) => a.date)])].sort();
  const byDate = new Map(data.entries.map((e) => [e.date, e]));
  const ans = new Map(data.answers.map((a) => [`${a.date}|${a.question_id}`, a.value]));
  const header = ['fecha', ...METRICS.map((m) => m.key), ...data.questions.map((q) => q.label), 'fuente', 'notas'];
  const lines = [header.map(csvCell).join(',')];
  for (const d of dates) {
    const e = byDate.get(d);
    lines.push(
      [
        d,
        ...METRICS.map((m) => e?.[m.key] ?? null),
        ...data.questions.map((q) => ans.get(`${d}|${q.id}`) ?? null),
        e?.source ?? '',
        e?.notes ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return new Response('﻿' + lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="readiness-${stamp}.csv"`,
    },
  });
};
