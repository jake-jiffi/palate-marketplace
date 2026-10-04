import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import pagefind from "astro-pagefind";
import tailwind from "@tailwindcss/vite";
import { cmsIntegrations } from "./astro.cms.mjs";

/**
 * STATIC BY DEFAULT. On-demand is declared per route, and only where a route earns it.
 *
 * This was `output: "server"` for every page of every build, and the rule protecting it read
 * "never ship a static preview and retrofit SSR later, that IS the rebuild this rule exists to
 * prevent". The rebuild was real once. It is not any more: the adapter stays installed in both
 * modes, `export const prerender = false` promotes a single route, and flipping this one line
 * to "server" promotes the whole site. Nothing about a page changes either way, because every
 * page reads through `loadPage()`.
 *
 * WHAT IT COST, measured on a scaffold built both ways:
 *   - SSR produced ZERO html files, so `astro-pagefind` indexed ZERO pages. Site search ships
 *     in this scaffold and had never worked. The build said so every time:
 *     "Output type `server` does not produce static *.html pages ... will not work with
 *     astro-pagefind". Static: 7 pages built, 7 indexed.
 *   - Every marketing page was a serverless invocation instead of a file on a CDN.
 *   - `dist/` held no HTML, so the uniqueness gate had nothing on disk to compare and could
 *     never have had a deterministic caller.
 *
 * THE EXCEPTIONS, and there are only three:
 *   - `src/pages/api/contact.ts`   an endpoint, `prerender = false`
 *   - `src/pages/robots.txt.ts`    reads the REQUEST host to close a non-canonical origin
 *   - a CMS PREVIEW deployment     `astro.cms.mjs` flips every route via astro:route:setup
 *
 * DO NOT WRITE `export const prerender = true` ON A PAGE. Static is already the default here,
 * so it adds nothing, and it would pin that page as static when someone later flips this line
 * to "server", turning a one-line escalation into a hunt. Declare exceptions, never the rule.
 *
 * WHAT SHOULD MAKE YOU FLIP IT: a logged-in area, per-visitor personalisation at render time,
 * live inventory or pricing that moves faster than a rebuild, server-decided A/B tests, or
 * geo/IP routing. NOT: a contact form (endpoint), a blog (build time), a CMS (build time plus
 * a publish webhook), or analytics of any kind (browser).
 */

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
// After `env`, not before: a const is not initialised until its line runs, so reading env
// above it throws at config load and every scaffold fails to build.
const siteUrl = `https://${env.SITE_DOMAIN || "{{DOMAIN}}"}`;

const siteEnv = env.PUBLIC_SITE_ENV || env.VERCEL_ENV || process.env.VERCEL_ENV || "";

export default defineConfig({
  site: siteUrl,
  output: "static",
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
    // Posts are prerendered routes now, so the integration enumerates them itself.
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
