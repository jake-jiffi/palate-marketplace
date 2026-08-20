# CMS and draft preview - the architecture

Read this before any build. It defines the content architecture in
`templates/astro-project/`, and the SSR + Sanity + visual-editing setup that
`scripts/add-sanity.sh` layers on top when a build needs a CMS. Where a CMS is
used it is the **official `@sanity/astro` integration** - the supported,
lowest-battle path.

## THE DEFAULT IS NO CMS

The scaffold ships with **no CMS**. Content is authored in `src/lib/content.ts`
and read through `loadPage()`, and the Sanity tree costs about **850 packages**
(a scaffold goes from 436 to 1,291), so a brochure site that changes twice a
year should not carry it.

**Add a CMS when, and only when, one of these is true:**

- the client will edit their own copy, without you;
- content is collection-shaped and will keep growing (blog, case studies, menu,
  team, listings, events);
- someone other than the developer needs draft preview before publishing.

**Do not add one** because the site "might need it later". Later is cheap: the
whole point of the seam below is that adding a CMS edits no page.

```
scripts/add-sanity.sh <project-dir>     # then: npm install && npm run build
```

This is deliberately NOT a decision the scaffold makes for you. It is a
question for the plan checkpoint, in the client's terms: *who edits this copy
in six months?*

## Why it can be added later without a rebuild

Two things stay true from the first file, so a CMS is purely additive:

1. **Output is `"static"`; the PREVIEW deployment is the exception.** Production wants files
   on a CDN: published content, no overlay, nothing recomputed per visitor. The preview
   deployment exists so an editor sees their DRAFT, and a prerendered preview freezes that
   draft at build time, which defeats the Presentation tool. So `astro.cms.mjs` flips every
   route to on-demand when `PUBLIC_SANITY_VISUAL_EDITING_ENABLED` is `"true"`, via the
   `astro:route:setup` hook. Astro 5 removed dynamic `prerender` exports (only a literal
   boolean compiles), and the hook belongs in `astro.cms.mjs` rather than `astro.config.mjs`
   because the latter is customised per build and `add-sanity.sh` must never patch it.
   Verified on a real scaffold with the Sanity tree installed: flag off -> 8 static pages,
   flag on -> 0, all on demand. The one operational consequence: **publishing needs a rebuild
   trigger** (a Sanity webhook to a Vercel deploy hook), so a change is a minute behind rather
   than instant. Say that to the client. One upside comes free: a Sanity outage now hits the
   BUILD, which falls back to `content.ts`, and the live site is untouched because it is
   already built.

2. **Every page calls `loadPage()`, never `content.ts` directly.** That
   indirection is the seam. Read `content.ts` straight from a page and you have
   signed up to rewrite every page the day a client wants to edit their own copy.

`add-sanity.sh` therefore never patches `astro.config.mjs` or
`BaseLayout.astro` (both are customised per build, and a sed patch against an
edited config is how you silently corrupt a live project). Instead the base
ships two **no-op files that the script replaces wholesale**:

| File | Base (no CMS) | After `add-sanity.sh` |
|------|---------------|----------------------|
| `astro.cms.mjs` | `cmsIntegrations()` returns `[]` | returns the `sanity()` integration |
| `src/components/CmsVisualEditing.astro` | renders nothing | renders `<VisualEditing>` |
| `src/lib/load.ts` | returns the `fallback` | queries Sanity, falls back |

`astro.config.mjs` already spreads `...cmsIntegrations(env)` and `BaseLayout`
already mounts `<CmsVisualEditing />`, so neither file is ever touched.

**Order matters with the Cloudflare host:** `switch-host-cloudflare.sh`
overwrites `package.json`, so pick the host FIRST and add the CMS second. The
script hard-blocks the wrong order rather than silently stripping the CMS.

## The shape (once a CMS is added)

- **Astro static** (`output: "static"`) on the **Vercel adapter** by default -
  or on the Cloudflare adapter, deployed as a Workers script, when
  `--host cloudflare` is picked (see `references/hosting-vercel.md`). The
  embedded Studio is a client-side SPA and builds fine as a static shell at
  `/studio`; only the PREVIEW deployment renders on demand, and `astro.cms.mjs`
  arranges that from the visual-editing flag. Everything in this doc applies
  identically on either host. The Vercel Toolbar's
  Comments feature complements Sanity's Presentation tool on preview
  deployments - reviewer notes on the page, plus Sanity click-to-edit.
- **`@sanity/astro`** is the integration. It provides the data client (the
  `sanity:client` virtual module), the embedded Studio, and stega encoding for
  visual editing. `@astrojs/react` is added alongside it (the Studio is React).
- **The Studio is embedded at `/studio`** (`studioBasePath: "/studio"`). It
  ships with the site - one deploy, one domain, same origin. `sanity.config.ts`
  lives at the project root.
- **A fallback-content layer** so the preview stage needs no Sanity project.

## The content layer

`src/lib/content.ts` exports a typed object with the real copy for every page.
`src/lib/load.ts` exports `loadPage(query, params, fallback)`. **Every page
calls it, always, whether or not a CMS exists.**

