# Composition and attention

The lens the build must point at every section before it calls itself done: does the
most important thing sit where attention lands, and is each section composed with
intent? This is the gap that let an obviously unbalanced hero (Arc Medical, 2026-06-22)
pass every gate: the headline parked in the bottom-left fallow zone, the signature arc
stranded top-right and divorced from it, the proof stats orphaned. A plain review named
all of it on the first look. No gate was built to look.

The rubric until now judged Hierarchy as "the most important thing lands first; nothing
competes" (`visual-rubric.md`). That measures weight COMPETITION, not PLACEMENT: the
headline was the heaviest element and nothing fought it, so it scored well while sitting
in the worst zone on the page. This reference adds the missing axis.

## The one rule that governs everything here

This is a FLOOR against BROKEN composition, never a prescription for "correct" placement.

Palate exists to produce bold, distinctive, often deliberately asymmetric composition. A
naive "the headline belongs top-left / centre" rule would fail the very off-centre,
tension-filled heroes the skill is meant to make, and herd every build back to the
generic centred stack, which is the exact slop we fight. So the gate fires only on a
composition that is BROKEN, not merely unconventional:

- the eye is led AWAY from the primary action, not toward it;
- the single most important element sits in the genuinely dead zone with nothing
  recovering it;
- elements that share one meaning are divorced into separate rooms;
- a key element is marooned from its group.

An asymmetric hero where the eye still resolves to the CTA PASSES. The Arc hero failed
not because it was off-centre but because three faults compounded: the focal element was
stranded in the dead bottom-left fallow, AND the arc led the eye away from the CTA, AND
the stats were orphaned. Fire on the confluence, pass the bold-but-resolved.

(Same discipline as the drift metric: it punishes drift, not richness. Here we punish
broken composition, not boldness.)

## The attention models (the grounding, not vibes)

- **Reading gravity / the Gutenberg diagram.** For text-heavy, left-to-right layouts the
  eye enters at the **primary optical area (top-left)**, sweeps to the **terminal area
  (bottom-right)** along a reading-gravity diagonal, and tends to SKIP the **strong fallow
  (top-right)** and especially the **weak fallow (bottom-left)**. The weak fallow is the
  worst place for the single most important element. (Applies most to copy-led layouts;
  a strong image or motion anchor can redraw the path, which is why this is a floor, not
  a grid to obey.)
- **F / Z / layer-cake scan paths (NN/g eye-tracking).** Readers scan text-dense pages in
  an F, simple pages in a Z, and sectioned pages as a "layer cake" (headings + bands).
  Attention is heaviest at the top and down the left. A focal element outside the scan
  path is rarely seen.
- **Bottom-up saliency (Itti and Koch).** Before meaning, the eye is pulled to regions of
  high local CONTRAST (luminance, colour, orientation). The heaviest-contrast blob is
  where the eye goes first, whether or not it is the thing that matters. If the heaviest
  blob is not the focal element, the composition is fighting the content. This is what the
  "squint test" approximates: blur the frame and see where the weight lands.

## The five criteria (per section, graded as a floor)

1. **Focal placement.** Identify the one most important element (the headline, the primary
   CTA, or the signature move). Is it in a usable attention zone, or stranded in the dead
   weak-fallow (bottom-left)? Stranded-in-fallow is a fault; merely off-centre is not.
2. **Eye path.** Does the reading order and any leading line carry the eye TOWARD the
   primary action, or away from it? (The Arc arc led the eye to the empty top-right, away
   from the CTA.)
3. **Balance and voids.** Are there dead quadrants holding nothing while weight piles into
   one corner? A bottom-heavy diagonal with two empty corners is a fault, not a style.
4. **Integration.** Do elements that share a meaning sit together? The headline and its
   signature arc were "the same idea living in separate rooms."
5. **Orphans.** Is any element marooned from its group (the proof stats pinned to the
   floor, divorced from the CTAs)?

## How it is measured: two layers

**Layer A, the computed squint (deterministic, the floor that bites).** `measure-composition.mjs`
reads each section's screenshot, downscales-and-blurs it (the squint), and builds a
visual-weight grid where a cell's weight is how far its blurred luminance deviates from
the section mean (deviation approximates Itti-Koch contrast salience). From that grid plus
the section's focal-element box (captured by `screenshot-build.mjs`) it computes, with no
LLM verdict:

- **focal-in-fallow**: the focal element's centre sits in the bottom-left weak-fallow.
- **weight-misaligned**: the visual-weight centroid is far from the focal element (the
  heaviest blob is not the thing that matters).
- **dead-corners / split-weight**: two or more quadrants are near-empty while weight piles
  into others (the bottom-heavy diagonal).

These are reproducible and would have caught the Arc hero on its hero clip alone.

**Layer B, the donor-grounded VLM read (interpretive nuance).** The visual rubric's
composition criterion judges eye-path, integration and orphans per section, with the
donor's matching page screenshot alongside (`refs_get_screenshot { slug, page }`, page
granularity) so the question is grounded: "does my focal placement and headline-to-
signature-move integration hold up against the donor", not judged blind.

## Severity (so a stranded hero cannot pass under "no Critical or High")

Composition faults are first-class findings:

- **High**: the single most important element of the page (the hero focal) sits in the
  weak fallow; OR the primary signature move is divorced from the headline; OR a key
  element is orphaned from its group.
- **Medium**: a non-hero section's focal is weakly placed; mild imbalance / a dead quadrant
  on a secondary band.

A High composition finding blocks `gate-done` exactly like any other High.

## Worked example: the Arc Medical hero

Run against the hero section clip, every criterion fires:

- Focal placement: headline centre in the bottom-left fallow -> **focal-in-fallow (High)**.
- Eye path: the arc leads up-and-right to the empty top-right, away from the CTA.
- Balance: weight piles bottom-left + a thin anchor top-right; top-left and bottom-right
  are dead -> **dead-corners**.
- Integration: the arc (the signature move) and the headline are divorced -> **High**.
- Orphans: the proof stats pinned to the floor, away from the CTAs -> **High**.

The squint alone (Layer A) shows the weight in the wrong corner and the focal in the
fallow. That is the same five-point read a designer gives in the first two seconds, run
by default instead of on request.

## What this is NOT

- Not a demand for symmetry or centring. Off-centre, asymmetric, tension-filled is good.
- Not a whole-page-only check: it runs per section, on the clips the driver already emits.
- Not a substitute for the Variety / Philosophy axes: a perfectly balanced page can still
  be boring. Read composition WITH them, never instead of them.
