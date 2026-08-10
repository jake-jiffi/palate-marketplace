# Asset sourcing and inference - making it feel real when there is little to work with

A site lives or dies on real content. When a client has a brand package, use it
(`phase-0-brand-detection.md`). When they have little (no website, just a Google
listing and an ordering link, the Big Red Cafe case), the skill goes and finds
the real thing, judges its quality, and fills the gaps honestly. This also feeds
the Story Engine: the pattern of imagery a business uses is evidence of who they
are.

## What to gather (and from where)

- **Logo:** the real mark, wherever it lives, the site, socials, or an ordering
  platform (Bopple, Square, Menulog, Mr Yum). If it is only a raster (PNG/JPEG)
  or baked into a link, recover it and **convert to a clean SVG** (trace or
  redraw) so the build ships a crisp vector, never a blurry bitmap.
- **Photos:** real interior, food, team, work. Google Place photos, socials, the
  existing site. These carry the truth of the place.
- **About / story:** the founder's why and history, from the about page, the
  Google description, socials, press (Broadsheet, local news) and the reviews.
- **Reviews:** the emotional language customers actually use (the Story Engine's
  fuel) and the proof (ratings, counts, named staff).

## The quality bar (reject the bad ones)

Not every real asset is usable. Reject low-resolution, blurry, badly lit or
yellow-cast phone photos, screenshots, watermarked stock, cluttered or off-brand
shots, anything that would cheapen the build. A great placeholder beats a shipped
bad photo. Judge each asset: is it production-ready, yes or no.

## Production-ready vs placeholder (and the pitch)

- If an asset is genuinely good enough, use it.
- If not, run the **imagery mode router** (below) BEFORE reaching for stock. Most slots
  that would default to an Unsplash photo are better served by a PROCEDURAL fill. Use
  Unsplash only for a slot that genuinely needs a PHOTOGRAPH of a real subject the client
  has not supplied, clearly as a placeholder, recorded in a **"content we need"** list in
  the handover ("this is the direction, swap in your real photos of X, Y and Z and it
  sings"). Never present a placeholder as the client's own work.
- Never ship a known-bad real asset just because it is theirs.

## The imagery mode router (real > procedural > generated > Unsplash-last)

Decide the source for EVERY image slot in this priority order. Stock-photo-by-default is
the generic tell Palate sells against, so it is the LAST resort, never the reflex:

1. **Real** - a quality-judged client asset (above). Always first.
2. **Procedural** - generate it in-build, a FIRST-CLASS output, not a fallback: SVG film
   grain / noise, a gradient mesh, a parametric or duotone pattern, a CSS/canvas texture, a
   seeded generative motif, and for a high-intensity hero a p5.js / shader field
   (`references/motion-and-3d.md`). Procedural fills are driven by the brand tokens, so they
   are on-brand, unique per build, zero-licence and near-zero-weight. MOST decorative,
   texture, background and abstract-hero slots should be procedural, not photographic.
3. **Generated** - a depicted scene the brand truly needs that procedural cannot serve (the
   rare case). GATED behind W22 (opt-in + output-clearance + the imagery-originality gate);
   do not reach for it at v1.
4. **Unsplash (LAST)** - only for a slot that genuinely needs a PHOTOGRAPH of a real subject
   (a face, a place, a product, a dish) the client has not supplied. Always a labelled
   placeholder in the content-we-need list, matched to the inferred vibe + palette.

Done-gate: zero AVOIDABLE Unsplash placeholders, a stock photo a procedural fill or a real
asset should have replaced. A decorative blob, texture or abstract hero shipping as an
Unsplash photo is the failure this router exists to prevent.

## Inference - read the story from the assets

When copy is thin, the pattern of available imagery is evidence. A cafe whose
photos are all warm food close-ups, the beach and groups of friends is telling
you it is about warmth, locality and casual ritual, lead the Story Engine there.
A trades business showing finished jobs and the same two faces is telling you it
is about craftsmanship and trust. Infer the before/after feeling and the one true
thing from what they choose to show, then confirm it.

## How this connects

Asset sourcing runs in Phase 0 alongside brand detection. Its findings (reviews,
story, imagery pattern) feed the Story Engine (`story-engine.md`). The
quality-judged real assets go into the build; the gaps become placeholders plus a
content list in the handover (`handover-format.md`).
