# Compose as a design act: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the pick, every page of the build is composed as a design act, judged on the built page by the same pairwise instrument that judged the boards, with the look recorded, the home's framing measured against the board, the local grade's ladder wired to done, and repeated section shapes caught mechanically.

**Architecture:** One new record on the manifest, `compose`, written only by `scripts/palate-pick.mjs` (the agent invokes it; the hook never writes judgement fields). Two new gates, `gate-page-judge.mjs` (reusing `ladder-local.mjs`'s `buildBoardPair` / `scoreBoardPair` and `gate-board-judge.mjs`'s bar) and `gate-taste.mjs` (reads `local-grade.json`). Three extensions: `gate-fidelity.mjs` measures framing, `verify-rendered.mjs` reports repeated silhouettes, `gate-done.sh` gains three sub-gates (`look`, `page-judge`, `taste`) through `gate_classify` / `gate_record` with names added to its roll-call line. Doctrine last, pinned by docs-truth.

**Tech Stack:** Node ESM scripts, Playwright (vendored under `scripts/reference-capture/node_modules`), bash gates, `node --test` and bash test suites.

**Spec:** `docs/superpowers/specs/2026-09-12-compose-design-act.md`

## Global Constraints

- Branch `beta` of `/Users/jakeshelley/dev/palate/skill`. Never `main`. Base for Task 1: `07b00fe` (the judge-bar commit, unshipped).
- Australian English, no em dashes, no AI-tell copy; the files' existing register; every doctrine sentence true of the code and of the agent's frontmatter tools (docs-truth pins it).
- Every new gate assertion mutation-checked, stated in the report with command and output.
- Existing exports and artefact paths stay. New: `manifest.compose = { pages: [], overrides: [], page_judgements: [] }`, `.palate/compose/judge-request.json`, `.palate/compose/judgements.json`, `.palate-shots/compose/<route-slug>/{entrance,foot}.png`, `gate-page-judge.mjs`, `gate-taste.mjs`.
- Skip/refusal grammar unchanged: exit 2 with first stderr line `<tool>: skipped (<reason>)` for a skip; exit 1 for findings; `process.exitCode`, never `process.exit()` while a Playwright browser or the ONNX head is open; refusals never delete anything under `.palate/`.
- `RUNGS` and `REFUSED_RUNGS` untouched; the bar is the board judge's.
- `PALATE_GATE_JUDGE=0` releases `page-judge` as it releases the board judge; `PALATE_GATE_LOOK=0`, `PALATE_GATE_TASTE=0` release theirs; every release prints a named skip note, never `fail()`.
- Manifest fields that carry judgement are SCRIPT-set: `palate-pick.mjs` and the gates write `compose.*`; `hooks/palate-manifest.mjs` is not touched.
- Fast suite green (`bash scripts/test/run.sh --fast`, 86 passed / 0 failed / 9 skipped today, more suites allowed), run in the foreground; slow suites touched run directly and quoted; `gate-done.test.sh`'s roll-call assertion (L110-117) must keep matching the headline count.
- `core-doctrine.md` untouched (byte budget); the template mirror under `templates/astro-project/_claude/` kept in step where the sync guard demands.
- The route slug for a path is `"/" -> "home"`, otherwise the path with slashes trimmed and replaced by `-` (`/security-windows/` -> `security-windows`).

---

### Task 1: The Compose record: the look and the override, written by the pick command and required at done

**Files:**
- Modify: `scripts/palate-pick.mjs` (the read-patch-write idiom at L69-354; new flags beside `--proof`)
- Modify: `scripts/gate-done.sh` (new sub-gate block `look` between `explore` L585 and `fidelity` L614; roll-call line L670)
- Modify: `references/build-manifest.md` (document `compose.pages[]`, `compose.overrides[]`)
- Test: `scripts/test/palate-pick.test.mjs`, `scripts/test/gate-done.test.sh`

