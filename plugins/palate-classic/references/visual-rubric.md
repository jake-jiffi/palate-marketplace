# The visual rubric (fixed) - what the verifier scores the RENDER against

This is the single fixed source the visual loop scores against, so the rubric does
not drift build to build. It judges the RENDERED page (the PNGs from
`scripts/reference-capture/screenshot-build.mjs`), not the code or the agent's
memory. The deterministic floors (`scripts/ux-lint.sh`,
`references/brand/perceptual-floors.md`, the console-error count, the uniqueness
gate) catch the mechanical failures; this rubric catches the craft failures a VLM
is better at seeing. Both arms must pass.

The screenshot driver is the real script (it targets localhost, captures retina
full-page + per-section PNGs, and records console errors):

```
bash scripts/serve-preview.sh <project-dir>          # prints SERVE_URL=...
node scripts/reference-capture/screenshot-build.mjs \
  --url <SERVE_URL> --out .palate-shots --label <variant-or-index> --sections
```

## The six axes (fixed)

Score the screenshot on six axes, 1 to 5 each. These are the exact axes from
`references/critique-discipline.md` section 2; do not improvise new ones.

| Axis | What 5 looks like |
|------|-------------------|
| Philosophy | The page has a clear, defensible thesis about what it values (speed, depth, irreverence, restraint) and every choice supports it. |
| Hierarchy | The most important thing lands first; the second-most second; nothing competes; AND it sits where attention lands. The focal element is in a usable zone (not stranded in the dead bottom-left fallow), the eye path leads toward the primary action (not away from it), elements that share one meaning are integrated (not divorced into separate rooms), and no key element is orphaned. Placement, not only weight (`references/composition-and-attention.md`). |
| Execution | Spacing, type pairing, alignment, transitions are deliberate. No "close enough" defaults. |
| Specificity | Copy and imagery name the actual product / user / situation. No generic stock phrases or stock images. |
| Restraint | Everything earns its place; nothing is decorative-by-default. The page would be worse if you added more. |
| Variety | The composition reproduces a named, located signature move from the lead reference (re-skinned), and does not fall back to the standard hero+three-cards+CTA shape unless that shape is itself the deliberate, reproduced move. |

**The bar: every axis >=4, no axis below 3.** Anything at 3 or below on any axis
means revise the named section, re-render, and re-score.

**Anchor the 1-5 scale to the corpus (calibrated judge).** Score the axes against two real
exemplars pulled from the library, not a free eye: a `craftBand:"strong"` ref (the 5 end) and
a `craftBand:"commodity"` ref (the 2-3 end) in the build's vertical (`refs_search` +
`refs_get_screenshot`), and reason about the build relative to them before assigning numbers.
Ungrounded, the base eye orders real sites by craft only at chance; anchored + reasoned it
reaches the trust gate (gap1 W2/W3). Fail-open: no MCP, or the two anchors come back identical (a server predating the `craftBand` facet), score the prose rubric as before. Score the axes on BOTH the 1440
AND the 390 render: Variety and Execution especially are judged on the phone too, not the
desktop alone, so a strong desktop score cannot carry an inert or generic mobile layout (see
defect 9, static-defensive mobile).

## The defect checklist (fixed, name-and-locate)

Walk this closed list for EVERY section shot. Each is a yes/no. When the answer is
"yes", a location string is REQUIRED (e.g. `v3-hero mobile`, `pricing desktop`) -
a defect named without a location does not count and the section is not cleared.

1. **Overflow** - text or an element bleeds past its container or the viewport edge.
2. **Overlap** - two elements collide (a z-index / positioning bug).
3. **Contrast** - body text sits below the perceptual-floor contrast on its surface
   (cross-ref `references/brand/perceptual-floors.md`; small labels on tinted, dark
   or photo bands are the usual offenders).
