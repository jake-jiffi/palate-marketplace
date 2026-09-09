# Explore stage - commit to a direction before scaffolding

Every site or landing-page build starts here. The point: stop guessing at the
right direction, put a genuine RANGE of concepts in front of the client, let
them point at sections and say "that hero, that CTA, that motion," then build
the canonical pages from those picks. One project the whole way through - the
board routes evolve into the final pages, nothing is rebuilt.

## A board, not a whole page

Explore builds **direction boards**, not eight complete home pages.

A board is a hero, the system strip, ONE inner section and a notes panel, on a
route at `/boards/bN`. That is everything a direction can be judged on: the
entrance, the design system underneath it, and the section the business is
actually judged on. Building the rest of the page bought a great deal of token
cost and almost no extra information, because everything after those three
things is the same decision being re-made with more surface area.

**What that does NOT change**: the survey, DIVERGE and CONVERGE are untouched,
the ladder is untouched, the endpoint rule is untouched, and it is still one
distinct donor per rung. The unit of work got smaller. The thinking did not.

The notes panel is what makes a quarter of a page enough. It carries what the
direction is, why it is that for THIS business, the feeling, **what MOVES** (a
still cannot show that, and it is the most expensive property on the page), the
CTA labels to choose between, and the reference the craft came from.

## The flow

1. **Plan checkpoint (Explore)** - confirm brief, brand source, references,
   board count and whether to include landing-page boards. Then ask:
   "Proceed?"

   **ASK FOR THE COUNT, AND SAY WHAT IT BUYS.** The count sets the RESOLUTION of
   the ambition ladder, never its range. Whether they pick 3 or 8, rung 1 is
   genuinely understated and rung N is genuinely bold; a larger number buys finer
   steps between those fixed ends, not a wider span. Say it in those terms, because
   "how many do you want" invites the cheapest answer, while "three gives you the
   range in coarse steps, six lets you see where it turns" invites a choice.
   **Default 5 when they have no preference**, and never fewer than three: below
   three there is no BETWEEN for the client to point at, which is the whole use
   of a ladder. `scripts/gate-explore.mjs` holds that floor on a high-intensity
   brief (`PALATE_MIN_BOARDS`, default 3).
2. **Generate boards** - one board per rung as routes `/boards/b1`..`/boards/bN`,
   plus 1-3 landing-page boards as `/lp1`..`/lpN` if the brief warrants. Each
   board is a real `.astro` page: its hero and its one inner section live as
   components in `src/components/sections/`, each wrapped in `<SectionMark
   id="bN-..."/>`, composed through `src/layouts/BoardFrame.astro`, which adds
   `SystemStrip.astro` and `BoardNotes.astro` and sets `noindex`. Each
   reproduces a named reference donor's craft from the MCP (see
   `reference-library-usage.md`), one distinct donor per rung.

   **THE FILE IS THE UNIT OF WORK.** Compose lifts a picked board's sections by
   moving those component files, so a hero written inline in the board page can
   only be re-extracted by copying markup, and a copy is where a picked direction
   quietly becomes a reinterpretation of one.

   **NO VARIANT IS REGISTERED UNTIL IT PASSES THE ANTI-AI GATE.** Run, per
   board, before it enters `src/lib/variants.ts`: `scripts/ux-lint.sh` (the
   mechanical ruleset), `scripts/verify-rendered.sh` on its route (the structural
   tells a text rule cannot see, including the eyebrow/kicker), and the visual
   loop against `visual-rubric.md` + `ai-slop-tells.md`. Critical/High is a hard
   BLOCK: fix and re-run, and after 3 attempts drop the board and resample its
   rung rather than show it. These gates used to run only at Compose, which is
   downstream of the thing they protect: the client had already seen the tells.
   The preview is the first impression of the product, so a board that looks
   AI-made has lost the argument before anyone reads a word.

   The bottom-right `<ExploreSwitcher />` picker lists
   them by id + name (give each board an evocative `name` in
   `src/lib/variants.ts`), **in ladder order, with its rung shown**: the range is
   only useful if the client can SEE it is a range. Add `ambition` to each entry
   (`{ id, name, href, ambition }`, 1..N, 1 = most restrained) and let the picker
   read left-to-right as understated toward bold. A client who can see the ends
   can say "somewhere around 5, with 8's motion on the hero", which is a far more
   useful sentence than "I like that one". As each board is registered, also record it in
   `build-manifest.json` under `explore.shown`
   (`{ id, name, donor_slug, hero_pattern, position }`) so every direction SHOWN
   is captured for the taste flywheel, not just the one picked
   (`references/build-memory.md`).
   Before generating each board, state a **Design Read** out loud (see
   `references/critique-discipline.md`): "Reading this as: a {page kind} for
   {audience}, with a {vibe} language, leaning toward {design direction}." A
   board whose Design Read is generic or missing is rejected and regenerated.
   Read `~/.config/palate/builds.log.json` (see `references/build-memory.md`)
   and exclude any hero pattern used in the last 3 Palate builds and any
   macrostructure used in the last 5 - the board set actively diversifies
   away from recent work. ALSO run `node scripts/taste-profile.mjs --variants N`
   and BIAS the set toward the operator's kept choices (its `summary`), while
   spending the returned `explorationBudget` on directions OUTSIDE the profile -
   bias, never pin (`references/build-memory.md`, "The positive taste profile").
   **Match implementation complexity to the
   aesthetic vision**: a maximalist board uses elaborate code; a minimalist
   one practises restraint.
