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

// Which deployment this build is, and it has to be BAKED IN here.
//
// Cloudflare has no VERCEL_ENV to fall back on, so CI sets PUBLIC_SITE_ENV on the build step
// (production in deploy.yml, preview in preview.yml). It cannot live in wrangler.toml: those
// vars reach the Worker at RUNTIME, and BaseLayout decides the robots meta from
// import.meta.env at BUILD time. Vite only exposes PUBLIC_ vars it can see in a .env file, and
// in CI this one arrives as a process env var with no .env at all, which is why it is defined
// rather than left to be picked up.
//
// Empty when nothing sets it. For INDEXING that is the safe direction: BaseLayout treats the
// build as a preview and noindexes it, and a preview that gets indexed puts a client's content
// on a domain they do not own, so gate-seo's live pass catches a production origin that
// noindexed itself.
//
// EMPTY IS NOT SAFE IN EVERY DIRECTION, and this is the one to know about. `smokeAllowed` in
// src/pages/api/contact.ts gates the `x-palate-smoke` header on this same value: empty means
// not-production, so the header is honoured with no secret and any request carrying it has its
// enquiry validated and DISCARDED. On a live site that is lost enquiries. Every path that
// produces a production build therefore sets it: deploy.yml, revalidate.yml, and the bootstrap
// `npm run build` in scripts/provision-cloudflare.sh, which is the one that used to be missed
// because it runs locally rather than in CI.
const siteEnv = env.PUBLIC_SITE_ENV || "";

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
  vite: {
    plugins: [tailwind()],
    define: { "import.meta.env.PUBLIC_SITE_ENV": JSON.stringify(siteEnv) },
  },
});

// SSR gotcha (see cms-and-draft-preview.md): if the deploy complains it needs a
// KV namespace for Astro sessions, the site is not using sessions - add a no-op
// session config rather than provisioning KV. wrangler.toml must NOT set `main`;
// the Cloudflare adapter injects the worker entry itself.