With **no CMS** (the default) it returns `fallback` and nothing else. The site
renders 100% from `content.ts`; a copy change is a code change.

With **Sanity added** it becomes:

1. If `SANITY_PROJECT_ID` is empty (not provisioned yet) - return `fallback`.
2. Else query Sanity via `sanity:client` (drafts perspective + stega when
   visual editing is on, published otherwise).
3. If the query throws or returns empty - return `fallback`.

So the preview stage still renders 100% on `content.ts` with no Sanity account;
production seeds Sanity from the same file, and the fallback stays as a
CMS-outage safety net. `src/pages/index.astro` is the canonical example - copy
its pattern. Keep `content.ts` shapes and the `src/sanity/schema/` field names
in lockstep.

Before the Sanity project is provisioned the integration still loads -
`projectId` falls back to a harmless placeholder (`"preview"`) in
`astro.cms.mjs` so the build succeeds; the fetches simply fail and `loadPage`
returns the fallback.

## Visual editing - how draft preview works

`@sanity/astro`'s model is **env-var gated**, not per-request:

- A single build-time variable, `PUBLIC_SANITY_VISUAL_EDITING_ENABLED`,
  decides the mode. `"true"` -> `loadPage` uses the `drafts` perspective with
  stega encoding, and `BaseLayout` mounts `<CmsVisualEditing enabled />`, which
  after `add-sanity.sh` wraps `<VisualEditing>` from
  `@sanity/astro/visual-editing`. `"false"` (production) -> published content,
  edge-cached, no overlay.
- So there are **two deployments of the same repo**:
  - **production** - `PUBLIC_SANITY_VISUAL_EDITING_ENABLED=false`. The real site.
  - **preview** - `PUBLIC_SANITY_VISUAL_EDITING_ENABLED=true`. Draft content,
    click-to-edit overlays. Sanity's Presentation tool loads this one.
- For a developer, `astro dev` with the flag set `true` in `.env` shows
  overlays locally. For a non-technical client, the deployed preview is what
  they use.

`SANITY_API_READ_TOKEN` is required whenever the flag is on (draft content
needs auth).

## The embedded Studio

`astro.cms.mjs` sets `studioBasePath: "/studio"`, so the full Studio is a
route on the site: `{site}/studio`. `sanity.config.ts` at the project root
configures it - schema from `src/sanity/schema/`, plus `structureTool`,
`presentationTool` and `visionTool`. The Presentation tool's `previewUrl` is
`{ origin: "same-origin", preview: "/" }` - it previews the very site the
Studio is embedded in. Same origin means no cross-site cookie problems.

The client edits at `{preview-site}/studio`; that deployment has visual editing
on, so Presentation shows live overlays.

## Editability 1: the locked client-shaped schema (W12)

The default schema lets a client break the build (delete the hero, paste an H1, blow out
the grid). The shipped schema is LOCKED to content edits only, so the client can change words
and swap images but cannot damage the structure or the craft:

- **Structure is `readOnly` / `hidden`.** Section order, layout variant, the component a
  block maps to, the design tokens: `readOnly: true` (visible, not editable) or `hidden` for
  pure build config. The client reorders nothing that would break the composition.
- **Validation on every editable field.** `Rule.required()`, `.max(n)` on every headline /
  label so copy cannot overflow the design (a hero that fits 6 words rejects 20), `.min/.max`
  on arrays so a 3-up card row stays 2-4, never 1 or 9.
- **No raw rich text where prose is not wanted.** Headlines and labels are `string`, not
  Portable Text. Where rich text IS allowed, a TRIMMED Portable Text: only the marks/styles
  the design supports (no H1, no arbitrary block, decorators limited to bold/italic/link).
- **Images are `image` with `options: { hotspot: true }`** so a swapped photo crops to the
  art direction, plus a required `alt`. Preset choices (a tone, an icon, a layout flavour)
  are `string` with a fixed `options.list` dropdown, never a free text field.
- **A guard-railed `Content editor` role** (Sanity role): publish + edit document content,
  but NOT create/delete documents or change types. So the client edits the site, never
  restructures it.

Done-gate: a client can edit copy and swap an image but cannot delete a section, break the
grid, or insert an H1. Keep `src/sanity/schema/` field names in lockstep with `content.ts`.

## Editability 2: seed Sanity at handoff, kill the TS fallback (W13)

At handoff, SEED the Sanity dataset from `src/lib/content.ts` (a `scripts/seed.ts` run via
`provision-sanity.sh`), so the CLIENT owns the live copy and edits it in Studio. `content.ts`
then survives ONLY as the build-time default and the CMS-outage fallback in `loadPage`, never
as the thing a client must email a developer to change. Without the seed, "editable" is a lie:
the real copy lives in a TypeScript file the client cannot touch. Done-gate: a client changes a
headline in Studio and it ships, with no builder involvement. Depends on W12 (the locked schema
the seed populates).

## Editability 3: visual editing on by default + image wiring (W14)

