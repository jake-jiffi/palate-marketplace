# The Story Engine - concept before composition

Before Explore generates a single variant, decide WHAT each one is FOR. The Story
Engine is the research-led method that turns a business into **demonstrative
concepts**: ideas that make a visitor FEEL the product's value rather than read
about it. It is how Palate sites stop being refined-but-generic. The craft layer
(`reference-library-usage.md`) decides HOW a site looks and moves; the Story
Engine decides WHAT idea it argues and WHAT it makes you feel.

Run it after brand/asset detection (Phase 0), before variant generation. It is
**research-led, not interview-led**: go and find the truth, then confirm it once.
Do not interrogate the client for the concept, that is your job.

## The five stages

1. **Research the real business, never the category.** The category is where
   generic lives ("trusted family lawyers", "your local cafe"). Pull the
   specifics: the founder's why, the years, the real point of difference, the
   suburb, and above all the emotional language the customers use, from Google
   reviews, testimonials, socials. See `asset-sourcing.md` for how to gather this
   (and the imagery) when the client has little online.
2. **Find the customer at the moment of need.** Not "a buyer" but a specific
   person at a specific moment feeling a specific thing (the first-home buyer at
   8pm with a 40-page contract; the founder doomscrolling at 6:50am).
3. **Name the before-feeling and the after-feeling.** The site's real job is the
   gap between them.
4. **Find the one true thing:** the single most emotionally potent fact nobody
   else can claim, usually hiding in the reviews or the founder's story (the
   conveyancer whose clients name Vicki by hand across 225 reviews).
5. **State the transformation (the spine):** "[ICP] arrives feeling [before] and
   should leave feeling [after], because [the real mechanism]."

The one human checkpoint is a **confirmation, not a quiz**: "Here is what I
believe your customer feels, and the one true thing about you. Did I get it
right?" Then surprise them.

## DIVERGE - sample wide before you narrow (Verbalized Sampling)

### First, detect the brand mode

