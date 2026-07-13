# Eval 03 - Webflow migration with SEO preservation

## Brief (give this to the skill verbatim)

> Migrate our site from Webflow to our own stack. It's at
> meridianadvisory.webflow.io - about 30 pages plus a blog. Keep all the SEO,
> we can't afford to lose rankings.

## Expected behaviour

A migration: audit the existing site, rebuild it, preserve every URL and meta
signal. See `references/webflow-migration.md`.

## Checklist (every box must tick)

- [ ] The existing site's URLs and meta (title, description, canonical, OG)
      were crawled / inventoried FIRST, as the SEO baseline.
- [ ] Pages were rebuilt as real Astro components - the Webflow code export was
      NOT used as the deliverable.
- [ ] The blog became the `collectionItem` pattern, not a bespoke type.
- [ ] A plan checkpoint was shown before scaffolding, and a provisioning
      checkpoint before anything went live.
- [ ] 301 redirects map every old URL to its new path; tested against the
      baseline crawl.
- [ ] Canonical URLs and meta match the baseline where they should be preserved.
- [ ] Sanity wired via `@sanity/astro`; SSR; connective tissue all present.
- [ ] Every `verify-*.sh` gate passes before launch.
- [ ] The handover flags the DNS cutover as the careful, last step - not done
      silently.

## Regression signals

Webflow's nested-div code export shipped as-is, a missing redirect map, meta
drift from the baseline, or a DNS cutover performed without a checkpoint.