4. **Missing OR fabricated imagery** - an empty or placeholder frame, a broken image,
   or a wireframe-grey box (automatic fail on a launch-bar site). ALSO a glossy,
   fabricated product mockup standing in for real product UI: a rendered "dashboard"
   the product does not actually show, an invented device-frame screen. A fake passes
   the empty-frame test (it is not blank), so judge it: if the UI is too clean, the data
   too tidy, and it does not match the real product, it is a fake mockup, name it and the
   section (`references/ai-slop-tells.md`, "fake glossy mockups vs real screenshots").
5. **Mobile hero legibility** - the hero headline / subhead is unreadable at 390px
   (truncation, overlap on the photo, or below the contrast floor where the mobile
   stack pushed the text onto the brightest part of the image).
6. **Default / genre-cliche accent in the render** - the accent reads as a raw framework
   default (the Tailwind indigo / "that one shade of purple", cyan-on-dark, the emerald
   SaaS green, the friendly beige + teal) or the category cliche, even when the hex was
   not caught by the lint. Name the surface where it shows. This is the render-side
   complement to the `accent-*` lint rules.
7. **Decorative tell shape in the render** - any of these visible in the pixels, each
   needs a location:
   - **Eyebrow / status pill / console-chrome / placard above a heading** - a small
     label sitting above a heading, in ANY costume: a rounded pill (often with a status
     dot - `Now in beta`, `Backed by ...`, `WHAT WE DO`), a mono **console label** /
     fake terminal prompt, a **placard**, an HUD overline, a tracked-caps "section
     marker". The styling does not matter; the PATTERN is the tell, and on a bold /
     motion-heavy build it comes back disguised as "functional chrome"
     (`references/rendered-bug-classes.md` (e)). On the HERO this is an automatic fail:
     it must not appear at all (Jake's directive). Name the location and fail. Lower-down
     kicker labels are the milder tell; the hero pill / console label is the worst-placed
     one. (The deterministic complements are the `hero-status-pill` and
     `ai-tell-tracked-eyebrow` lint checks.)
   - **Kinetic / split heading breaks MID-WORD** - a per-character split or
     variable-font kinetic heading where a WORD wraps across two lines ("NOCTUR" /
     "NE"), usually visible at 390px. A per-char split needs per-WORD wrappers
     (`white-space:nowrap`); name the heading and the viewport
     (`references/rendered-bug-classes.md` (d); the deterministic complement is the
     `kinetic-heading-char-split` lint check).
   - **Two-tone OR gradient hero heading** - a hero `<h1>` whose words use two distinct
     solid colours, OR gradient-clipped text, to fake hierarchy. Either is a fail; name
     the heading. Hierarchy is carried by weight / size / composition, not a recolour.
     (The deterministic complements are `two-tone-heading` and `gradient-text-clip`.)
   - **The recurring default face (MODE-AWARE)** - read `.palate-skill-state.json`
     `brandMode` first. In **brand-creation** mode (no brand was provided, the skill chose
     the identity) the display face being a known reflex default with no brand rationale is
     a tell: this skill's own Bricolage Grotesque + Hanken Grotesk pairing, or Instrument
     Serif / Geist / Space Grotesk / Inter reached for out of habit. If the face reads as
     the unconsidered default and the build has no stated brand reason for it, that is a
     Variety / Philosophy fail, name the face and the surface. In **brand-provided** mode
     the face IS the brand's deliberate choice, so do NOT flag it for being a default (the
     pill-above-hero and two-tone/gradient-heading tells still fail in both modes; only the
     face is mode-gated). (The deterministic complements are the `banned-display-*` /
     `banned-body-hanken` lint rules and the cross-build type-face-recurrence check in
     `scripts/gate-novelty.mjs`.)
   - **Glassmorphism as decoration** - frosted-blur panels on nav / cards / modals used
     for look, not for a real overlay, and especially where it drops body text below the
     contrast floor.
   - **Bento grid as decoration** - mixed-size tiles where the sizes do NOT encode real
     priority (equal-weight content dressed as a bento); it is a plain card grid wearing
     a trendy name.
   - **The universal feature-card shape** - a row of cards each with a small rounded-square
     icon tile above a heading, three across, symmetric; the template SaaS component.
   - **Decorative motion** - cursor-followers, hover that hides the button it decorates,
     scroll-jacking, parallax that fights reading; motion the page would be better without
     (the motion budget catches cost, this catches the taste failure).
   - **Inconsistent visual language across sections** - the type scale, spacing, radius,
     border weight or accent usage shifts band to band, so sections read as different
     sites (cross-ref `audit-dimensions.md` dims 1, 2, 8; `critique-discipline.md` habit 7).
