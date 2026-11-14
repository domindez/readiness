-- 1) Sensaciones en escala 0-4 con 5 posiciones, siempre 0 = peor (izquierda) y 4 = mejor (derecha).
--    Las respuestas antiguas (1-4) se pasan a "bondad" (las preguntas invertidas se dan la vuelta)
--    y se reescalan: 1 → 0, 2 → 1, 3 → 3, 4 → 4 (equivalente redondeado de (v-1)·4/3).
CREATE TABLE answers_new (
  date        TEXT NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL CHECK (value BETWEEN 0 AND 4),
  PRIMARY KEY (date, question_id)
);

INSERT INTO answers_new (date, question_id, value)
SELECT a.date, a.question_id,
  CASE (CASE WHEN q.inverted = 1 THEN 5 - a.value ELSE a.value END)
    WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 3 ELSE 4 END
FROM answers a JOIN questions q ON q.id = a.question_id;

DROP TABLE answers;
ALTER TABLE answers_new RENAME TO answers;
CREATE INDEX answers_question ON answers(question_id, date);

-- En las preguntas invertidas, lo malo pasa a la izquierda: se intercambian las etiquetas.
UPDATE questions SET low_label = high_label, high_label = low_label WHERE inverted = 1;
ALTER TABLE questions DROP COLUMN inverted;

-- 2) Forma (TSB) = CTL − ATL, guardada como métrica propia.
ALTER TABLE entries ADD COLUMN form REAL;
UPDATE entries SET form = ROUND(ctl - atl, 1) WHERE ctl IS NOT NULL AND atl IS NOT NULL;
