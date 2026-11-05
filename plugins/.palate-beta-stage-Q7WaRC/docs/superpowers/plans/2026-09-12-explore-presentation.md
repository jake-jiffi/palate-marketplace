# Explore Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Explore canvas reads as an agency's direction-and-style sign-off: an intake round before research, four artboards plus the donor per direction (home, inner page, mobile, a detail sheet of the kit pieces as used), provenance per piece, the judge on three surfaces, and "direction" as the client's word.

**Architecture:** The checkpoint validator gains `shown.intake` (required for a ladder). The surveyor splits into a calibration-first act and a deep survey that consumes the intake. `boards-render.mjs` validates, keys, measures and shoots four artboard kinds per direction and lays each direction as its own canvas row. `gate-explore.mjs` checks the presentation files and per-piece provenance against `kit.ts`. `gate-board-judge.mjs` builds three pairs per direction. `/explore`, the canvas text and the pick messages say "direction".

**Tech Stack:** Node ESM scripts, bash tests, vendored Playwright + sharp, Astro 5 template.

**Spec:** `docs/superpowers/specs/2026-09-12-explore-presentation.md`

## Global Constraints

- Branch `beta` of `/Users/jakeshelley/dev/palate/skill`. Never `main`.
- Australian English, no em dashes, no AI-tell copy; the files' existing register; every doctrine sentence true of the code; a doctrine line that tells an agent to do something is only true if that agent's frontmatter carries the tool (docs-truth pins it).
- Every new gate assertion mutation-checked, stated in the report with command and output.
- Existing exports and artefact paths stay (`B<N>.dc.html`, `D<N>.dc.html`, `Ref<N>.dc.html`, `shots/<id>/{rendered.html,hero.png,full.png,donor.jpg}`, `public/_explore/<id>{,-full,-donor}.{png,jpg}`, `canvas.json`, `manifest.explore.*`). New: `I<N>.dc.html`, `M<N>.dc.html`, `S<N>.dc.html`, `shots/<id>/{inner,mobile,sheet}.png`, `public/_explore/<id>-{inner,mobile,sheet}.png`, `plan_checkpoint.shown.intake`, `Variant.presentation`, `Variant.pieces`, `board_judgements[].rungs`.
- The write wall's `PAGE_OR_SECTION` already matches any `.palate/explore/seed/<Name>.dc.html`; do not narrow it. The gitignore rules ignore only generated files (`D*`, `Ref*`, `ref*`, `d[0-9]*-hero.jpg`, `canvas.json`, `README.md`, judge files); the new hand-drawn kinds are committed; do not ignore them.
- The refusal bar stays `clearly_worse` (open decision, Jake's). `RUNGS` untouched.
- Skip/refusal grammar unchanged: exit 2, first stderr line `<tool>: skipped (<reason>)` for a skip; `process.exitCode`, never `process.exit()` mid-Playwright; refusals never delete the seed.
- Fast suite green (`bash scripts/test/run.sh --fast`, 86 passed / 0 failed / 8 skipped today); slow suites touched (`boards-render.test.mjs`, `explore-page-boards.test.sh`, `gate-fidelity.test.mjs`) run directly and quoted; all in the foreground, never left in the background.
- The kit's piece ids: navigation, hero, trust, problem, benefits, demo, process, usecases, testimonials, casestudies, pricing, comparison, faq, cta, forms, locality, footer; variation ids as in `templates/astro-project/src/lib/kit.ts` (e.g. `NavSimple`, `NavMobileSheet`, `FooterSimple`, `CtaClosing`, `FormEnquiry`, `TrustRatings`, `BenefitCards`).

---

### Task 1: The intake is asked before the survey, recorded on the checkpoint, and steers the research

**Files:**
- Modify: `hooks/palate-pretooluse.mjs` (`checkpointValid`, `CHECKPOINT_REQUIRED_MESSAGE`)
- Modify: `agents/palate-surveyor.md` (two acts), `SKILL.md` ("The plan checkpoint" moment 1 and A.4's opening), `references/explore-stage.md` (step 1)
- Test: `scripts/test/pretooluse-diverge.test.sh`, `scripts/test/docs-truth.test.sh`

**Interfaces:**
- Produces: `plan_checkpoint.shown.intake = { calibration: { position: int 1..4, why: string }, admired: string[] (>=1), disliked: string[] (>=1), primary_action: "call"|"form"|"booking"|"buy"|string non-empty, wow: string, avoid: string[] (3..5) }`; required (every key, non-empty) when `shown.explore.mode === "ladder"`; ignored for named-direction and supplied-example.
- Produces: surveyor act 1 (`palate-surveyor` prompt: "calibration only") writes `.palate/explore/refs.json` + stills and returns; act 2 (the deep survey) receives the intake block verbatim and: sets the `intensity` facet from `calibration.position` (1-2 -> calm/considered, 3-4 -> bold/spectacle, in `refs_search`'s vocabulary), runs `refs_for_business` on each admired site, treats `disliked` and `avoid` as exclusions when choosing donors, and names the `primary_action` in the packet's COMPOSITION NOTE.

- [ ] **Step 1: Tests first.** pretooluse: a ladder checkpoint with `go.how: "asked"` and no `intake` -> DENY; with a complete intake -> ALLOW; missing any one key (parametrise the six) -> DENY; `avoid` with 2 entries -> DENY; a supplied-example checkpoint without intake -> ALLOW. docs-truth: surveyor names "calibration only" and "the intake"; SKILL.md checkpoint names `shown.intake`; explore-stage step 1 names the six questions.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** the validator (after the `ex.mode` checks), the deny message (list the six questions in the person's language), the surveyor's two acts, the checkpoint doctrine (the six questions in order, asked in one round, before the deep survey), explore-stage step 1.
- [ ] **Step 4: Run green; mutations (drop the intake check; drop the avoid length check); fast suite.**
- [ ] **Step 5: Commit** `intake: six questions before the survey, recorded on the checkpoint, steering the research`

---

### Task 2: Four artboards per direction, validated, shot and laid out as a row

**Files:**
- Modify: `templates/astro-project/src/lib/variants.ts` (`presentation` required)
- Modify: `scripts/boards-render.mjs` (`validateArtboard` gains `kind`; new `validateSheet`; `main()` per kind; `writeCanvasJson` per-direction rows)
- Modify: `templates/astro-project/src/pages/explore.astro` (four stills per direction)
- Test: `scripts/test/boards-render.test.mjs`, `scripts/test/explore-page-boards.test.sh`

**Interfaces:**
- Produces: `validateArtboard(html, { id, section, dir, kind })` with `kind` in `home` (default, as today), `inner` (1440 wide; marks `<id>-inner-navigation`, `<id>-inner-hero`, `<id>-inner-cta`, `<id>-inner-footer` required; motion note optional), `mobile` (x-dc width 390; marks `<id>-navigation`, `<id>-hero`, `<id>-cta`, `<id>-footer`; motion note optional), `sheet` (1440 wide; every block carries `data-kit-piece="<piece>:<Variation>:<state>"`; required at minimum `navigation:*:default`, `navigation:*:open`, `footer:*:default`, `cta:*:default`, `forms:*:default`, `forms:*:error`, one of `benefits|usecases|casestudies:*:default`, `trust:*:default`; the piece ids and variation ids must exist in `kit.ts` under that piece (read `templates/astro-project/src/lib/kit.ts` with the same bracket parser style as `parseRegistry`, exported as `parseKitVariations(src)` -> `Map<piece, Set<variation>>`); a `<style>` that is a type ramp with no copy (detect: fewer than 120 characters of visible text outside `<style>`) is refused as a specimen sheet). Shared rules (images, links, scripts, class ratio, a:hover) apply to all kinds.
- Produces: `Variant.presentation = { inner: "I<N>.dc.html", mobile: "M<N>.dc.html", sheet: "S<N>.dc.html" }` required; `parseRegistry` returns it.
- Produces: `main()` validates the four files per direction (refusing on the first bad one naming file and kind), stamps keys in all four, archives `shots/<id>/{rendered,inner,mobile,sheet}.html`, shoots `hero.png` + `full.png` (as now) plus `inner.png` (1440x900 top of the inner page), `mobile.png` (390 wide, full page), `sheet.png` (full page), copies stills to `public/_explore/<id>-{inner,mobile,sheet}.png`; `writeCanvasJson({ boards, refs, donors, out })` lays row 0 refs, then one row per direction: `B` at x=0, `D` at 1520, `I` at 2320, `M` at 3840 (390 wide), `S` at 4310, all at the row's y; the row height is the tallest frame; rows 120 px apart; annotations `board-<id>` (the direction's name and feeling), `donor-<id>`, `inner-<id>` ("The primary service page in this direction"), `mobile-<id>` ("At 390"), `sheet-<id>` ("The pieces as used: navigation, footer, CTA, form and their states").
- Produces: `/explore` rung card gains the three stills under the entrance still, each linked to its `public/_explore` file, captioned "Inner page", "Mobile", "The details".

- [ ] **Step 1: Tests first** (unit: each kind's required marks; the sheet's required blocks and the kit-variation check and the specimen refusal; parseKitVariations on the real kit.ts finds 17 pieces and 50 variations; integration: two directions with all four files each and a donor row -> the five stills per direction exist, the canvas rows are laid as specified, `explore.shown` unchanged; a direction missing `S1.dc.html` exits 2 naming it; explore-page-boards: the four stills per card).
- [ ] **Step 2: Run, watch them fail.**  **Step 3: Implement.**  **Step 4: Green; mutations (drop the sheet's required-block check; drop the mobile width check; drop the specimen refusal); slow suites + fast suite.**
- [ ] **Step 5: Commit** `boards: four artboards per direction, the detail sheet of the kit pieces, one canvas row per direction`

---

### Task 3: Provenance per piece, checked against the kit

**Files:**
- Modify: `templates/astro-project/src/lib/variants.ts` (`pieces` required), `scripts/gate-explore.mjs` (checks 9 and 10), `scripts/boards-render.mjs` (sheet captions from `pieces`)
- Test: `scripts/test/gate-explore.test.sh`, `scripts/test/boards-render.test.mjs`

**Interfaces:**
- Produces: `Variant.pieces = { navigation: { variation, donor }, hero: {...}, cta: {...}, forms: {...}, footer: {...}, [<section>]: {...} }` required; gate-explore check 9: every required key present, each `variation` belongs to that piece in `kit.ts` (reuse `parseKitVariations`), each `donor` in `manifest.references_surveyed` (block naming the piece, the variation and the nearest valid ids); check 10: the sheet's `data-kit-piece` variations for navigation/footer/cta/forms equal the registry's (read `.palate/explore/seed/S<N>.dc.html`).
- Produces: the sheet's blocks get a caption line rendered by the AUTHOR (doctrine) but `boards-render` verifies each required block's caption text contains its `variation` and `donor` ("Navigation: NavSimple, drawn from aesop"); refuse otherwise.

- [ ] Tests first (gate-explore: missing piece, unknown variation, variation under the wrong piece, donor not surveyed, sheet mismatch; boards-render: caption missing the donor) -> fail -> implement -> green -> mutations -> suites -> commit `provenance: every piece names its kit variation and its donor, and the sheet agrees`.

---

### Task 4: The judge on three surfaces

**Files:**
- Modify: `scripts/reference-capture/ladder-local.mjs` (`buildBoardPair` accepts `surface` and `question`; `scoreBoardPair` unchanged), `scripts/gate-board-judge.mjs` (three pairs per direction; the donor's foot crop), `scripts/boards-render.mjs` (fetch the donor's `full.png` too: `hero_url.replace(/desktop\.png$/, "full.png")`, save `shots/<id>/donor-full.jpg` under 70 KB is NOT required for a shot: keep it as PNG/JPEG under 400 KB in shots only), `scripts/gate-explore.mjs` (check 8 reads `rung`, unchanged)
- Test: `scripts/test/ladder-local.test.mjs`, `scripts/test/gate-board-judge.test.mjs`, `scripts/test/boards-render.test.mjs`

**Interfaces:**
- Produces: per direction three pairs with ids `<id>:entrance`, `<id>:foot`, `<id>:inner`, each with two swapped comparisons; the foot pair compares the bottom 900 px crop of `shots/<id>/full.png` (written by phase 1 as `shots/<id>/foot.png` via sharp) with the bottom 900 px crop of `shots/<id>/donor-full.jpg` (`donor-foot.png`); the inner pair compares `inner.png` with the donor hero under the question "does this inner page hold the reference's standard"; `board_judgements[] = { id, donor, rung (lowest), rungs: { entrance, foot, inner }, consistent (all three), run_token, judged_at, board_hero }`; phase 2 requires `pairs.length * 2` judgements as before (pairs now 3 per direction).
- [ ] Tests first -> fail -> implement -> green -> mutations (lowest-of-three -> mean; drop the foot crop) -> suites -> commit `judge: the entrance, the foot and the inner page, each against the donor`.

---

### Task 5: "Direction" is the client's word

**Files:**
- Modify: `templates/astro-project/src/pages/explore.astro`, `scripts/boards-render.mjs` (annotations, README, card titles), `scripts/palate-pick.mjs` (messages), `references/explore-stage.md` (the hand-off script), `commands/pick.md`
- Test: `scripts/test/explore-page-boards.test.sh` (assert "Direction 1 of" appears and "rung" does not appear in the built `/explore`), `scripts/test/boards-render.test.mjs` (annotation text), `scripts/test/docs-truth.test.sh` (the hand-off says "which direction")

- [ ] Tests first -> fail -> implement -> green -> commit `direction: the client's word on /explore, the canvas and the pick`.

---

### Task 6: The motion proof is measured, not declared

**Files:**
- Create: `scripts/motion-proof.mjs`
- Modify: `scripts/palate-pick.mjs` (`--proof` runs the probe; refuses on no measurable motion; records `explore.proof.measured`), `scripts/gate-done.sh` (the proof branch reads `explore.proof.measured`, skip-with-reason when absent), `references/explore-stage.md` (Compose step 1), `SKILL.md` A.6
- Test: create `scripts/test/motion-proof.test.mjs`, extend `scripts/test/palate-pick.test.mjs`, `scripts/test/gate-done.test.sh`

**Interfaces:**
- Produces: `node scripts/motion-proof.mjs <url> [--json <path>]` opens the URL at 1440x900 with the vendored Playwright, records: the sticky header's height before and after an 800 px scroll; for every `<img>`, `<video>` and element with a background image inside the first two sections, its `transform` translateY delta over that scroll as a ratio of the scroll distance; the count of elements whose computed `animationName !== "none"`; whether any element's computed style changed between two samples 600 ms apart with no input (a running marquee or loop); and honours `prefers-reduced-motion: reduce` on a second pass, reporting what still moves. Exit 0 with a JSON summary `{ url, header: { before, after }, parallax: [{ selector, ratio }], animated: n, running: n, reduced: { animated, running } }`; exit 2 `motion-proof: skipped (<reason>)` when the URL does not load.
- Produces: `palate-pick.mjs --proof <url>` runs the probe first; REFUSES (exit 1) when `animated === 0 && running === 0 && every parallax ratio < 0.05 && header unchanged` with "nothing measurable moves at <url>; the motion proof is what the client was promised, build it before recording it"; otherwise records `explore.proof = { url, verified_at, measured: <summary> }`. `--proof-unmeasured "<reason>"` records the URL with `measured: null, reason` for a page the probe cannot reach (a tunnel, an auth wall). gate-done's proof branch: `measured` absent and no reason -> skip naming the flag.
- Doctrine: Compose step 1 says the hero is built, then `--proof` MEASURES it, and the measurements must match the board's motion note in kind (a promised parallax must register as a parallax ratio, a promised marquee as `running`); a mismatch is a Compose defect, not a proof.

- [ ] Tests first (probe: a fixture page with a scroll-linked transform and a CSS animation reports ratio > 0.3 and animated 1; a static page reports zeros; reduced-motion pass reports 0 running; pick: refuses on the static page, records `measured` on the moving one, `--proof-unmeasured` records the reason; gate-done: measured absent + no reason -> skip naming `--proof`) -> fail -> implement -> green -> mutations (drop the refusal; drop the reduced pass) -> suites -> commit `proof: the motion is measured before it is recorded`.

---

### Task 7: Doctrine, then release beta.21

**Files:** `references/explore-stage.md` (step 2 gains the four kinds, the sheet's required blocks, the provenance captions, the specimen ban; step 2b the five stills and the row layout; the judge block's three surfaces), `SKILL.md` A.4, `references/build-manifest.md`, `commands/README.md`, `agents/palate-verifier.md` (the judge block count), `scripts/test/docs-truth.test.sh`.
- [ ] docs-truth assertions first; write; suites green; commit `doctrine: the presentation set, provenance, the three-surface judge`; then `git push origin beta`, `sync-beta.sh ~/dev/palate/skill 1.17.0-beta.21`, bump, `check-tracks.sh` 15/15, commit, push. Report SHAs and counts.
