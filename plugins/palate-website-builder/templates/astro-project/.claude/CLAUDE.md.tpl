# {{CLIENT_NAME}} website

Astro 6 + Cloudflare Workers + Sanity. Brand from @jiffi-projects/{{SLUG}}-brand (pinned {{BRAND_VERSION}}).

## NON-NEGOTIABLES
- Build happens in CI and deploys an artifact. NEVER switch to building on Cloudflare (private brand package auth breaks there).
- Pin the brand package to an exact version. Updating it is deliberate: bump, review, deploy.
- Australian English. No em dashes.
- Only brand tokens for colour/type. Never hand-pick hex.

## Reading order
1. This file
2. src/layouts/BaseLayout.astro (SEO + brand wiring)
3. src/lib/sanity.ts (content)
4. The brand package CLAUDE.md (design rules)

## Continuing this site (add a page, a section, a feature)
Use the palate-website-builder skill's **CONTINUE SITE** mode, not a fresh build: ask it to "add {the page or section} to this site". It grounds the addition in the Palate MCP per page, matches these brand tokens and this layout, adds the SEO + sitemap entry, and runs the anti-slop + rendered + visual gates on the changed page. It never re-invents the brand.

## Deploy
Push to main -> CI builds (brand package via GITHUB_TOKEN) -> deploys dist/ to Workers.
Content change in Sanity -> webhook -> revalidate workflow rebuilds.

## Updating the brand
npm install @jiffi-projects/{{SLUG}}-brand@latest, review visual diff, deploy.
