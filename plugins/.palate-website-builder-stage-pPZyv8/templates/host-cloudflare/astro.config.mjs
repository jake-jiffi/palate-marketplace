import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import pagefind from "astro-pagefind";
import tailwind from "@tailwindcss/vite";
import { cmsIntegrations } from "./astro.cms.mjs";

// CLOUDFLARE OVERLAY: replaces the Vercel-native baseline astro.config.mjs when
// the build's host is Cloudflare (`--host cloudflare`). Applied by
// scripts/switch-host-cloudflare.sh. The default host is Vercel.
//
// Build-time env. If a CMS is added later, its client, embedded Studio and
// visual-editing flag are all configured at build time (that is how
// @sanity/astro works), so CI must then provide SANITY_* +
// PUBLIC_SANITY_VISUAL_EDITING_ENABLED as build vars.
// See references/cms-and-draft-preview.md.
const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");

// Server-rendered (SSR) on Cloudflare Workers. SSR is the default even with no
// CMS, so adding one later is purely additive: it is what the embedded Studio
// and visual editing need, and retrofitting it would be a rebuild.
export default defineConfig({
  site: `https://${env.SITE_DOMAIN || "{{DOMAIN}}"}`,
  output: "server",
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    // Empty until a CMS is added (scripts/add-sanity.sh swaps astro.cms.mjs).
    // Keeping it a spread means adding a CMS never edits this file.
    ...cmsIntegrations(env),
    react(), // pre-wired: peer of the Sanity Studio, and of the Tier-2 R3F opt-in
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
