// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // La app no usa sesiones de Astro: evita aprovisionar un KV innecesario.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  devToolbar: { enabled: false },
});
