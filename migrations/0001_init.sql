-- Registro diario: métricas del reloj (todas opcionales).
CREATE TABLE entries (
  date            TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  resting_hr      REAL,
  hrv             REAL,
  sleep_score     REAL,
  sleep_hours     REAL,
  stress_avg      REAL,
  body_battery    REAL,
  respiration     REAL,
  spo2            REAL,
  skin_temp_delta REAL,
  ctl             REAL,
  atl             REAL,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'intervals', 'mixed')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Batería de preguntas configurable (1-4).
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  description TEXT,
  low_label   TEXT NOT NULL DEFAULT 'Muy mal',
  high_label  TEXT NOT NULL DEFAULT 'Muy bien',
  -- 1 = un 4 es lo peor (p. ej. "despertares": 4 = muchos)
  inverted    INTEGER NOT NULL DEFAULT 0 CHECK (inverted IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE answers (
  date        TEXT NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL CHECK (value BETWEEN 1 AND 4),
  PRIMARY KEY (date, question_id)
);
CREATE INDEX answers_question ON answers(question_id, date);

INSERT INTO questions (id, label, description, low_label, high_label, inverted, sort_order) VALUES
  (1, 'Calidad del sueño',      '¿Cómo has dormido?',                                   'Muy mal',     'Muy bien',      0, 10),
  (2, 'Despertares nocturnos',  'Veces que te has despertado (agua, pis, ruido…)',       'Ninguno',     '3 o más',       1, 20),
  (3, 'Dolor muscular',         'Agujetas o molestias musculares',                       'Sin dolor',   'Mucho dolor',   1, 30),
  (4, 'Energía',                '¿Con cuánta energía te levantas?',                      'Agotado',     'Con mucha',     0, 40),
  (5, 'Ánimo',                  'Estado de ánimo general',                               'Muy bajo',    'Muy bueno',     0, 50),
  (6, 'Estrés vital',           'Trabajo, familia, preocupaciones…',                     'Tranquilo',   'Muy estresado', 1, 60),
  (7, 'Ganas de entrenar',      'Motivación para la sesión de hoy',                      'Ninguna',     'Muchas',        0, 70);
