// Genera SQL con 120 días de datos sintéticos (para probar gráficos y alertas en local).
// Uso: npm run db:seed-demo   (BORRA los registros locales existentes)
const DAYS = 120;
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const iso = (d) => d.toISOString().slice(0, 10);

const out = ['DELETE FROM answers;', 'DELETE FROM entries;'];
let ctl = 45;
let atl = 45;
let lastLoad = 0;
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - i);
  const date = iso(d);
  if (rnd() < 0.06) continue; // algún día sin registrar

  // "Enfermedad" hace ~20 días durante 3 días y un bloque de sobrecarga hace ~50.
  const sick = i >= 18 && i <= 20 ? 1 : 0;
  const overload = i >= 48 && i <= 54 ? 0.6 : 0;
  const fitnessTrend = (DAYS - i) / DAYS; // mejora lenta
  const hrv = r1(clamp(58 + 6 * fitnessTrend + gauss() * 4 - sick * 18 - overload * 8, 20, 120));
  const rhr = Math.round(clamp(50 - 2 * fitnessTrend + gauss() * 1.5 + sick * 8 + overload * 3, 38, 80));
  const sleepH = r1(clamp(7.3 + gauss() * 0.6 - sick * 0.8, 4, 10));
  const sleepScore = Math.round(clamp(78 + gauss() * 7 - sick * 20 - overload * 6, 30, 100));
  const stress = Math.round(clamp(26 + gauss() * 6 + sick * 20 + overload * 8, 5, 90));
  const bb = Math.round(clamp(78 + gauss() * 8 - sick * 30 - overload * 10, 5, 100));
  const resp = r1(clamp(14 + gauss() * 0.4 + sick * 2.2, 10, 25));
  const spo2 = r1(clamp(96 + gauss() * 0.8 - sick * 2, 88, 100));
  const temp = r1(clamp(gauss() * 0.2 + sick * 0.9, -2, 2));
  const load = d.getUTCDay() === 1 || sick ? 0 : 40 + rnd() * 80 + overload * 60;
  const prevLoad = lastLoad;
  lastLoad = load;
  ctl += (load - ctl) / 42;
  atl += (load - atl) / 7;

  out.push(
    `INSERT INTO entries (date, resting_hr, hrv, sleep_score, sleep_hours, stress_avg, body_battery, respiration, spo2, skin_temp_delta, ctl, atl, form, load_prev, source, notes) VALUES ('${date}', ${rhr}, ${hrv}, ${sleepScore}, ${sleepH}, ${stress}, ${bb}, ${resp}, ${spo2}, ${temp}, ${r1(ctl)}, ${r1(atl)}, ${r1(ctl - atl)}, ${Math.round(prevLoad)}, 'mixed', ${sick ? "'Resfriado'" : 'NULL'});`,
  );

  const q = (base) => clamp(Math.round(base + gauss() * 0.7), 0, 4);
  const answers = {
    1: q(2.8 - sick * 2),
    2: q(0.8 + sick * 1.6), // cantidad: 0 = ninguno
    3: q(1 + overload * 2.6 + (d.getUTCDay() === 2 ? 1 : 0)), // cantidad
    4: q(2.8 - sick * 2.5 - overload),
    5: q(3 - sick * 1.3),
    6: q(1.3 + sick), // cantidad
    7: q(3 - sick * 2.5 - overload),
  };
  for (const [qid, v] of Object.entries(answers)) out.push(`INSERT INTO answers (date, question_id, value) VALUES ('${date}', ${qid}, ${v});`);
}
console.log(out.join('\n'));
