import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

// The portable Palate starter (non-Claude tools). Static-first, Vercel adapter, Tailwind 4
// via PostCSS (postcss.config.mjs) - the Vite plugin is incompatible with Astro 6's
// rolldown-vite. Brand tokens live locally in src/styles/globals.css (vendored), no package.
// Set SITE_DOMAIN in the environment (or Vercel project env) for canonical/OG URLs.
const SITE = process.env.SITE_DOMAIN || "example.com";

export default defineConfig({
  site: `https://${SITE}`,
  output: "static",
  adapter: vercel({ webAnalytics: { enabled: true } }),
  devToolbar: { enabled: false },
});
