import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import sanity from "@sanity/astro";
import pagefind from "astro-pagefind";
import tailwind from "@tailwindcss/vite";

// CLOUDFLARE OVERLAY: replaces the Vercel-native baseline astro.config.mjs when
// the build's host is Cloudflare (`--host cloudflare`). Applied by
// scripts/switch-host-cloudflare.sh. The default host is Vercel.
//
// Build-time env. The Sanity client, embedded Studio and visual-editing flag
// are all configured at build time (this is how @sanity/astro works), so CI
// must provide SANITY_* + PUBLIC_SANITY_VISUAL_EDITING_ENABLED as build vars.
// See references/cms-and-draft-preview.md.
const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");

// Server-rendered (SSR) on Cloudflare Workers. SSR is REQUIRED - it is what
// makes the embedded Sanity Studio and visual editing work.
export default defineConfig({
  site: `https://${env.SITE_DOMAIN || "{{DOMAIN}}"}`,
  output: "server",
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    // Sanity: the data client (imported as `sanity:client`), the embedded
    // Studio at /studio, and stega encoding for click-to-edit visual editing.
    // projectId falls back to a harmless placeholder during the preview stage
    // (no Sanity project yet) - pages still render because loadPage() falls
    // back to src/lib/content.ts when a fetch fails.
    sanity({
      projectId: env.SANITY_PROJECT_ID || "preview",
      dataset: env.SANITY_DATASET || "production",
      useCdn: false,
      apiVersion: "2025-02-19",
      studioBasePath: "/studio",
      stega: { studioUrl: "/studio" },
    }),
    react(), // required by the embedded Sanity Studio
    sitemap(),
    pagefind(), // static search, indexed at build time
  ],
  // never let the Astro dev toolbar appear in screenshots or the client preview
  devToolbar: { enabled: false },
  vite: { plugins: [tailwind()] },
});

// SSR gotcha (see cms-and-draft-preview.md): if the deploy complains it needs a
// KV namespace for Astro sessions, the site is not using sessions - add a no-op
// session config rather than provisioning KV. wrangler.toml must NOT set `main`;
// the Cloudflare adapter injects the worker entry itself.