2b. **Render the boards** - `node scripts/boards-render.mjs <project-dir>`
   builds the site once, opens each board at 1440 and writes the hero stills
   `/explore` shows, the archived renders the uniqueness and fidelity gates read,
   and the canvas working files under `.palate/explore/seed/`. It stamps
   `explore.shown_at`, which is half of the only number this stage produces.

   **THEN SEED THE CANVAS, when the design skill is present.** Run `/design`
   with those working files and publish WITHOUT export, so the link opens outside
   the organisation. Record the URL as `manifest.explore.canvas_url` and `/explore`
   will link to it first. **A missing design skill is not an error**: `/explore`
   is the surface every tool can open, and the doctrine below is the same either
   way.

3. **Pause - pick** - deploy a shareable Vercel preview with
   `scripts/deploy-preview.sh <project-dir> <slug> --explore` and send the
   client the `SHAREABLE_URL` (a live `*.vercel.app` link with the bottom-right
   direction picker + Vercel Toolbar Comments for feedback). The client says
   what they want; mix-and-match is the default ("b3 hero, b5 menu"),
   whole-board or by-name shortcuts are fine ("go with Deep Trawl").
   (`--local-preview` swaps this for a local dev-server link.)
   **Record it with `/pick`** (`scripts/palate-pick.mjs`), never by hand: it
   writes `explore.picks` with the rung, its position on the ladder and the
   timestamp, so time to pick is `picked_at - shown_at` rather than a memory. It
   refuses an unregistered id, a rung outside the ladder and a second pick on a
   surface that already has one, because everything downstream trusts this record.
   Also record the calibration answer (`--intensity`, 1 to 4) and, when the client
   worked on the canvas, read it back with `--canvas <extract-dir>`, which writes
   `.palate/explore/feedback.json`.
