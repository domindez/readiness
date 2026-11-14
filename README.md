# Readiness matutino

Check-in diario: métricas nocturnas del reloj (importadas de intervals.icu o a mano) más una batería de preguntas de 0 (peor) a 4 (mejor). Calcula un readiness frente a tu línea base de 60 días, avisa de anomalías (HRV baja con FC en reposo alta, temperatura, respiración…) y muestra tendencias de 7 días a todo el histórico.

Stack: Astro 7 (SSR), Cloudflare Workers, D1 y Chart.js.

## Desarrollo local

```sh
npm install
cp .dev.vars.example .dev.vars        # opcional: pon tu INTERVALS_API_KEY
npm run db:migrate:local
npm run db:seed-demo                  # opcional: 120 días de datos falsos (BORRA los locales)
npm run dev                           # http://localhost:4321
```

## Despliegue en Cloudflare

```sh
npx wrangler login
npx wrangler d1 create readiness      # copia el database_id en wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put INTERVALS_API_KEY
# en wrangler.jsonc: INTERVALS_ATHLETE_ID = tu id (p. ej. "i123456")
npm run deploy
```

### Proteger la app con Cloudflare Access (gratis)

1. Zero Trust → Access → Applications → *Add an application* → **Self-hosted**: pon el dominio del Worker (`readiness.<tu-subdominio>.workers.dev` o tu dominio propio).
2. Policy: *Allow* → *Emails* → tu email.
3. Copia el **Application Audience (AUD) Tag** y tu team domain (`<equipo>.cloudflareaccess.com`) en `ACCESS_AUD` y `ACCESS_TEAM_DOMAIN` (`wrangler.jsonc`). Vuelve a desplegar.

Con estas dos variables, el Worker exige y verifica el JWT de Access en todas las peticiones, así que no se puede entrar sin login por ninguna URL. Si están vacías, la app queda abierta.

## Personalizar

- **Preguntas**: desde *Ajustes*, sin tocar código.
- **Métricas**: `src/lib/metrics.ts` (y una migración nueva si añades una columna).
- **Pesos y umbrales del readiness**: `SCORE_CONFIG` en `src/lib/readiness.ts`.

## intervals.icu

Se importan HRV, FC en reposo, sueño (puntuación y horas), SpO₂, respiración y CTL/ATL. Garmin no envía a intervals el estrés, el Body Battery ni la temperatura de la piel, así que esos se introducen a mano. *Ajustes → Importar histórico* muestra qué campos llegan realmente desde tu cuenta.
