# {{CLIENT_NAME}} website

Astro 6 + Vercel + Sanity. Brand from @palate-projects/{{SLUG}}-brand (pinned {{BRAND_VERSION}}).

## NON-NEGOTIABLES
- Vercel owns the build and deploy (its GitHub integration): pushes to main auto-deploy, PRs get preview deployments. The cloud build installs the private brand package via GITHUB_PACKAGES_TOKEN.
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
Push to main -> Vercel builds and deploys. PRs get preview deployments.
Content change in Sanity -> served fresh (SSR), no code redeploy needed.

## Updating the brand
npm install @palate-projects/{{SLUG}}-brand@latest, review the visual diff, deploy.