DIVERGE is mode-aware, so the FIRST thing it does is decide whether a brand was
provided, because that sets WHICH axes the directions diverge on. A brand is
**PROVIDED** if any of these hold: a brand package resolves
(`scripts/detect-brand-repo.sh` returns `EXISTS:...`, or `--vendor-brand` points at a
real brand repo); real brand tokens / assets exist (a brand PDF / skill / token file,
or, for a redesign, the capture engine extracted real `tokens.raw.json` +
`typography.raw.json` from the client's site); or the brief states explicit colours AND
fonts. Otherwise the brand is **NOT provided** (brand-creation): the skill is inventing
the identity. A partial brand (colours but no fonts, or a logo only) counts as provided:
LOCK the provided half and choose the missing half to fit it. Pure `--vendor-brand`
defaults with no real source count as brand-creation, because the skill is choosing the
identity. The mode is recorded at state-init as `.palate-skill-state.json` `brandMode`
and MUST equal `manifest.diverge.mode`.

The axes you diverge on follow the mode:

- **brand-creation** (no brand provided): you are helping CREATE the brand, so diverge
  across the FULL identity space: **colourway** (vary it), **type / faces** (vary them),
  **mood**, **layout**, **composition**, **motion**, **density**. Set
  `diverge.axes_varied` to include colour and type (they are REQUIRED varied axes), and
  record each concept's `colourway` and `type`. The validity gate needs `>= 3` distinct
  colourways AND `>= 3` distinct type directions across the set, so do not reach for one
  default pairing.
- **brand-provided** (a brand exists): LOCK the brand colour + type + identity. Do NOT
  vary colour or fonts away from the brand: set `diverge.locked = { colour: true, type:
  true }` and record the palette source + faces, and do NOT put colour or type in
  `axes_varied`. Diverge ONLY within the brand, on **layout**, **composition**, **section
  logic**, **motion**, **density**, **art direction**. The validity gate judges
  distinctness on those axes (`>= 6` distinct layout/motion skins), never on a face or
  colour the brand already fixed.

This is enforced: the PreToolUse wall and the done gate both read `brandMode` from the
marker and block the build until `manifest.diverge` is valid FOR THIS MODE. Full field
shape + thresholds in `references/build-manifest.md`.

### Then sample wide

A single "best concept" collapses to the category mode: the safe, typical idea
the model reaches for first. Do not narrow yet. From the one true thing (stage 4)
and the spine (stage 5), generate **N candidate concepts (N = 6-8) in one pass,
NOT one**, with the constraints deliberately removed, and self-tag each so the
surprising tail survives. Each concept is `{ mechanic, 3-beat arc, named feeling }`
as before, PLUS three tags:

- **`conventionality: 0..1`** - the model self-rates how TYPICAL this concept is
  for the category (1 = the category default, what every site in this vertical
  does; 0 = nobody in this category does this). This is Verbalized Sampling:
  asking the model to verbalise each sample's typicality surfaces the
  low-typicality tail it otherwise collapses to the mode. Be honest: a flood-then-
  resolve hero for a SaaS launch is `~0.7` (common now), the same mechanic on a
  conveyancer is `~0.2`.
- **`lens`** - which directing lens generated it. Use **2-3 varied lenses**, not
  one, and require the set to span **>=2 lenses**. Lenses: *the customer's worst
  moment*, *the founder's obsession*, *the physical object or space*, *the thing
  the category refuses to show*, *the after-feeling made literal*.
- **`analogical_seed`** - a forced **cross-domain analogy** that seeds the
  mechanic: reframe the brief through an UNRELATED domain (print, signage,
  architecture, film, games, instruments, maps, tide charts) and let it suggest a
  device. "What if a conveyancer's site behaved like a flight tracker / a tide
  chart / a relay baton?" Pull seeds from the `refs_insights { topic: "mechanics" }`
  catalogue (flood-then-resolve, tap-to-decode, absence-as-argument, carried-
  timeline, crowd-as-proof, scroll-as-time, press-and-nothing-happens) AND from a
  deliberately DIFFERENT vertical via `refs_similar` / `refs_search { device }`, so
  the seed is borrowed across domains, not from the obvious neighbour.

**Carry the lower-typicality tail forward.** After sampling, drop the highest-
`conventionality` concepts unless one is genuinely needed as the safe-warm anchor.
The bold and one-of-a-kind slots MUST come from the low-typicality tail; aim for
at least two concepts at `conventionality <= 0.3`. Write the sampled set to
`manifest.diverge` (`{ ran: true, n, mode, axes_varied, locked, concepts: [...] }`, the
mode-aware shape above).

The split that governs everything downstream: **reference = craft + buildability
(the HOW and the CAN); the concept layer + this DIVERGE pass = novelty (the
WHAT-that-is-new).** Originality comes from sampling wide here, never from a
donor's safe default.

## CONVERGE - cull the unbuildable, then curate the rest onto a ladder

**CONVERGE IS A CURATOR, NOT A FUNNEL.** It used to advance the best 1-2 and have
every variant elaborate those, which meant the preview could never be bolder than
one concept, and the low-typicality tail DIVERGE had just paid to sample went
straight in the bin. Its job is to REMOVE what cannot be built and SHAPE what
survives into a range.

Score on EVIDENCE, never on a single "creativity" feeling, but score **for
ORDERING, not for elimination**. Two SEPARATE axes, each 0-5:

- **Originality** = distance from the category default AND from the last N builds.
  Start from the candidate's own self-tag (`originality ~= 5 * (1 - conventionality)`),
  then PENALISE any mechanic, feeling or signature move that matches a recent build
  - read the cross-build memory (`~/.config/palate/builds.log.json`, the same log
  the surveyor consults) and dock a concept that repeats what you shipped last
  time. A face, a mechanic or a feeling reached for out of habit is not original
  however novel it felt in isolation. **Read the last entries that CARRY a
  signature move or an explore block, not the last entries full stop**: most rows
  in a real log are attribute-less shells, so a plain tail read finds nothing and
  docks nobody (see `references/build-memory.md`). If no comparable entry exists,
  say the recency penalty could not be applied rather than scoring as if it was.
- **Craft-feasibility** = can the chosen donor's craft plus the Palate stack
  actually BUILD this? Decompose the mechanic into named parts and check each has a
  real precedent with a buildable `astro_recipe` (the buildability oracle in
  `reference-library-usage.md`). A concept with no buildable precedent scores low
  here even if maximally original; an original concept must never exceed what the
  stack can build.

**Combine the two, never one number**, for ordering: `combined = 2 * O * F / (O + F)`
(with a documented, env-tunable weighting in the eval, not a magic constant in
prose). **But feasibility is a FLOOR, not a weight.** A harmonic mean punishes a
low score in either axis by design, and a genuinely wild concept ALWAYS scores low
on buildability at concept time, so using the blend to eliminate is precisely what
killed the tail. Drop a candidate only when it cannot be built AT ALL, then use the
blend to order what is left.

**Then assign the survivors to the ambition ladder**, one concept per rung, and
build one variant per rung:

- **The endpoints are anchored, the middle interpolates.** Rung 1 is genuinely
  restrained and rung N genuinely bold whether N is 4 or 10, so the count sets the
  RESOLUTION and never the range. A set clustered in the middle cannot teach anyone
  what they want.
- **Three sub-axes rise together**: conceptual distance from the category default,
  motion and interaction intensity, and structural risk (a layout that breaks its
  own grid, navigation that is not a nav).
- **Rung 1 is restrained and EXCELLENT, never the weak one.** It carries a
  signature move like every rung; the move is quiet. Flawless restraint can win,
  and a timid rung 1 rebuilds the original problem at the bottom of the ladder.
- **Every rung stays on brief and on brand.** The top rung is the wildest
  expression of THIS business, never a technology demo wearing its logo.
- **No two adjacent rungs share a `lens`, and no donor slug is used twice.** If a
  rung cannot be filled, sample more candidates at that ambition level rather than
  duplicating its neighbour: two variants that differ slightly are the most
  wasteful thing a preview can contain.

Write `manifest.converge` (`{ ran: true, scored: [{ id, originality, craft_feasibility, combined }], advanced: [ids] }`).
The deterministic pre-check `scripts/gate-novelty.mjs --manifest build-manifest.json`
catches a converge that threw the tail away: it fails when **not one** advanced
concept sits at or below `PALATE_LOW_TAIL_MAX` (0.3), the same bar DIVERGE's own
tail requirement uses.

It scores the MINIMUM, not the mean, and the reason matters now that the advanced
set is the whole ladder rather than one or two picks. A mean punishes exactly the
shape this section asks for: rung 1 is deliberately restrained, so enough restrained
rungs drag a genuinely bold ladder over the line. And a mean is passed by a set with
nothing in it: eight concepts all self-tagged 0.55 average 0.55 and clear a 0.6 bar
while not one of them came from the tail. The question is about the TOP rung, so it
is answered by the minimum. If DIVERGE itself never sampled below the bar, the gate
says so and names DIVERGE rather than sending you to re-run CONVERGE for a fault one
step upstream. It fails-open (skips) when DIVERGE did not run, so it never traps a
build that could not sample.

## From truth to concepts (elaborating the advanced concepts)

Each Explore variant carries a demonstrative concept: a **mechanic** where the
visitor does or witnesses something that enacts the transformation, a **3-beat
arc** (tension, turn, payoff), and **one named feeling** that governs every craft
choice. Each variant **elaborates the concept CONVERGE assigned to its rung** (not a
fresh spine each, and no longer one or two concepts stretched across the whole set),
so the set spans the ambition spectrum:

- **safe-warm** - clear, human, low-risk, but still a real idea (not a brochure).
- **bold** - one strong demonstrative move.
- **one-of-a-kind** - a genuinely surprising mechanic (the Sift: type your topic,
  the firehose floods, all but twelve evaporate). Always include at least one.

The ambition scales to the business: a particle firehose suits a SaaS launch; a
conveyancer's one-of-a-kind is emotionally huge but visually quiet
(`intensity: whisper|calm`). A concept that only describes the value in nice type
is rejected. Show, do not tell.

Treat type exactly as colour: reproduce the donor's type SYSTEM and choose the
FACE fresh per brief, to fit the brand's voice and the website vision (no font is
banned, no font is the default; see `references/type-selection.md`). Across the
variant set, faces differ because the DIRECTIONS genuinely differ, never to tick a
box, and a face recurring across unrelated builds is the smell to catch, not the
face itself (the cross-build type-face recurrence check in `scripts/gate-novelty.mjs`).

