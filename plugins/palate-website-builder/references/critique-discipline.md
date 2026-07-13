# Critique discipline - the six pre-emit habits

Six cheap, high-yield rules Claude follows when generating any user-facing
page. None of them require a script; the discipline is in the doc and is
enforced at the plan-checkpoint pauses and in the reviewer pass
(`audit-dimensions.md`). Together they are the difference between a sharp
page and a default-shaped one.

## 1. Design Read - one sentence before any code

Before generating a variant (Phase A.4) or composing the canonical page
(Phase A.6), state the read out loud, in this exact shape:

> Reading this as: a {page kind} for {audience}, with a {vibe} language,
> leaning toward {design direction}.

Concrete example, not invented:

> Reading this as: an open-roles index for senior tech operators, with a
> direct, low-decoration language, leaning toward an editorial wide-rule
> layout with monospace metadata.

Generic Design Reads ("a modern marketing site for users with a clean look")
do not count and the variant is rejected. The point is to commit to a
thesis BEFORE writing layout code, not to retrofit one afterwards.

Source: adapted from the `taste-skill` `SKILL.md` Section 0.B.

## 2. The 6-axis pre-emit critique

At Compose time, before the canonical pages are written, score the proposed
home-page composition on six axes, 1 to 5 each. Anything **below 3** on any
axis forces a revision pass before emit.

| Axis | What 5 looks like |
|------|-------------------|
| Philosophy | The page has a clear, defensible thesis about what it values (speed, depth, irreverence, restraint) and every choice supports it. |
| Hierarchy | The most important thing lands first; the second-most second; nothing competes; AND it sits where attention lands (focal in a usable zone, not the dead bottom-left fallow; the eye path leads to the action; meaning-linked elements integrated, none orphaned). Placement, not only weight (`references/composition-and-attention.md`). |
| Execution | Spacing, type pairing, alignment, transitions are deliberate. No "close enough" defaults. |
| Specificity | Copy and imagery name the actual product / user / situation. No generic stock phrases or stock images. |
| Restraint | Everything earns its place; nothing is decorative-by-default. The page would be worse if you added more. |
| Variety | The composition reproduces a named, located signature move from the lead reference (re-skinned), and does not fall back to the standard hero+three-cards+CTA shape unless that shape is itself the deliberate, reproduced move. |

Document the scores in the build transcript or in `handover.md`; not for the
client, for the next reviewer.

Source: adapted from an internal slop-test rubric.

### 2b. The visual rubric gate (judge the RENDER, then loop)

The 6-axis critique is not only a thought experiment over the proposed composition,
it is a hard gate applied to the **rendered page**, because a build looks different
than it reads in code. After Compose (and for each Explore variant before it is
shown), RENDER and SCREENSHOT the page, then score the screenshot on the six axes:

1. Take a real screenshot of the built page, desktop **and** mobile, with the real
   driver: serve the project (`bash scripts/serve-preview.sh <project-dir>`, parse
   `SERVE_URL=`), then `node scripts/reference-capture/screenshot-build.mjs --url
   <SERVE_URL> --out .palate-shots --label <variant-or-index> --sections`. It writes
   retina (2x) full-page desktop + mobile PNGs, per-section clips keyed by
   `data-section-id`, and an `errors.json` (any console error is an automatic visual
   fail). View the pixels with Read; do not score from the code or from memory.
2. Score all six axes 1 to 5 against what you SEE, using the FIXED rubric and defect
   checklist in `references/visual-rubric.md` (the single source the verifier scores
   against). Apply the perceptual floors (`references/brand/perceptual-floors.md`) at
   the same time: body-on-dark contrast, 44px tap targets, the type scale, the motion
   floor. Follow the loop guardrails in that file: a revision is accepted only if the
   score improves; name a defect + its location before passing an axis below 5; "no
   issues found" is suspect; cap 2-3 iterations then escalate.
3. **Gate (the standard we hold to): every axis must be >=4, no axis below 3, no
   floor violation, and no unresolved placeholder imagery.** Any axis at 3 or below,
   any floor violation, or a section that still reads as a wireframe -> it has NOT
   passed. Name the specific failing section, revise it, re-render, and re-score.
   **Loop until it passes; a build is not done until its render clears the rubric.**
4. The most common real failures the render exposes (fix, do not excuse): placeholder
   or empty imagery on a launch-bar site, a hero that plays safer than the body, dead
   space where a section trails off, a section that reads as assembled (a generic
   card grid) next to designed ones, motion that is claimed but invisible, and a dark
   or photo-led hero that reads on desktop but drops below the contrast floor on mobile
   (see section 7).

