# Brand normalisation rules - raw extraction to a usable brand package

When BUILD BRAND ingests raw client assets (or a capture from an existing
site), the extracted values are noisy: a body text size of 14.6px, three
candidate primaries, an off-by-one font weight. These rules normalise the
extraction into a usable brand package before tokens are emitted. They are
applied between the raw extraction stage and the token-emission stage.

The pattern is adapted from the dembrandt-skills `generate-ui-from-brand`
SKILL.md Step 2.

## Type

- **Body font size < 16px on mobile -> bump to 16px.** Floor from
  `perceptual-floors.md`; iOS zoom-prevent + WCAG SC 1.4.4. Note the
  override in the brand README so the client knows the original spec was
  lifted.
- **Body line-height < 1.5 -> bump to 1.5.** Same floor reference.
- **Body line-height > 1.7 -> cap at 1.7.** Past 1.7, lines become disjoint.
- **More than three weights in the body family -> drop to the three with
  highest usage in the captured set.** Loading five weights bloats the
  page; rarely-used weights signal accidents.
- **Display + body in the SAME font family -> note in the brand README and
  ask the client if a contrast was intended.** Often a capture artefact
  (the original brand had two; only one was loaded on the captured site).
- **Body type scale outside the 1.125 / 1.2 / 1.25 / 1.333 / 1.414 / 1.5 set
  -> snap to the closest.** Eyeballed type scales drift; snapping makes the
  scale legible and consistent.

## Colour

- **More than two brand colours competing for "primary" -> pick the one with
  the highest interactive usage** (primary buttons, links, accent bars) per
  the capture engine's confidence model. The others become secondary or
  tertiary, not co-primary.
- **A "neutral" with chroma > 5 (in HCL) -> flag as a tinted neutral, not a
  true neutral.** Document the tint in the brand README. Some brands do
  this intentionally; the package should make it explicit.
- **Contrast pair (text on background) below 4.5:1 -> reject the pair and
  pick the next-closest variant that meets it.** Note the override.
- **Palette without a documented dark-mode treatment -> mark dark mode as
  "not supported" in the brand README** rather than auto-generating a dark
  palette by inversion. Inverted palettes look wrong.

## Spacing

- **Captured spacing values clustered around 8 / 12 / 16 / 24 / 32 / 48 /
  64 / 80 -> snap to that scale.** Drop free-floats.
- **Captured spacing in odd values (7, 11, 15) -> round to the nearest
  scale step.** Note the round in the brand README.

## Radius

- **More than two unique border-radius values in the captured set ->
  collapse to two (a "small" for controls and a "large" for cards).**
  Often the captured values are accidents.
- **Radius > 24px on a button -> cap at 24px unless the brand has a
  documented pill style.** Past 24px buttons look pill-shaped by accident.

## Motion

- **Captured transition duration < 100ms -> bump to 150ms.** Below 100ms,
  motion is missed and feels broken.
- **Captured transition duration > 400ms -> cap at 300ms.** Past 400ms,
  motion feels sluggish; the brand can override but should not default to
  sluggish.
- **Easing curves freelanced per element -> normalise to a documented set
  (a default, an enter, an exit).** Two or three named eases beats a
  zoo.

## Semantic naming

- **Tokens emitted with palette-primitive names only (e.g. `colour-blue-500`)
  -> add semantic aliases (`colour-action`, `colour-link`, `colour-success`,
  `colour-border-subtle`).** The brand package consumes the semantic
  aliases; palette primitives are an implementation detail behind them.
- **Spacing tokens emitted as pixel values only -> add scale-step aliases
  (`space-1`, `space-2`, ...).** Marketing sites use the aliases; the px
  values are an implementation detail.

## What this does NOT do

- It does not invent values. If the raw extraction is missing a token, the
  package emits the gap (and the BUILD BRAND output lists it as a Known
  Gap). The skill never silently guesses.
- It does not override a client-explicit value. If the brief says "body at
  15px on purpose because we have huge type", the rule does not apply.
  Document the deviation in the brand README.

## How it integrates with BUILD BRAND

Phase: between "extract raw tokens" and "emit brand package".

```
raw assets -> capture engine -> tokens.raw.json
                                       |
                                       v
                          normalisation-rules.md (this file)
                                       |
                                       v
                              tokens.json (final) -> brand package emit
```

Every rule that fires produces a one-liner in `brand/README.md`'s "Decisions
made on your behalf" section, so the client sees what the skill changed and
why.

## Eval

`evals/10-brand-normalisation.md` feeds an input brand that violates each
rule and asserts the normalised brand package conforms. Add a new test to
that eval for each new rule you add here.