**Interfaces:**
- Produces: `manifest.compose.pages[] = { route, page_type, shot, shot_sha256, looked_at, verdict }`; `manifest.compose.overrides[] = { route, section, what, reason, recorded_at }`; `pageTypeOf(route)` exported from `palate-pick.mjs` (`"/"` -> `home`; `/contact*` -> `contact`; `/about*` -> `about`; `/client-reviews*`, `/reviews*`, `/testimonials*` -> `reviews`; `/lp*`, `/landing*` -> `landing`; anything else -> `service`).
- Consumes: `explore.picks` (a look is only required once a pick exists).

- [ ] **Step 1: Failing tests in `palate-pick.test.mjs`** (node --test, same fixtures as the `--proof` cases): `--looked / --shot .palate-shots/desktop-full.png --verdict "The hero bleeds like the board, the wordmark sits on the photo, the band's two columns share a baseline"` records one `compose.pages[]` entry with `shot_sha256` equal to `sha256` of the file, `page_type: "home"`; a shot outside `.palate-shots/` is refused (`the look must be a screenshot under .palate-shots/`); a shot older than `dist/client/<route>/index.html` (touch the html newer) is refused (`older than the built page`); a verdict under 40 characters or matching one of `["looks good", "matches the board", "no issues", "as designed", "fine"]` case-insensitively is refused with the phrase named; a second `--looked` for the same route replaces the first (one entry per route, `looked_at` moves); `--override /security-windows --section hero --what "photo inset instead of bleed" --reason "the only photo under 900px wide is soft at full bleed"` records `compose.overrides[]`; `--override` without `--reason` is refused; `--looked` combined with `--proof` in one call is refused (one record per call, as `--canvas-url`/`--canvas-skipped` already are).
- [ ] **Step 2: Run, watch them fail** (`node --test scripts/test/palate-pick.test.mjs`).
- [ ] **Step 3: Implement** in `palate-pick.mjs`: parse the new flags; `sha256` via `node:crypto`; resolve the built page as `dist/client/<route>/index.html` else `dist/<route>/index.html` else `dist/client/index.html` for `/`; compare `mtimeMs`; write `patch.compose.pages` / `patch.compose.overrides` merged with the existing arrays (replace by `route` for pages; append for overrides). Export `pageTypeOf` and `routeSlug`.
- [ ] **Step 4: Failing tests in `gate-done.test.sh`**: with `explore.picks` present and no `compose.pages`, the done gate prints `look: no page has a recorded look` and the sub-gate reads `look=fail`; with `compose.pages` covering `home` only while `dist/client/security-windows/index.html` exists, it names `security-windows` (`look: 1 page type never looked at: service (/security-windows)`); with one look per page type present, `look=pass`; with no pick, `look=skipped (no pick recorded)`; `PALATE_GATE_LOOK=0` prints the named release. Page types discovered from `dist/client/**/index.html` through `pageTypeOf`, kit and explore routes excluded (`/kit`, `/kit-frame`, `/explore`, `/404`, `/thank-you`).
- [ ] **Step 5: Implement** the `look` block in `gate-done.sh` as a small `node -e` (or `scripts/gate-look.mjs`, preferred, following the gate contract) and register the note in the roll-call line; update `gate-done.test.sh`'s roll-call count.
- [ ] **Step 6: Document** `compose.pages[]` and `compose.overrides[]` in `references/build-manifest.md`.
- [ ] **Step 7: Mutation-check** (remove the age check, the phrase list, the per-type discovery) and watch each assertion fail; suites green; commit `compose: the look and the override are recorded by the pick command and required at done`.

---

### Task 2: The judge on the built pages

**Files:**
- Create: `scripts/gate-page-judge.mjs`
- Modify: `scripts/gate-board-judge.mjs` (export the request/record helpers the page judge reuses: `fingerprint(path)`, `writeRequest`, `readJudgements`, `scorePairs`, `staleness` checks; no behaviour change)
- Modify: `scripts/reference-capture/ladder-local.mjs` (add `PAGE_QUESTION` and `PAGE_FOOT_QUESTION` beside `BOARD_*`; `buildBoardPair` already takes `surface` and `question`)
- Modify: `scripts/gate-done.sh` (sub-gate `page-judge` after `look`), `references/build-manifest.md` (`compose.page_judgements[]`)
- Test: `scripts/test/gate-page-judge.test.mjs` (new), `scripts/test/gate-board-judge.test.mjs` (exports still behave), `scripts/test/gate-done.test.sh`