4. **Compose** - Claude builds the canonical pages (`src/pages/index.astro`,
   etc.) from the picked sections, adopting the design tokens of the board
   that set the dominant tone (usually whichever supplied the hero).

   **THE MOTION PROOF COMES FIRST, AND NOTHING IS BUILT ON TOP OF IT UNTIL IT
   HAS BEEN SEEN.** Write `src/pages/index.astro`, run the full verify loop on
   `/` alone (`scripts/verify-rendered.sh <url> --routes /`), record the proof
   with the command below, and hand the preview URL to the client.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> --proof <preview-url>
   ```

   **RECORD IT WITH THAT COMMAND, never by editing the manifest.** It writes
   `explore.proof = { url, verified_at }` through `manifest-merge.mjs`, which is
   the only write that survives the PostToolUse hook's own. It is also what
   `scripts/gate-done.sh` reads to decide whether there is a composed home page to
   measure at all: without it every build after Compose reports
   `fidelity=skipped (Compose has not recorded the motion proof ...)` and the one
   check on the picked direction never runs. A board is a still, so a bold rung has been chosen on a picture of
   itself; the client sees it MOVING before three thousand pages are built on it.
   The cost of finding out here is one page.

   **FEEDBACK IS HONOURED, NOT NOTED.** Read `.palate/explore/feedback.json`
   (written by `/pick --canvas`). Text edits on the picked surfaces are applied:
   a client who retyped a headline has written the copy. Every note is listed in
   the Compose summary with what was done about it, including "nothing, because"
   when that is the answer. Style drags are evidence of intent, never
   instructions: someone pulling a font size on a flattened snapshot is saying
   "bigger", not specifying 72px.

   **KEEP THE SECTION IDENTITY ON THE LIFTED SECTION.** Put
   `data-palate-section="bN-hero"` on each lifted section, matching the
   `SectionMark` id it carried on the board. `scripts/gate-fidelity.mjs` reads it
   to check the picked hero is the built page's entrance and the picked inner
   section is present at all, and then checks the section's tag-and-class
   skeleton as well, because an id is a label anyone can type and a skeleton is
   not.

   **THIS IS CONCEPT WORK, NOT A SPLICE, and it got harder on purpose.** When
   every board elaborated one spine, stitching picks together was clerical.
   Now the rungs are genuinely different concepts, so lifting "v3 hero, v7
   features" verbatim produces a page with two arguments in it. Ask what the
   person was reaching for in each pick, and build the thing that serves BOTH
   reasons better than either original did. Someone taking a hero from rung 7 and
   features from rung 2 is usually telling you they want that intensity at the
   entrance and calm once they are reading; the answer is a single design with a
   deliberate falling intensity curve, not rung 7's hero pasted above rung 2's
   grid. State the read out loud before composing ("you want the boldness at the
   door and quiet inside"), so a wrong inference is corrected in a sentence rather
   than in a rebuild. **Landing between two rungs is a legitimate destination**:
   the ladder exists so someone can point between its steps. First
   **VIEW the lead reference's screenshot** (`refs_get_screenshot` on the spine
   donor) and design from the pixels - match its actual composition (weight,
   asymmetry, negative space, signature move), then re-skin with the brand. This
   is a required step, not optional: composing from prose alone regresses to
   generic priors. Then pull `refs_get { slug, format:"design" }` for the spine
   donor to lift its exact type scale, spacing and easings as structured YAML
   (with the WHY of each token) and map them onto the brand's range, reproducing
   the rationale, not just the values. Before emit, score the proposed composition
   on the **6-axis
   pre-emit critique**
   (Philosophy / Hierarchy / Execution / Specificity / Restraint / Variety, 1
   to 5 each; revise if any axis is below 3); apply the **Conceptual Grounding
   Test** to every section - delete anything that cannot finish "This exists
   because {a specific reason}". Board routes move to `_explore-archive/`
   (gitignored) or are removed. The Stop hook appends this build to
   `~/.config/palate/builds.log.json` automatically from the manifest once the
   build passes its gates, carrying the `explore` labels recorded above
   (`references/build-memory.md`), so the next Palate build diversifies away
   from this one. Ensure `explore.picks` is set before finishing.
5. **Pause - confirm** - re-deploy the shareable Vercel preview without
   `--explore` (`scripts/deploy-preview.sh <project-dir> <slug>`, picker off) so
   the client reviews the composed direction on a clean shareable link and
   confirms before deep scaffold continues.
6. **Continue Phase A** - fill `src/lib/content.ts` with real copy, finish the
   rest of the pages in the chosen direction, run `verify-is-real-astro.sh`,
   and hand over the final shareable Vercel preview link. From here the flow is
   identical to today.

The two new pause points (pick, confirm) sit alongside the existing checkpoint
before production. Four total decision moments, all at meaningful forks.

## When to skip Explore

Same scoping as the plan checkpoint: skip for tiny / reversible work. The
defaults:

| Brief shape | Explore? |
|-------------|---------:|
| New site or landing page (preview or production) | YES (default) |
| HIGH-INTENSITY commission (`intensity: high`) | YES - mandatory, BUILT boards (cannot skip) |
| "Build it like the {client} site we did last week" / direction already set | NO |
| `--skip-explore` in the brief | NO |
| Editing an existing scaffolded project (add a section, fix copy) | NO |

If you skip Explore, jump straight to Phase A as before.

**A high-intensity commission cannot skip Explore.** When `manifest.commission.intensity == "high"`
the bold mandate requires BUILT boards (at least `PALATE_MIN_BOARDS`, default 3, distinct
directions, not a concept-level convergence): collapsing Explore to one concept is the documented cause of Variety-flat bold
builds, so `scripts/gate-done.sh` fails a high-intensity build with fewer than `PALATE_MIN_BOARDS` boards. The
named-direction / `--skip-explore` escape applies ONLY when the user explicitly asked for one
direction; in that case record `commission.explore_skip = true` with the reason so the gate
honours it. Calm / conversion / tiny-edit briefs are unaffected.

## Board scope - the entrance, the system, one section, the notes

Each board varies BOTH the structure (hero pattern, the inner section it shows,
CTA placement, motion intensity) AND the underlying design tokens within the
client's brand (type scale, density, accent colour treatment, motion strength).
When the client picks a hero, they are also picking a design direction: the rest
of the site inherits those tokens at Compose time, which is exactly why the
system strip is on the board. It renders from the brand layer's custom
properties alone, so two boards with different tokens look different in the
strip with nobody drawing a swatch, and a board claiming a direction it did not
implement is caught by its own strip reading identical to the one beside it.

The rest of the home page, and every other page (about, services, contact), are
NOT generated per board. They are built once at Compose in the chosen direction.
Boards only multiply where direction-setting happens.

## The calibration row - ask how bold in pictures

The ladder is built BEFORE anyone has said how bold they want to be. The
intensity in the commission is inferred from the brief and nothing has ever
checked it.

So the surveyor picks three or four references from the client's own vertical
spanning restrained to bold, writes them to `.palate/explore/refs.json`, and
they become row 0 of the canvas and the row above the ladder on `/explore`,
under one question: **which of these is closest to how bold you want to be?**
Same vertical on purpose, so the client is comparing like with like and cannot
dismiss the row as being for a different sort of business. High taste at every
position, because a weak restrained example teaches the client that restraint is
the poor option.

The answer is `commission.intensity_asked`, recorded by `/pick --intensity <n>`
and drawn on the ladder as a marker. It sets the default pick suggestion. It does
NOT govern the bold bar: `commission.intensity`, the inferred one, still does
that, because a client under-reporting their own appetite is exactly the case the
bar exists for.

## Generating distinct boards - concept-led, not skin-deep

Five boards that all feel like a slightly-reskinned Linear is failure, and so
is five aesthetic skins of the same idea. **This paragraph used to mandate the
second failure while naming it**: it required every board to elaborate one of
1-2 advanced concepts, which is the definition of eight skins of one idea, and
that is exactly what previews became.

**Each board carries ITS OWN concept**, one per rung of the ambition ladder: a
mechanic that makes the visitor feel the transformation, a 3-beat arc, one named
feeling, and its own donor from the library. Run the Story Engine's DIVERGE ->
CONVERGE first (research -> the one true thing -> sample wide, at least the
board count plus three, with self-tagged conventionality -> cull only what
cannot be built -> curate the survivors onto the ladder), then build one board
per rung.

The ladder is the product, not a side effect. Rung 1 is the most restrained
expression and rung N the boldest, and **N sets the resolution, never the range**:
both ends are genuinely reached whether the client asked for 4 or 10. A client
cannot tell you how bold they want to be until they have seen both ends, and a
set clustered in the middle teaches them nothing. **Rung 1 is restrained and
excellent, never the weak one** - it carries a signature move like every other
rung, and the move is simply quiet.

**The boards elaborate the commission** (`references/build-commission.md`), which
was issued at A.3.5 from the converged concept + the resolved brand. Hold every
board to the commission's Awwwards / FWA ambition bar ("competent is a fail"). The
commission's chosen mechanisms (from the toolkit register, each grounded in its
`references/motion-and-3d.md` recipe + MCP precedent) are spread across the board
set to FIT each direction - not ticked off in every board. Fit over familiarity is
the rule (the same rule as type): a mechanism appears in a board only where that
direction actually needs it, and the restraint clause governs the spread (match
intensity to the brand; maximal motion is not the bar). A safe-warm board may sit
on the Tier 0 floor while a one-of-a-kind board earns a shader hero - the same
spread the ambition spectrum below already calls for.
**A CALM BRAND STILL SPANS THE LADDER.**
Calm sets the CHARACTER of the top rung, never its height: on a calm brand
rung N is still the boldest thing the ladder contains, expressed slowly, quietly and
without startling anyone, rather than a slightly warmer rung 1. A measured build (a
pelvic-health clinic) whose commission read "calm brand, calm build, anything that
performs is wrong here" shipped 8 rungs spanning 1 to 2 keyframes and 3 to 4
transitions, so the client was shown a range that was not one and could not ask for
more than they saw. If the spread of motion, structure and conceptual distance from
rung 1 to rung N is not obvious IN A STILL AND IN MOTION, the ladder has collapsed. **The restraint clause cuts both
ways** (`references/build-commission.md`, "The bold mandate"): if the brand is
high-intensity (a label, a maximalist consumer brand, a creative studio, a launch, a
culture / type brand) the bold mandate applies and a flat, safe board set FAILS the
brief - reach into the bold-donor cluster (utsubo, thingy-and-thingy, mat-voyce, spline,
oddcommon, huge, gymbox, microdot, stas-bondar), not only the restrained flagships
(aesop / the-modern-house / leoleo / linear), and make the bold boards commit (one
declared feeling, a hero INTERACTION not a banner, a custom cursor, scroll-as-timeline,
a rare accent that detonates), each still shipping its no-JS / reduced-motion finished
state. Ground each concept in the MCP concept layer
(`refs_insights { topic: "mechanics" }` / `{ topic: "emotion" }`,
`refs_search { register, device, intensity }`), then execute its craft via the
organ-transplant method (`reference-library-usage.md`).
Every board's lead donor MUST be studied through the **section-build recipe**
(`reference-library-usage.md`): pull the donor by pattern (`refs_search { pageType,
uiElement, conversionPrimitive }`), VIEW its inner page (`refs_get_screenshot
{ slug, page:"pricing" }` etc., not only its home), read its
`refs_get { slug, layer:"do_dont" }` + `refs_get { slug, layer:"component_prompts" }`
+ `sections[]`/`pages[]`, then build from those. For the spine donor, also pull
`refs_get { slug, layer:"signature_moves" }` and `refs_get { slug, layer:"concept" }`
so the mechanic is named and re-skinned. Do not stop at the homepage screenshot and
tokens; that leaves the section depth, inner pages and taste layer unused.
When you reach for donors, a `refs_search` query may mix facets with exact lexical
terms because retrieval is hybrid (dense + lexical, RRF-fused), quality-ranked and
diversity-re-ranked: name the literal font, library, mechanic or business category
in `query` alongside the facets and it retrieves sites that use precisely that, with
the best craft first and cross-vertical range across the spread. For example:
`refs_search { vertical:"hospitality", query:"split-flap menu board" }`,
`refs_search { intensity:"high", query:"GSAP Lenis pinned hero" }`,
`refs_search { serifPresent:true, query:"Fraunces editorial optometry" }`.
For a set of five, spread across the **concept-ambition spectrum** (scale the
counts with N, and keep the shape):

- **~2 safe-warm concepts** - a clear, human demonstrative idea, low-risk to
  build and convert. Executed with a faithful vertical-spine transplant plus one
  borrowed organ. Still a real idea, never a brochure.
- **~2 bold concepts** - a strong demonstrative mechanic (a reveal, a
  before/after flip, a carried timeline, crowd-as-proof), executed with
  cross-vertical motion and type transplants.
- **~1 one-of-a-kind concept** - a genuinely surprising mechanic (a Sift-style
  flood-then-resolve, an absence-as-argument, an input-then-personalise), the
  kind that makes a client go "I have never seen that". At least one in every
  set. Ambition scales to the business: whisper-quiet for an anxious category
  (a conveyancer), spectacle for a launch.

Each board's Design Read names its **concept** (the transformation, the
mechanic, the named feeling) AND its craft (the donor spine + grafted organs +
the reproduced signature move): "One-of-a-kind, feeling = relief: the visitor
types their worry and watches it answered (input-then-personalise); a
clinic-flagship spine + a calm dawn motion organ; signature move = the carried
timeline." A board that cannot name its concept and its craft is rejected and
regenerated. Every board must pass the feel gate (`critique-discipline.md`).
- **No two boards share the same hero pattern.** No two share the same
  section sequence. No two share the same density level (compact / regular /
  spacious / immersive).
- **Vary motion intensity across the set**: a few near-static, a few with
  scroll-driven choreography, one or two with hero-stage WebGL or canvas.
- **Vary design tokens within the brand**: type scale 1.2 vs 1.333 vs 1.5,
  border-radius 0 vs 8 vs 16, accent weight (subtle vs loud), font-weight
  emphasis. Stay inside the brand's permitted range; do not invent off-brand
  colours.
- **Choose type per direction, treat it as colour.** No font is banned and none is
  the default (`references/type-selection.md`): reproduce the donor's type SYSTEM
  and decide the FACE fresh to fit the brand and the concept. Across the set, faces
  differ because the directions genuinely differ, not to tick a box, and never the
  same face reached for out of habit on unrelated builds (the type-face recurrence
  smell in `scripts/gate-novelty.mjs`). A system sans at one weight standing in for
  a decision is the failure, not any particular family.
- **Landing-page boards** (when included) are single-page, conversion-shaped:
  hero + value props + social proof + CTA + FAQ + footer. The full-site
  boards are home pages that hint at site depth.

The two-layer doctrine from `reference-library-usage.md` applies: reference-led
boards FAITHFULLY reproduce the donor's craft layer (structure, rhythm, type
system, motion choreography and its signature compositional move), re-skinned
with the client's brand; only the identity layer (palette hexes, wordmark, font
files, photos, copy) is off-limits. "Loosely inspired" is not the bar - the
donor's signature move should be visible in the board, re-skinned. The board
set is the proof that the recipe was followed.

## Section identifiers - so the client can point

Every section in every board wraps with `<SectionMark id="vN-hero" />` (or
`vN-features`, `vN-cta`, etc.). In Explore mode (`PUBLIC_EXPLORE_MODE=true`)
the label appears as a small top-corner badge. In production it does not
render. The IDs follow a fixed convention so the picking conversation is
unambiguous:

- `b1-hero` and `b1-services` (the hero and the one inner section this board shows)
- `lp1-hero`, `lp1-value-props`, `lp1-form`, etc.

The id survives Compose as `data-palate-section` on the lifted section, which is
what makes a pick checkable rather than asserted.

This works alongside Vercel Toolbar Comments on Vercel preview deployments -
the labels give the client structured pointing ("v3 hero"), Comments give them
free-form notes on the same page. The two compose.

## The explore page (`/explore`) - the one thing the client opens first

**A LINK TO FIVE URLS DOES NOT COMMUNICATE A RANGE.** Everything expensive about the
ladder is spent on the assumption that the client understands they are being shown a
span. They do not, unless something says so. Handed `/boards/b1` through `/boards/b5` with no framing,
a client reads five guesses, opens two, picks whichever is nearest what they already
had in mind, and the restrained rung reads as "the boring one" rather than as one
deliberate end of a distance the boldest rung defines. So the preview always ships
`src/pages/explore.astro`, and it is the URL you hand over, never `/boards/b1`.
It shows each board inline (its rendered entrance, its notes, a link to the board),
draws the calibration row above the ladder, and links the canvas first when one
exists.

It does four things a list of links cannot:

1. **Says what just happened**, in the client's language: we sampled many genuinely
   different concepts, kept the ones worth building, and put them in order from most
   restrained to boldest. This is a range, not a shortlist.
2. **DRAWS the ladder**, so the span is visible before anything is clicked: one bar per
   rung, rising left to right, labelled `more restrained` and `bolder` at the ends, with
   the calibration answer marked on it. A client who can see the ends can say "somewhere
   around 4, with 5's motion on the hero", which is worth ten times "I like that one".
3. **Gives every rung its own argument**: `what` it is (the structural idea, not the
   mood), `why` it is doing that for THIS business, and the `feeling` it carries. This is
   also a check on the BUILD, which is the half worth remembering: a rung whose `why`
   restates its `what`, or whose feeling is "modern and clean", did not have an idea, and
   it is far cheaper to find that out before a client reads it.
4. **Says what happens next** (below), because that is the step clients most often do not
   know they have.

`scripts/gate-explore.mjs` enforces all of it and is wired into the done gate: it blocks
when boards are registered and the page is missing, when a rung carries no
`what`/`why`/`feeling`, when two rungs claim the same position, when the ladder has gaps,
and when a name is "Option 2" or a feeling would describe any website ever built. It has
no opinion at all when no boards are registered, so it never touches a non-Explore
build, and it SAYS that rather than exiting clean: `gate-explore: skipped (<reason>)` with
exit 2, which the done gate records as `explore=skipped(<reason>)`. Exiting 0 there used to
put `explore=pass` in the summary of every build that never ran Explore. The page is DELETED at Compose with the `/vN` routes; `gate-shipready.mjs` catches
it if it survives, because it names the rejected directions and belongs to nobody but this
client.

## The hand-off - what you SAY when the preview is ready

The preview being ready is the moment the build is most often mis-handled, because the
natural instinct is to ask "which one?" and stop. That collapses a range into a vote.
Say all four of these, in this order:

1. **Send them to `/explore`, not to a board.** "Start here: it explains the set and
   walks the range from restrained to bold." One link, not eight.
2. **Invite reaction, not selection.** Ask them to open BOTH ENDS before forming a view,
   and say plainly that mixing is normal and expected: "rung 5, but with 8's hero and 2's
   navigation" is a better answer than a single page, and the section marks exist so they
   can point at one by name.
3. **Offer another pass, and mean it.** Anything they want tried gets rebuilt into the
   preview so they look at the real thing rather than a description of one. Changes are
   cheap here and expensive after Compose, and saying so is what gets the useful feedback
   out rather than a polite yes.
4. **THEN name the next phase explicitly.** Once a direction is settled it becomes the
   design system, and the rest of the site (services, about, contact, blog, legal) is
   built on it end to end, with accessibility, performance and mobile checked on every
   page. Say that out loud: a client who thinks the preview IS the site will not
   understand why there is more work, and a client who does not know the offer exists
   will not ask for it.

Do not skip step 3 to reach step 4 faster. A direction chosen without a round of changes
is a direction nobody has argued with, and it comes back at Compose when it is expensive.

## The direction picker (`ExploreSwitcher.astro`)

A floating pill in the **bottom-right corner** - never a top bar, so it stays
clear of the site's own navigation (a top-bar switcher is hard to work with and
collides with the real header). The collapsed pill shows a status dot and the
current direction (`v1 Deep Trawl`). Clicking it expands UPWARD into a panel
headed `PREVIEW · PICK A DIRECTION` that lists every board by id + name
(`v1 Deep Trawl`, `v2 Morning Paper`, ...) with the active one highlighted in
mint. Built on a native `<details>` (zero JS).

Each board gets a short, evocative **name** (not just `v1`) so the pick
conversation is human: the client can say "go with Deep Trawl" or "v2 hero".
Claude sets `{ id, name, href, ambition, what, why, feeling }` for each board in
`src/lib/variants.ts` as they are generated; the picker reads that registry, renders only
when `PUBLIC_EXPLORE_MODE=true` and at least one board exists, and always reflects what
actually exists. It is mounted once in `BaseLayout.astro`.

**It lists in LADDER order and shows the rung, not the route id.** A panel in registration
order hides the one property that makes the set worth building. It also always carries the
way back to `/explore` ("All N directions, explained"), because a client who arrives on a
deep link otherwise has no route to the page that frames what they are looking at, and "I
opened one and could not get back" is how a range ends up judged on whichever page someone
happened to click.

## Compose - turning picks into the canonical pages

The mechanic when the client says "b3 hero + b5 menu":

1. Take each picked board's section COMPONENT (`src/components/sections/B3Hero.astro`
   etc.). Move the file; do not copy markup out of the board page.
2. Write a new `src/pages/index.astro` that composes them in the obvious order
   (hero -> body sections -> CTA), using the canonical
   `loadPage(query, params, fallback)` pattern, and carry each section's id
   across as `data-palate-section="b3-hero"`. Then finish the rest of the home
   page in that direction: a board is a quarter of a page, so the sections the
   boards did not show are written now, on the picked system.
3. **Adopt the design tokens of the dominant board** - by default, whichever
   supplied the hero (the hero sets the tone). Confirm with the client if it
   is ambiguous. Token overrides live in `src/styles/globals.css` (or the
   brand-package overrides layer) - keep them inside the brand's range.
3b. **PROVE IT MOVING BEFORE BUILDING ANYTHING ELSE.** Run the full verify loop
   on `/` alone, hand the client the URL, and record the proof:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> --proof <preview-url>`.
   Only after that is the rest of the site built. The fidelity gate does not run
   until that stamp exists, so skipping it silently turns the check off.