8. **Composition / attention (per section)** - the section's focal element (its headline,
   primary CTA, or signature move) is stranded in the dead bottom-left fallow, the eye
   path leads AWAY from the primary action, the visual weight is piled away from the focal,
   or an element that shares the section's meaning is divorced / orphaned. HIGH when it is
   the HERO's focal (a stranded hero must not pass). This is a FLOOR against BROKEN
   composition, NOT a centring rule: a bold, off-centre hero where the eye still resolves to
   the action is fine, name a fault only when the eye is genuinely led astray. Compare each
   section against the donor's matching page via `refs_get_screenshot { slug, page }` and
   judge whether the focal placement and the headline-to-signature-move integration hold up.
   The deterministic complement is `scripts/reference-capture/measure-composition.mjs` (the
   squint: focal-in-fallow / weight-misaligned / bottom-heavy), folded into the done gate
   (`references/composition-and-attention.md`).

9. **Static-defensive mobile (FIT-GOVERNED)** - on a brand that warrants motion, the 390
   render shows NO designed motion: it is clean but inert, the mobile twin of the flat-page
   tell, passing only because nothing is broken. Read `.palate-skill-state.json` `brandMode`
   and judge it the way the commission's restraint clause cuts both ways (the same shape as
   the recurring-face check): a calm or anxious brand gets calm mobile and this is NOT a
   defect; a brand that warranted motion but shipped a motionless 390 IS one (80% of traffic
   is the phone, so it is a primary surface, not a fallback). What clears it is
   compositor-cheap mobile-native motion (scroll-snap, sticky-scrub, transform/opacity
   reveals, view transitions), never main-thread or WebGL by default, and the reduced-motion
   / no-JS state is still the static finished state. Name the surface (e.g. `v2-hero mobile`).

10. **Duplication (repeated or near-identical sections / elements)** - the same section, card
    row, or block appears twice with only trivial copy changes, or a "different" section is
    structurally a clone of one above it (same layout, same rhythm, same component), so the page
    pads its length rather than earning it. Name BOTH locations (e.g. `services` and `process`
    are both the same 3-card icon row). This is a section-by-section read; a downscaled full-page
    glance misses it, so walk the per-section clips in order.
11. **Padding / spacing inconsistency** - the vertical rhythm or inner padding jumps band to band
    with no intent (one section cramped, the next cavernous), gutters or card padding differ
    across a row that should match, or an element hugs an edge where its siblings have breathing
    room. Name the section and the neighbour it disagrees with. (This is the located, name-and-fix
    form of an Execution miss; a single inconsistency is Cosmetic, a pattern of them is a defect.)

A non-zero `console_errors` count in `.palate-shots/errors.json` is an automatic
`visual: fail` regardless of the axis scores - a thrown build cannot pass.

**The motion-path bug classes (run the rendered gate, do not trust the still).** The
screenshot pass above captures a STILL, and on a bold / motion-heavy build the worst
defects only appear on the live, default motion path (and a reduced-motion / `scrollTo`
pass MASKS them). So the verifier ALSO runs `scripts/verify-rendered.sh` (see
`agents/palate-verifier.md` step 7, `references/rendered-bug-classes.md`), which drives a
REAL `mouse.wheel` scroll with JS ON + motion ON, and a JS-OFF pass, to catch: (a) a
hero that is blank / canvas-only / preloader-covered with JS disabled; (b) reveal
elements stuck at `opacity:0` for normal visitors after a real scroll; (c) a pinned hero
that overprints the footer; (f) heavy WebGL mounted on mobile instead of degrading to a
poster. A High finding there is a `visual: fail` with the named class and route, exactly
like a console error.

