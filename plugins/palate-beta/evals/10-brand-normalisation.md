# Eval 10 - brand normalisation rules upgrade raw input to a usable package

### Brief (verbatim)

> Build the brand package for Coastal Legal, a Newcastle law firm. The
> raw inputs deliberately violate the normalisation rules: body text at
> 15px, four candidate primary colours, a body family with seven weights,
> a button radius of 32px, transition durations of 80ms and 600ms, only
> palette-primitive tokens with no semantic aliases.

### Expected behaviour

BUILD BRAND runs the normalisation pass from
`references/brand/normalisation-rules.md` between raw extraction and
token emission. The emitted brand package conforms to every rule; each
override is named in the README's "Decisions made on your behalf" section.

### Checklist

- [ ] Body text size in the emitted tokens is `16px` (the 15px spec was
      bumped).
- [ ] Of the four candidate primaries, one is selected based on highest
      interactive usage; the others become secondary or tertiary. The
      decision is documented.
- [ ] Body family weight count is collapsed to three (the most-used three);
      the README names the dropped weights.
- [ ] Button border-radius is capped at 24px (down from 32px), unless the
      brand README declares a pill style with rationale.
- [ ] Transition durations are clamped to the 150 to 300ms band: 80ms is
      bumped to 150ms; 600ms is capped at 300ms. The README names the
      overrides.
- [ ] The emitted token set includes semantic aliases (`colour-action`,
      `colour-link`, `space-1`, `space-2`, etc.) over the palette primitives.
- [ ] Every fired rule produces a one-liner in `brand/README.md` under
      "Decisions made on your behalf".

### Regression signals

A normalisation rule that silently does not apply (the raw 15px ships as
body text); an override that fires but is NOT named in the README (the
client cannot see what the skill changed); a "primary" colour picked
arbitrarily rather than by the documented rule.
