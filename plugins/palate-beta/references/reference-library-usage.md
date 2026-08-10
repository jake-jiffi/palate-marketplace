# Using the reference library

The library is deep design intelligence - structure, tokens, motion, component
behaviour and an Astro translation for 260+ top-tier sites - to inform a build:
reproduce a reference's craft faithfully, re-skin it with the client's brand,
and never copy its identity. It is served by the **`palate` MCP connector**, which
is the read path for a build. The catalog is served only through the MCP; there
is no local copy and nothing is cloned.

## The MCP is the read path (use this, not the old sync)

The `palate` MCP exposes every entry as read-only `refs_*` tools,
decomposed into orthogonal layers (tokens, typography, motion, layout,
structure, components, voice, signals, cluster) plus `referenceItFor` (what to
borrow) and `doNotCopy` (what is brand-coded, leave alone). The layers being
separable is the whole point: you take structure from one site and motion or
type from another.

The tool-chain, in the order a build uses it:

1. **`refs_match_brief { brief }`** - seed the build. Returns the dominant
   `style` / `mode` / `cluster`, three anchor references, and a playbook
   extract. Always start here.
2. **`refs_search { vertical?, subtype?, style?, mode?, tier?, craftBand?, cluster?,
   canvasFamily?, accentCount?, serifPresent?, hasWebgl?, register?, device?,
   intensity?, pageType?, uxPattern?, uiElement?, conversionPrimitive?, query?,
   limit, page, format, responseFormat }`** - faceted + natural-language
   discovery. This is how you find cross-vertical donors (a motion language from
   a creative studio, a type voice from a fashion house) AND, now, donors by what
   is literally on the page: `pageType` (pricing, menu, booking, contact, faq),
   `uxPattern`, `uiElement`, `conversionPrimitive` (bookable, order-online,
   service-area, reviews-integration). (`craftBand` (strong/solid/commodity, for judge
   anchoring) and the `refs_get` `layer:"copy_voice"` (the voice fingerprint + headline
   pattern) are FORTHCOMING on the MCP; recipes that use them fail-open if the deployed
   server predates them.) `format:"detailed"` adds tokens, sections
   and borrow guidance; `responseFormat:"md"` returns a token-lean list; `page`
   paginates the faceted path.
   **Exploit hybrid retrieval:** search is now hybrid (dense meaning + lexical
   exact-term, RRF-fused, quality-ranked and diversity-re-ranked). Name the exact
   thing you want directly in `query` ALONGSIDE the facets - a font (`"Fraunces"`),
   a library (`"GSAP"`, `"Lenis"`), a named move (`"preloader"`, `"marquee"`,
   `"pinned hero"`, `"split-flap"`), or the literal business category
   (`"optometry"`) - and it retrieves sites that use precisely that. Trust the top
   few for craft (quality-ranked) and scan the spread for cross-vertical range (at
   most two per cluster). The same lexical-anchor habit applies to
   `refs_match_brief` and `refs_for_business`.
3. **`refs_list_verticals {}`** - the taxonomy with counts and example slugs.
4. **`refs_insights { topic: "trends" | "clusters" | "playbook" }`** -
   corpus-level patterns. Use `clusters` to pick a visual signature that is
   deliberately rare in the brief's vertical.