**Interfaces:**
- Consumes: `explore.picks[]` (`variant_id` of the hero pick), `.palate/explore/shots/<id>/{hero.png,foot.png,inner.png,donor.jpg,donor-foot.png}`, `compose.pages[]` (the routes to judge: one per page type, the looked route), `compose.overrides[]` (printed beside a refused surface), `REFUSED_RUNGS` / `refusedRung` from `gate-board-judge.mjs`.
- Produces: phase 1 `.palate/compose/judge-request.json` `{ runToken, questions, rungs, pairs: [ { id: "<slug>:<surface>@<token>", route, page_type, surface, candidate, candidate_sha, donor|board, comparisons: [2], question, rungs } ] }`; the built stills `.palate-shots/compose/<slug>/entrance.png` (1440x900) and `foot.png` (the bottom 900 px of a full-page shot, cropped with sharp); phase 2 `--judgements <file>` records `manifest.compose.page_judgements[] = { route, page_type, surfaces: ["entrance","foot"], rungs: { entrance, foot }, rung, against: { entrance: "<path>", foot: "<path>" }, fingerprints: { entrance_sha, foot_sha, html_sha }, judged_at, run_token }`.

- [ ] **Step 1: Failing tests** in `gate-page-judge.test.mjs` with a fixture project (a `dist/client` with three routes, a picked board's shots, a looked `compose.pages` for each page type, a served URL via the test's own static server or `--serve`): phase 1 shoots entrance and foot per looked route and writes six pairs for three routes (home entrance vs `hero.png`, home foot vs `foot.png`, service entrance vs `donor.jpg`, service foot vs `donor-foot.png`, contact likewise), each with two comparisons and `candidate_is`; a missing pick skips (`gate-page-judge: skipped (no pick recorded)`); a looked route with no built HTML is refused naming it; phase 2 with all `comparable` passes and records `rungs`; one `somewhat_worse` on the service foot refuses naming `/security-windows foot: somewhat worse than the donor's ending` and prints any override for that route; a judgement whose `candidate_is` does not echo is refused; a rebuilt page (html sha changed after phase 1) is refused as stale; `PALATE_GATE_JUDGE=0` releases; missing sharp skips loudly with the setup command named.
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Implement** `gate-page-judge.mjs`: `main(argv)`; `--serve <url>` else build dir over `file://` like `gate-fidelity.mjs` L146; Playwright at 1440x900 for the entrance, full-page for the foot (sharp crop as `boards-render.mjs` does for `donor-foot.png`); pairs through `buildBoardPair` with `surface` `entrance|foot` and the new questions; write the request; phase 2 through `scoreBoardPair`, the lowest rung per route, `refusedRung` for the verdict; `record()` writes `compose.page_judgements` replacing the entry for the route; `process.exitCode`, browser closed in `finally`.
- [ ] **Step 4: gate-done** block `page-judge`: skip when no pick; refuse when a looked page type has no judgement, a refused judgement, or `fingerprints.html_sha` differs from the built HTML now; note in the roll-call.
- [ ] **Step 5: Mutation-check** (drop the foot pair, accept a non-echoed `candidate_is`, skip the html staleness) and watch each fail; run `node --test scripts/test/gate-page-judge.test.mjs scripts/test/gate-board-judge.test.mjs scripts/test/ladder-local.test.mjs`, `bash scripts/test/gate-done.test.sh`; commit `judge: the built pages, entrance and foot, against the board and the donor`.

---

### Task 3: Fidelity measures framing

**Files:**
- Modify: `scripts/gate-fidelity.mjs` (inside `measureHeroScope()` L353-380 and the findings block L458-586)
- Test: `scripts/test/gate-fidelity.test.mjs`

