# Explore taste: the drawing brief and the every-rung donor judge (spec)

Date: 2026-09-11, after beta.17. Jake: "The canvas designs always need to be visually stunning."
Branch: `beta`.

## The problem

Canvas-first Explore (beta.17) makes the boards fast and complete. It does not make them good.
On the eastcoast v2 build the five Astro boards scored 25 to 28 out of 30 on the visual rubric and
were bland, because that rubric measures hygiene. The one instrument that separates "impressive"
from "fine" is the pairwise comparison against a library exemplar, and it bound only on
high-intensity builds (`gate-done.sh:314`), never on a board, never on a calm commission. And the
donor a rung reproduces is a bare slug in the registry: its hero is never on the canvas, its
signature move, component prompts and copy voice are never handed to the drawing.

## The shape

1. **Donor heroes on disk, free.** Reference screenshots are public objects
   (`<catalogue assets.desktop>`, e.g. `https://<project>.supabase.co/storage/v1/object/public/screenshots/<slug>/desktop.png`),
   and the surveyor already reads each donor with `refs_get_screenshot` during the survey. The
   surveyor now records, per rung donor, `{ slug, hero_url, signature_move, component_prompts[],
   copy_voice, do_dont[] }` in `.palate/explore/donor-heroes.json` (a new file; `.palate/donors.json`
   is the stop hook's and is not touched). No new metered call: the URL is in the response the
   surveyor already paid for.
2. **The donor sits beside its board on the canvas.** `boards-render.mjs --donors
   .palate/explore/donor-heroes.json` (default path, on by default when the file exists) fetches
   each hero over HTTPS, re-encodes it under 70 KB, writes `seed/D<rung>.dc.html` (a donor card:
   the hero, the slug, the signature move in one line) and `public/_explore/<id>-donor.jpg`, and
   lays `D<rung>` at the same `y` as `B<rung>`, to its right (`x = board.x + 1440 + 80`). A
   registered board whose donor has no entry is a refusal, not a silence. `/explore` shows the
   donor still beside each rung card.
3. **The judge runs on every rung, at every intensity.** New `scripts/gate-board-judge.mjs`:
   phase 1 (`<project-dir>`) writes `.palate/explore/judge-request.json` with, per board, TWO
   comparisons (board `hero.png` vs donor hero, both orders, a per-run token in each id), using the
   rung scale exported by `scripts/reference-capture/ladder-local.mjs` (`RUNGS` untouched; a new
   `buildBoardPair({ boardPath, donorPath, id, runToken })` and `scoreBoardPair(judgements)` exported
   beside `buildLadderRequest`). Phase 2 (`--judgements <file>`) validates the judgements (same
   strictness: missing, unknown, duplicate, wrong candidate_is all fail), takes the LOWER rung when
   the two orders disagree, refuses any board at `clearly_worse` (exit 2 naming the board, the donor,
   both verdicts), and records `manifest.explore.board_judgements = [{ id, donor, rung, consistent,
   run_token, judged_at }]` through `manifest-merge.mjs`. The judging subagents are the verifier's
   (one fresh subagent per ordering, as the ladder discipline requires); the verifier's Explore round
   runs the gate. `gate-explore.mjs` refuses a shown build with a board that has no judgement.
   `PALATE_GATE_JUDGE=0` releases it. The high-intensity bold bar in `gate-done.sh` is untouched.
4. **The drawing brief is doctrine.** `references/explore-stage.md` step 2: before drawing rung N,
   the agent reads `donor-heroes.json[N]` and the kit's grounding for the pieces it will use, and
   draws FROM the donor's hero, signature move and component prompts, in the donor's rhythm, with
   the conversion spine (phone-first CTA, trust beat, locality beat) placed where the library places
   it, then re-skins to the locked brand. The board's `why` names what it took from the donor.
5. **The lineage seam is closed.** `boards-render.mjs recordShown` writes `explore.shown[] = { id,
   name, donor_slug, position }` as well as `explore.boards[]`, so the stop hook's `.palate/donors.json`
   records the picked rung's donor.

## Out of scope

Changing `RUNGS` or the grader; SigLIP priors on boards; the high-intensity bold bar.

## Proof

The eastcoast re-run: every board sits beside its donor on the canvas, every board is judged
comparable or better to its donor before Jake sees it, and a board judged clearly worse is redrawn
before the canvas is published.
