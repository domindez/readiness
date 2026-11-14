// Secrets (no aparecen en wrangler.jsonc): `wrangler secret put` / .dev.vars
declare namespace Cloudflare {
  interface Env {
    INTERVALS_API_KEY?: string;
  }
}
