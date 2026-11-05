# Asset handling in the site

- **Brand assets** come from the brand package (logos, fonts, tokens). Imported, never duplicated, unless --vendor-brand.
- **Content imagery** lives in Sanity, served via the Sanity image CDN with urlFor() (responsive, format-negotiated).
- **OG images** generated per page at build (src/pages/og/) for social sharing.
- **Favicons** generated from the brand logo at scaffold.
- **Static assets** (the IndexNow key, any downloads) live in public/.

The rule: brand assets from the package, content assets from Sanity, generated assets at build. Nothing hand-copied that could go stale.

## MEASURE AND LOOK AT THE PHOTOS BEFORE CHOOSING A TREATMENT

**This is not optional and it is not a nicety.** When a client's own imagery comes across in a
rebuild or a modernisation, the photos decide the layout, not the other way round. Choosing a
slot first and pouring their photos into it is the single most reliable way to make a good build
look cheap.

**The failure that wrote this section.** A build set `aspect-ratio: 3/1` full-bleed without once
opening the client's photo set. Fifteen of thirty-one were portrait or square. A 2:3 portrait
forced through a 3:1 letterbox shows **22% of the frame, dead centre**, so a candid of two people
at a counter reached the homepage as two decapitated torsos centred on a t-shirt. Every gate was
green, because nothing had measured anything: the asset inventory counted files by extension.

### 1. Measure, first, always

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-assets.mjs" <assets-dir>
```

It writes `.palate/assets.json` and prints the shape of the set. Two numbers decide most of the
layout on their own:

- **Pixel width** sets the largest slot the photo can occupy before it goes soft. At 2x, which is
  every phone, you need twice the CSS pixels: a 1600px photo is an honest 800px slot on a retina
  screen. `verify-rendered` fails a build that shows an image larger than it exists.
- **Crop loss** for any slot: a cover-crop shows `min(source, slot) / max(source, slot)` of the
  frame. Under 70% is risky, under 50% is destructive. The 2:3-into-3:1 case above is 22%, and
  seeing that number is what turns "this looks wrong" into "you are throwing away 78% of the
  photograph".

**"Most of these are portrait" is a layout decision, not a detail.** A portrait-heavy set wants
portrait or square slots, or photos placed BESIDE text rather than behind it. It does not want a
letterbox anywhere, and no amount of `object-position` rescues a 22% crop.

### 2. Then LOOK at them, because pixels cannot see the subject

A crop that keeps two faces and a crop that slices them measure **identically**. Nothing in the
arithmetic knows where the person is, whether the shot has room at the top, or whether a photo is
simply not a hero: plenty of technically-large images are cluttered, badly lit, or shot with the
subject dead centre and no negative space to put type on.

So view every image that will be used, and record in `.palate/assets.json`:

- **`subject`** - where the important content actually sits ("two faces, upper-left third"), which
  is what `object-position` should be set from. Never leave it at the default `50% 50%` because it
  was easier; centre is only correct when the subject is centred.
- **`treatment`** - the slot it should get and why, including where it must NOT go.

`palate-assets.mjs --check` **exits 1 while any image in use is unreviewed**, so "nobody looked"
is a visible failure rather than a silent default. A recorded review survives a re-measure: the
half that took someone looking is never discarded by re-running the tool.

### 3. Design to the set you have

- **Never pick a ratio before reading the set.** Pick the ratio the photographs support.
- A set with few hero-capable images does not get a full-bleed hero. Use one strong landscape
  photo and give the rest honest cards, or lead with type and let the imagery support it.
- **Check mobile separately.** A 16:9 slot on desktop often becomes something near-square on a
  phone, so a photo that survives one crop can be destroyed by the other. `verify-rendered` runs
  all three viewports for exactly this reason.
- When the client's photos genuinely cannot carry the design, say so plainly and early. A
  reshoot, a tighter crop, or a design that leans on type is an honest answer; stretching a small
  photo across a hero is not.