5. **`refs_get { slug | slugs[], layer?, format, sections? }`** - the full record
   plus note bodies, asked for by **intent-named `layer`** (the documented path),
   any of: `concept` (essence + voice), `pages` (page/section anatomy), `tokens`
   (design tokens + type + layout), `signature_moves` (the distinctive moves +
   motion), `do_dont` (the explicit do/don't rules that keep a build faithful),
   `component_prompts` (paste-ready per-component build prompts in the reference's
   own tokens), `astro_recipe` (the rebuild recipe). Defaults to `concept` +
   `astro_recipe`. **`format:"design"`** returns a **DESIGN.md** - YAML token
   front-matter (the exact fonts, palette, accent, canvas, craft score) plus a
   Markdown body of the rationale and rules - the LLM-native way to ingest a
   donor's tokens *with the WHY of each choice*, which is exactly what stops
   generic re-skinning; prefer it over hand-parsing raw token JSON. Pass `slugs[]`
   to read a whole donor set (spine + grafts) in one call. (Raw `sections:[...]`
   still works as a power-user fallback for naming individual note sections;
   `voice` has no named layer, so reach it via `sections:["voice"]`.) The detailed
   record also carries `sections[]` - the homepage section sequence, each tagged
   with its uiElements, uxPatterns, conversionPrimitives and the named signatureMove.
6. **`refs_get { slug, format:"design" }`** (preferred) or **`refs_get_tokens
   { slug }`** (lean fallback) - the donor's tokens. `format:"design"` returns a
   DESIGN.md whose YAML front-matter carries the exact fonts / palette / accent /
   canvas and whose Markdown body explains the WHY of each choice; reproduce that
   rationale, not just the values. `refs_get_tokens` returns the raw palette / type
   scale / radii / easings when you only need the numbers. Either way: reproduce
   the scale, radii and easings; substitute the client's hues into the same roles.
   Re-skin the palette, never lift it.
7. **`refs_get_astro_recipe { slug }`** - the `astro-rebuild` recipe (islands,
   motion-on-Astro, packages, pitfalls). This is the file that makes a donor
   actionable on the Palate stack.
8. **`refs_get_screenshot { slug, viewport }`** - VIEW the lead reference's
   actual screenshot and design from the pixels, not only the prose notes. Match
   the real composition (where the weight sits, the asymmetry, the negative
   space, the signature move), then re-skin it. Required for the lead donor
   before you compose.

9. **`refs_similar { slug, sameVertical?, limit }`** - expand from one strong
   donor to its nearest neighbours by meaning. Use it when a search or
   `refs_for_business` hands you one donor you like and you want more of the same
   feel to compare. Leave `sameVertical` off for cross-vertical cousins (often the
   better grafts).

## The section-build recipe (MANDATORY for every conversion section)

A homepage is not the whole job, and a whole-site donor is the wrong grain for a
specific section. For each conversion-critical SECTION you build (pricing, booking,
menu, services, contact, FAQ, the hero), do NOT design from memory or from the
spine alone. Run this recipe, grounding the section in real exemplars. This is the
default for both Explore (each variant's lead donor) and Compose (each canonical
section), not an optional extra.

1. **Find 2-3 donors for THIS section by facet** (not by whole-site vibe):
   `refs_search { pageType:"pricing" }`, `{ conversionPrimitive:"bookable" }`,
   `{ conversionPrimitive:"menu", vertical:"hospitality" }`, `{ uiElement:"switch-toggle" }`,
   `{ pageType:"booking", conversionPrimitive:"bookable" }`. Widen a promising set
   with `refs_similar { slug }`.
2. **View the donor's INNER page, not only its home**:
   `refs_get_screenshot { slug, page:"pricing" }` (or menu / booking / services / ...).
   This is the depth the library now carries: study how the best sites actually
   build THAT page, at the pixel, before you compose it.
3. **Read its anatomy + discipline**:
   `refs_get { slug, layer:"component_prompts" }` and `refs_get { slug, layer:"do_dont" }`,
   plus the donor's `sections[]` (the homepage section breakdown) and `pages[]` (its
   inner-page sections, each with type + the named signatureMove). `refs_get { slug,
   layer:"pages" }` is the LLM-native read of a donor's inner-page anatomy when you
   are not also pulling its screenshot.
4. **Build the section** by reproducing the strongest donor's structure for that
   section, re-skinned to the client brand: start each component from its
   `componentPrompts`, keep its `sections[]`/`pages[]` rhythm, reproduce its named
   signatureMove (named and located in the code).
