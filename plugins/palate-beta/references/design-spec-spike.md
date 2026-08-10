# SPIKE: a durable DESIGN.md as the build's design source of truth

Status: GRADUATE (LEAN) - decided 2026-06-30 (source-triage review). NOT yet wired into the
live gate; this records the decision + the bounded scope for the build.

DECISION: graduate the LEAN version - a durable per-page DESIGN.md modelled on MOTION_BUDGET.md
(a small local artefact that travels with the code, NOT a whole-system context dump) PLUS
graduating `measure-drift.mjs` from report-only to a COMPUTED consistency floor (a gate),
fail-open + intensity-scoped per the house discipline. Do NOT adopt the Google-labs
whole-system DESIGN.md form: Atlassian's own test (verified 2026-06-30) shows a whole-system
dump costs ~92% more tokens and ~35% longer than an MCP that fetches on demand, and Palate IS
that MCP, so the dump is the wrong shape. The lean per-page artefact is a different thing (a
build-output constraint spec, not a context load) and closes the real gap the source-triage
review confirmed is still open: there is a durable MOTION_BUDGET.md but no design equivalent,
and W19 cross-page consistency is interpretive (VLM), multi-page-only, and single-page-skipped,
not a computed floor. Build it as a focused follow-up (bead below); keep it fail-open so a calm
single-page build is never blocked.

## The gap this tests

A build's design decisions live in two places the section-build recipe does not
read as one spec:

- the brand package (the locked tokens), and
- `manifest.commission` (concept, vision, chosen mechanisms), a nullable,
  fail-open block buried in `build-manifest.json` telemetry.

There is no project-root, human-readable spec of the per-page VISUAL constraints,
and no COMPUTED consistency measure (`gate-uniqueness.mjs` measures the inverse,
near-duplication across Explore variants; the Philosophy axis is an interpretive
VLM read). The failure this targets is already named in the corpus: anti-patterns.md
"inconsistent visual language across sections" (the scale, spacing unit, radius,
border weight, accent usage shifting band to band because the page was generated
piecemeal and never reconciled).

Note this is NOT "there is no consistency check": interpretive doctrine exists
(anti-patterns.md + `audit-dimensions.md` dims 1, 2, 8). What is missing is a
durable written spec and a computed number.

## The intervention (the durable artefact)

A project-root `DESIGN.md`, modelled on the existing `MOTION_BUDGET.md` pattern (a
spec that ships with the code so the rule travels with it). At Compose, AFTER
divergence (so it never narrows Explore), promote the commission's design decisions
into a written constraint set the section-build recipe re-reads before each section:

```md
# Design constraints (this build)

- **Type scale**: the locked steps in px (e.g. 14 / 18 / 24 / 40 / 64), and which
  level each role uses. No size off this scale.
- **Spacing unit**: the base rhythm (e.g. 8px) and the section padding (e.g. 96px
  desktop / 56 mobile). Every band uses it.
- **Radius**: the one (or two) corner radii. No third.
- **Border weight**: the one hairline / weight. No mix.
- **Accent placement**: the single accent and WHERE it is allowed (CTAs, links,
  one highlight), and where it is NOT (not every card edge).
- **Density**: the rule for how much breathes vs how much packs.
- **Do / Don't for THIS site**: the 3-5 lines that keep section N looking like
  section 1.
```

This must ADD the explicit per-page constraint set (the list above), not restate
the commission's concept/vision or the brand tokens, or it is just a rename. It must
preserve commission's fail-open contract: its absence never blocks a build.

## The measurement (the FLOOR, not a maximand)

`scripts/reference-capture/measure-drift.mjs` (built for this spike) loads a built
page and scores drift by CROSS-SECTION RECURRENCE, not raw distinct count:

```
node scripts/reference-capture/measure-drift.mjs --url http://localhost:PORT
```

A value (a type size, radius, border weight, accent colour) that recurs across
>=2 sections is "the system"; one used in a single section is "local" - exactly
the "shifts band to band" the anti-pattern names. `driftScore` counts the LOCAL
values (+ section-rhythm variance), so a RICH-but-coherent page (one system
reused, plus a hero flourish) scores low, while a piecemeal page with the SAME
distinct count but nothing shared scores high. REPORT-ONLY; `aggregate()` is pure
and unit-tested (`measure-drift.test.mjs`, run `node --test`).

Why recurrence, not distinct count: the first cut counted raw distinct values and,
measured against the 8 real demo builds, it conflated RICHNESS with drift (a bold
demo scored 18-24, indistinguishable from genuine slop). A probe showed the noise:
incidental element sizes inherited by containers, and warm-grey browns + single-use
gradient stops counted as "accents". The recurrence model + a ~16% chroma cut on
accents fixed it: the same 4 demos re-scored 6.3-13.1, re-ranked correctly, and the
signal became diagnostic (e.g. aught/kern carry type drift, 8-9 section-unique sizes,
but disciplined palettes; zoop carries palette drift, 6 section-local accents).

CRITICAL: low drift is still necessary-but-NOT-sufficient. A single section, a
trivially-uniform page, or a page of generic defaults all score ~0, consistent yet
possibly slop. So drift is a FLOOR read ALONGSIDE the Variety / Philosophy axes,
never a target to minimise; minimising it alone manufactures the sameness Palate
fights. Known limit: measured at a fixed 1440px viewport, so fluid clamp() type
resolves to one value per role (no fluid inflation here), but a per-route hero can
still read as a small, legitimate "local".

## The A/B (run before graduating)

1. Pick 3-5 matched briefs. Build each TWICE: once with the DESIGN.md write+read
   step, once without (the commission + brand-tokens baseline).
2. Score both: `measure-drift.mjs` driftScore, the visual-rubric Philosophy axis
   (consistent visual language across sections), and the Variety axis.
3. WIN = lower drift AND higher Philosophy with NO loss on Variety.

## Kill criteria (any one => drop it; the commission stays)

- No measurable Philosophy or drift gain over the commission+brand baseline.
- The Variety axis drops (it is manufacturing sameness).
- It just restates the commission + brand tokens with no new constraint delta.

Timebox to a handful of builds. Roll back = delete the write step (and, if desired,
`measure-drift.mjs`); nothing in the live build flow depends on either today.

## Dependencies

Soft dependency on the WebGL-capture fix (sec-gj4.7) for fairly scoring WebGL-hero
builds (you cannot judge consistency on a hero QA renders blank). The A/B can start
on DOM / CSS builds immediately.
