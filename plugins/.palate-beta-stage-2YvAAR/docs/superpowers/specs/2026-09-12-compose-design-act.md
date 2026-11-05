# Compose as a design act (spec)

Date: 2026-09-12. Branch `beta`. Jake, after reviewing the eastcoast v3 preview (beta.18): "a tonne
of issues... things are just poorly done in general... it feels like it wasn't even visually self
reviewed... I think if I went to ChatGPT and one-shotted it it would be better." The review
(claude.ai/code/artifact/23f85413) found the cause: after the pick nothing in the process is a design
act. The home page was the picked board degraded by six documented "safety" edits; eighteen inner
pages were assembled from kit pieces in one 22-minute burst with no board, no library call and no
look; every gate measures hygiene, similarity or facts and passed all of it; the visual rubric was
self-scored 4 of 4 with its defects written as "accepted"; the local grade's pairwise ladder said
`somewhat_worse` at the 12.9th taste percentile and is wired to nothing. A fresh agent given the
same facts and photos and forbidden any process out-composed the build in four minutes, and shipped
two named tells and a phone overflow. Jake's sequencing: build this now, ship it as beta.22 with the
judge-bar commit (07b00fe), then re-run eastcoast as the acceptance test.

## The principle

The model composes when it is asked to compose. Compose asks it, page by page, and then the same
instrument that judged the boards judges the pages it built. Everything the control lacked (facts
held to the client's own, contrast, targets, SEO, measured motion, no tells) stays.

## 1. Compose is a design act, page by page

- Doctrine (SKILL.md A.6, `references/explore-stage.md` Compose, `references/build-stages.md`): each
  page of the site is WRITTEN as a designer inside the picked direction, in the register the control
  proved the model has: choose the page's one idea, decide its section rhythm (ground, density and
  media alternate; no two consecutive sections share a silhouette), choose and crop its photographs
  by looking at them, then build it. The direction's detail sheet (`S<N>`) is the vocabulary
  (navigation, footer, CTA, form, card, trust exactly as drawn); the kit is parts and states, never
  the page. "Fill the rest of the site from the kit" is struck. A page template that produces twelve
  routes (`[service].astro`) is composed ONCE as a designed page type and its per-route content and
  photographs are chosen per route, not just its words.
- The home page LIFTS the picked board: Compose starts from the board's archived markup
  (`.palate/explore/shots/<id>/rendered.html`) and re-skins it into Astro. An edit that changes the
  board's framing (bleed to inset, the h1's role or size, a section's shape, the form's field count)
  is an OVERRIDE: it needs a one-line written reason in the Compose record and the page is
  re-judged (section 2). "So every letter keeps its edge" is a reason the judge gets to answer.
- The primary inner page (the `I<N>` board from beta.21) is lifted the same way. Other page types are
  composed from the sheet and the direction; they are judged, not lifted.
- The v3 build invented its own `PageHero` with a width rule (1440px or wider bleeds, narrower
  sits inset at native size, never cropped); the template's `HeroServicePhoto` only requires a
  1600px photograph for a bleed. Doctrine now says: a hero photograph under the floor is cropped
  to the subject and served at the size it has, or is not the hero; "inset at native size" is never
  a fallback; and a photograph enters any slot only with a decided crop (`object-position` or an
  explicit crop) and the reason recorded against the slot in `.palate/assets.json` (extending the
  per-photo `{ subject, treatment, reviewed }` record `palate-assets.mjs` keeps); a raw job snap
  never leads a page.

## 2. The judge runs on the built pages