4b. **If the section carries an audacious motion / 3D / scroll moment, run the
   buildability oracle FIRST** (see "The buildability oracle" below): decompose the
   moment into named mechanics and resolve each to its closest precedent +
   `astro_recipe`, or, where the library fails closed, to the matching
   `references/motion-and-3d.md` recipe and its perf / reduced-motion budget. Build
   only what the oracle returns as buildable; never ship a guessed shader / 3D / pointer
   interaction. (Skip this step for calm conversion sections - they need only steps 1-4.)
5. **Check against `doDont` BEFORE emit**: the composed section must honour the
   donor's Do rules and break none of its Don'ts. Hard pre-emit gate, not advice.
   Audit dimension 11 re-checks it against the structured `doDont`.

The point of the upgraded library is that you build a great pricing / booking /
menu / services page from how the best sites build THAT page, not from a generic
skeleton plus the client's colours. A build that pulls one `format:"design"`
DESIGN.md per donor but never opens `layer:"do_dont"`, `layer:"component_prompts"`
or `layer:"signature_moves"`, and never views the inner-page screenshots, is
leaving the taste layer and the section depth unused - the exact thing that stops
output looking generic. The depth gate checks for those rich layers, not just call
count.

## The buildability oracle - decompose ambition into buildable mechanics

The MCP is not only a craft library, it is a **buildability oracle**. When CONVERGE
(`references/story-engine.md`) advances an audacious concept, do NOT build it from
memory of "how something like that probably works". Decompose it into its
constituent mechanics, then ask the library, per mechanic, for the closest real
precedent and its `astro_recipe`, so ambition is grounded in **how someone actually
built something like this on this stack**, not in a guess. This is also the
mechanism behind CONVERGE's craft-feasibility axis: the oracle's per-mechanic
verdict IS that score.

Run this only when the carried concept is audacious (an ambitious motion / 3D /
scroll-choreography moment, not a calm conversion page). For a calm brief the
section-build recipe above is sufficient. Where it runs, follow the exact query
sequence:

**Step 0 - route the whole concept (one call, get a spine).**
`refs_match_brief { brief: "<the audacious concept in prose>", format: "detailed" }`
(or `refs_for_business` for a named real business). It returns the three closest
refs plus the inferred style / mode / cluster. Pick ONE as the structural
**backbone**; the rest are donors.

**Step 1 - decompose the concept into named mechanics.** Map it to the MCP's
mechanic vocabulary (confirm the live list with `refs_insights { topic:"mechanics" }`).
Example: "a living, shader-lit homepage that scrubs a 3D product through the hero
and morphs into the detail page" decomposes to `shader-surface` (Tier-2 Recipe 2),
`product-rotate` / `model-viewer-3d` (Recipe 1), `scrub-timeline` (Recipe 3), a
shared-element View Transition (Recipe 6) and `kinetic-type` (Recipe 7). The recipes
live in `references/motion-and-3d.md`.

