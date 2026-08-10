import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwind from "@tailwindcss/vite";

// The portable Palate starter (non-Claude tools). Static-first, Vercel adapter, Tailwind 4
// via the VITE plugin. (It used to go through PostCSS because the Vite plugin was
// incompatible with Astro 6's rolldown-vite. On Astro 7 / Vite 8 that is fixed, and the
// PostCSS route actively breaks: postcss-import resolves `@import "tailwindcss"` as a
// relative path and the build dies with ENOENT.)
// Brand tokens live locally in src/styles/globals.css (vendored), no package.
// Set SITE_DOMAIN in the environment (or Vercel project env) for canonical/OG URLs.
const SITE = process.env.SITE_DOMAIN || "example.com";

export default defineConfig({
  site: `https://${SITE}`,
  output: "static",
  adapter: vercel({ webAnalytics: { enabled: true } }),
  devToolbar: { enabled: false },
  vite: { plugins: [tailwind()] },
});
