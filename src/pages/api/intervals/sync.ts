import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { upsertImported } from '../../../lib/db';
import { addDays, daysBetween, isIsoDate, todayIn } from '../../../lib/dates';
import { bad, json, readJson } from '../../../lib/http';
import { fetchWellness, IntervalsError } from '../../../lib/intervals';

/** POST { oldest?, newest?, days?, overwrite? } → importa el wellness de intervals.icu. */
export const POST: APIRoute = async ({ request }) => {
  const b = (await readJson(request)) ?? {};
  const today = todayIn(env.TZ_NAME || 'Europe/Madrid');
  const newest = isIsoDate(b.newest) ? b.newest : today;
  const days = Math.min(Math.max(Number(b.days) || 1, 1), 1500);
  const oldest = isIsoDate(b.oldest) ? b.oldest : addDays(newest, -(days - 1));
  if (oldest > newest || daysBetween(oldest, newest) > 1500) return bad('Rango inválido (máximo ~4 años)');

  try {
    const { days: rows, fieldsSeen } = await fetchWellness(oldest, newest);
    const imported = await upsertImported(rows, b.overwrite === true);
    return json({ ok: true, oldest, newest, received: rows.length, imported, fieldsSeen });
  } catch (e) {
    if (e instanceof IntervalsError) return bad(e.message, 502);
    throw e;
  }
};