## Grounding concepts in the MCP (the concept layer is first-class)

The `palate` MCP now indexes feeling and mechanic, not just craft. Use
it to assemble concepts:

- `refs_insights { topic: "mechanics" }` - the catalogue of demonstrative devices
  (flood-then-resolve, tap-to-decode, absence-as-argument, carried-timeline,
  crowd-as-proof, scroll-as-time, press-and-nothing-happens, ...) with the
  references that execute each best. Pick the mechanic that enacts your
  transformation, then study its exemplars.
- `refs_insights { topic: "emotion" }` - registers (calm, relief, awe, belonging,
  trust, warmth, ...) with exemplars. Find references that already produce your
  target feeling.
- `refs_search { register, device, intensity, demonstrative }` - pull references
  by feeling and mechanic (`register: relief, intensity: whisper` for the
  conveyancer; `device: flood-then-resolve` for a Sift).
- `refs_for_business` - returns the spine with its signatureMoves,
  emotionalRegister and storyDevices.

Then the craft layer executes the chosen mechanic faithfully, re-skinned (the
organ-transplant method in `reference-library-usage.md`).

## The feel gate

Before emit, every concept passes: would the actual ICP feel SEEN ("that's me,
that's exactly it")? Is the interaction the argument? Is there tension and a
payoff? If it is competent but they would feel nothing, it fails, however clean
the craft. See `critique-discipline.md` (habit 6) and `creative-principles.md`.
