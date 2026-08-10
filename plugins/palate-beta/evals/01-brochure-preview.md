# Eval 01 - brochure-site preview

## Brief (give this to the skill verbatim)

> Build a preview of a website for Northwind Joinery, a custom cabinetry
> workshop in Brisbane. Pages: home, about, services, contact. I just want to
> see it first before we commit to anything.

## Expected stage

Preview. The build runs Phase 0 + Phase A and STOPS. No Sanity project,
Cloudflare, GitHub or domain is touched.

## Checklist (every box must tick)

- [ ] A short plan checkpoint was shown before scaffolding (pages, brand source,
      references, stack, stage) and a go-ahead taken.
- [ ] The deliverable is a real Astro project copied from
      `templates/astro-project/` - NOT loose `.html` files.
- [ ] `verify-is-real-astro.sh` passes.
- [ ] `astro.config.mjs` has `output: "server"` - SSR from the first file, even
      though this build has no CMS, so nothing has to be re-architected later.
- [ ] **NO CMS is added.** Four static pages for a joinery workshop is the
      textbook case for skipping it (SKILL.md rule 7): `@sanity/astro` must NOT
      be a dependency, there is no `/studio`, and `astro.cms.mjs` still returns
      `[]`. Adding Sanity here is a regression, not thoroughness.
- [ ] `src/lib/content.ts` is filled with real Northwind Joinery copy; no
      `{{PLACEHOLDER}}` tokens remain anywhere in the project.
- [ ] Pages render through `loadPage()`, never by importing `content.ts`
      directly - that seam is what keeps the CMS decision reversible.
- [ ] The brand is applied via a brand package or vendored tokens through
      `BaseLayout` + the Tailwind preset - not ad-hoc inline styles per page.
- [ ] A working preview URL was handed over (via `serve-preview.sh`); the user
      was NOT told to run `npm run dev` themselves.
- [ ] The hand-back states this is the real production codebase and that
      "make it production-ready" continues it - no rebuild.

## Regression signals

Loose `.html` output, placeholders left in, a static (non-SSR) config, a preview
that needed a Sanity account, a page importing `content.ts` directly instead of
going through `loadPage()`, or a CMS added to a four-page brochure site all
indicate a regression.
