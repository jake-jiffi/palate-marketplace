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
 * THE POSTS @astrojs/sitemap CANNOT SEE.
 *
 * This site is `output: "server"` and src/pages/blog/[slug].astro resolves per request with no
 * getStaticPaths, deliberately, so a new post needs no route regeneration. The consequence is
 * that the sitemap integration enumerates only the prerendered routes, and every post is
 * therefore absent from sitemap.xml. On a real build that shipped a site whose entire SEO
 * argument was discoverability with none of its detail pages listed.
 *
 * So enumerate them here, from the content directory, and hand them over as customPages. Drafts
 * are excluded by a frontmatter scan rather than a full parse: this runs at config time, before
 * the content layer exists, and a draft wrongly listed is a worse failure than a cheap regex.
 */
function publishedPostUrls(site) {
  if (!site) return [];
  const dir = join(process.cwd(), "src", "content", "posts");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /\.mdx?$/.test(f));
  } catch {
    return [];                                   // no posts collection yet: nothing to add
  }
  const base = site.replace(/\/+$/, "");
  return files
    .filter((f) => {
      try {
        const head = readFileSync(join(dir, f), "utf8").slice(0, 2000);
        return !/^\s*draft:\s*true\s*$/m.test(head);
      } catch {
        return false;                            // unreadable means unlisted, never guessed in
      }
    })
    .map((f) => `${base}/blog/${f.replace(/\.mdx?$/, "")}/`);
}

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
    sitemap({ customPages: publishedPostUrls(siteUrl) }),
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