## The AI-slop Quick QA pass (run before emit, augments the axes + defect checklist)

Walk the Quick QA list at the foot of `references/ai-slop-tells.md` over the render. It
overlaps the axes and the defects on purpose, it is the field guide's own fast check.
**Tick more than two and the build has regressed to the AI default**: name the failing
items, revise the named sections, re-render. The list covers gradient-text headlines,
untuned / genre accents, Instrument-Serif-or-serif-italic-by-reflex, the untouched
eyebrow-pill centred-hero formula, rounded-icon-tile cards / side-border cards, feature
pill rows, bento / glassmorphism as decoration, sections that look like different sites,
the stock pricing / tapestry / contrast-framing copy, the trust-chrome stickers (cookie
banner on a new microsite, Product Hunt badge, dual free-call CTA), glossy mockups where
real screenshots belong, and the AI-washing test.

<!-- ux-lint-disable ai-washing-copy the AI-washing phrase is named here to define the render-side test, quoted not used -->
The **remove-the-word-"AI" test** is part of this pass: read any "AI-powered" / "powered
by AI" claim in the render, remove the word "AI", and re-read the sentence. If the
product is unchanged, the AI is decoration, that is a Specificity / Substance fail, name
it. (The `ai-washing-copy` lint flags the phrase; this is the render-side judgement that
the claim is earned.)

## The commission check (augments the axes + defect checklist, does not replace them)

When a commission was recorded (`manifest.commission`,
`references/build-commission.md`), the verifier ALSO judges the built result against
it. This is an additional arm of the judgement, not a new set of axes - the six axes
above and the defect checklist stand; the commission adds the ambition bar, the proof
contract and the restraint clause.

- **The proof contract.** The render must be captured at **both 1440 and 390**, the
  **pixels and the console** read (zero console errors), the page **mobile-friendly** in
  the full sense (the 390 shot clears the defect checklist AND, on a brand that warrants
  motion, shows designed compositor-cheap mobile motion, not merely the absence of breakage
  - defect 9), **holds ~60fps** (no jank: one RAF loop,
  `client:visible` islands, the LCP static not a canvas - cross-ref
  `references/motion-and-3d.md`), and it **honours `prefers-reduced-motion`** (each
  Tier-1 / Tier-2 mechanism has its JS guard + static poster; the reduced-motion state
  is the finished state).
- **The ambition bar (emitted as structured evidence).** "Competent" is a fail. A
  clean-but-generic render that would not place in its category on Awwwards / FWA does not
  clear the bar even with no defect found. The verifier emits an `ambition` block
  (`{ clears, register, dock_list:[{ gap, severity, what_would_lift_it, human_accepted }] }`)
  in `verify-report.json`; the `dock_list` is the BAR-LOSING gaps only (not every nit). For a
  HIGH-INTENSITY build (`manifest.commission.intensity == "high"`) `clears` is the
  pairwise verdict below, not a self-granted adjective.
- **The pairwise gate (HIGH-INTENSITY only).** The build is compared against a flagship-tier,
  same-vertical / same-register library exemplar (`refs_get_screenshot { slug }`) on the question
  "which would a senior designer be more likely to deliver to a paying client?", with the order
  SWAPPED to kill position bias (the swap, not blinding, is the control); it must WIN (or clearly
  tie a flagship) to clear the ambition axis. Recorded as `pairwise: { ran, won, against, consistent, question, evidence }`. This is
  the UI-Bench method (pairwise-vs-reference beats a noisy absolute self-score). A loss is
  `commission: fail`. (`agents/palate-verifier.md` step 6.)
- **Built Explore (HIGH-INTENSITY only).** A bold brief must record BUILT Explore routes
  (`manifest.variants` non-empty); `variants: []` on a high-intensity build is `commission: fail`
  (Explore collapsed to concept-level). Recorded as `explore: { built_routes }`.
