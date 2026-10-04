import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import liveDesignPreview from './palate-preview/integration.mjs';

// The origin that canonical URLs, the sitemap and robots.txt name. Set SITE_URL to the real domain;
// on Vercel the production domain is used automatically; locally it falls back to the dev origin.
const site = process.env.SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:4321');

export default defineConfig({
  site,
  output: 'static',
  integrations: [liveDesignPreview(), sitemap()],
  devToolbar: { enabled: false },
  // A preview deployment is a public origin. robots.txt reads this to refuse indexing outside production.
  vite: { define: { 'import.meta.env.PUBLIC_SITE_ENV': JSON.stringify(process.env.VERCEL_ENV || process.env.SITE_ENV || 'development') } },
});