**Interactive primitives are a SEPARATE mechanic class - resolve them to the behaviour
layer, never rebuild the a11y from scratch.** When a decomposed mechanic is an
interactive widget (a dialog / modal, combobox, listbox, menu, tabs, accordion,
carousel, tooltip, toggle), its hard part is the invisible plumbing (keyboard, focus
management, ARIA, async states), which is exactly what hand-built AI output gets wrong.
Resolve it to `references/interactive-primitives.md` (the vetted, unstyled Zag.js
behaviour layer: reuse the brain, re-skin every pixel in the brand's tokens), not to a
from-scratch rebuild and not to a motion recipe. The donor still supplies the LOOK (pull
its `component_prompts` + `do_dont`); the behaviour layer supplies the correct,
audited interaction. Record the primitive in the build plan as
`mechanic -> interactive-primitives.md (Zag <name>) -> donor skin`.

**Step 2 - for EACH mechanic, find the closest precedent (the oracle loop).**
Prefer the exact facet path (it returns a `coverage` signal); fall back to semantic
where no facet exists:

```
// faceted (preferred where a facet / mechanic exists):
refs_search { device: "scrub-timeline", tier: "flagship", responseFormat: "md" }
refs_search { device: "kinetic-type", intensity: "bold", responseFormat: "md" }
refs_search { hasWebgl: true, canvasFamily: "near-white", responseFormat: "md" }  // light-WebGL
// semantic (where the mechanic is not yet a facet, e.g. shader / cursor-physics):
refs_search { query: "fluid distortion shader gradient-mesh hero", responseFormat: "md" }
```

**Read the coverage signal, do not trust the rank alone.** If `coverage:"good"`
AND the top `similarity` is high AND the returned cluster actually matches the
mechanic, that is a real precedent. If the hits are off-topic fallbacks, treat it
as **NO donor** (see the graceful fallback below) rather than cloning the wrong
ref.

**Step 3 - for each chosen precedent, pull the buildable craft.**

```
refs_get { slug: "<precedent>", layer: ["concept","signature_moves","do_dont"] }
refs_get_astro_recipe { slug: "<precedent>" }   // islands, dpr/triangle budget, reduced-motion path
refs_get_tokens { slug: "<precedent>" }          // adaptable tokens (re-skin, never clone)
refs_get_screenshot { slug: "<precedent>" }      // see the pixels before composing
```

The `astro_recipe` is the terminus: `stas-bondar`, for instance, returns a full
island strategy (a single `client:visible` WebGL island, Lenis as `client:idle`,
the expo `cubic-bezier(0.84,0,0.16,1)`, a DPR / particle budget, and the mandatory
static poster + reduced-motion path). That is what makes a mechanic buildable on
the Palate stack rather than a guess.

**Step 4 - widen each donor, then assemble.** `refs_similar { slug: "<backbone>" }`
to expand the shortlist from the best find. Compose ONE backbone for structure,
then graft specific moves (a palette, one motion, one component, the conversion
pattern) from at least three other donors via the organ-transplant method below.
Re-skin every identity layer; never clone one reference.

**Step 5 - emit the build plan (one row per mechanic).** A table:
`mechanic -> precedent slug (or "no donor") -> Template Recipe -> island / hydration ->
perf + reduced-motion note`. Where the oracle found a real precedent, the row cites
its `astro_recipe`. Where it found no donor (Step 2 failed closed), the row cites the
matching `references/motion-and-3d.md` recipe and flags the CURATE gap. Write the
per-mechanic verdicts to `manifest.buildability`
(`{ ran, mechanics:[{ name, precedent_slug, astro_recipe_pulled, feasible, fallback }] }`).

### The graceful fallback - what to do when the library fails closed

The corpus is deep but narrow on the frontier. Three high-value mechanics currently
return real-but-wrong fallbacks (the query succeeds, the hits are off-topic), so the
oracle must read them as NO donor, never build from them:

- **shader-surface hero** (fluid-distortion / gradient-mesh / noise / raymarch /
  dither) - the live query returns `raycast` / `menuxl` / `microdot`, none of which
  are shaders.
- **interactive 3D product** (glTF / drag-to-orbit / explode-view) - the live query
  returns `polecat` (an illustrated island) and `roberta-ungaro` (photography), zero
  glTF / orbit.
- **cursor-driven physics** (magnetic buttons / pointer repulsion / particle field) -
  the live query returns `guidepost-montessori` / `ichiki-109` / `cursor` / `bychudy`,
  and `cursor` is the brand name, not the mechanic.

For any mechanic where the oracle reads NO donor:

1. **Do not fabricate a precedent and do not clone the wrong ref.** Set
   `feasible: false` (no donor) but still buildable via the recipe layer, and record
   the named fallback.
2. **Fall back to the matching Template Recipe** in `references/motion-and-3d.md`
   (Recipe 2 for shader-surface, Recipe 1 for interactive 3D, the cursor-physics note
   for pointer-physics), built to that recipe's performance + prefers-reduced-motion
   budget (a static poster is the LCP and the no-JS / reduced-motion state). The
   recipe layer is exactly the floor that lets a build reach the ceiling even where a
   donor is thin.
3. **Log the donor gap, do not silently absorb it.** When a fail-closed mechanic has
   no strong donor, record the gap in the build manifest and fall back to the recipe
   layer. Recording real gaps as they surface is what prioritises future library
   sourcing; that sourcing is library work, not skill work. The skill's job is to fall
   back cleanly and note the gap.

So the oracle fails **open**: a thin or missing donor never blocks an ambitious
build, it routes it to the template recipe and its budget, and writes a CURATE task
instead of a wrong clone.

**The ONE exception that fails CLOSED: a quota / upgrade error.** A `refs_*` error
mentioning the daily limit (`used all … enriched requests for today`,
`quota_exceeded`, `Upgrade to Pro`) is NOT a donor gap. It means the user hit the
Palate free tier cap (20 deep reads a month), so falling back to a template recipe and
continuing would silently ship a shallow build. Treat it as a HARD STOP and relay the
upgrade prompt (SKILL.md step 6.1): stop calling `refs_*`, tell the user to upgrade at
https://app.palatemcp.com/dashboard/billing and re-run, and do not write a CURATE task
(this is billing, not coverage).

## The organ-transplant method (structure wholesale, then graft two organs)

A site reads as generic two ways: when one reference supplies every layer (no
range), OR when three references are averaged into a blur (the craft cancels
out). Avoid both. This is a transplant, not a blend:

- **Take the lead reference's structure WHOLESALE** - section rhythm, grid,
  hierarchy, conversion spine - and re-skin it with the client's brand. This is
  the body. Do not water it down.
- **Graft ONE signature interaction** from a second donor (a motion language, a
  scroll choreography) - intact, re-skinned. One organ.
- **Graft ONE type treatment** from a third donor (a bespoke-serif voice, an
  oversized-display system) - intact, re-skinned. One organ.

Three intact, identifiable contributions - never a 3-way average where each is
sanded down to fit. The spine usually comes from the brief's own vertical (it
carries the conversion pattern); the two grafts come from donors that share an
emotional register but not the category, which is where the distinctiveness
comes from.

