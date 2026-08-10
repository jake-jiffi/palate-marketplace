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
  vite: { plugins: [tailwind()] },
});
