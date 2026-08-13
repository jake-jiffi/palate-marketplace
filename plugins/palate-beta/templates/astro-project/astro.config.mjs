import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import pagefind from "astro-pagefind";
import tailwind from "@tailwindcss/vite";
import { cmsIntegrations } from "./astro.cms.mjs";

// Vercel is the default host (this is the baseline config). For the Cloudflare
// backup, scripts/switch-host-cloudflare.sh swaps in the Cloudflare adapter.
//
// Build-time env. Vercel injects project env vars into the build step scoped
// per environment (Production / Preview / Development) - set them in the
// Vercel dashboard or via `vercel env add`. See references/hosting-vercel.md.
const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");

// Which deployment this build is. Vercel sets VERCEL_ENV ("production" | "preview" |
// "development") in the build step, but it is a plain process env var, so it does not survive
// into a prerendered response: robots.txt is emitted at build time on a static route and would
// read the BUILDER's environment, not the deployment's. Promoting it to a PUBLIC_ var bakes the
// value into the output, which is what makes src/pages/robots.txt.ts able to close a preview.
//
// Empty is left empty on purpose rather than defaulted to "production". robots.txt fails safe
// on the host instead, and a value invented here would look like a measurement.
const siteEnv = env.PUBLIC_SITE_ENV || env.VERCEL_ENV || process.env.VERCEL_ENV || "";

export default defineConfig({
  site: `https://${env.SITE_DOMAIN || "{{DOMAIN}}"}`,
  output: "server",
  adapter: vercel({
    webAnalytics: { enabled: true },
    maxDuration: 10,
  }),
  integrations: [
    // Empty until a CMS is added (scripts/add-sanity.sh swaps astro.cms.mjs).
    // Keeping it a spread means adding a CMS never edits this file.
    ...cmsIntegrations(env),
    // MDX before react(): .mdx entries in src/content/ may embed components,
    // and the MDX integration has to claim the extension first.
    mdx(),
    react(),
    sitemap(),
    pagefind(),
  ],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwind()],
    // Inlined rather than passed through `env`, because Astro only exposes PUBLIC_ vars it can
    // see in a .env file, and on Vercel this one arrives as a process env var with no .env at all.
    define: { "import.meta.env.PUBLIC_SITE_ENV": JSON.stringify(siteEnv) },
  },
});
