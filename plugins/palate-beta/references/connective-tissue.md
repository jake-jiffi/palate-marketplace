# SEO and AI-crawler connective tissue

Every site ships with all of this. Most of it is in the template already - the
list below says where each piece lives so it is never hand-rebuilt.

- **Meta + canonical** - title, description, canonical URL per page. BaseLayout.
- **Open Graph + Twitter cards** - title, description, `og:image`. BaseLayout.
  A default social image ships at `public/og/default.png` (a placeholder Phase A
  replaces). Per-page dynamic OG images are an optional Phase F enhancement
  (`workers-og` on the edge) - not every site needs them.
- **JSON-LD** - Organization schema in BaseLayout; add Article / JobPosting /
  Breadcrumb per page type as needed.
- **Favicon** - `public/favicon.svg` (placeholder), linked in BaseLayout. Phase
  A swaps in the brand mark.
- **Sitemap** - `@astrojs/sitemap`, auto-generated, referenced in robots.txt.
- **robots.txt** - route at `src/pages/robots.txt.ts`, explicitly allows AI
  crawlers (GPTBot, ClaudeBot, PerplexityBot) - this is marketing content.
- **llms.txt** - route at `src/pages/llms.txt.ts`, a structured summary for AI
  crawlers, populated from siteSettings.
- **Pagefind search** - the `astro-pagefind` integration builds the index from
  the rendered site at build time; `src/components/Search.astro` wraps the UI.
  No server, no Algolia bill.
- **`public/_headers`** - long-cache for hashed assets, `no-store` for `/api/*`,
  and security headers. `X-Frame-Options` is `SAMEORIGIN` (not `DENY`) so the
  same-origin Sanity Presentation preview iframe still works.
- **IndexNow** - the key file (named after a generated UUID) is added to
  `public/` during Phase F provisioning, and the publish workflow pings search
  engines. Not templated because the key is per-project.
- **Performance** - SSR on Cloudflare Workers; published responses are
  edge-cached, preview responses are `no-store`. Lighthouse 100 is the baseline.

The AI-crawler readiness (robots + llms.txt + clean JSON-LD) is deliberate:
clients increasingly get discovered via AI answers, not just search.