Where a build HAS a CMS, make Sanity Presentation the DEFAULT for its preview deployment
(`PUBLIC_SANITY_VISUAL_EDITING_ENABLED=true` on preview), not an opt-in, so the client always
gets click-to-edit. AND wire `data-sanity` stega to IMAGES and non-text elements, not only
text: every image, CTA and swappable block carries its field reference (`stega` /
`createDataAttribute`) so a click reaches the field. Done-gate: a client can click any text OR
image on the preview and reach its field. Depends on W12, W13.

## Editability 4: teach the handoff (W15)

Generate a CLIENT-SPECIFIC editor guide at handoff (not a generic Sanity manual): the 5-8
things THIS client will actually edit (their hero line, their hours, their photos), each with
the exact Studio path, plus a 60-second tour, the pre-set Content-editor login, and ONE
deliberate first-edit step ("change your hero subhead and Publish") so they succeed once before
they are alone. Lives in the handover (`references/handover-format.md`). Done-gate (the
editability metric): a non-dev who has never used Sanity changes a headline, swaps a hero image,
and publishes, unaided, in under 10 minutes, layout intact. Depends on W12-W14. Behavioural;
confirm with a real non-dev test.

## Build-time vs runtime environment (a Cloudflare gotcha)

`@sanity/astro` resolves its config **at build time** - so these must be set in
the **CI build environment** (and in local `.env`):

- `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_READ_TOKEN`,
  `PUBLIC_SANITY_VISUAL_EDITING_ENABLED`

These are **runtime Worker secrets** (`wrangler secret put`), read per request
via `locals.runtime.env` - they are NOT needed at build:

- `SANITY_API_WRITE_TOKEN` (the `/api/contact` handler), `RESEND_API_KEY`,
  `TURNSTILE_SECRET`

Getting this split wrong is the most likely source of a confusing failure.

## Versions (pinned, known-good - update deliberately, together)

**The adapter major is pinned to the Astro major, and getting it wrong is the
recurring trap here.** A field build once broke on `@astrojs/cloudflare@12`
(it targets Astro 5) when the project was on Astro 6, which needs the 13.x
line. The same jump happened again at Astro 7: `@astrojs/vercel@10` and
`@astrojs/cloudflare@13` both peer `astro@^6` and must move to 11.x / 14.x.
Move these as a matched set:

- `astro` 7.2.0   ·   `@astrojs/vercel` 11.0.5   ·   `@astrojs/cloudflare` 14.2.0
  (needs `wrangler` ^4.83)   ·   `@astrojs/sitemap` ^3.7
- `@astrojs/react` 6.0.2   ·   `react` / `react-dom` ^19.2.2
- `sanity` ^6.9   ·   `@sanity/vision` ^6.9 (lockstep: vision peers `sanity ^6`)
  ·   `@sanity/client` ^7.26   ·   `@sanity/image-url` ^2.1   ·   `@sanity/astro` ^3.5

Studio v6 drops Node 20, removes the deprecated `auth.mode` and
`enableLegacySearch` config, enables React strict mode, and runs on **Vite 8** -
the same major Astro 7 uses, which is why the two upgrades belong together.
`@sanity/image-url` v2 deprecated its DEFAULT export: use the named
`createImageUrlBuilder`. Sanity 6 also peers `react` ^19.2.2 /
`styled-components` ^6.1.19, and those pins live in the BASE scaffold (the CMS
overlay cannot raise them), so they move with the Sanity major.

Astro 7 also moves to **Vite 8**, so any `overrides.vite` pin in package.json
must be `^8`: an inherited `^7` override silently fights the framework.
- `@sanity/astro` ^3.4   ·   `@sanity/client` ^7   ·   `sanity` ^5   ·
  `@sanity/vision` ^5   ·   `@sanity/image-url` ^1
- `@portabletext/to-html` ^5 (rich text)
- `astro-pagefind` ^2 + `pagefind` ^1.5 (search)
- `tailwindcss` ^4 + `@tailwindcss/vite` ^4   ·   `wrangler` ^4   ·   `tsx` ^4

## CMS-driven collections (blogs, job boards)

A blog or a job board is one pattern: the `collectionItem` type
(`src/sanity/schema/collection.ts`) + an index page + a `[slug].astro` detail
page (`src/pages/blog/`). Adding "a blog" or "open roles" is renaming this
pattern (e.g. `jobListing` + `/jobs`), not inventing one.

## SSR gotchas (pre-solved in the template)

- **No-op session driver.** If the deploy asks for a KV namespace for Astro
  sessions, the site does not use sessions - add a no-op session config rather
  than provisioning KV.
- **`wrangler.toml`**: do not set `main` - the Cloudflare adapter injects the
  worker entry. Just `[assets] directory = "./dist"` + `nodejs_compat`.
- **`devToolbar: { enabled: false }`** so the toolbar never appears in
  screenshots or the client preview.

## Helper scripts (shipped, run via tsx)

- `scripts/seed-content.mjs` - seeds the dataset from `content.ts`.
- `scripts/seed-collection.mjs` - seeds one example collection item.
- `scripts/publish-all.mjs` - publishes every pending draft in one command.

They use `@sanity/client` directly with the write token and read `SANITY_*`
from `.env`.