**Interfaces:**
- Consumes: the board's `rendered.html` and the built home (already loaded); `compose.overrides[]` from Task 1 (route `/`, `section`, `reason`).
- Produces: three new findings: `the hero's framing is not the picked board's (board: bleed, built: inset)`, `the h1 is not the picked board's (board 64px above the media, built 28px below)`, `section <id> is <n>% shorter than on the board`; each suppressed by a matching override, which is printed as `override on /, hero: <reason>`.

- [ ] **Step 1: Failing tests**: a fixture board with a bleed hero (media box width 1440 within 8 px) and a built home with the same media inset (width 1200) -> the framing finding; the built h1 at 40% of the board's size -> the h1 finding; a carried section 40% shorter -> the height finding; each of the three with a recorded override -> no finding and the reason printed; unchanged pages -> none of the three.
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Implement**: in `page.evaluate`, for the hero section find the largest `img, video, picture, [style*="background-image"]` box and classify `bleed` when its width is within 8 px of `innerWidth`; read the first `h1`'s computed font size and whether its top is above or below the media's top; read each carried section's `getBoundingClientRect().height`. Compare with the same reads on the board. Tolerances 15% (h1) and 25% (section height).
- [ ] **Step 4: Mutation-check** (widen the bleed tolerance to 400 px, drop the override suppression) and watch fail; `node --test scripts/test/gate-fidelity.test.mjs`; commit `fidelity: framing, the h1 and section heights, with a recorded override as the only excuse`.

---

### Task 4: The local grade's ladder is a done sub-gate

**Files:**
- Create: `scripts/gate-taste.mjs`
- Modify: `scripts/gate-done.sh` (sub-gate `taste` after `page-judge`), `references/local-grade.md` (the grade runs before done), `SKILL.md` A.12 (one sentence: the full local grade runs before done and `gate-taste` reads it)
- Test: `scripts/test/gate-taste.test.mjs` (new), `scripts/test/gate-done.test.sh`, `scripts/test/docs-truth.test.sh` (two pins)

**Interfaces:**
- Consumes: `local-grade.json` at `.palate-shots/local-grade.json` or the `--out` directory recorded in `.palate-shots/local-grade-state.json` (`grade-local.mjs` L79-86 writes the state beside the result; read `OUT_DIR` from it), shape `{ ladder: { applicable, rung, meanRaw, results }, flattery: { risk, honestRange, tastePercentile } | null, taste: { percentile }, overall, findings[] }`.
- Produces: exit 0 when `ladder.applicable` and `ladder.rung` is `comparable` or `better` and `!flattery?.risk`; exit 1 naming the rung, the taste percentile, the honest range and the first finding's `detail` + `fix`; exit 2 `gate-taste: skipped (the local grade has not run: node scripts/reference-capture/grade-local.mjs ...)` when the file is absent, and `skipped (the ladder was not applicable: <reason>)` when `ladder.applicable` is false.

- [ ] **Step 1: Failing tests** for the four outcomes above plus a malformed file (refused as corrupt, never treated as a pass) and `PALATE_GATE_TASTE=0`.
- [ ] **Step 2: Watch them fail; implement; gate-done block + roll-call; docs-truth pins for the A.12 sentence and `local-grade.md`.**
- [ ] **Step 3: Mutation-check** (treat `somewhat_worse` as passing; ignore `flattery.risk`) and watch fail; suites; commit `taste: the local grade's ladder refuses a build read worse than its exemplar`.

---

### Task 5: Repeated silhouettes are a rendered finding

**Files:**
- Modify: `scripts/verify-rendered.mjs` (beside the dead-space measurement; the positive-failures path `positiveFailures()` in `hooks/palate-stop.mjs` already blocks on findings it emits, confirm the finding id is in the set it reads or extend that set), `references/rendered-bug-classes.md` (one entry)
- Test: `scripts/test/verify-rendered-deadspace.test.mjs` (extend, or a sibling `verify-rendered-silhouette.test.mjs`), `scripts/test/docs-truth.test.sh` (one pin)

