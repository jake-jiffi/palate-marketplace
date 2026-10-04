# Explore presentation: the canvas as an agency's sign-off deck (spec)

Date: 2026-09-12. Jake, after the eastcoast v3 re-run: "all of what the kit wants should be present
in the initial canvas design stage, it should look like what a professional website design agency
would present to get sign off on the direction and style before full build." Also: the process asked
no questions before drawing; nothing called out the nav, footer, CTAs, feature pages; "rung" is the
wrong client-facing word. Branch `beta`.

## The shape

### 1. An intake round before the survey (asked, recorded, steering)

The surveyor's FIRST act is the calibration row only (3 or 4 references from the vertical, restrained
to bold, `.palate/explore/refs.json` + stills), returned early. The main agent then asks the person, in
their language, ONE round: (a) which calibration reference is closest to how bold they want to be, and
what they dislike about it; (b) two or three sites in their field they admire and one they do not;
(c) the primary action (call, form, booking, buy); (d) the wow moment; (e) the avoid list (3 to 5);
then (f) host, CMS, direction count. The answers are recorded on `plan_checkpoint.shown.intake =
{ calibration: { position, why }, admired: [..], disliked: [..], primary_action, wow, avoid: [..] }`
and the write wall refuses a ladder build whose checkpoint lacks any of them (all six keys, non-empty).
The surveyor's SECOND act (the deep survey) receives the intake: the calibration position sets the
`intensity` facet and the ladder's ends, the admired sites are searched with `refs_for_business`, the
primary action steers the conversion spine, the avoid list is a hard filter on donors.

### 2. A presentation set per direction, on the canvas

For each direction N, four artboards, all hand-drawn against the canvas contract, all in the direction:
- `B<N>.dc.html` the whole home page (as now), 1440 wide, beside its donor card `D<N>`.
- `I<N>.dc.html` ONE inner page, the primary service page (the page the primary action lands on),
  1440 wide, nav to footer, marked `data-section-id="<id>-inner-<piece>"`.
- `M<N>.dc.html` the mobile home at 390 wide (`x-dc{width:390px}`), the same sections stacked,
  the navigation as `NavMobileSheet` closed.
- `S<N>.dc.html` the detail sheet, 1440 wide: the kit pieces AS USED in this direction, each a block
  carrying `data-kit-piece="<piece>:<Variation>:<state>"`, required at minimum: `navigation:*:default`
  and `navigation:*:open` (the menu open), `footer:*:default`, `cta:*:default` (the closing band),
  `forms:*:default` and `forms:*:error` (the enquiry form filled, then with its errors shown), one
  card from `benefits`/`usecases`/`casestudies`, one `trust` strip. Content-led: real copy in the
  brand's voice, never the type-specimen sheet (Ag ramp, swatches) rejected on 9 September.
The registry `Variant` gains `presentation: { inner: "I<N>.dc.html", mobile: "M<N>.dc.html",
sheet: "S<N>.dc.html" }` (required) and `pieces` (section 3). `boards-render.mjs` validates all four
(width per kind, marks per kind, the sheet's required blocks, the shared image/link/script rules),
keys, measures and shoots each (`shots/<id>/{hero,full,inner,mobile,sheet}.png`), writes
`public/_explore/<id>-{inner,mobile,sheet}.png`, and lays each direction as its own canvas ROW:
`B` | `D` (donor) | `I` | `M` | `S`, 80 px apart, rows 120 px apart, the calibration references on
row 0. `/explore` shows the four stills per direction. gate-explore refuses a registered direction
missing any of the four files.

### 3. Provenance per piece

`Variant.pieces = { navigation: { variation, donor }, hero: {...}, cta: {...}, forms: {...},
footer: {...}, [<section>]: {...} }`, each `variation` a kit variation id that belongs to that piece
in `src/lib/kit.ts`, each `donor` a slug in `references_surveyed`. gate-explore checks both; the
detail sheet's `data-kit-piece` variations must match the registry's. The registry `why` for the
direction still names what it took from the direction's donor; each piece's provenance is what the
detail sheet's caption prints ("Navigation: NavSimple, drawn from aesop").

### 4. The judge widened

Per direction, THREE pairs (six comparisons): the entrance (`hero.png` vs the donor's desktop hero,
as now), the foot (the bottom 900 px of `full.png` vs the bottom 900 px of the donor's `full`
capture, `<assets>/screenshots/<slug>/full.png`, fetched free like the hero), and the inner page
(`inner.png` top 900 px vs the donor's desktop hero: the donor's inner pages are not on disk, so the
comparison is "does this inner page hold the donor's standard", stated in the question). Lower rung
across all six wins; `board_judgements[]` records `rungs: { entrance, foot, inner }` and `rung` (the
lowest). The refusal bar stays `clearly_worse` until Jake decides otherwise (recorded as an open
decision).

### 5. The client-facing word is "direction"

On `/explore`, the canvas card titles and annotations, the seed README, the pick command's messages
and the hand-off doctrine: "Direction 2 of 4", "Direction 1 is restrained on purpose", "which
direction", never "rung" or "ladder". Internal names (`ambition`, the gates, the ledger) are unchanged.

## Out of scope

Compose; the bar; a donor inner page on disk; SigLIP priors.

## Proof

A fresh eastcoast run: the intake is asked before anything is researched, the canvas shows four
artboards plus the donor per direction, every piece names its variation and donor, the judge scores
three surfaces, and the deck reads as something an agency would put in front of a client.
