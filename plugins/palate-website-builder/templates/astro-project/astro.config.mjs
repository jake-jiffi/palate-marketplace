import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import sanity from "@sanity/astro";
import pagefind from "astro-pagefind";
import tailwind from "@tailwindcss/vite";

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
    sanity({
      projectId: env.SANITY_PROJECT_ID || "preview",
      dataset: env.SANITY_DATASET || "production",
      useCdn: false,
      apiVersion: "2025-02-19",
      studioBasePath: "/studio",
      stega: { studioUrl: "/studio" },
    }),
    react(),
    sitemap(),
    pagefind(),
  ],
  devToolbar: { enabled: false },
  vite: { plugins: [tailwind()] },
});
