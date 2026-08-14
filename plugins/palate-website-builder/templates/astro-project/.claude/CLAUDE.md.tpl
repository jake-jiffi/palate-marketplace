# {{CLIENT_NAME}} website

Astro 7 + Vercel, server-rendered. No CMS: content is authored in `src/lib/content.ts` and read through `loadPage()`. Brand from @palate-projects/{{SLUG}}-brand (pinned {{BRAND_VERSION}}).

## NON-NEGOTIABLES
- Vercel owns the build and deploy (its GitHub integration): pushes to main auto-deploy, PRs get preview deployments. The cloud build installs the private brand package via GITHUB_PACKAGES_TOKEN.
- Pin the brand package to an exact version. Updating it is deliberate: bump, review, deploy.
- Australian English. No em dashes.
- Only brand tokens for colour/type. Never hand-pick hex.

## Reading order
1. This file
2. src/layouts/BaseLayout.astro (SEO + brand wiring)
3. src/lib/content.ts (the content) + src/lib/load.ts (the seam a CMS plugs into)
4. The brand package CLAUDE.md (design rules)

## Continuing this site (add a page, a section, a feature)
Use the palate-website-builder skill's **CONTINUE SITE** mode, not a fresh build: ask it to "add {the page or section} to this site". It grounds the addition in the Palate MCP per page, matches these brand tokens and this layout, adds the SEO + sitemap entry, and runs the anti-slop + rendered + visual gates on the changed page. It never re-invents the brand.

## Editing content
Copy lives in `src/lib/content.ts`. Every page reads it via `loadPage()`, never by importing it directly: that seam is what lets a CMS be added later without touching a page. If the client needs to edit their own copy, add one: `scripts/add-sanity.sh .` wires Sanity, the embedded Studio at /studio and draft preview, and changes no page.

## Deploy
Push to main -> Vercel builds and deploys. PRs get preview deployments.
A copy change is a code change (edit content.ts, push). With a CMS added, content changes serve fresh over SSR with no redeploy.

## Updating the brand
npm install @palate-projects/{{SLUG}}-brand@latest, review the visual diff, deploy.
