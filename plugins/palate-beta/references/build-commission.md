# The build commission - the ambition bar + the toolkit, made explicit

The short brief the skill issues to ITSELF, once, at the highest-impact
moment: after the Story Engine has fixed the concept (the divergent spine,
`references/story-engine.md`) and the brand is resolved, and BEFORE Explore. It
is the ambition bar and the toolkit made explicit, so award-tier mechanisms are
reached for **on purpose**, not left to chance, and then carried through Explore,
Compose and the verifier.

It ties four threads together at one point: the concept (the converged spine),
the toolkit + the buildability oracle (`references/reference-library-usage.md`),
the visual-loop proof (`references/visual-rubric.md`), and the
fit-over-familiarity doctrine (mechanisms are chosen to FIT, a few not all, never
by default - the same rule as type, `references/type-selection.md`).

It is doctrine and recorded evidence, not a heavy new ceremony and not a hard
trap. The skill writes the descriptive commission (the bar, the concept, the
vision, the chosen mechanisms with their precedents and recipes, the proof
requirements) and records it in `manifest.commission`; pass/fail stays computed by
the gates and the verifier, never self-claimed. Keep it lightweight: a calm
conversion brief writes a calm commission with no audacious mechanisms, exactly
as the buildability oracle is skipped for a calm brief.

## The build commission (issue this to yourself, after the concept, before Explore)

Once the Story Engine has fixed the concept and the brand is resolved, write a short
commission and carry it through Explore, Compose and the verifier. This is the ambition
bar and the toolkit made explicit, so award-tier mechanisms are reached for on purpose,
not left to chance.

COMMISSION
- Bar: build a site good enough to win its category on Awwwards / FWA. "Competent" is a fail.
- Intensity: <high | calm> - recorded machine-readably as `manifest.commission.intensity`. HIGH
  binds the bold mandate below AND the machine gates that enforce it (the blinded pairwise gate
  vs a library exemplar, the ambition gate, and the built-Explore requirement, all in
  `scripts/gate-done.sh` / `agents/palate-verifier.md`); calm keeps the lighter floor (axes >=4,
  no defects). Detect it as described under "The bold mandate" and record the single token so the
  gates scope to it instead of guessing from prose.
- Concept: <the one true thing + the demonstrative mechanic + the one governing feeling>
- Vision: <one line on the experience this site should be>
- Voice: <the copy register in one line + the say / do-not-say lists> - see "The voice spec"
  below. Copy is half of craft; a generic hero line fails the bar as surely as a generic layout.
- Mechanisms on hand, CHOSEN TO FIT (a few, not all, fit over familiarity, same rule as type):
  <pick from the toolkit register the ones this concept actually needs>
- Buildability: for each chosen mechanism, ground it in the MCP. refs_search the mechanic
  and refs_get_astro_recipe of the closest real precedent, so it is built from how a real
  award-tier site did it, not from memory.
- Proof: verify the built result with headless Chrome at 1440 and 390. Screenshot and read
  the pixels plus the console. It must hold 60fps and honour prefers-reduced-motion, and the
  390 render must be mobile-friendly in the FULL sense: it clears the defect checklist (no
  overflow, hero legible) AND, on a brand that warrants motion, it shows designed,
  compositor-cheap mobile motion (scroll-snap, transform/opacity reveals, view transitions),
  not merely the absence of breakage. 80% of traffic is mobile, so the phone is a primary
  deliverable, not a fallback. Keep the motion compositor-cheap (transform / opacity / native
  scroll), never main-thread or WebGL by default, so the perf floor holds; reduced-motion
  users still get the static finished state.
- Restraint clause (it CUTS BOTH WAYS): ambition is in the idea and its execution, not in
  maximal motion. **Match intensity to the brand** - and read both directions. A calm,
  anxious category (a conveyancer, a clinic) demands whisper-quiet; a HIGH-INTENSITY brand (a
  label, a maximalist consumer brand, a creative studio, a launch, a culture / type brand)
  DEMANDS bold motion, and serving it a safe, flat page is failing the brief just as surely as
  over-motioning a calm one. A janky WebGL hero fails the bar; so does a tasteful-but-inert
  page on a brand that wanted to detonate. See "The bold mandate" below for what a
  high-intensity commission must require.

## The voice spec (the copy register, grounded in the corpus)

The commission's `Voice` line is backed by a short voice spec, recorded the same way the
concept and mechanisms are. Copy is the half of craft the build verifier was blind to, so
make it explicit, not improvised.

- **Principles (3-5):** what this brand's copy values (specific over hyperbolic, plain over
  clever, institutional over chummy...). Derive them from the brand, not a template.
