# Eval 04 - the Explore stage by default

## Brief (give this to the skill verbatim)

> Build a website for Lighthouse Optometry, an independent eye-care clinic in
> Newcastle. They want a strong, modern look but I'm not sure of the exact
> direction yet - show me options first.

## Expected behaviour

The brief is a new site with no direction named, so Explore runs by default.
The build runs Phase 0 (Brand) + Phase A.1 (Scaffold) + A.2 (Explore), then
PAUSES for the client to pick sections. A.3 (Compose) and A.4 (Finalise)
happen after the pick + a confirm pause. PREVIEW stops there.

## Checklist (every box must tick)

- [ ] A plan checkpoint was shown BEFORE Explore: brief, brand source,
      references, host, stage, AND explicit "Explore is ON, ~8-10 variants"
      with a "Proceed?" - the skill did not silently start generating.
- [ ] After the go-ahead, the project was scaffolded from
      `templates/astro-project/`; `verify-is-real-astro.sh` would pass on
      the bare scaffold.
- [ ] `PUBLIC_EXPLORE_MODE` is set to `true`.
- [ ] 8-10 variants exist as `src/pages/v1.astro`..`/vN.astro` - each a real
      `.astro` page that imports `BaseLayout`, uses `loadPage()`, and wraps
      every section with `<SectionMark id="vN-..."/>`.
- [ ] `src/lib/variants.ts` lists every generated variant - the switcher
      reads it, so the count on the page matches.
- [ ] The variants are genuinely different - **no two share the same hero
      pattern, the same section sequence, or the same density level**. They
      span the concept-ambition spectrum: roughly 3 safe-warm, roughly 3 bold,
      and roughly 2 one-of-a-kind, and **every one is MCP-grounded** (the
      "invented" end means a surprising mechanic, not an approach untied to any
      reference).
- [ ] EVERY variant names a real donor slug studied via the MCP. The bold and
      one-of-a-kind variants fetched an inner-page screenshot
      (`refs_get_screenshot { slug, page }`). The spine donor (the one
      supplying the hero) was read via `refs_get { layer:"signature_moves" }`
      AND `refs_get { layer:"do_dont" }` (bonus: `format:"design"` for the
      DESIGN.md). Each variant's Design Read names a located signatureMove, and
      the donor search used a lexical/category anchor relevant to the brief
      (an exact font, move, or vertical), not a vague keyword.
- [ ] Token variation is real - type scale, density, accent treatment differ
      between variants within the brand's permitted range. They do not invent
      off-brand colours.
- [ ] If the brief implies a landing page, 1-3 `/lp1`..`/lpN` exist too;
      otherwise none.
- [ ] The skill PAUSED and asked which sections to combine before doing
      anything else; it did NOT compose on its own assumption.
- [ ] After the pick ("e.g. v3 hero + v7 features + v5 cta"), `Compose` built
      `src/pages/index.astro` from those sections, without `SectionMark`
      wrappers, using the canonical `loadPage()` pattern.
- [ ] Design tokens of the dominant variant (the one supplying the hero) were
      adopted as the project's tokens.
- [ ] Variant routes were moved to `_explore-archive/` (or removed);
      `src/lib/variants.ts` arrays are empty; `PUBLIC_EXPLORE_MODE` is now
      `false`; the switcher no longer renders.
- [ ] The skill PAUSED again and asked the client to confirm the composed
      direction before finalising.
- [ ] On confirm, `src/lib/content.ts` got real Lighthouse Optometry copy
      (no `{{PLACEHOLDER}}` left), and `verify-is-real-astro.sh` passes.
- [ ] A working preview URL was handed over - not "run `npm run dev` yourself".

## Regression signals

A build that jumped straight to a single canonical page without Explore, a
variant set that all feel the same, missing `SectionMark` wrappers, a
canonical `index.astro` still carrying `SectionMark` after Compose, or no
pause between Explore and the deep build.