| Layer | Where it comes from | How to fetch it |
|-------|---------------------|-----------------|
| **Spine** - structure, section rhythm, conversion | a flagship in the brief's own vertical | `refs_match_brief` -> `refs_get { slug, layer:"signature_moves" }` (the move) + `layer:"pages"` (structure) on the top anchor |
| **Motion language** - the "full motion" feel | a donor from a motion-rich cluster the vertical rarely uses (creative-studio, agency) | `refs_search { hasWebgl:true }` or `{ query:"GSAP pinned scroll" }` -> `refs_get { slug, layer:"signature_moves" }` + `refs_get_astro_recipe` |
| **Typographic voice** - designed, not catalogued | a bespoke-type flagship (fashion / editorial) | `refs_search { serifPresent:true, query:"<the font>" }` or `{ cluster:"bespoke-variable-font-flagship" }` -> `refs_get { slug, format:"design" }` |
| **Canvas / colour** - stand out on the shelf | a `canvasFamily` that is rare in the brief's vertical | `refs_search { vertical:..., canvasFamily:... }` to confirm rarity |
| **Component patterns** | only patterns that actually exist across the refs | `refs_get { slug, layer:"component_prompts" }` on two or three donors |

Rules for the transplant:

- **Always cross at least the spine / motion / type boundary.** If the same
  slug supplies structure and motion and type, you have not transplanted - you
  have cloned one site. Range across builds comes from varying the donors.
- **Respect every `doNotCopy`.** That is the reference's identity layer. Borrow
  the pattern, never the artefact (a signature wordmark, a brand-owned motif, a
  trademark-grade gimmick).
- **Reproduce the reference's scale, rhythm and easings; re-skin the palette.**
  Use the donor's actual type scale, spacing and motion easings in the same
  roles, then substitute the client's hues. The client's brand colours always
  win; the craft stays intact.
- **Match the brief's proof.** If the client lacks what a donor leans on (a
  slick product UI, world-class photography), substitute what they actually
  have in the same slot rather than forcing the donor's asset.

