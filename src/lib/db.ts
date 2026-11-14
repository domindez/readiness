import { env } from 'cloudflare:workers';
import { METRICS, METRIC_KEYS, type MetricKey } from './metrics';

export type Source = 'manual' | 'intervals' | 'mixed';

export type Entry = { date: string; source: Source; notes: string | null; updated_at: string } & Record<MetricKey, number | null>;

export interface Question {
  id: number;
  label: string;
  description: string | null;
  /** Qué significa 0. */
  low_label: string;
  /** Qué significa 4. */
  high_label: string;
  /** 0 = 4 es lo mejor (calidad, energía…). 1 = pregunta de cantidad: 0 = nada es lo mejor (dolor, despertares…). */
  inverted: 0 | 1;
  sort_order: number;
  active: 0 | 1;
}

export interface AnswerRow {
  date: string;
  question_id: number;
  value: number;
}

export interface AllData {
  entries: Entry[];
  answers: AnswerRow[];
  questions: Question[];
}

const db = () => env.DB;
const COLS = METRIC_KEYS.join(', ');

// ---------- lectura ----------

export async function getQuestions(includeInactive = false): Promise<Question[]> {
  const sql = `SELECT * FROM questions ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`;
  return (await db().prepare(sql).all<Question>()).results;
}

export async function getEntries(from?: string, to?: string): Promise<Entry[]> {
  const sql = `SELECT date, ${COLS}, source, notes, updated_at FROM entries WHERE date >= ?1 AND date <= ?2 ORDER BY date`;
  return (await db().prepare(sql).bind(from ?? '0000-00-00', to ?? '9999-99-99').all<Entry>()).results;
}

export async function getAnswers(from?: string, to?: string): Promise<AnswerRow[]> {
  const sql = `SELECT date, question_id, value FROM answers WHERE date >= ?1 AND date <= ?2 ORDER BY date`;
  return (await db().prepare(sql).bind(from ?? '0000-00-00', to ?? '9999-99-99').all<AnswerRow>()).results;
}

/** Todo el histórico (un solo usuario: son pocos cientos de filas). */
export async function getAllData(): Promise<AllData> {
  const [entries, answers, questions] = await Promise.all([getEntries(), getAnswers(), getQuestions(true)]);
  return { entries, answers, questions };
}

export async function getDay(date: string): Promise<{ entry: Entry | null; answers: Record<number, number> }> {
  const [entry, ans] = await Promise.all([
    db().prepare(`SELECT date, ${COLS}, source, notes, updated_at FROM entries WHERE date = ?1`).bind(date).first<Entry>(),
    db().prepare('SELECT question_id, value FROM answers WHERE date = ?1').bind(date).all<AnswerRow>(),
  ]);
  return { entry, answers: Object.fromEntries(ans.results.map((a) => [a.question_id, a.value])) };
}

/** Fechas con algún dato (registro o respuestas), más recientes primero. */
export async function getLoggedDates(): Promise<string[]> {
  const r = await db()
    .prepare('SELECT date FROM entries UNION SELECT DISTINCT date FROM answers ORDER BY date DESC')
    .all<{ date: string }>();
  return r.results.map((x) => x.date);
}

// ---------- escritura ----------

export type MetricValues = Partial<Record<MetricKey, number | null>>;