- `scripts/gate-page-judge.mjs` (new; reuses `gate-board-judge.mjs`'s pair, fingerprint, request and
  judgement machinery through shared exports): for every composed page type (the home, the primary
  inner page, and one route per page template: service, about, contact, reviews, landing where
  present) it shoots the built page at 1440 (entrance 1440x900 and the foot, the bottom 900 px)
  and states, as pairs: the home's entrance and foot against the picked board's `hero.png` and
  foot; the primary inner page against `inner.png`; every other page type's entrance and foot
  against the direction's donor (`donor.jpg` hero, `donor-foot.png`), question "does this page hold
  the direction and its donor's standard". Both orders, the four rungs, `candidate_is` echoed, one
  fresh subagent per comparison dispatched by the main agent, exactly as the boards. The bar is the
  board judge's (`REFUSED_RUNGS`, comparable or better on every judged surface). A refused page is
  recomposed, judged again, three attempts, then the build stops with the page named; never
  silently accepted. `PALATE_GATE_JUDGE=0` releases both judges.
- Phase 1 writes `.palate/compose/judge-request.json`, phase 2 `--judgements` records
  `manifest.compose.page_judgements[] = { route, page_type, surfaces, rungs: { entrance, foot },
  rung, fingerprints, judged_at }` and refuses stale fingerprints (a rebuilt page is re-judged).
- gate-done gains the sub-gate `page-judge` (skip when no pick was recorded; refuse when a composed
  page type has no judgement, a refused judgement, or a fingerprint older than the built HTML).
- The self-scored visual rubric (`visual.iterations[].axes` written by the agent) stops counting as
  a gate: `gate-done` no longer reads its axes for pass/fail; it stays as a working note. Doctrine
  says so.

## 3. The look is recorded, per page

- `node scripts/palate-pick.mjs <project-dir> --looked <route> --shot <path> --verdict "<one sentence>"`
  records `manifest.compose.pages[] = { route, shot_sha256, looked_at, verdict }`. The `shot` must
  be a file under `.palate-shots/` newer than the route's built HTML; the verdict is at least 40
  characters and must not be one of the generic phrases the gate lists ("looks good", "matches the
  board", "no issues"). `gate-done` refuses a composed page type with no look. This is the record
  the review found missing: 101 screenshots and no evidence anyone held one against the board.

## 4. Fidelity measures framing

- `scripts/gate-fidelity.mjs` adds three measurements read from the board's `rendered.html` and the
  built home's DOM at 1440: (a) the hero media's framing class, bleed (media box spans the viewport
  width within 8 px) or inset, must match the board; (b) the h1's rendered font size within 15% of
  the board's h1 and its vertical order relative to the hero media the same; (c) each carried
  section's height within 25% of the board's section height. A mismatch names the section and the
  measurement, and the existing similarity scores stay as supporting evidence rather than the
  verdict. A Compose override recorded with a reason (section 1) suppresses that one measurement and
  prints the reason in the report.

## 5. The local grade's ladder is a done sub-gate

- `gate-done` gains the sub-gate `taste`: it reads `local-grade.json` (default `.palate-shots/`, or wherever `grade-local.mjs --out` put it, found by the same resolution) when present and
  refuses a build whose ladder verdict is `somewhat_worse` or `clearly_worse` against its exemplar,
  or whose `flattery.risk` is true, printing the honest range and the finding. Skip (exit 2, named)
  when the local grade has not run, and doctrine (A.12) says the full local grade runs before done,
  not after.

## 6. Rhythm is checked mechanically

- `scripts/verify-rendered.mjs` gains a `repeated-silhouette` finding: two consecutive sections on a
  page whose rendered silhouettes match (same child count, same column count, same aspect within
  10%, same ground colour) are reported as one finding with both section ids. The finding blocks
  through the existing positive-failures path; a section marked `data-palate-repeat="deliberate"`
  is exempt and the mark is printed.

## Out of scope

Redrawing the kit; a board per page type (beta.21's one inner board stands); the bar (settled at
07b00fe); any change to the survey, the ladder or the board judge.

## Proof

A fresh eastcoast run on beta.22: every page type carries a recorded look, every page type is
judged comparable or better against the board or the donor, the home's framing measurements pass
without an override or with one that names its reason, the local grade's ladder passes at done, and
Jake's ten changes from the review are not needed on the page he opens first.
