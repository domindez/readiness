-- 1) Preguntas "de cantidad": el número indica cuánto (0 = nada, 4 = mucho), lo que es más intuitivo
--    para despertares, dolor o estrés. Para las medias se invierten (0 cuenta como 4).
--    Los valores guardados no se tocan: la escala pasa a leerse como cantidad.
ALTER TABLE questions ADD COLUMN inverted INTEGER NOT NULL DEFAULT 0 CHECK (inverted IN (0, 1));

UPDATE questions SET inverted = 1, low_label = 'Ninguno', high_label = '3 o más' WHERE id = 2;
UPDATE questions SET inverted = 1, low_label = 'Sin dolor', high_label = 'Mucho dolor' WHERE id = 3;
UPDATE questions SET inverted = 1, label = 'Estrés nocturno', description = 'Estrés durante el sueño',
  low_label = 'Nada', high_label = 'Mucho' WHERE id = 6;

-- 2) Carga de entrenamiento del día anterior (suma de la carga de las actividades de intervals.icu).
ALTER TABLE entries ADD COLUMN load_prev REAL;