4. Build the rest of the site's pages (`about`, `services`, etc.) in the same
   direction, ONE PER PAGE in `manifest.architecture` (W16). They get the chosen tokens
   automatically via the brand layer.
   **Ground EVERY inner page in a page-type-matched donor (gap4 W18), not just the
   conversion ones.** For each archetype page (about, work, case-study, team, process,
   pricing, contact, ...), pull the best donor PAGES OF THAT TYPE via
   `refs_search { pageType:"about" }` (W17 ranks pages-as-units by craft), VIEW the
   matched inner-page screenshot (`refs_get_screenshot { slug, page }`), and re-skin its
   composition for this brand. An about page built from memory regresses to a generic
   "team + mission + values" template; an about page built from how the best about pages
   are made does not. Record the page-type-matched donor on the page in
   `manifest.architecture.pages[].donor_slug`.
   For every conversion section (pricing, booking, menu, services, contact) and
   every conversion-critical inner page, run the **section-build recipe**
   (`reference-library-usage.md`): facet-search 2-3 donors for THAT section, view
   their inner-page screenshots, build each component from
   `refs_get { slug, layer:"component_prompts" }`, and check the result against
   `refs_get { slug, layer:"do_dont" }` before emit. The composed section is grounded
   in how the best sites build that page, not assembled from memory.
