# Build stages: preview and production

A website build runs in one of two stages, recorded as `stage` in
`.palate-skill-state.json`. The SAME codebase carries from one to the other.
This is the heart of building things right: the preview IS the production
codebase, just not provisioned.

## The architecture is fixed: SSR from line one, CMS only if needed

Every build is a **server-rendered Astro site** whose content is read through
one seam. Two halves, and only one of them is unconditional:

- **SSR, not static. Not optional, not deferred.** The site renders on demand.
  This is what keeps draft preview possible - a static site structurally cannot
  show unpublished content - and retrofitting SSR onto a static build later IS a
  re-architecture. So `output: "server"` from the first file **even when the
  build has no CMS at all**.
- **NO CMS by default.** Content is authored in `src/lib/content.ts`. The Sanity
  tree is ~850 packages (436 -> 1,291 on a scaffold), and most sites never need
  it. Add one with `scripts/add-sanity.sh <dir>` when the client will edit their
  own copy, or content is collection-shaped and growing.
- **Every page reads through `loadPage()`, never `content.ts` directly.** This
  is the non-negotiable build-contract item, and it is what makes the CMS
  decision reversible: `add-sanity.sh` swaps two no-op seam files and edits no
  page. Import `content.ts` straight into a page and you have signed up to
  rewrite every page the day the client wants to edit their own copy.

The old rule here was "never strip Sanity to do it later", written to prevent a
static-to-SSR rebuild. That rebuild is still prevented, by SSR-always. Carrying
the CMS itself was never what protected against it.

## The content layer

The template ships `src/lib/content.ts` - a typed object holding the real copy
for every page. Every page calls `loadPage(query, params, fallback)`. With no
CMS it returns the fallback; with Sanity added it tries Sanity and falls back if
Sanity is unconfigured, empty or unreachable. So:

- **Preview** runs entirely on `content.ts` either way. The site is complete and
  real, no CMS account touched, no provisioning. Claude writes the actual page
  copy into `content.ts`.
- **Production, no CMS** ships exactly that. A copy change is a code change.
- **Production, CMS added** provisions a Sanity project and SEEDS it from that
  same `content.ts` (the seed script reads it). Nothing is rewritten. The CMS
  becomes the live source; the fallback stays as a safety net so a CMS outage
  cannot break the site.

This mechanism is what makes "the preview is the production codebase" true in
practice, not just in principle.

## Preview stage (default)

Triggered by: "redesign Luke's site", "make it look good", "let me see it
first", "rebuild this site" with no mention of going live, or `--stage=preview`.

Runs: Phase 0 (brand) + Phase A (scaffold the real SSR Astro project, apply
brand, write every page reading through `loadPage()`, fill `content.ts`) + the `verify-is-real-astro.sh` gate. Then STOPS.

Deliverable: a **shareable Vercel preview deployment**. Claude runs
`deploy-preview.sh` and hands over the `SHAREABLE_URL` - a live `*.vercel.app`
link the client can open and comment on via the Vercel Toolbar. With
`--local-preview` it instead starts the dev server (`serve-preview.sh`) and
hands over a local URL. Either way it is the production codebase minus
provisioning.

Does NOT: add a CMS, or create any custom domain, GitHub repo, or PRODUCTION
deploy. A preview deployment is throwaway and runs on `content.ts`. The SSR
adapter and the `loadPage()` seam are already in the code, so promotion adds
provisioning (and a CMS if one is wanted) around it rather than rebuilding it.

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

Runs on top of preview: Phase B Sanity **only if the build needs a CMS**
(`add-sanity.sh` to wire it, then provision project + dataset + tokens,
**seed from `content.ts`**; the Studio is embedded at /studio and ships with
the site), C Cloudflare (deploy the SSR worker), D GitHub (repo + CI), E
domain, F optional. Each verified.

Production runs hands-off: in Cowork, Claude drives the user's own Terminal
(`gh`, `wrangler`, `sanity`, `npm`) - see `references/production-handoff.md`.
The user only creates accounts and approves credential prompts.

## The promotion path (no rebuild, ever)

Promotion adds the CMS *project*, the forms backend, hosting, repo and CI
*around* code that already expects all of them. It never regenerates the site.
If you find yourself rebuilding during promotion - converting static to SSR, or
re-doing pages - something earlier was wrong: the preview
was not built to this contract.

## What this fixes

The two failure modes seen in real use: (1) a "redesign" producing loose static
HTML that is a dead end, and (2) a preview built **static**, forcing a
static-to-SSR re-architecture the moment the client wants draft preview. Note
that (2) is about the RENDERING MODE, not the CMS: a preview with no CMS is the
normal shape and costs nothing later, because SSR is on and every page already
reads through `loadPage()`. With this contract, the first thing built is the
real, final thing.