**Interfaces:**
- Produces: finding `repeated-silhouette` `{ page, sections: [a, b], why: "same child count (5), same columns (5), aspect within 10%, same ground" }` for two CONSECUTIVE `[data-section-id]` (or top-level `section`) elements whose silhouette matches on all four; a section carrying `data-palate-repeat="deliberate"` is exempt and named in a note.

- [ ] **Step 1: Failing tests**: a fixture page with two identical five-card grids back to back -> one finding naming both; the same with `data-palate-repeat="deliberate"` on the second -> no finding, a note; two grids separated by a statement band -> no finding; two grids with different column counts -> no finding.
- [ ] **Step 2: Watch fail; implement** (child count of the section's main grid, `grid-template-columns` track count or flex children on one row, section aspect from its rect, ground from computed `background-color`); rendered-bug-classes entry; docs-truth pin.
- [ ] **Step 3: Mutation-check** (drop the consecutive condition) and watch fail; suites; commit `rendered: two consecutive sections with one silhouette are a finding`.

---

### Task 6: Doctrine: Compose is a design act, the judge on the built pages, the recorded look, the rubric demoted

**Files:**
- Modify: `SKILL.md` A.6 (rewrite: the page-by-page design act, the lift and the override, the sheet as vocabulary, photographs cropped by looking, no inset-at-native-size fallback, the look recorded with `--looked`, the page judge dispatched by the main agent like the board judge, the fidelity framing measurements), A.9 (the rubric's six axes are the verifier's working notes and no longer the gate; the judge is), the gates list at item 11 (the three new sub-gates), A.12 (the local grade before done)
- Modify: `references/explore-stage.md` "Compose" (L958-974; the lift, the override record, one page type composed once with per-route photographs), `agents/palate-verifier.md` (step 5: the axes are notes; a new step stating the page-judge comparisons, dispatch stays with the main agent), `references/build-manifest.md` (`compose.*` complete), `commands/pick.md` (`--looked`, `--override`), `commands/README.md`, `references/asset-sourcing.md` or `references/image-optimisation.md` (whichever holds the photo rules: the crop-by-looking rule and the never-inset-at-native-size rule)
- Test: `scripts/test/docs-truth.test.sh` (pins for every new sentence; retarget the pins that quote "the rest of the site's pages" and the rubric as a gate), `scripts/test/doctrine-consistency.test.sh`

- [ ] **Step 1: Pins first, watched failing.**
- [ ] **Step 2: Write the doctrine** in the files' register; every sentence true of Tasks 1 to 5.
- [ ] **Step 3: `bash scripts/test/docs-truth.test.sh`, `bash scripts/test/doctrine-consistency.test.sh`, `bash scripts/test/run.sh --fast`; commit `doctrine: Compose is a design act, judged on the built page, with the look recorded`.**

---

### Task 7: Release beta.22 (controller-run)

- [ ] Whole-plan review, fix wave, re-review.
- [ ] `git push origin beta`; `sync-beta.sh ~/dev/palate/skill 1.17.0-beta.22`; bump `marketplace.json`; `check-tracks.sh` 15/15; commit; push. The judge-bar commit `07b00fe` ships in the same release.
- [ ] Changelog and memory; the eastcoast re-run on beta.22 is the acceptance test.

## Self-review

- Spec 1 (design act, lift, override, photos): Task 6 doctrine + Task 1 override record + Task 3 override suppression. Spec 2 (judge on built pages, gate, rubric demoted): Task 2 + Task 6. Spec 3 (look): Task 1. Spec 4 (framing): Task 3. Spec 5 (taste): Task 4. Spec 6 (silhouette): Task 5.
- Type consistency: `compose.pages[]`, `compose.overrides[]`, `compose.page_judgements[]` named identically in Tasks 1, 2, 3 and 6; `pageTypeOf` / `routeSlug` from Task 1 used by Tasks 2 and the look gate; `REFUSED_RUNGS` / `refusedRung` from `gate-board-judge.mjs` used by Task 2.
- Order: Task 1 first (the record everything reads). Tasks 3 and 5 are file-disjoint from Task 2 and may run in parallel with it. Task 4 after Task 2 (both edit `gate-done.sh`). Task 6 last.
