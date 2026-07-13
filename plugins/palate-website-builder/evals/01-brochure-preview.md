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
- [ ] `astro.config.mjs` has `output: "server"` and the `@sanity/astro`
      integration - the CMS is wired from the first file, not stripped.
- [ ] `src/lib/content.ts` is filled with real Northwind Joinery copy; no
      `{{PLACEHOLDER}}` tokens remain anywhere in the project.
- [ ] Pages render from `loadPage()` against the `content.ts` fallback - the
      preview runs with NO Sanity account.
- [ ] The brand is applied via a brand package or vendored tokens through
      `BaseLayout` + the Tailwind preset - not ad-hoc inline styles per page.
- [ ] A working preview URL was handed over (via `serve-preview.sh`); the user
      was NOT told to run `npm run dev` themselves.
- [ ] The hand-back states this is the real production codebase and that
      "make it production-ready" continues it - no rebuild.

## Regression signals

Loose `.html` output, placeholders left in, a static (non-SSR) config, or a
preview that needed a Sanity account all indicate a regression.
