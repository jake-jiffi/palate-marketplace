# Build stages: preview and production

A website build runs in one of two stages, recorded as `stage` in
`.palate-skill-state.json`. The SAME codebase carries from one to the other.
This is the heart of building things right: the preview IS the production
codebase, just not provisioned.

## The architecture is fixed: SSR + Sanity, from line one

Every build is a **server-rendered Astro site on Cloudflare Workers, wired to
Sanity from the very first file**, with a local fallback-content layer. Not
optional, not deferred:

- **SSR, not static.** The site renders on demand at Cloudflare's edge. This is
  what makes draft preview possible - a static site structurally cannot show
  unpublished content. (Exception: an explicit `--static` flag for a true
  brochure site with no CMS and no draft preview. Rare. Confirm it is genuinely
  wanted before using it.)
- **Sanity-wired from the start.** Every page reads its content through the
  Sanity data layer. It does not matter that no Sanity project exists yet during
  preview - see the fallback layer below.
- **NEVER strip Sanity to "do it later."** Removing the CMS wiring to ship a
  faster static preview forces a full re-architecture at production time. If the
  person says "Sanity later", that means *provision the Sanity project later* -
  the wiring stays in from day one. This is a non-negotiable build-contract item.

## The fallback-content layer (why preview needs no Sanity project)

The template ships `src/lib/content.ts` - a typed object holding the real copy
for every page. Every page calls `loadPage(query, fallback, draft)`: it tries
Sanity, and if Sanity is not configured / empty / unreachable it returns the
fallback. So:

- **Preview** runs entirely on `content.ts`. The site is complete and real, no
  Sanity account touched, no provisioning. Claude writes the actual page copy
  into `content.ts`.
- **Production** provisions a Sanity project and SEEDS it from that same
  `content.ts` (the seed script reads it). Nothing is rewritten. The CMS becomes
  the live source; the fallback stays as a safety net so a CMS outage cannot
  break the site.

This mechanism is what makes "the preview is the production codebase" true in
practice, not just in principle.

## Preview stage (default)

Triggered by: "redesign Luke's site", "make it look good", "let me see it
first", "rebuild this site" with no mention of going live, or `--stage=preview`.

Runs: Phase 0 (brand) + Phase A (scaffold the real SSR + Sanity-wired Astro
project, apply brand, write every page reading from the data layer, fill
`content.ts`) + the `verify-is-real-astro.sh` gate. Then STOPS.

Deliverable: a **shareable Vercel preview deployment**. Claude runs
`deploy-preview.sh` and hands over the `SHAREABLE_URL` - a live `*.vercel.app`
link the client can open and comment on via the Vercel Toolbar. With
`--local-preview` it instead starts the dev server (`serve-preview.sh`) and
hands over a local URL. Either way it is the production codebase minus
provisioning.

Does NOT: create any Sanity project, custom domain, GitHub repo, or PRODUCTION
deploy. A preview deployment is throwaway and runs on the `content.ts` fallback
(no Sanity account touched). The SSR adapter, the Sanity data layer, the
draft-mode endpoints and the visual-editing channel are ALL already in the code.

## Production stage

Triggered by: "make it production-ready", "take it live", "ship it", "deploy
it", or `--stage=production` from the start.

Promoting an existing preview: run `scripts/promote-to-production.sh`. It re-runs
`verify-is-real-astro.sh` AND the production preflight (`scripts/preflight.sh`,
matched to the chosen host) before it flips `stage`. The preview was built with
the preview preflight only (no cloud creds), so promotion is the first point the
production credentials are actually needed: re-running the production preflight
here means a missing credential fails loudly and early with its remediation,
instead of dying mid-provision inside `provision-sanity.sh`. Then continue Phases
B-F on the SAME project.

Runs on top of preview: Phase B Sanity (provision project + dataset + tokens,
**seed from `content.ts`**; the Studio is embedded at /studio and ships with
the site), C Cloudflare (deploy the SSR worker), D GitHub (repo + CI), E
domain, F optional. Each verified.

Production runs hands-off: in Cowork, Claude drives the user's own Terminal
(`gh`, `wrangler`, `sanity`, `npm`) - see `references/production-handoff.md`.
The user only creates accounts and approves credential prompts.

## The promotion path (no rebuild, ever)

Promotion adds the CMS *project*, the forms backend, hosting, repo and CI
*around* code that already expects all of them. It never regenerates the site.
If you find yourself rebuilding during promotion - converting static to SSR,
adding Sanity wiring, re-doing pages - something earlier was wrong: the preview
was not built to this contract.

## What this fixes

The two failure modes seen in real use: (1) a "redesign" producing loose static
HTML that is a dead end, and (2) a preview built without the CMS, forcing a
static-to-SSR re-architecture the moment the client wants draft preview. With
this contract, the first thing built is the real, final thing.