This is the same rubric as 2.; the difference is it judges the artefact a client
will actually see, and it repeats until the artefact is genuinely good.

## 3. The Conceptual Grounding Test

Every section, every component, every image must finish the sentence:

> This exists because {a specific product or user reason}.

If the sentence does not finish without filler ("...because it looks nice",
"...because heroes have features"), the element is decorative-by-default and
gets deleted. Apply at Compose and again in the reviewer pass.

The SIGNATURE MOVE / motion gets the test too, at a harder bar: it must finish
"this MOVES because {a specific reason the ICP would feel}", never "because it looks
premium" or "because the hero should feel alive". Spectacle that only finishes with a
generic premium reason is decorative-by-default however well executed: ground it in the
buyer's actual story or cut it. (Arc Medical: an abstract WebGL particle arc read as
decoration for a 400k specialist hire; re-grounded as the doctor's real career
trajectory, Fellowship to Consultant to VMO to Leadership, lighting up as it draws, it
earned its place AND demonstrated the domain fluency that is the differentiator.) The
commission names the demonstrative mechanic; it must also name what that motion MEANS to
the buyer, not only what it does.

Source: anti-slop-ui `SKILL.md` Step 1.

## 4. The vague-word ban (on Claude's own narration)

In Claude's own messages about a Palate build - the plan checkpoint
descriptions, the variant write-ups, the compose summary, the handover note -
never use these words as descriptors of the design:

- `clean`, `nice`, `modern`, `sleek`, `beautiful`, `stunning`, `minimal`,
  `bold`, `elegant`, `polished`, `striking`.

Replace each with a specific observation:

- not "a clean hero" -> "a 96px display headline at -0.03em tracking, single
  line, left-aligned, with 32px of breathing room beneath."
- not "a modern feel" -> "a 1.5 type scale with 1.6 line-height, neutral
  borders at 1px, no rounded corners except inputs."
- not "a bold CTA" -> "a filled button using the brand accent at 100%
  saturation, sitting at the optical centre of the hero."

The ban applies to Claude's narration, not to the client's brief or to the
brand's voice document. Naming things specifically is the discipline.

The specific numbers that replace a banned word must come from a real token, not
be invented to sound precise: read them off the brand package or off the donor's
`refs_get { slug, layer:"tokens" }` (or `refs_get { slug, format:"design" }`)
output. A specific-sounding claim ("96px display at -0.03em") that does not trace
back to a token in the brand package or the donor's design tokens is itself a
finding - precise-but-fabricated is worse than vague.

Source: taste-skills (Dragoon0x) `skills/perception/visual-audit/SKILL.md`.

## 5. The anti-default detector - reject the Claude-default shape

Before emit, check the composition against the list of Claude-default tells. The
default-shaped page is what the model produces WITHOUT the references; it is the
regression-to-the-mean this skill exists to beat. If the composition matches the
default shape AND reproduces no named signature move from the lead reference,
reject it and redo.

The default tells (a cluster of these is the smell):

- A centred hero: headline + subhead + one button, stacked and centred.
- Three feature cards in a symmetric row directly under the hero.
- A system-ish sans throughout (the browser default stack, or Inter at one
  weight) with no display / body distinction at scale or family.
- A standard sticky top nav: wordmark left, four to five links centre / right,
  a pill CTA.
- A fully symmetric grid - everything centred, nothing full-bleed, no asymmetry,
  no pinned stage, no repeated-identical-section rhythm.
- Tailwind default spacing and the default blue / slate palette doing the work
  instead of the brand.
- The CATEGORY-default palette: the colour scheme every site in this vertical
  already reaches for (dark-teal + orange for a coffee roaster, forest-green for a
  dental / wellness clinic, navy for finance). It is a default even when executed
  well. Ground the palette in a CROSS-vertical donor so it is not the genre cliche.
- A three-card "shop / services / pricing" row the page falls back to even when the
  hero is distinctive - the most template-shaped section there is. Carry the page's
  OWN signature motif into it (the numbered index, the editorial list, the donor's
  real component) instead of three equal cards.
- NO named, located signature move reproduced from the lead reference.

The positive test that clears it: name the signature move this page reproduces
from the lead reference, and point to where it lives ("the donor's full-bleed
pinned hero stage, reproduced at `index.astro` lines 12-40, re-skinned to the
brand"). Derive the candidate move from `refs_get { slug, layer:"signature_moves" }`
on the lead donor and quote the move's name verbatim, do not paraphrase it into a
generic label. Hybrid search lets you confirm a move actually exists before you
claim it: search its lexical term (e.g. `refs_search { query:"split-flap" }`) and
trust the exact-term match. If you cannot name and locate one, the page is
default-shaped - redo it with the lead reference's craft reproduced faithfully (see
`references/reference-library-usage.md`, the two-layer doctrine).