5. **Archive the board routes**. Move `src/pages/boards/` and
   `src/pages/lp*.astro` into `_explore-archive/` (project-level, gitignored)
   or remove them, delete `public/_explore/`, and clear `src/lib/variants.ts`.
   The project shape returns to a normal Astro site: the routes that exist are
   the routes that ship. `gate-shipready.mjs` fails the hand-over if any of the
   three survive, because they name the directions the client did not choose.

After Compose: `PUBLIC_EXPLORE_MODE` flips to `false` for the rest of the
preview/production flow.

## Visual editing co-existence

`PUBLIC_EXPLORE_MODE` (the switcher + section labels) and
`PUBLIC_SANITY_VISUAL_EDITING_ENABLED` (Sanity overlay) are independent. During
Explore the visual-editing flag is normally OFF - we're picking structure, not
editing content. It flips ON for the preview deployment after Compose, once
the canonical pages exist. Same pattern as today.

## Where this lives in the codebase

Same Astro project from start to finish. During Explore the project has
`src/pages/boards/b1.astro`..`bN.astro`, their section components under
`src/components/sections/`, and (optionally) `lp1..lpN.astro`. After Compose
those routes are gone and `src/pages/index.astro` plus the rest of the canonical
site lives in their place. No rebuild, no fork, no second project - the boards
ARE the project, just at an earlier shape.