- **Tone matrix:** place the voice on 2-3 axes that matter for this brand, e.g. warm..clinical,
  plain..ornate, understated..declarative. One point per axis; the headlines must sit there.
- **Exemplar lines, from the corpus (ground it):** pull the voice layer of 2-3 donors in this
  register with `refs_get { slug, layer:"copy_voice" }` - the `voiceFingerprint` and
  `headlinePattern` name the move ("Hero H1 uses additive equation framing"; "section headings
  are short declarations or questions"), and `marketingTellScore` flags donors that lean on
  generic filler (study the LOW-tell ones). Re-skin the PATTERN into this brand's words; never
  reuse phrasing. (Fail-open: if the deployed MCP predates the `copy_voice` layer and returns no
  `voiceFingerprint`, write the voice spec from the brand directly, the corpus exemplars aid it,
  they are not a dependency.)
- **Say / do-not-say:** the concrete words this brand uses (the real product, the real user, the
  real situation) and the words it never uses (the AI-tell / marketing-filler banlist: leverage,
  seamless, solutions, empower, elevate, unlock, game-changer, ... - the same set
  `copy-voice` scores as the marketing tell).

**Verbalized Sampling on the hero headline (the same move DIVERGE makes on concepts).** Do not
write the first headline that comes to mind (the low-perplexity, expected one the base model
reaches for). Sample 5-8 headline directions wide in one pass, each self-tagging its
`typicality` (0..1, how expected it is for the category), then advance one from the LOW-typicality
tail that still says the true thing. A headline that could sit on any competitor's site is the
copy equivalent of the default hero+three-cards layout. Record the chosen line + its typicality
tag in the commission. Fail-open: a calm conversion brief still writes a specific headline, it
just does not need the full spread.

## The bold mandate (when the brand is high-intensity, the commission must commit)

This is the high-intensity half of the restraint clause, made explicit so it cannot be read
one-directionally. The restraint clause has a known failure mode: read only as "calm down",
it produces clean, gated, emotionally INERT pages on brands that were asking to detonate (a
real session shipped four such demos before this was written: safe, same-same, flat). The
clause is symmetric. A calm brief writes a calm commission; **a high-intensity brief writes a
BOLD commission, and a flat one is a failed brief.**

Detect intensity at COMMISSION time from the brand and the converged concept. A brand reads
HIGH-INTENSITY when it is a label / record / fashion drop, a maximalist consumer brand, a
creative or design studio, a product launch, or a culture / type / art brand - anything whose
whole job is to make the visitor FEEL something and remember it. Record the verdict as
`manifest.commission.intensity` (`"high"` or `"calm"`) the moment you write the commission: it is
the single machine-readable switch the v1.5 gates read to bind the bold bar (the pairwise gate +
the ambition gate + the built-Explore requirement) to high-intensity briefs only, so a calm
conveyancer or clinic is never held to it. For a high-intensity brand
the commission MUST require (these are commitments, not options to tick):

- **One committed feeling, declared up front and never diluted.** Name it in the commission
  ("after-dark", "weird-joyful", "kinetic-precise") and hold every choice to it.
- **Copy that RISKS something.** Irreversible, specific voice, not reversible corporate lines.
  "It is late. The room is dark." / "Soda that bobs." beats "Premium quality you can trust".
  A line you could paste onto a competitor's site is a failed line.
- **ONE signature focal object that is the hero INTERACTION, not a banner.** The whole page
  orbits it and the visitor DOES something to it (clicks a gate, spins a thing, scrubs type
  that reflows). Build it as a REAL WebGL / Three.js / R3F element where the brand earns it
  (Recipe 1 / 2 / the Tier-2 R3F hero recipe in `references/motion-and-3d.md`; procedural
  geometry + premium materials so no external GLB is needed), or as a hand-built
  morphing-SVG-behind-a-glow (SMIL / GSAP path-morph) where 3D would be overkill. The emotion
  is ART DIRECTION + COMMITMENT, not GPU: the strongest bold builds use only GSAP +
  ScrollTrigger + Lenis + one hand-built SVG morph + one custom cursor. WebGL is amplification
  where it fits, not the price of admission.
- **A custom reactive cursor + tactile micro-physics on every interactive element**
  (press-shadows, tilt-toward-cursor, magnetic pull, spring `linear()` easing).
- **ONE signature easing token used everywhere** + an entrance ritual (a preloader, a
  typewriter, a pop-in) + a film-grain `feTurbulence` overlay + a rich-dark surface (NOT pure
  black) + a warm off-white + ONE rare accent that DETONATES (a single hot colour used
  sparingly, never a pastel spread across everything).
- **Scroll as a TIMELINE** (Lenis + pinned / scrubbed ScrollTrigger) and **kinetic masked
  type** (a hero wordmark that reflows / displaces under scroll).

The bold mandate is still governed by fit and the proof contract: every requirement above
ships its no-JS / reduced-motion finished state and holds the mobile budget (the bug-class
gates in `references/rendered-bug-classes.md` exist because the first bold builds slipped on
exactly these). And the phone is part of the mandate, not a degraded fallback: on a
high-intensity brand a static, motionless 390 render is a failed brief the same way a flat
1440 is, just carried in compositor-cheap mobile-native motion (scroll-snap galleries,
sticky-scrub, transform/opacity reveals, view transitions, kinetic type) rather than a ported
desktop WebGL hero. Bold is not an excuse for jank; it is a higher bar that still has to pass,
on the phone as much as the desktop.

### Bold-donor awareness (reach past the restrained flagships when the brief is bold)

The first flat demos were grounded in the RESTRAINED flagships (aesop, the-modern-house,
leoleo, linear) - excellent donors for a calm brief, the wrong well for a bold one. When the
commission is high-intensity, the surveyor and Explore should reach into the experimental /
kinetic / immersive cluster (all in the MCP) so the borrowed craft matches the ambition:

- **WebGL-cinematic / immersive 3D**: utsubo, spline, stas-bondar, fiddle-digital, oddcommon.
- **Maximalist-playful**: thingy-and-thingy, yellow-fellow, polecat.
- **Kinetic type**: mat-voyce (the portfolio IS a type specimen), clay-boan, sun-hung.
- **Cursor / hover detonation**: huge (custom cursor + a rare colour that detonates), cyphr.
- **Scroll choreography**: double-play, microdot (scrub filmstrip), geex-arts.
- **Bold but conversion-ready**: gymbox (near-black + electric accent, real booking / pricing).

This is awareness, not a checklist: pick the donor that fits the one feeling, the same
fit-over-familiarity rule as everything else. The point is only that a bold brief must not
default to the quiet-luxury well.

## The mechanisms on hand (the award-tier toolkit)

Reach for any of these as Astro islands (client:visible), inside a performance and
prefers-reduced-motion budget. Choose by fit to the concept and vision, never by default;
each must degrade gracefully.
- Motion choreography: GSAP + ScrollTrigger (pinning, scrubbed timelines, scroll reveals).
- Smooth scroll: Lenis, synced to the GSAP ticker.
- 3D / WebGL: Three.js / React Three Fiber, optional GLSL shaders, physics (Rapier/Cannon)
  for hero stages, product exploration, spatial galleries.
- No-JS motion: CSS scroll-driven animations for lightweight reveals and morphs.
- Navigation: the View Transitions API (already wired) for shared-element morphs.
- Type as interface: variable-font weight/width animation, kinetic and oversized editorial type.
- Detail: custom cursors, marquees, draggable canvases.

## How the toolkit maps to the recipe layer and the oracle (the cross-links)

The toolkit register above is the menu; the buildable detail lives in two files.
Cite the recipe and the precedent in the commission so the chosen mechanism is a
deliberate, grounded choice, not a hope.

- **Every mechanism resolves to a recipe in `references/motion-and-3d.md`** - the
  Tier 0 / 1 / 2 recipes, each with its minimal implementation, its performance
  budget, and its `prefers-reduced-motion` fallback. The mapping:
  - Motion choreography (GSAP + ScrollTrigger) -> Recipe 3 (pin / scrub), Recipe 5
    (CSS scroll-driven, the zero-JS floor).
  - Smooth scroll (Lenis) -> Recipe 4, the one mandatory singleton, synced to the
    GSAP ticker (one RAF loop only).
  - 3D / WebGL (Three.js / R3F, GLSL, physics) -> Recipe 1 (R3F 3D island) and
    Recipe 2 (GLSL shader hero), the opt-in Tier 2 ceiling behind the perf budget.
  - No-JS motion (CSS scroll-driven) -> Recipe 5.
  - Navigation (View Transitions) -> Recipe 6, already wired in `BaseLayout`.
  - Type as interface (variable-font / kinetic) -> Recipe 7.
  - Detail (cursors, marquees, draggable canvases) -> the Tier 1 island pattern plus
    the cursor-physics fallback note.
  The one law carries from there: **the LCP is never a canvas** - every ceiling
  effect ships a static poster that is simultaneously the LCP, the no-JS state and
  the reduced-motion state. The full performance + reduced-motion budget lives in
  that file and in `templates/astro-project/MOTION_BUDGET.md`.

- **Interactive primitives resolve to the behaviour layer, not a motion recipe.** A
  dialog / modal, combobox, listbox, menu, tabs, accordion, carousel, tooltip or
  toggle is a behaviour problem (keyboard, focus, ARIA, async states), not a motion
  one. Resolve it to `references/interactive-primitives.md` (the vetted, unstyled
  Zag.js behaviour layer: reuse the brain, re-skin every pixel in the brand's tokens)
  rather than hand-rolling the a11y. The donor still supplies the LOOK via its
  `component_prompts` + `do_dont`; the behaviour layer supplies the correct, audited
  interaction. It is opt-in like Tier 2 (install `@zag-js/<name>` + `@zag-js/vanilla`
  per build, never in the default deps).

- **The buildability of each chosen mechanism is grounded by the oracle in
  `references/reference-library-usage.md`.** That is the "Buildability" line of the
  commission in practice: decompose the concept into named mechanics, then per
  mechanism resolve the closest real precedent + its `astro_recipe`
  (`refs_search` the mechanic, read the `coverage` signal, `refs_get_astro_recipe`
  of the precedent), so each mechanism is built from how a real award-tier site did
  it on this stack, not from memory. Where the corpus fails closed on a frontier
  mechanic (shader-surface, interactive 3D product, cursor-physics), the oracle
  reads NO donor, falls back to the matching `references/motion-and-3d.md` recipe and
  its budget, and logs the CURATE gap. The oracle's per-mechanic verdict is also
  CONVERGE's craft-feasibility score and is recorded in `manifest.buildability`; the
  commission records the same precedent + recipe per chosen mechanism in
  `manifest.commission.chosen_mechanisms[]`, so the two blocks agree.

## Fit over familiarity (the same rule as type)

The mechanisms are chosen to FIT the concept and the vision, a few not all, the
same way a type face is chosen to fit and never reached for out of habit
(`references/type-selection.md`). Three rules:

- **Pick by fit, not by default.** A mechanism earns its place only if the concept
  actually needs it. A calm conveyancer brief may choose nothing past the Tier 0
  floor; a launch may earn a shader hero. Ticking the toolkit box-by-box is the
  failure, exactly as a system sans standing in for a type decision is the failure.
- **A few, not all.** The commission names the handful of mechanisms this concept
  needs, not the whole register. More mechanisms is not more ambition.
- **Maximal motion is not the bar; FIT is - and fit cuts both ways.** The restraint
  clause is part of the judgement, not a footnote: ambition lives in the idea and its
  execution, matched in intensity to the brand. A janky WebGL hero fails the bar;
  flawless restraint can win it on a calm brand - AND a safe, flat page fails the bar
  on a high-intensity brand that wanted to detonate (the bold mandate above). The
  verifier judges the built result against this clause in both directions, not against
  a motion count (`references/visual-rubric.md`, `agents/palate-verifier.md`).

## Where the commission is carried (the spine)

The commission is written once and then referenced, never re-derived:

1. **Written at A.3.5 COMMISSION** (`SKILL.md`), between A.3 CONVERGE and A.4
   EXPLORE, from the converged concept + the resolved brand. Recorded in
   `manifest.commission`.
2. **Carried into A.4 EXPLORE** (`references/explore-stage.md`): the variants
   ELABORATE the commission. The chosen mechanisms are spread across the variant set
   to fit each direction, not ticked off in every variant. The Awwwards / FWA bar is
   the explicit ambition target every variant is held to.
3. **Carried into A.6 COMPOSE**: the composed page realises the commission's chosen
   mechanisms, each built from its recorded precedent + `astro_recipe` (the
   buildability line), inside the motion + reduced-motion budget.
4. **Checked at A.9 VERIFY** (`agents/palate-verifier.md`,
   `references/visual-rubric.md`): the verifier checks the built result AGAINST the
   commission - the proof contract (1440 + 390, read the pixels + the console,
   mobile-friendly, holds 60fps, honours `prefers-reduced-motion`), the ambition bar
   ("competent is a fail"), and the restraint clause (fit over maximal motion). This
   AUGMENTS the existing 6 axes + the defect checklist; it does not replace them.

## The hard invariant (fail-open, no new trap)

The commission is doctrine + recorded evidence. It must NOT add a hard trap. The
floor and the fail-open contract are unchanged: the verifier judging the build
against the commission still degrades gracefully when it cannot run (no MCP, no
renderable preview - the gate skips, fail-open, as today). `manifest.commission`
is a nullable block: a build with no commission recorded is not blocked by its
absence. The agent sets the descriptive commission fields; every pass/fail stays
computed by the gates and the verifier from real artefacts, never self-claimed.
