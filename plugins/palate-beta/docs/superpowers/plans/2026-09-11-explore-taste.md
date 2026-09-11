# Explore Taste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Explore board is drawn beside its donor's real hero and judged against it before anyone sees it; a board clearly worse than its donor is refused, at every intensity.

**Architecture:** The surveyor records each rung donor's public hero URL and its taste layers in `.palate/explore/donor-heroes.json`. `boards-render.mjs` fetches the hero, writes a donor card artboard beside each board on the canvas, and a still for `/explore`. A new `gate-board-judge.mjs` builds two swapped comparisons per board on the ladder's rung scale (reusing `ladder-local.mjs` primitives), the verifier's fresh subagents judge them, phase 2 scores with lower-rung-wins and refuses `clearly_worse`; `gate-explore.mjs` refuses a shown board with no judgement. Doctrine carries the drawing brief.

**Tech Stack:** Node ESM, bash tests, the vendored Playwright + sharp under `scripts/reference-capture/`, Astro 5 template.

**Spec:** `docs/superpowers/specs/2026-09-11-explore-taste.md`

## Global Constraints

- Branch `beta` of `/Users/jakeshelley/dev/palate/skill`. Never `main`.
- Australian English, no em dashes, no AI-tell copy; the file's existing register; every doctrine sentence true of the code.
- Every new gate assertion mutation-checked (watched failing with the fix reverted), stated in the report with command and output.
- `RUNGS` in `scripts/reference-capture/ladder-local.mjs` is byte-pinned to the grader (`ladder-local.test.mjs`): never edit it. Add exports beside it; do not change `buildLadderRequest`, `validateJudgements` or `scoreLadder` behaviour.
- Existing artefact paths and exports of `boards-render.mjs` stay (see the canvas-first plan's constraints); new artefacts: `.palate/explore/donor-heroes.json` (surveyor-written), `.palate/explore/seed/D<rung>.dc.html`, `.palate/explore/seed/d<rung>-hero.jpg`, `.palate/explore/shots/<id>/donor.jpg`, `public/_explore/<id>-donor.jpg`, `.palate/explore/judge-request.json`, `.palate/explore/judgements.json`, `manifest.explore.board_judgements[]`.
- `.palate/donors.json` (stop-hook lineage) is a different file; never write it here.
- No new metered MCP call: the donor hero URL is the `assets.desktop` URL the surveyor already receives from `refs_get_screenshot`; it is fetched over plain HTTPS.
- Refusals never delete the seed. Exit 0 ok / 2 refusal / skip = exit 2 with first stderr line `<tool>: skipped (<reason>)`. `process.exitCode`, never `process.exit()` mid-Playwright.
- Fast suite green: `bash scripts/test/run.sh --fast` (85 passed / 0 failed / 8 skipped today); slow suites touched (`boards-render.test.mjs`, `explore-page-boards.test.sh`) run directly and quoted.

---

### Task 1: Donor heroes on disk and beside each board on the canvas

**Files:**
- Modify: `agents/palate-surveyor.md` (the DONORS packet block ~122-131, the fan-out list, the CALIBRATION ROW section ~81-110)
- Modify: `scripts/boards-render.mjs` (`loadRefs` ~602, `writeRefs` ~620, `refArtboard` ~739, `writeCanvasJson` 443-498, `recordShown` ~815, `main()`)
- Modify: `templates/astro-project/src/pages/explore.astro` (the rung card ~184-206)
- Test: `scripts/test/boards-render.test.mjs`, `scripts/test/explore-page-boards.test.sh`

**Interfaces:**
- Produces: `.palate/explore/donor-heroes.json` = `[{ rung: 1, slug, name, hero_url, signature_move, component_prompts: [..], copy_voice, do_dont: [..] }]`, one entry per registered rung; validated by `loadDonors(projectDir, path)` exported from boards-render (every field present; `hero_url` https; `rung` integer; one per rung; a registered board with no entry is a refusal naming the rung and the file).
- Produces: `boards-render.mjs` flag `--donors <path>` (default `.palate/explore/donor-heroes.json`; `--no-donors` to run without, which is recorded as `explore.donor_row = { skipped: true }`); fetches each `hero_url` with `fetch()` (10 s timeout; a failed fetch is a refusal naming the URL), re-encodes under 70 KB via the existing `fitUnder`, writes `seed/d<rung>-hero.jpg`, `seed/D<rung>.dc.html` via `refArtboard`-shaped `donorArtboard({ rung, slug, name, signature_move, img })` (720 x 580, title `Donor for rung N: <name>`, the signature move as the one line of text), `shots/<id>/donor.jpg`, `public/_explore/<id>-donor.jpg`.
- Produces: `writeCanvasJson({ boards, refs, donors, out })` lays `D<rung>` at `{ x: board.x + FRAME_WIDTH + FRAME_GAP, y: boardY, w: 720, h: 580 }` and steps `bx` by `FRAME_WIDTH + FRAME_GAP + REF_WIDTH + FRAME_GAP` when a donor exists for that board; a `donor-<id>` annotation under the donor card: "Drawn from <slug>: <signature_move>".
- Produces: `recordShown` also writes `explore.shown = boards.map(b => ({ id, name, donor_slug: b.donor, position: b.ambition }))` (the stop hook reads `donor_slug`).
- Produces: `/explore` rung card shows `<img src="/_explore/<id>-donor.jpg">` captioned "Drawn from <donor>" beside the board still when the file exists (the page cannot check the file: render it when `v.donor` is set; boards-render guarantees the file for every registered board when donors ran).

- [ ] **Step 1: Failing tests.** In `boards-render.test.mjs`: `loadDonors` refuses a missing rung, a non-https url, a duplicate rung; the integration case writes a `donor-heroes.json` whose `hero_url` points at a local `http://127.0.0.1:<port>/hero.png` served by a tiny `http.createServer` in the test (the fixture PNG), runs the CLI, asserts `seed/D1.dc.html`, `seed/d1-hero.jpg` (≤ 70 KB), `shots/b1/donor.jpg`, `public/_explore/b1-donor.jpg`, `canvas.json` has `D1.dc.html` at `x = 1440 + 80` and the same `y` as `B1.dc.html`, and B2 at `x = 1440 + 80 + 720 + 80`; a registry with a board whose rung has no donor entry exits 2 naming `rung 2` and `donor-heroes.json` and leaves `seed/B1.dc.html` in place; `--no-donors` runs without the file and records `explore.donor_row.skipped`. In `explore-page-boards.test.sh`: write `public/_explore/b1-donor.jpg` and assert the card carries `src="/_explore/b1-donor.jpg"` and "Drawn from the-modern-house".
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** `loadDonors`, the fetch + re-encode, `donorArtboard`, the layout, `recordShown`'s `shown`, the `/explore` card, and the surveyor packet: the DONORS block becomes

```
DONORS (>=3, one per rung in ladder order, each with its hero on disk):
  - rung <N>: <slug> - borrow: <...> - signature move: <one line> - hero: <assets.desktop URL from refs_get_screenshot>
Written to .palate/explore/donor-heroes.json as [{ rung, slug, name, hero_url, signature_move, component_prompts, copy_voice, do_dont }]
```
with the instruction that the URL is the one `refs_get_screenshot { slug }` returned (no extra call), and that `component_prompts` / `copy_voice` / `do_dont` are the two or three lines from `refs_get` layers the board will reproduce. Keep the calibration row as is and say in one sentence how it differs (the range of the vertical, not the rung's donor).
- [ ] **Step 4: Run green; mutations** (drop the missing-rung refusal; drop the layout pairing) watched failing; `node --test scripts/test/boards-render.test.mjs`, `bash scripts/test/explore-page-boards.test.sh`, `bash scripts/test/hook-donors.test.sh`, fast suite.
- [ ] **Step 5: Commit** `boards: the donor's hero sits beside its board on the canvas and on /explore`

---

### Task 2: The board judge

**Files:**
- Modify: `scripts/reference-capture/ladder-local.mjs` (add exports beside the existing ones; touch nothing existing)
- Create: `scripts/gate-board-judge.mjs`
- Modify: `scripts/gate-explore.mjs` (a new check: a shown board with no judgement blocks)
- Test: `scripts/test/ladder-local.test.mjs` (new cases), create `scripts/test/gate-board-judge.test.mjs`, `scripts/test/gate-explore.test.sh` (new cases)

**Interfaces:**
- Produces in ladder-local: `export function buildBoardPair({ id, boardPath, donorPath, donorSlug, runToken })` → `{ id, runToken, comparisons: [ { id: `${id}:board-first@${runToken}`, candidate_is: "A", A: boardPath, B: donorPath }, { id: `${id}:donor-first@${runToken}`, candidate_is: "B", A: donorPath, B: boardPath } ], question, rungs: RUNGS.map(r => r.id) }` where `question` is the fixed text: "Two home page entrances, one drawn for this client and one a library reference in its field. On the four rungs, how does the candidate compare to the reference as a piece of design a senior designer would deliver to a paying client? Judge composition, type, hierarchy, restraint and specificity; ignore that one is a drawing." `export function scoreBoardPair(pair, judgements)` → `{ id, rung: <id of the LOWER rung across the two orders>, consistent: |i1 - i2| <= 1, verdicts: [a, b] }`; throws on a missing, duplicate, unknown or wrong-`candidate_is` judgement (reuse the strictness of `validateJudgements`, do not call it: its request shape differs).
- Produces `gate-board-judge.mjs`: phase 1 `node scripts/gate-board-judge.mjs <projectDir>` reads the registry (`parseRegistry` from boards-render), requires `shots/<id>/hero.png` and `shots/<id>/donor.jpg` for every board (missing → `gate-board-judge: skipped (<reason>)` exit 2, naming what to run first), writes `.palate/explore/judge-request.json` = `{ runToken, question, rungs, pairs: [...] }` and prints the path; phase 2 `--judgements <file>` reads `[{ id, verdict }]`, scores every pair, records `manifest.explore.board_judgements = [{ id, donor, rung, consistent, run_token, judged_at }]` through manifest-merge, exits 0 when no board is `clearly_worse`, else exit 2 with stderr `gate-board-judge: <id> (<donor>) judged clearly worse than its donor: <verdict a> / <verdict b>. Redraw it from the donor's hero before the canvas is published.` `PALATE_GATE_JUDGE=0` → `skipped (PALATE_GATE_JUDGE=0)`.
- Produces in gate-explore: when `manifest.explore.shown_at` exists and `PALATE_GATE_JUDGE !== "0"`, every registered board id must appear in `explore.board_judgements` with `rung !== "clearly_worse"`; else block naming the board and `scripts/gate-board-judge.mjs`.

- [ ] **Step 1: Failing tests.** ladder-local: `buildBoardPair` yields two comparisons with swapped `candidate_is` and the token in both ids; `scoreBoardPair` takes the lower rung (`comparable` + `somewhat_worse` → `somewhat_worse`), flags inconsistency at a two-rung gap, throws on a missing judgement, a duplicate, an unknown rung, a wrong `candidate_is`. gate-board-judge: fixture project with two boards, `hero.png` and `donor.jpg` each (any PNG/JPEG bytes); phase 1 writes the request with four comparisons; phase 2 with all `comparable` exits 0 and records two judgements; phase 2 with b2 `clearly_worse` in both orders exits 2 naming b2 and its donor and STILL records both judgements; missing `donor.jpg` → skipped line; `PALATE_GATE_JUDGE=0` → skipped. gate-explore: shown build, two boards, judgements for one → block naming the other; judgement `clearly_worse` → block; both `comparable` → pass; `PALATE_GATE_JUDGE=0` → pass.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** `runToken` = 8 hex chars from `crypto.randomBytes`. Phase 2 validates `judgements.length === pairs.length * 2` before scoring so a partial file cannot pass.
- [ ] **Step 4: Run green; mutations** (lower-rung → higher-rung; drop the `clearly_worse` refusal; drop gate-explore's check) watched failing; `node --test scripts/test/ladder-local.test.mjs scripts/test/gate-board-judge.test.mjs`, `bash scripts/test/gate-explore.test.sh`, fast suite.
- [ ] **Step 5: Commit** `judge: every board is compared with its donor on the rung scale; clearly worse is refused`

---

### Task 3: The verifier runs the judge, and the doctrine carries the drawing brief

**Files:**
- Modify: `agents/palate-verifier.md` (after step 2b: a new step 2c)
- Modify: `references/explore-stage.md` (step 2 "Draw the boards" ~51-57 and the judged-half block ~104-120; step 2b command line; the artefact list; the calibration-row section ~339-359)
- Modify: `SKILL.md` A.4 (one sentence on the donor beside the board and the judge), line ~226 (the per-Explore-round gate list)
- Modify: `references/build-manifest.md` (`explore.shown[].donor_slug`, `explore.board_judgements`, `explore.donor_row`), `commands/README.md` (the artefact table), `references/cache-invalidation.md`
- Test: `scripts/test/docs-truth.test.sh` (assertions: explore-stage names `donor-heroes.json`, `gate-board-judge.mjs`, `clearly_worse`; SKILL.md A.4 names the judge; palate-verifier.md names step 2c)

**Interfaces:**
- Verifier step 2c, in the file's register: run phase 1; for EACH comparison in `judge-request.json` dispatch ONE fresh subagent (no build context, the two images by path, the question, the four rungs, answer with one rung id) and collect `[{ id, verdict }]` into `.palate/explore/judgements.json`; run phase 2; report its stderr verbatim; a refused board goes back to the drawing step (three attempts, then drop the rung), and the canvas is not published until every board passes.
- Doctrine, step 2 "Draw the boards", the brief: read `donor-heroes.json[rung]` and the kit grounding for the pieces the rhythm uses; draw FROM the donor's hero (composition, weight, negative space, the signature move) and its component prompts, in its rhythm, with the conversion spine (phone-first CTA, trust, locality) where the library places it; re-skin to the locked brand; the registry `why` names what was taken from the donor; the judged half is now the donor comparison, not the agent's own eye alone.

- [ ] **Step 1: docs-truth assertions first, watch them fail.**
- [ ] **Step 2: Write the doctrine** in each file; regenerate skill-lite if `core-doctrine.md` changes (prefer not to touch it).
- [ ] **Step 3: `bash scripts/test/docs-truth.test.sh`, `doctrine-consistency.test.sh`, `skill-lite-sync.test.sh`, fast suite green.**
- [ ] **Step 4: Commit** `doctrine: the drawing brief, the donor beside the board, the judge before the canvas`

---

### Task 4: Release beta.18

- [ ] `bash scripts/test/run.sh --fast` green; `git push origin beta`.
- [ ] In `~/dev/palate-marketplace`: `./scripts/sync-beta.sh ~/dev/palate/skill 1.17.0-beta.18`, bump `plugins[palate-beta].version`, `./scripts/check-tracks.sh` = 15/15, commit, push.
- [ ] Report SHAs and test counts; the eastcoast re-run is the acceptance test.
