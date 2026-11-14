import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

/**
 * Defensa en profundidad para Cloudflare Access: si ACCESS_TEAM_DOMAIN y ACCESS_AUD están
 * configurados, cada petición debe traer un JWT de Access válido (firmado por tu equipo y
 * con tu AUD). Así ni la URL *.workers.dev ni otra ruta pueden saltarse el login.
 */
interface Jwk extends JsonWebKey {
  kid: string;
}
let jwksCache: { at: number; keys: Jwk[] } | null = null;

async function getKeys(team: string): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys };
  return keys;
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifyAccessJwt(token: string, team: string, aud: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { kid?: string; alg?: string };
  if (header.alg !== 'RS256') return false;
  const jwk = (await getKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return false;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as { aud?: string | string[]; exp?: number; iss?: string };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);
  return auds.includes(aud) && (payload.exp ?? 0) > now && payload.iss === `https://${team}`;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (team && aud) {
    const token = ctx.request.headers.get('Cf-Access-Jwt-Assertion');
    let ok = false;
    try {
      ok = !!token && (await verifyAccessJwt(token, team, aud));
    } catch {
      ok = false;
    }
    if (!ok) return new Response('No autorizado', { status: 403 });
  }
  const res = await next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
});