## How to read a single donor (MCP order)

For each chosen donor, call in this order and use it for its assigned layer:

1. `refs_get { slug, layer:"concept" }` - decide what this donor is FOR on this
   build: its essence, demonstrative device and emotional register. For the spine
   donor this names the mechanic to re-skin and enact.
2. `refs_get_screenshot` - VIEW it. Design from the pixels: read the actual
   composition (weight, asymmetry, negative space, the signature move) before the
   prose. Required for the spine donor.
3. `refs_get { slug, layer:"signature_moves" }` - the distinctive compositional
   moves + motion (spine donor): name and locate the move in the code, re-skinned.
4. `refs_get { slug, format:"design" }` - the DESIGN.md: reproduce the exact type
   scale, spacing and easings AND the rationale (the WHY of each token);
   substitute the client's hues into the same roles. (`refs_get_tokens` for raw
   values only.)
5. `refs_get { slug, layer:"signature_moves" }` + `refs_get_astro_recipe` - motion
   intensity and the concrete recipe for the interactions you implement (motion
   donor); reproduce the easings and choreography.
6. `refs_get { slug, layer:"component_prompts" }` - component anatomy, states, and
   the paste-ready per-component prompts in the donor's own tokens.
7. `refs_get { slug, sections:["voice"] }` - calibrate tone only, never copy
   phrasing. (`voice` has no named layer; use the raw `sections` fallback.)
8. `refs_get { slug, layer:"do_dont" }` (spine donor) - the do/don't discipline to
   hold the build to. Re-skin, then check the composed page against it before
   emitting.

`astro-rebuild` (via `refs_get_astro_recipe`) and the motion specs are what make
a donor buildable on the Palate stack - use them, do not just read the prose.

## The two-layer doctrine - reproduce the craft, protect the identity (important)

A site feels designed because of its **craft layer**: the grid system, the
spacing rhythm, the type scale and pairing, the motion timing / easing /
choreography, the interaction models, and the signature compositional moves
(full-bleed, asymmetry, repeated-identical-sections, a pinned hero stage). That
layer is not owned by anyone. **Reproduce it faithfully.** When a build informs
itself with a reference, it should use the reference's actual scale, rhythm and
easings and re-skin them with the client's brand - not dilute them down to
Claude's generic priors.

What stays off-limits is the **identity layer**: the exact palette hexes, the
wordmark / logo, bespoke font files, photography, copy, and any trademark-grade
gimmick (Linear's literal dot-grid, Stripe's exact gradient). That is the
client's, or the reference's, trade dress. Borrow the pattern, never the
artefact.

So the rule is not "weaken the reference so sites do not look the same." It is:

- **Reproduce the craft layer faithfully, re-skinned.** Use the reference's exact
  type scale, spacing rhythm and motion easings; substitute the client's hues
  into the same roles (the reference's accent role takes the client's accent
  hue). The composition stays; the identity changes.
- **Protect the identity layer absolutely.** The client's brand colours, fonts,
  logo and voice always win. Respect every `doNotCopy` - that is the reference's
  identity layer, named.
- **Get variety by choosing DIFFERENT references per build**, not by diluting any
  one of them. A faithfully-reproduced restaurant site and a faithfully-
  reproduced studio site look nothing alike; two half-diluted ones both look
  like Claude. Vary which reference leads; the build memory
  (`references/build-memory.md`) actively excludes recently-used patterns.
- **Match the client's proof.** If the client lacks what a donor leans on (a
  slick product UI, world-class photography), substitute what they actually have
  in the same structural slot rather than forcing the donor's asset.

The failure mode this replaces: stripping every memorable move out of a
reference "so sites do not look the same," which lands every build back on the
generic skeleton + the client's colours = default-Claude output. Variety comes
from range across builds, not from blanding each one.

## Posture

The library is internal Palate intelligence. Captured screenshots and SVGs are
reference material for understanding a site, not assets to ship. Every client
deliverable is original work informed by references, never copied from them.