- **The restraint clause (part of the judgement, not a motion count).** Maximal motion
  is not the bar; fit is. A janky WebGL hero fails; flawless restraint matched to an
  anxious brand can win. Judge intensity against the commission's stated brand fit, not
  against the toolkit register. Do not penalise a calm commission for being calm.
- **Mechanism vs record.** Each mechanism named in `commission.chosen_mechanisms[]` is
  present in the render and built from a recorded precedent + recipe (cross-check
  `manifest.buildability`); a claimed mechanism that is absent, thrown, janky, or
  missing its reduced-motion fallback is a fail with the section named.

This check is **fail-open AND intensity-scoped**: if no commission was recorded or the build
cannot be served / shot, it is skipped gracefully (`commission: skip`). The pairwise +
built-Explore gates bind ONLY when `manifest.commission.intensity == "high"`; a calm build keeps
the lighter floor (axes >=4, no defects) and those gates do not run. A high-intensity pairwise
that cannot run (no MCP / no matched exemplar) records `pairwise: { ran: false }` and falls back
to the dock_list judgement - never a hard trap.

## Loop guardrails (the anti-rubber-stamp rules)

The loop is the discipline. Follow these verbatim:

- **A revision is accepted only if the rubric score improves.** "Improves" means the
  sum of the six axes is strictly greater than the previous iteration's, OR a named
  defect from the checklist is resolved with no new defect introduced. A revision
  that does not improve the score is rejected and re-attempted - do not accept lateral
  churn as progress.
- **The critic must name a concrete defect with a location before any axis may pass
  below 5**, and must name the single weakest section even on an otherwise-passing
  render. A clean first read of a freshly generated page is statistically unlikely;
  **"looks good" / "no issues found" with no located observation is treated as
  SUSPECT** and forces one more critic pass at higher scrutiny - look again, walk the
  defect checklist section by section.
- **Cap at 2-3 iterations, then escalate** to the human with the manifest, the gate
  output, and the screenshots attached. Do not loop forever; do not lower the bar to
  pass. (`scripts/gate-done.sh` now ENFORCES this: at `PALATE_ITER_CAP` iterations, default 3,
  with the bar still unmet it returns an ESCALATE verdict with the evidence attached, rather than
  letting the loop run on or silently accepting a sub-bar pass.)

## What the verifier records

Per iteration, the verifier records (and writes to `verify-report.json` so the
done-gate reads computed evidence, not narration):

- `shots` - the PNG paths captured this iteration (`desktop_full`, `mobile_full`,
  and the per-section clips when `--sections` ran).
- `axes` - the six axis scores 1..5.
- `defects[]` - each `{ type, location }` from the fixed checklist that was found.
- `score` - the iteration score (the sum of the axes), so the next iteration can be
  checked for improvement.

`verify-report.json` shape (project root):

```json
{ "verdict": "pass|fail",
  "gates": { "depth":"pass", "uniqueness":"pass", "anti_slop":"pass", "provenance":"pass", "visual":"pass", "commission":"pass|fail|skip", "real_astro":"pass" },
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 4, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 },
      "defects": [ { "type": "overflow", "location": "v1-hero mobile" } ], "score": 24,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png", "mobile_full": ".palate-shots/mobile-full.png" } } ] },
  "ambition": { "clears": true, "register": "awwwards", "dock_list": [ { "gap": "3D credible not jaw-dropping", "severity": "med", "what_would_lift_it": "per-vertex displacement", "human_accepted": false } ] },
  "pairwise": { "ran": true, "won": true, "against": "gymbox", "consistent": true, "question": "deliver-to-client", "evidence": "..." },
  "explore": { "built_routes": 3 },
  "shots_dir": ".palate-shots" }
```

The `ambition`, `pairwise` and `explore` blocks are written ONLY for HIGH-INTENSITY builds
(`manifest.commission.intensity == "high"`); calm builds omit them and the done gate does not
require them. All three are optional and backward-compatible (an older report without them is
read as `null` and the bold gates fail-open).
