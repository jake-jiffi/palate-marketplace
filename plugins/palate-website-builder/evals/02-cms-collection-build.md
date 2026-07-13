# Eval 02 - full production build with a CMS collection

## Brief (give this to the skill verbatim)

> Build and launch a recruitment site for Harbour Talent. It needs an
> open-roles job board the team can update themselves. Domain is
> harbourtalent.com.au - take it all the way to production.

## Expected stage

Production. Phases 0 + A, then B-F. Real infrastructure is provisioned.

## Checklist (every box must tick)

- [ ] A plan checkpoint was shown before scaffolding, AND a separate
      provisioning checkpoint before Phase B (what infra, what it commits).
- [ ] The job board uses the shipped `collectionItem` schema + the
      `src/pages/blog/` page pattern, renamed to suit (e.g. `/jobs`) - not a
      bespoke one-off content type.
- [ ] Sanity is wired via `@sanity/astro`; the Studio is embedded at `/studio`
      (no separate Studio deploy).
- [ ] The dataset is seeded from `content.ts` (`npm run seed`).
- [ ] Provisioning is idempotent - re-running an interrupted phase does not
      create a second Sanity project, repo, or worker (see
      `references/idempotency.md`).
- [ ] Connective tissue is present: sitemap, `robots.txt`, `llms.txt`,
      `public/_headers`, Pagefind in the build, a favicon, a default OG image.
- [ ] `verify-sanity.sh`, `verify-cloudflare.sh`, `verify-github.sh` all pass;
      no phase advanced on a failed gate.
- [ ] Build-time vars vs runtime Worker secrets are split correctly (see
      `references/cms-and-draft-preview.md`) - the build is not missing
      `SANITY_*` at `astro build` time.
- [ ] A `handover.md` is produced, listing the live site, the `/studio` URL,
      the repo, and any required user actions.

## Regression signals

A bespoke job-content type, a non-idempotent provisioning run, missing
connective tissue, or a phase marked complete on a failed verify.