/** Guardado manual desde el formulario: sustituye todas las métricas, respuestas y notas del día. */
export async function saveDay(date: string, metrics: MetricValues, answers: Record<number, number>, notes: string | null) {
  const values = METRIC_KEYS.map((k) => metrics[k] ?? null);
  const placeholders = METRIC_KEYS.map((_, i) => `?${i + 2}`).join(', ');
  const updates = METRIC_KEYS.map((k) => `${k} = excluded.${k}`).join(', ');
  const n = METRIC_KEYS.length;

  const stmts = [
    db()
      .prepare(
        `INSERT INTO entries (date, ${COLS}, notes, source) VALUES (?1, ${placeholders}, ?${n + 2}, 'manual')
         ON CONFLICT(date) DO UPDATE SET ${updates}, notes = excluded.notes,
           source = CASE WHEN entries.source = 'manual' THEN 'manual' ELSE 'mixed' END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
      )
      .bind(date, ...values, notes),
    db().prepare('DELETE FROM answers WHERE date = ?1').bind(date),
    ...Object.entries(answers).map(([qid, v]) =>
      db().prepare('INSERT INTO answers (date, question_id, value) VALUES (?1, ?2, ?3)').bind(date, Number(qid), v),
    ),
  ];
  await db().batch(stmts);
}

/**
 * Importa filas de intervals.icu. Solo toca las métricas que vienen en cada fila.
 * Con overwrite = false, conserva los valores que ya existen (p. ej. corregidos a mano).
 */
export async function upsertImported(rows: { date: string; metrics: MetricValues }[], overwrite: boolean): Promise<number> {
  const stmts = rows
    .map(({ date, metrics }) => {
      const keys = METRICS.map((m) => m.key).filter((k) => metrics[k] !== undefined && metrics[k] !== null);
      if (!keys.length) return null;
      const cols = keys.join(', ');
      const ph = keys.map((_, i) => `?${i + 2}`).join(', ');
      const set = keys.map((k) => (overwrite ? `${k} = excluded.${k}` : `${k} = COALESCE(entries.${k}, excluded.${k})`)).join(', ');
      return db()
        .prepare(
          `INSERT INTO entries (date, ${cols}, source) VALUES (?1, ${ph}, 'intervals')
           ON CONFLICT(date) DO UPDATE SET ${set},
             source = CASE WHEN entries.source = 'intervals' THEN 'intervals' ELSE 'mixed' END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
        )
        .bind(date, ...keys.map((k) => metrics[k]!));
    })
    .filter((s) => s !== null);
  // D1 limita el tamaño de cada batch: troceamos.
  for (let i = 0; i < stmts.length; i += 50) await db().batch(stmts.slice(i, i + 50));
  return stmts.length;
}

export async function deleteDay(date: string) {
  await db().batch([
    db().prepare('DELETE FROM answers WHERE date = ?1').bind(date),
    db().prepare('DELETE FROM entries WHERE date = ?1').bind(date),
  ]);
}

// ---------- preguntas ----------

export type QuestionInput = Pick<Question, 'label' | 'description' | 'low_label' | 'high_label' | 'inverted' | 'active'>;

export async function createQuestion(q: QuestionInput): Promise<number> {
  const max = await db().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM questions').first<{ m: number }>();
  const r = await db()
    .prepare('INSERT INTO questions (label, description, low_label, high_label, inverted, active, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
    .bind(q.label, q.description, q.low_label, q.high_label, q.inverted, q.active, (max?.m ?? 0) + 10)
    .first<{ id: number }>();
  return r!.id;
}

export async function updateQuestion(id: number, q: QuestionInput) {
  await db()
    .prepare('UPDATE questions SET label = ?2, description = ?3, low_label = ?4, high_label = ?5, inverted = ?6, active = ?7 WHERE id = ?1')
    .bind(id, q.label, q.description, q.low_label, q.high_label, q.inverted, q.active)
    .run();
}

/** Mueve una pregunta una posición arriba (-1) o abajo (+1). */
export async function moveQuestion(id: number, dir: -1 | 1) {
  const qs = await getQuestions(true);
  const i = qs.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= qs.length) return;
  [qs[i], qs[j]] = [qs[j], qs[i]];
  await db().batch(qs.map((q, k) => db().prepare('UPDATE questions SET sort_order = ?2 WHERE id = ?1').bind(q.id, (k + 1) * 10)));
}

/** Borra la pregunta y todas sus respuestas (para conservar el histórico, mejor desactivarla). */
export async function deleteQuestion(id: number) {
  await db().batch([
    db().prepare('DELETE FROM answers WHERE question_id = ?1').bind(id),
    db().prepare('DELETE FROM questions WHERE id = ?1').bind(id),
  ]);
}