Source: the palate two-layer doctrine (reproduce the craft, protect
the identity).

## 6. The feel gate - would the ICP feel seen

The anti-default detector (habit 5) kills generic CRAFT. This kills generic
CONCEPT. Before emit, every page (and every Explore concept) answers:

- Would the actual ICP, at their moment of need, feel SEEN - "that's me, that's
  exactly it"?
- Is the interaction the ARGUMENT (the visitor does or witnesses the value), or
  does the page only describe it in nice type?
- Is there a transformation with tension and a payoff, not just pleasant sections?
- Could this be pasted onto a competitor? If yes it is generic; find the one true
  thing and rebuild on it.

A page that is competent, clean and correct but makes the visitor feel nothing
fails this gate. This is the gate that catches "refined but underwhelming". See
`story-engine.md` and `creative-principles.md`.

Source: the Palate Story Engine.

## 7. Recurring finish failures (lift the Execution / Restraint 4 to a 5)

These are the three that the visual rubric gate (2b) flags most often on otherwise-
strong builds: the difference between a 4 and a 5 on Execution and Restraint. Pre-empt
them at Compose, do not wait for the gate.

- **CTA-verb sprawl.** Three near-synonymous primary actions competing ("Book a
  call-out" + "Get a fixed quote" + a per-row "Quote this" + a sticky "Get a quote")
  reads as nagging and dilutes the accent. Pick ONE primary verb, let the secondary
  actions inherit it (or demote them to plain-text targets), and keep the accent scarce.
- **Loose baseline grid in editorial / numbered rows.** A numbered index or service
  ledger (the move that replaces three cards) only reads as crafted if the number, the
  title baseline, the description column and the right-hand price/action share ONE
  baseline grid with consistent row padding and rule-line lengths. "Close enough"
  alignment here is exactly the close-enough default the rubric penalises.
- **Small-text contrast on tinted / dark / photo surfaces.** Eyebrows, captions,
  muted labels and over-photo suburb lists routinely sit below 4.5:1 on a dark band,
  a persimmon-on-cream link, or the lighter regions of a hero image. Check every small
  label against its actual background; add a scrim or bump weight/opacity. This is a
  perceptual-floor failure, not a nicety.
- **Dark / immersive hero text on MOBILE.** A dark or photo-led hero that reads cleanly
  on desktop is the single most common thing that fails at 390px: the mobile stack pushes
  the eyebrow, the headline and the intro paragraph across the BRIGHTEST part of the hero
  photo (fur, sky, water highlights), or onto a gradient that is dark at the foot but light
  at the top, exactly where the desktop layout had kept that text in a dark zone. So judge
  the hero on the MOBILE screenshot, not only the desktop one; any hero text over a photo or
  a dark gradient needs a mobile-scoped scrim that pulls the background luminance under EVERY
  line (the eyebrow included) below ~70, clearing 4.5:1. Related: do not leave desktop HUD
  chrome (a floating location label, a live clock, a marquee edge) in the mobile top bar,
  it collides with the wordmark and the CTA, hide it at the mobile breakpoint and leave the
  wordmark plus one CTA.

Source: distilled from the capstone validation heal lists (coffee / dental / trades) and
the S2 eval-runs slice (physio / accountant / hair-salon / pilates / real-estate / vet),
where every variant that needed more than two heal rounds failed on the dark/immersive
mobile hero, never on desktop.

---

## Where these apply

- Before Phase A.4 (Explore): every variant generation begins with a Design
  Read; the variant is rejected if the Design Read is missing or generic.
- Before Phase A.6 (Compose): the 6-axis critique is scored on the proposed
  composition; revise before emit if any axis is below 3.
- Before Phase A.6 (Compose) emit: the anti-default detector runs on the
  composition; if it is default-shaped with no reproduced signature move, redo.
- Before Phase A.4 (Explore) and A.6 (Compose): the feel gate, on every concept
  and on the composed page; if the visitor would feel nothing, redo.
- At Phase A.6 (Compose) and Phase A.10 (Finalise reviewer pass): the
  Conceptual Grounding Test on every section.
- Whenever Claude narrates the build: the vague-word ban.

The combination is the difference between a deliberate page and a defaulted one.
