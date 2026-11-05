# Explore stage - commit to a direction before scaffolding

Every site or landing-page build starts here. The point: stop guessing at the
right direction, put a genuine RANGE of concepts in front of the client, let
them point at sections and say "that hero, that CTA, that motion," then build
the canonical pages from those picks. The directions are DRAWN before anything
is built, so the range arrives in minutes and only the chosen one costs a build.

## A board is drawn, not built

Explore writes no Astro at all. Each rung is a hand-authored Claude Design
artboard at `.palate/explore/seed/B<rung>.dc.html`, and that file IS the board:
there is no route to open and nothing to serve. Astro is written ONCE, at
Compose, for the direction the client picked.

**And a board is the WHOLE home page in that direction**, navigation to footer,
composed from the website kit (`src/lib/kit.ts`, the seventeen pieces, the
rhythms in `src/lib/kit-grounding.ts`), declaring its rhythm the way the kit
pages do. A hero plus one section was the cheaper unit while boards were built,
and it is not what a client judges: they ask what the footer does, and a
direction that answers "it was not drawn" is a mood board wearing a page's
clothes. Drawing costs a fraction of building, so the whole page is affordable.

**A DIRECTION IS FOUR ARTBOARDS, not one.** What an agency puts up to have a
direction and a style signed off is the home page, the inner page the primary
action lands on, the same home on a phone, and a sheet of the pieces as used
with their states. Signing off on an entrance alone leaves the navigation, the
enquiry form, the footer and every phone layout to be decided later, by nobody,
and discovered by the client on the built site. So each direction owes, under
`.palate/explore/seed/`:

| File | What it is | Width | Marks |
|------|------------|-------|-------|
| `B<rung>.dc.html` | the whole home page | 1440 | `data-section-id="<id>-<piece>"` |
| `I<rung>.dc.html` | the primary service page, navigation to footer | 1440 | `data-section-id="<id>-inner-<piece>"` |
| `M<rung>.dc.html` | the same home stacked on a phone | `x-dc{width:390px}` | `data-section-id="<id>-<piece>"` |
| `S<rung>.dc.html` | the kit pieces as used, with their states | 1440 | `data-kit-piece="<piece>:<Variation>:<state>"` |

`scripts/boards-render.mjs` holds each to its own width, its own marks and the
shared image, link and script rules, and REFUSES a registry that names none of
them rather than deriving the three from the rung: a derived name lets a registry
that declared nothing pass while the client is shown one board out of four.

**What that does NOT change**: the survey, DIVERGE and CONVERGE are untouched,
the ladder is untouched, the endpoint rule is untouched, and it is still one
distinct donor per rung. The medium changed. The thinking did not.

The motion is written ON the board, as text: one block with
`class="motion-note"` carrying `data-palate-motion`, saying what moves, when and
how it feels. An artboard is a still, so the direction's most expensive property
is written where it is read rather than in a side panel. `what`, `why`,
`feeling`, `donor` and `motion` in the registry carry the rest of the argument
onto `/explore` and the canvas.

## The flow

1. **Plan checkpoint (Explore)** - confirm brief, brand source, references,
   board count and whether to include landing-page boards. Then ask:
   "Proceed?"

   **THE INTAKE COMES FIRST, AND IT IS ASKED IN ONE ROUND.** Nothing about the
   range used to come from the person: the calibration question was asked after
   the boards were already drawn, so the answer reached the canvas too late to
   steer the research it was for. So the cheap half of the survey runs first.
   Dispatch `palate-surveyor` with `calibration only` (its act 1: 3 or 4 real
   sites from the client's own vertical spanning restrained to bold, written to
   `.palate/explore/refs.json` with their stills), show that row, and ask all six
   at once, in their language and not ours:

   a. **which of the calibration references is closest** to how bold you want to
      be, and what do you dislike about it?
   b. **two or three sites in your field you admire**, and **one you do not**.
   c. what is the one thing you want a visitor to do?
      A **call, a form, a booking or a purchase**.
   d. **the wow moment** - what should this site do that nothing else in your
      field does? One sentence.
   e. **the avoid list** - three to five things we must not do ("no purple", "no
      stock people photos").
   f. the host, who edits this copy in six months, and how many directions you
      want to see (the count, per the paragraph below).

   Ask them in ONE round, never one at a time: six separate questions across six
   turns reads as an interrogation and the person answers the last three in three
   words. **Ask them with `AskUserQuestion`** (SKILL.md, "Asking the person"),
   four in the first call and two in the second: the calibration question's
   options are the row's own positions ("1, Aesop: restrained ..."), the primary
   action's are call / form / booking / buy, the count's are 3 / 5 / 8 with 5
   recommended, and the avoid list is multi-select over the usual don'ts with
   "Other" for theirs. The admired and disliked sites come in as "Other" on their
   own question, because nobody can list a client's field for them. Where the
   tool is absent, one message listing all six.

   Record the answers on the checkpoint as
   `plan_checkpoint.shown.intake = { calibration: { position: 1..4, why },
   admired: [1 to 20], disliked: [1 to 20], primary_action, wow, avoid: [3 to 5] }`.
   The write wall refuses a ladder whose checkpoint lacks any of them
   (`hooks/palate-pretooluse.mjs`), because an unanswered intake is a range drawn
   on our own taste rather than theirs. Then hand that block verbatim to the
   surveyor's act 2: the calibration position sets the `intensity` facet and where
   the ladder's ends sit, the admired sites are searched with `refs_for_business`,
   the disliked and avoided are ruled out as donors, and the primary action is the
   conversion spine every board places.

   **ASK FOR THE COUNT, AND SAY WHAT IT BUYS.** The count sets the RESOLUTION of
   the ambition ladder, never its range. Whether they pick 3 or 8, rung 1 is
   genuinely understated and rung N is genuinely bold; a larger number buys finer
   steps between those fixed ends, not a wider span. Say it in those terms, because
   "how many do you want" invites the cheapest answer, while "three gives you the
   range in coarse steps, six lets you see where it turns" invites a choice.
   **Default 5 when they have no preference**, and never fewer than three: below
   three there is no BETWEEN for the client to point at, which is the whole use
   of a ladder. `scripts/gate-explore.mjs` holds that floor on a high-intensity
   brief (`PALATE_MIN_BOARDS`, default 3).
2. **Draw the boards** - FOUR artboards per rung under `.palate/explore/seed/`
   (`B<rung>.dc.html`, `I<rung>.dc.html`, `M<rung>.dc.html`,
   `S<rung>.dc.html`, the table above), plus 1-3
   landing-page boards if the brief warrants (see the limit below). All four are
   the one direction, composed from the kit and grounded in the
   survey: name the donor, read its section notes, and skin them with the LOCKED
   brand tokens (`references/website-kit.md`, `reference-library-usage.md`).
   One distinct donor per rung.

   **THE INNER PAGE AND THE PHONE ARE THE SAME DIRECTION, NOT A SECOND ONE.**
   `I<rung>.dc.html` is the page the primary action lands on (the answer to
   intake question (c): the service the call, form, booking or purchase is for),
   drawn navigation to footer at 1440 with its sections marked
   `<id>-inner-<piece>` so the fidelity gate can tell an inner entrance from the
   home one. `M<rung>.dc.html` is that direction's home page at
   `x-dc{width:390px}`, the same sections in the same order stacked, with the
   navigation drawn as `NavMobileSheet` CLOSED: a phone board opening on an open
   drawer shows the drawer and hides the page. Drawn at any other width it is a
   desktop board captioned "mobile", and the render refuses it.

   **THE DRAWING BRIEF - DRAW FROM THE DONOR, NOT FROM ITS NAME.** Before rung N
   is drawn, read the entry in `.palate/explore/donor-heroes.json` whose `rung`
   is N (the surveyor writes the file, `agents/palate-surveyor.md`; it is a list
   keyed by `rung`, not an array you index) and the kit's grounding for the pieces that
   rung's rhythm uses (`src/lib/kit-grounding.ts`). The entry carries the donor's
   `hero_url`, its `signature_move`, the `component_prompts` and `do_dont` lines
   the board will reproduce, and its `copy_voice`. Draw FROM that hero:
   its composition, its weight, its negative space and the signature move, in the
   donor's own rhythm, with the conversion spine (the phone-first CTA, the trust
   beat, the locality beat) placed where the library places it rather than where
   habit puts it. THEN re-skin to the LOCKED brand. The registry `why` names what
   this rung took from the donor, in those terms, because a `why` that could have
   been written without opening the reference is the tell that the reference was
   never opened. **THE COPY ON A BOARD IS HELD TO THE CLIENT'S OWN FACTS**, drawn
   board or built page alike: a quote is verbatim from a review the business has
   published, attributed as it is published, never a name from the old site that
   matches no reviewer anywhere; a rating and its count are read from the live
   profile on the day, never the old site's number; a year or a decade appears only
   when the business states it, because "45 years" is not "since the 1970s" and
   arithmetic is not a source; a spec (a mesh grade, a lock, a turnaround) appears
   only where they publish it. `gate-facts` never reads an artboard, so the person
   picking a direction reads whatever the board says as true of the business, and
   a board that carries a falsehood is a board the client cannot be shown. The
   re-run of a build on this doctrine drew "4.8 on Google" and three testimonials
   the previous build had already found to match no real reviewer, on its first
   two boards, which is why this paragraph exists. **WHEN THE DONOR ROW RUNS, a registered board whose rung has no
   entry in that file is a refusal**: `boards-render.mjs` names the rung and
   writes nothing, rather than drawing half a donor row. It is only a refusal
   when the row runs. With no `donor-heroes.json` there at all the run records
   `explore.donor_row = { skipped: true, reason }` and draws the boards without
   their donors, which is the honest record of a survey that never named them and
   is NOT a path a build held to the stunning standard should ever take: no board
   sits beside the reference it reproduces, and the board judge then has nothing
   to compare and skips.

   **THE DETAIL SHEET NAMES ITS PIECES AND WHERE THEY CAME FROM.** Every block
   on `S<rung>.dc.html` is marked
   `data-kit-piece="<piece>:<Variation>:<state>"`, with the piece and variation
   ids taken from `src/lib/kit.ts`, and the sheet owes eight of them: the
   navigation at rest and open, the footer, the closing call to action, the
   enquiry form filled in and then with its errors shown, one card (from
   `benefits`, `usecases` or `casestudies`) and one trust strip. **Inside each
   of those blocks, write the provenance as a line a client can read**:
   `"<Piece>: <Variation>, drawn from <donor>"`.
   For example, "Navigation: NavSimple, drawn from aesop".
   The same variation and donor go in the registry's `pieces`, and `boards-render.mjs` refuses a sheet whose required blocks do
   not carry that line: the sheet is the only place a person ever reads where a
   piece's craft came from, so a block without it looks finished and proves
   nothing.

   **AND THE SHEET IS CONTENT-LED, never a type specimen.** Every block carries
   the real copy in the brand's voice, the form filled with a plausible enquiry
   and then with the errors a real visitor would see. The format it collapses
   into is the one Jake rejected on 9 September: an Ag ramp, a row of swatches
   and a button pair, which is type DISPLAYED rather than used and reads
   identical across every direction. `boards-render.mjs` measures the visible
   copy inside the marked blocks and refuses a sheet under the floor, because a
   sheet of correctly marked empty boxes passes every other rule.

   **THE ARTBOARD CONTRACT.** `scripts/boards-render.mjs` holds every board to
   it and names every fault ON THAT BOARD in one pass, then stops at the first
   board that fails, so read it as a checklist before drawing rather than after:

   - The skeleton is exactly this, verbatim. The editor replaces `support.js` at
     render time, and a different spelling stops the board being editable with
     nothing saying so:

     ```html
     <!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>...</style></helmet>...</x-dc></body></html>
     ```
   - `x-dc` is 1440px wide (`x-dc{display:block;width:1440px;overflow:hidden}`).
     The height is MEASURED, never declared: a frame neither scales nor crops,
     so a guessed height clips the bottom off the board silently.
   - **Every kit section the board renders is a root carrying
     `data-section-id="<id>-<piece>"`**, where `piece` is the kit piece id
     (`navigation`, `hero`, `trust`, `problem`, `benefits`, `demo`, `process`,
     `pricing`, `faq`, `cta`, `footer`, `locality`, ...). Required at minimum:
     `<id>-navigation`, `<id>-hero`, `<id>-cta`, `<id>-footer`, and
     `<id>-<section>` for the registry's `section`, the inner section the client
     is asked to look at. The hero is found by name, never by position.
   - **The planned motion is written on the board**: one block with
     `class="motion-note"` and `data-palate-motion`, 40 characters or more,
     saying what moves, when and how it feels.
   - Name every block element's role with a class, and **at least 60% of them
     must carry one**, which is what the validator holds: the uniqueness gate signs structure by class, and a
     board styled only inline signs it blind. Copy is literal markup, because a
     viewer retypes it in place; use inline `style` only on the few properties
     they should be able to drag.
   - Images are bare basenames beside the artboard, double-quoted
     (`<img src="b1-hero.jpg">`), 70 KB or less each, and only
     png/jpg/jpeg/gif/webp/avif/bmp/svg. No `srcset`: it overrides the bare name
     with a URL the canvas cannot fetch. A CSS `url()` obeys the same rules.
   - Nothing is fetched from the network except Google Fonts
     (`fonts.googleapis.com` / `fonts.gstatic.com`) through a `<link>` or an
     `@import` in `<helmet>`; other faces travel as `@font-face` data URIs.
     There is no egress inside the canvas, so anything else renders as a broken
     box and nothing reports it.
   - Exactly one `<script>`, `./support.js`. `a` and `a:hover` are defined.

   **REGISTER EACH DIRECTION** in `src/lib/variants.ts` as
   `{ id, name, artboard: "B<rung>.dc.html",
   presentation: { inner: "I<rung>.dc.html", mobile: "M<rung>.dc.html", sheet: "S<rung>.dc.html" },
   pieces: { navigation: { variation, donor }, hero: {...}, trust: {...}, cta: {...},
   forms: {...}, footer: {...}, [section]: {...} },
   ambition, what, why, feeling, donor, section, motion, ctas }`. `artboard` is
   REQUIRED and is how every gate downstream finds the home board; `presentation`
   and `pieces` are REQUIRED too, and `href` is deprecated and unused, because no
   route exists.

   **`pieces` IS THE PROVENANCE, AND IT IS CHECKED IN BOTH DIRECTIONS.** Each
   entry names the kit variation the piece is and the library reference its craft
   was drawn from. `scripts/gate-explore.mjs` holds every `variation`
   against src/lib/kit.ts (naming the piece it does belong to when it belongs to
   another one), every `donor` against the manifest's `references_surveyed` (a
   slug the survey never read is provenance invented after the fact), and the
   sheet's own `data-kit-piece` marks against the variations recorded here, so a
   direction whose sheet shows one footer and whose registry records another
   cannot ship a footer nobody approved. The FILES are boards-render's half:
   gate-explore checks the registry, and inventing a finding about a missing
   artboard here would report one absence twice in two different words.

   **NO VARIANT IS REGISTERED UNTIL IT PASSES THE ANTI-AI GATE.** The mechanical
   half is `boards-render.mjs` (the contract above) and `scripts/gate-explore.mjs`
   (a rung with no argument, a motion plan that restates the `what`, two boards
   on one donor, one CTA or four). The judged half is yours, and it is the half
   that matters: hold the board against `references/anti-patterns.md`,
   `references/visual-rubric.md` and `references/ai-slop-tells.md` before it
   enters the registry, and LOOK at the still
   (`.palate/explore/shots/<id>/hero.png`). `scripts/ux-lint.sh` does not read
   `.palate/`, so nothing lints an artboard for you; it runs at Compose, which is
   downstream of the thing it protects. A board that cannot be cleared in 3
   attempts is dropped and its rung redrawn rather than shown. The preview is the
   first impression of the product, so a board that looks AI-made has lost the
   argument before anyone reads a word.

   **AND YOUR EYE IS THE FIRST PASS, NEVER THE GATE. THE GATE IS THE DONOR
   COMPARISON**, and it runs in step 2b rather than here, because it compares the
   board's entrance still with its donor's hero and neither of those exists until
   `boards-render.mjs` has drawn them. Register a board once your eye clears it;
   whether it is SHOWN is the judge's answer, not yours.

   As each board is registered, it is also recorded in `build-manifest.json`
   under `explore.shown` (`{ id, name, donor_slug, position }`) so
   every direction SHOWN is captured for the taste flywheel, not just the one
   picked (`references/build-memory.md`).
   Before drawing each board, state a **Design Read** out loud (see
   `references/critique-discipline.md`): "Reading this as: a {page kind} for
   {audience}, with a {vibe} language, leaning toward {design direction}." A
   board whose Design Read is generic or missing is rejected and redrawn.
   Read `~/.config/palate/builds.log.json` (see `references/build-memory.md`)
   and exclude any DONOR used in the last 3 Palate builds (`explore.shown[].donor_slug`,
   which `boards-render.mjs` writes on every canvas-first build) and any
   macrostructure used in the last 5 - the board set actively diversifies
   away from recent work. The rule used to be stated on a hero pattern, which
   `recordShown` has not written since Explore started drawing artboards, so it
   could never fire. ALSO run `node scripts/taste-profile.mjs --variants N`
   and BIAS the set toward the operator's kept choices (its `summary`), while
   spending the returned `explorationBudget` on directions OUTSIDE the profile -
   bias, never pin (`references/build-memory.md`, "The positive taste profile").
   **Match drawing complexity to the aesthetic vision**: a maximalist board is
   drawn elaborately; a minimalist one practises restraint.
2b. **Validate, measure, judge, publish** - `node scripts/boards-render.mjs <project-dir>
   [--out .palate/explore] [--refs .palate/explore/refs.json]
   [--donors .palate/explore/donor-heroes.json | --no-donors]`. It builds
   nothing. It holds all four of every direction's artboards to the contract and
   REFUSES with every fault named, stamps a stable `data-palate-k` on each
   element in place (so the published canvas and the read-back align), archives
   each board as `.palate/explore/shots/<id>/rendered.html` with its images,
   opens each over `file://` at its own width (1440, or 390 for the phone) and
   measures its real height. It records
   `manifest.explore = { ran, shown_at, boards }`, and `shown_at` is half of the
   only number this stage produces, because time to pick is
   `picked_at - shown_at`.

   **FIVE STILLS PER DIRECTION: hero, full, inner, mobile and sheet.**
   `shots/<id>/hero.png` is the home board's 1440x900 entrance (what the
   fidelity gate compares and what a card shows), `full.png` the whole home board
   end to end (what the card's link opens, and what the page ending is cropped
   from), `inner.png` the inner page's own 1440x900 entrance, because the judge
   compares it exactly as it compares the hero, and `mobile.png` and `sheet.png`
   the phone and the sheet end to end, because those are evidence rather than
   comparisons and a fold of a detail sheet is the navigation and nothing else.
   They are copied to `public/_explore/<id>.png`, `<id>-full.png`,
   `<id>-inner.png`, `<id>-mobile.png` and `<id>-sheet.png`, which is what
   `/explore` shows.

   **AND EACH DIRECTION IS LAID OUT AS ITS OWN CANVAS ROW: `B, D, I, M, S`** -
   the home board, its donor card, the inner page, the phone and the detail
   sheet, 80 px between frames, 120 px between rows, the calibration references
   on row 0. Boards used to run left to right along one row, which read as a
   strip of home pages. The columns are CONSTANTS rather than a running offset,
   because the value of a row is comparison: a client scanning two directions
   reads home against home and phone against phone, and a direction with no donor
   must not slide its inner page into the donor's column or the row cannot be
   read against the one above it.

   **IT ALSO DRAWS THE DONOR ROW, and that is on by default.** With
   `.palate/explore/donor-heroes.json` present it fetches each rung's
   `hero_url` over HTTPS (10 seconds, and an answer that is not an image is
   refused), re-encodes it under the canvas image ceiling, and writes
   `seed/d<rung>-hero.jpg`, `seed/D<rung>.dc.html` (a 720 by 580 donor card: the
   hero, the reference's name and slug, and the one signature move the rung
   reproduces), `shots/<id>/donor.jpg` and `public/_explore/<id>-donor.jpg`. The
   card is laid on the canvas at the same `y` as its own board, immediately to its
   right, and the next board steps past both. It records
   `explore.shown[] = { id, name, donor_slug, position }`, which is the lineage
   the Stop hook's `.palate/donors.json` is built from. `--donors <path>` names
   the file explicitly, and then a file that is not there is a refusal, because
   it was asked for. `--no-donors` is the deliberate skip and is RECORDED as
   `explore.donor_row = { skipped: true }`, so a canvas with no donor row can
   never be mistaken for one whose donors were simply never recorded.
   `shots/<id>/donor.jpg` is also what the board judge compares against, so a run
   with no donor row leaves nothing for the judge to read and it skips saying so.
   **A refusal never deletes the seed**:
   those are the operator's own drawings, not this script's output, and wiping
   them over one oversized image would throw away hours of authoring.

   **THEN JUDGE EVERY BOARD AGAINST ITS OWN DONOR, BEFORE ANYTHING IS
   PUBLISHED.** Every board is judged against the one thing it has to answer to,
   the library reference it was drawn from. It runs HERE, after the render, because
   it compares the board's `hero.png` with the donor's `donor.jpg` and neither
   exists until the step above has drawn them.

   **IT READS THREE SURFACES, BECAUSE A DIRECTION IS AS GOOD AS ITS WEAKEST
   ONE.** The entrance was once the whole judge, so a verdict about the top of a
   page was recorded as a verdict about the page, while a client asks what the
   ending does before they ask about anything below the fold and then spends most
   of their time on an inner page. So the gate states **THREE pairs per direction
   (the entrance, the page ending and the inner page), six comparisons** once
   each pair is judged in both orders:

   - **entrance** - `hero.png` against the donor's hero (`donor.jpg`).
   - **page ending** - the bottom 900 px of `full.png` against the bottom 900 px
     of the donor's own whole-page capture, cropped to `foot.png` and
     `donor-foot.png` so the question can be about the ending rather than read as
     the entrance again.
   - **inner page** - `inner.png` against the donor's hero. The library holds no
     inner page for a reference, so the question asks whether this page holds the
     donor's standard, and it says so rather than pretending to compare like
     with like.

   The **lowest across the surfaces judged** stands, for the same reason the
   lower of the two orderings stands: averaging is how a weak ending gets carried
   by a strong hero. `manifest.explore.board_judgements[]` records
   `rungs: { entrance, foot, inner }` beside the `rung` that is the lowest of
   them, and a surface that was never judged records `null` there rather than
   silence.

   **A MISSING SURFACE AND A PASSING SURFACE MUST NOT LOOK ALIKE**, and the two
   ways a surface goes missing are answered differently. `sharp not installed` is
   a local fault with a named fix (`scripts/reference-capture/setup.sh`), so
   phase 1 SKIPS loudly rather than quietly judging every direction on two
   surfaces. A donor with **no whole-page capture** in the library is a fact
   about the library and not the operator's doing, so the ending is dropped, the
   direction keeps its other two surfaces, phase 1 names the direction on stderr,
   and the pass line names ONLY the surfaces that were judged. `gate-explore.mjs`
   then **WARNS rather than blocks** on a shown direction whose ending was never
   judged, so "lowest across three surfaces" cannot quietly become "lowest across
   the two we managed"; refusing over it would switch the instrument off on the
   builds it exists to serve.

   **YOU RUN IT, in your own session, because the judging happens in subagents
   and the verifier has no Agent tool** (the same division as the site ladder,
   `references/local-grade.md`). The verifier states the comparisons and hands
   you the request path; the four steps are yours:

   1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-board-judge.mjs" <project-dir>`
      writes `<project-dir>/.palate/explore/judge-request.json`: the four `rungs`
      (`clearly_worse`, `somewhat_worse`, `comparable`, `better`) and, per
      direction, its three pairs, EACH CARRYING ITS OWN `question` (there is no
      top-level one, because the entrance's question asked over a page ending
      comes back a valid answer to a question nobody meant), each pair holding
      TWO comparisons, the same images swapped.
   2. **Dispatch ONE FRESH general-purpose subagent per comparison**, never two
      comparisons in one context. Give it NOTHING about this build: the two image
      paths (`A` and `B`), THAT PAIR'S OWN `question` verbatim, the four rung ids, which of
      `A` or `B` the comparison names as the candidate, and "answer with
      `{ id, candidate_is, verdict }`: the comparison id, the letter you were told
      the candidate is, and one rung id, nothing else". **`candidate_is` is
      REQUIRED and is the check on the dispatch**: an answer that echoes the other
      letter was judged against the other ordering's instructions, and the gate
      refuses the pair rather than record a reading of a question nobody asked. The
      swap is
      the position-bias control, so a subagent that has already seen the other
      ordering is agreeing with itself rather than judging, and one that knows
      which image you drew is not judging either.
   3. Collect the answers into `<project-dir>/.palate/explore/judgements.json` as
      `[{ id, candidate_is, verdict }]`, two per pair, each `id` copied verbatim:
      six on a three-surface direction, four where the donor has no whole-page
      capture and the ending was dropped.
   4. `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-board-judge.mjs" <project-dir>
      --judgements <project-dir>/.palate/explore/judgements.json` takes the LOWER
      of the two readings on each surface and the lowest of the surfaces, records
      `manifest.explore.board_judgements`, and exits 2 naming any direction that
      read below the bar, THE SURFACE IT WAS READ WORSE ON and THE READING in the
      client's language ("somewhat worse", never "somewhat_worse"), because
      "redraw it" over a page whose entrance is fine and whose ending is not sends
      you to the wrong half of the drawing, and somewhat worse and clearly worse
      are different amounts of redrawing. **Report its stderr verbatim**, and
      publish the canvas only once it passes.

   **THE BAR IS `comparable` OR `better`, ON EVERY SURFACE THE DIRECTION WAS
   JUDGED ON, AT EVERY INTENSITY.** A board read `somewhat_worse` on any one
   surface is refused exactly as one read `clearly_worse` is. A calm brand is not
   a reason to hand someone a weak drawing, and the visual rubric every board
   already clears measures hygiene, which is how five boards scored 25 to 28 out
   of 30 and were bland: somewhat worse than the reference a board was drawn FROM
   is the reading a competent bland board earns, so passing it left the judge
   unable to refuse the boards it exists for. The bar moved here on 2026-09-12
   (Jake's ruling) from "not clearly worse"; the ladder itself is unchanged, all
   four rungs are still stated, judged and recorded, and only what the gate
   REFUSES is wider. A surface that could not be judged at all (the library holds
   no whole-page capture for that reference) reads null and refuses nothing:
   absence of evidence is not a bad reading. A refused board goes back
   to the drawing step, redrawn from the donor's hero, re-rendered, and judged
   from step 1 of this block again (a redrawn `hero.png` makes the standing request
   stale and the gate says so, and an unchanged board is not re-judged: a standing
   verdict is reported rather than re-asked); three attempts, then the rung is dropped rather than shown.
   `scripts/gate-explore.mjs` blocks a shown build whose registered boards carry no
   judgement or carry a reading below the bar, so a board cannot reach a client by
   being judged late. `PALATE_GATE_JUDGE=0` releases both.

   **THEN PUBLISH THE CANVAS, once the board judge has passed**, when the design
   skill is present. The judge is the condition and not a courtesy: publishing
   first puts a board a client can open in front of them before anything has
   compared it with the work it was drawn from, and a board refused afterwards has
   already been seen. Seed it from `.palate/explore/seed/` (the `README.md` written there says what to
   title it and which artboard is which) and publish WITHOUT export, so the link
   opens outside the organisation. Record `manifest.explore.canvas = { url }`
   with the command, never by hand:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> \
     --canvas-url https://claude.ai/code/artifact/<id>
   ```

   and `/explore` links to it first. **A missing design skill is not an error,
   and silence is**: when no design skill can run in this session, record
   `manifest.explore.canvas = { skipped: true, reason }` with
   `--canvas-skipped "no design skill in this session"` and hand over `/explore`
   instead. The two are mutually exclusive in one call, a link that is not
   http(s) is refused, and so is a skip with no reason.
   `scripts/gate-explore.mjs` blocks a build that showed boards and
   recorded neither, because silence reads as "the client never saw a canvas at
   all", which is worse than either honest outcome.

3. **Pause - pick, then ask** - the client picks on the canvas, or from
   `/explore` on a shareable Vercel preview
   (`scripts/deploy-preview.sh <project-dir> <slug> --explore`, which turns
   `PUBLIC_EXPLORE_MODE` on so `/explore` renders the stills, the calibration
   row and the ladder; `--local-preview` swaps it for a local dev-server link).
   Mix-and-match is the default ("b3 hero, b5 menu"); whole-board and by-name
   shortcuts are fine ("go with Deep Trawl").
   **Record it with `/pick`** (`scripts/palate-pick.mjs`), never by hand: it
   writes `explore.picks` with the rung, its position on the ladder and the
   timestamp, so time to pick is `picked_at - shown_at` rather than a memory. It
   refuses an unregistered id, a rung outside the ladder and a second pick on a
   surface that already has one, because everything downstream trusts this
   record. Also record the calibration answer (`--intensity`, 1 to 4).

   **THEN THE QUESTION ROUND, ONE PASS.** Three questions asked together,
   **as one AskUserQuestion call** (SKILL.md, "Asking the person"): `motion` and `cms` are
   single-select with the recommended option first, `mix` is multi-select over
   the other boards' sections. The moment the direction is settled, and answered
   in one command:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> \
     --answer motion="..." --answer mix="..." --answer cms="..."
   ```

   `motion` is what should actually move on the picked rung (the board is a
   still and the note on it is a plan, not something the client has agreed to);
   `mix` is which sections to carry across from other boards; `cms` is whether
   anyone but us will ever edit this site, which has to be settled before a page
   shape depends on the answer. It writes `explore.question_round`, and
   `scripts/gate-done.sh` refuses a build that picked a direction and never
   asked. Asking the three one at a time across the build is how a client
   answers the CMS question after the pages are written.

   When the client worked on the canvas, read it back with
   `--canvas <extract-dir>`, which diffs each artboard against the seed on
   `data-palate-k` and writes `.palate/explore/feedback.json`.
4. **Compose** - Claude writes the FIRST Astro of the build: the canonical
   pages (`src/pages/index.astro`, etc.) in the picked direction, read off the
   picked artboards, adopting the design tokens of the board that set the
   dominant tone (usually whichever supplied the hero).

   **THE MOTION PROOF COMES FIRST, AND NOTHING IS BUILT ON TOP OF IT UNTIL IT
   HAS BEEN SEEN.** Write `src/pages/index.astro` (the picked rung's home page,
   and nothing else yet), run the full verify loop on
   `/` alone (`scripts/verify-rendered.sh <url> --routes /`), record the proof
   with the command below, and hand the preview URL to the client.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> --proof <preview-url>
   ```

   **THAT COMMAND MEASURES THE PAGE, it does not take your word for it.** It runs
   `scripts/motion-proof.mjs` against the URL and records what it read: the
   sticky header's height before and after an 800 px scroll, how far each image,
   video and background travelled over that scroll as a ratio of the scroll
   distance (however the motion was built: the element, its wrapper, or the
   background inside it), how many elements carry a CSS animation, how many
   change with no input at all, and the same counts again under
   `prefers-reduced-motion: reduce`. A page where none of that moves is REFUSED:
   the motion proof is what the client was promised, so it is built before it is
   recorded. **The measurements must match the board's motion note IN KIND** - a
   promised parallax has to register as a parallax ratio, a promised marquee as
   `running`, a promised sticky header as two different heights. A note that
   promises one kind of motion and a page that delivers another is a Compose
   defect, not a proof. A page too short to scroll reports NO parallax rather
   than a ratio taken over the little it could scroll (`short_page: true`), so
   on one of those the note has to be checked by eye; the other three
   measurements still hold it to the floor, so a short page where nothing else
   moves is refused like any other still page. If the preview genuinely cannot be reached from this
   machine (a tunnel only the client's browser opens, a host behind a login),
   say so rather than skipping: add
   `--proof-unmeasured "<reason>"`, which records the URL with `measured: null`
   and the reason.

   **RECORD IT WITH THAT COMMAND, never by editing the manifest.** It writes
   `explore.proof = { url, verified_at, measured }` through `manifest-merge.mjs`, which is
   the only write that survives the PostToolUse hook's own. It is also what
   `scripts/gate-done.sh` reads to decide whether there is a composed home page to
   measure at all: without it every build after Compose reports
   `fidelity=skipped (Compose has not recorded the motion proof ...)` and the one
   check on the picked direction never runs. A board is a still, so a bold rung has been chosen on a picture of
   itself; the client sees it MOVING before three thousand pages are built on it.
   The cost of finding out here is one page.

   **THE ANSWERS ARE HONOURED TOO.** `explore.question_round.mix` says which
   sections come across from other rungs and `question_round.motion` says what
   moves; both were asked at the pick precisely so Compose does not have to
   guess, and a build that ignores them asked for nothing.

   **FEEDBACK IS HONOURED, NOT NOTED.** Read `.palate/explore/feedback.json`
   (written by `/pick --canvas`). Text edits on the picked surfaces are applied:
   a client who retyped a headline has written the copy. Every note is listed in
   the Compose summary with what was done about it, including "nothing, because"
   when that is the answer. Style drags are evidence of intent, never
   instructions: someone pulling a font size on a flattened snapshot is saying
   "bigger", not specifying 72px.

   **KEEP THE SECTION IDENTITY.** Put
   `data-palate-section="bN-hero"` on each composed section, matching the
   `data-section-id` it carried on the artboard. `scripts/gate-fidelity.mjs`
   reads it against the picked board's own archived artboard to check the picked hero is the built page's entrance and the picked inner
   section is present at all, and then checks the section's tag-and-class
   skeleton as well, because an id is a label anyone can type and a skeleton is
   not.

   **THIS IS CONCEPT WORK, NOT A SPLICE, and it got harder on purpose.** When
   every board elaborated one spine, stitching picks together was clerical.
   Now the rungs are genuinely different concepts, so lifting "v3 hero, v7
   features" verbatim produces a page with two arguments in it. Ask what the
   person was reaching for in each pick, and build the thing that serves BOTH
   reasons better than either original did. Someone taking a hero from rung 7 and
   features from rung 2 is usually telling you they want that intensity at the
   entrance and calm once they are reading; the answer is a single design with a
   deliberate falling intensity curve, not rung 7's hero pasted above rung 2's
   grid. State the read out loud before composing ("you want the boldness at the
   door and quiet inside"), so a wrong inference is corrected in a sentence rather
   than in a rebuild. **Landing between two rungs is a legitimate destination**:
   the ladder exists so someone can point between its steps. First
   **VIEW the lead reference's screenshot** (`refs_get_screenshot` on the spine
   donor) and design from the pixels - match its actual composition (weight,
   asymmetry, negative space, signature move), then re-skin with the brand. This
   is a required step, not optional: composing from prose alone regresses to
   generic priors. Then pull `refs_get { slug, format:"design" }` for the spine
   donor to lift its exact type scale, spacing and easings as structured YAML
   (with the WHY of each token) and map them onto the brand's range, reproducing
   the rationale, not just the values. Before emit, score the proposed composition
   on the **6-axis
   pre-emit critique**
   (Philosophy / Hierarchy / Execution / Specificity / Restraint / Variety, 1
   to 5 each; revise if any axis is below 3); apply the **Conceptual Grounding
   Test** to every section - delete anything that cannot finish "This exists
   because {a specific reason}". There is no board route to archive: the
   artboards stay in `.palate/explore/`, which never ships. The Stop hook appends this build to
   `~/.config/palate/builds.log.json` automatically from the manifest once the
   build passes its gates, carrying the `explore` labels recorded above
   (`references/build-memory.md`), so the next Palate build diversifies away
   from this one. Ensure `explore.picks` is set before finishing.
5. **Pause - confirm** - re-deploy the shareable Vercel preview without
   `--explore` (`scripts/deploy-preview.sh <project-dir> <slug>`, so `/explore`
   no longer renders) so
   the client reviews the composed direction on a clean shareable link and
   confirms before deep scaffold continues.
6. **Continue Phase A** - fill `src/lib/content.ts` with real copy, finish the
   rest of the pages in the chosen direction, run `verify-is-real-astro.sh`,
   and hand over the final shareable Vercel preview link. From here the flow is
   identical to today.

The two new pause points (pick, confirm) sit alongside the existing checkpoint
before production. Four total decision moments, all at meaningful forks.

## When to skip Explore

Same scoping as the plan checkpoint: skip for tiny / reversible work. The
defaults:

| Brief shape | Explore? |
|-------------|---------:|
| New site or landing page (preview or production) | YES (default) |
| HIGH-INTENSITY commission (`intensity: high`) | YES - mandatory, a drawn board per rung (cannot skip) |
| "Build it like the {client} site we did last week" / direction already set | NO |
| `--skip-explore` in the brief | NO |
| Editing an existing scaffolded project (add a section, fix copy) | NO |

If you skip Explore, jump straight to Phase A as before.

**A high-intensity commission cannot skip Explore.** When `manifest.commission.intensity == "high"`
the bold mandate requires a drawn board per rung (at least `PALATE_MIN_BOARDS`, default 3, distinct
directions, not a concept-level convergence): collapsing Explore to one concept is the documented cause of Variety-flat bold
builds, so `scripts/gate-done.sh` fails a high-intensity build with fewer than `PALATE_MIN_BOARDS` boards. The
named-direction / `--skip-explore` escape applies ONLY when the user explicitly asked for one
direction; in that case record `commission.explore_skip = true` with the reason so the gate
honours it. Calm / conversion / tiny-edit briefs are unaffected.

## Board scope - the whole home page, drawn

Each board varies BOTH the structure (hero pattern, which kit pieces it composes
and in what rhythm, CTA placement, motion intensity) AND the underlying design
tokens within the client's brand (type scale, density, accent colour treatment,
motion strength). When the client picks a hero, they are also picking a design
direction: the whole site inherits those tokens at Compose time, which is why
two boards drawn on different tokens have to LOOK different, and a board
claiming a direction it did not draw is caught by reading identical to the one
beside it.

A board is the whole home page because drawing one costs a fraction of building
one, and because the questions a client asks are about the parts a hero-plus-one-
section board left out. Every OTHER page (about, services, contact) is still not
drawn per board: those are built once at Compose in the chosen direction. Boards
only multiply where direction-setting happens.

## The calibration row - ask how bold in pictures

The intensity in the commission is INFERRED from the brief, and an inference
about how bold a person wants to be is a guess until they have seen the range in
pictures. So the question is **asked in the intake, before the deep survey**
(step 1), and the ladder is built from the answer rather than checked against it
afterwards.

So the surveyor picks three or four references from the client's own vertical
spanning restrained to bold, writes them to `.palate/explore/refs.json`, and
they become row 0 of the canvas and the row above the ladder on `/explore`,
under one question: **which of these is closest to how bold you want to be?**
Same vertical on purpose, so the client is comparing like with like and cannot
dismiss the row as being for a different sort of business. High taste at every
position, because a weak restrained example teaches the client that restraint is
the poor option.

**THE ANSWER IS RECORDED IN TWO PLACES, AND THE LADDER READS BOTH.** The intake
writes it to `plan_checkpoint.shown.intake.calibration = { position, why }`,
which is what the write wall holds and what the surveyor's act 2 searches on.
`src/pages/explore.astro` draws the marker on the ladder from
`commission.intensity_asked` and then
**falls back to `plan_checkpoint.shown.intake.calibration.position`**, so a
build that only ever asked the intake still shows the client where their own
answer sits. The later record is written by `/pick --intensity <n>` and
overwrites the marker when it exists, which is right: it is the confirmation
given after the boards were seen, and it sets the default pick suggestion. Neither governs the bold bar:
`commission.intensity`, the inferred one, still does that, because a client
under-reporting their own appetite is exactly the case the bar exists for.

**TWO ROWS OF REAL SITES, AND THEY ANSWER DIFFERENT QUESTIONS.** The calibration
row (`.palate/explore/refs.json`, drawn as `Ref<position>.dc.html` on row 0) is
the RANGE of the vertical, shown once, to ask the client how bold they want to
be. The donor row (`.palate/explore/donor-heroes.json`, drawn as
`D<rung>.dc.html` beside each board) is the ONE reference that rung was drawn
from, shown per rung, so the client can check the board against the thing it
reproduces and the judge can compare the two. Same 720 by 580 frame on purpose,
because both are real sites shown as evidence and a row of mismatched frames
reads as a mistake; different jobs, so a reference in one row is not thereby in
the other.

## Generating distinct boards - concept-led, not skin-deep

Five boards that all feel like a slightly-reskinned Linear is failure, and so
is five aesthetic skins of the same idea. **This paragraph used to mandate the
second failure while naming it**: it required every board to elaborate one of
1-2 advanced concepts, which is the definition of eight skins of one idea, and
that is exactly what previews became.

**Each board carries ITS OWN concept**, one per rung of the ambition ladder: a
mechanic that makes the visitor feel the transformation, a 3-beat arc, one named
feeling, and its own donor from the library. Run the Story Engine's DIVERGE ->
CONVERGE first (research -> the one true thing -> sample wide, at least the
board count plus three, with self-tagged conventionality -> cull only what
cannot be built -> curate the survivors onto the ladder), then draw one board
per rung.

The ladder is the product, not a side effect. Rung 1 is the most restrained
expression and rung N the boldest, and **N sets the resolution, never the range**:
both ends are genuinely reached whether the client asked for 4 or 10. A client
cannot tell you how bold they want to be until they have seen both ends, and a
set clustered in the middle teaches them nothing. **Rung 1 is restrained and
excellent, never the weak one** - it carries a signature move like every other
rung, and the move is simply quiet.

**The boards elaborate the commission** (`references/build-commission.md`), which
was issued at A.3.5 from the converged concept + the resolved brand. Hold every
board to the commission's Awwwards / FWA ambition bar ("competent is a fail"). The
commission's chosen mechanisms (from the toolkit register, each grounded in its
`references/motion-and-3d.md` recipe + MCP precedent) are spread across the board
set to FIT each direction - not ticked off in every board. Fit over familiarity is
the rule (the same rule as type): a mechanism appears in a board only where that
direction actually needs it, and the restraint clause governs the spread (match
intensity to the brand; maximal motion is not the bar). A safe-warm board may sit
on the Tier 0 floor while a one-of-a-kind board earns a shader hero - the same
spread the ambition spectrum below already calls for.
**A CALM BRAND STILL SPANS THE LADDER.**
Calm sets the CHARACTER of the top rung, never its height: on a calm brand
rung N is still the boldest thing the ladder contains, expressed slowly, quietly and
without startling anyone, rather than a slightly warmer rung 1. A measured build (a
pelvic-health clinic) whose commission read "calm brand, calm build, anything that
performs is wrong here" shipped 8 rungs spanning 1 to 2 keyframes and 3 to 4
transitions, so the client was shown a range that was not one and could not ask for
more than they saw. If the spread of motion, structure and conceptual distance from
rung 1 to rung N is not obvious IN THE STILL AND IN THE MOTION EACH BOARD WRITES ON ITSELF, the
ladder has collapsed. **The restraint clause cuts both
ways** (`references/build-commission.md`, "The bold mandate"): if the brand is
high-intensity (a label, a maximalist consumer brand, a creative studio, a launch, a
culture / type brand) the bold mandate applies and a flat, safe board set FAILS the
brief - reach into the bold-donor cluster (utsubo, thingy-and-thingy, mat-voyce, spline,
oddcommon, huge, gymbox, microdot, stas-bondar), not only the restrained flagships
(aesop / the-modern-house / leoleo / linear), and make the bold boards commit (one
declared feeling, a hero INTERACTION not a banner, a custom cursor, scroll-as-timeline,
a rare accent that detonates), each still shipping its no-JS / reduced-motion finished
state. Ground each concept in the MCP concept layer
(`refs_insights { topic: "mechanics" }` / `{ topic: "emotion" }`,
`refs_search { register, device, intensity }`), then execute its craft via the
organ-transplant method (`reference-library-usage.md`).
Every board's lead donor MUST be studied through the **section-build recipe**
(`reference-library-usage.md`): pull the donor by pattern (`refs_search { pageType,
uiElement, conversionPrimitive }`), VIEW its inner page (`refs_get_screenshot
{ slug, page:"pricing" }` etc., not only its home), read its
`refs_get { slug, layer:"do_dont" }` + `refs_get { slug, layer:"component_prompts" }`
+ `sections[]`/`pages[]`, then build from those. For the spine donor, also pull
`refs_get { slug, layer:"signature_moves" }` and `refs_get { slug, layer:"concept" }`
so the mechanic is named and re-skinned. Do not stop at the homepage screenshot and
tokens; that leaves the section depth, inner pages and taste layer unused.
When you reach for donors, a `refs_search` query may mix facets with exact lexical
terms because retrieval is hybrid (dense + lexical, RRF-fused), quality-ranked and
diversity-re-ranked: name the literal font, library, mechanic or business category
in `query` alongside the facets and it retrieves sites that use precisely that, with
the best craft first and cross-vertical range across the spread. For example:
`refs_search { vertical:"hospitality", query:"split-flap menu board" }`,
`refs_search { intensity:"high", query:"GSAP Lenis pinned hero" }`,
`refs_search { serifPresent:true, query:"Fraunces editorial optometry" }`.
For a set of five, spread across the **concept-ambition spectrum** (scale the
counts with N, and keep the shape):

- **~2 safe-warm concepts** - a clear, human demonstrative idea, low-risk to
  build and convert. Executed with a faithful vertical-spine transplant plus one
  borrowed organ. Still a real idea, never a brochure.
- **~2 bold concepts** - a strong demonstrative mechanic (a reveal, a
  before/after flip, a carried timeline, crowd-as-proof), executed with
  cross-vertical motion and type transplants.
- **~1 one-of-a-kind concept** - a genuinely surprising mechanic (a Sift-style
  flood-then-resolve, an absence-as-argument, an input-then-personalise), the
  kind that makes a client go "I have never seen that". At least one in every
  set. Ambition scales to the business: whisper-quiet for an anxious category
  (a conveyancer), spectacle for a launch.

Each board's Design Read names its **concept** (the transformation, the
mechanic, the named feeling) AND its craft (the donor spine + grafted organs +
the reproduced signature move): "One-of-a-kind, feeling = relief: the visitor
types their worry and watches it answered (input-then-personalise); a
clinic-flagship spine + a calm dawn motion organ; signature move = the carried
timeline." A board that cannot name its concept and its craft is rejected and
regenerated. Every board must pass the feel gate (`critique-discipline.md`).
- **No two boards share the same hero pattern.** No two share the same
  section sequence. No two share the same density level (compact / regular /
  spacious / immersive).
- **Vary motion intensity across the set**: a few near-static, a few with
  scroll-driven choreography, one or two with hero-stage WebGL or canvas.
- **Vary design tokens within the brand**: type scale 1.2 vs 1.333 vs 1.5,
  border-radius 0 vs 8 vs 16, accent weight (subtle vs loud), font-weight
  emphasis. Stay inside the brand's permitted range; do not invent off-brand
  colours.
- **Choose type per direction, treat it as colour.** No font is banned and none is
  the default (`references/type-selection.md`): reproduce the donor's type SYSTEM
  and decide the FACE fresh to fit the brand and the concept. Across the set, faces
  differ because the directions genuinely differ, not to tick a box, and never the
  same face reached for out of habit on unrelated builds (the type-face recurrence
  smell in `scripts/gate-novelty.mjs`). A system sans at one weight standing in for
  a decision is the failure, not any particular family.
- **Landing-page boards** (when included) are single-page, conversion-shaped:
  hero + value props + social proof + CTA + FAQ + footer. The full-site
  boards are home pages that hint at site depth. **Know the limit before you
  promise one**: `boards-render.mjs` and `gate-explore.mjs` read the `variants`
  export only, so a board registered in `landingVariants` is never validated,
  never measured and gets no still, and `/explore` shows it with nothing behind
  its picture. Register it in `variants` with a `B<rung>.dc.html` artboard if it
  is to be treated like every other board.

The two-layer doctrine from `reference-library-usage.md` applies: reference-led
boards FAITHFULLY reproduce the donor's craft layer (structure, rhythm, type
system, motion choreography and its signature compositional move), re-skinned
with the client's brand; only the identity layer (palette hexes, wordmark, font
files, photos, copy) is off-limits. "Loosely inspired" is not the bar - the
donor's signature move should be visible in the board, re-skinned. The board
set is the proof that the recipe was followed.

## Section identifiers - so the client can point

Every kit section on every board carries `data-section-id="b1-hero"` (or
`b1-services`, `b1-cta`) on its root element. The ids follow a fixed convention
so the picking conversation is unambiguous:

- `b1-navigation`, `b1-hero`, `b1-cta` and `b1-footer` on every board, plus
  `b1-<section>` for the inner section the registry says that board shows
- `lp1-hero`, `lp1-value-props`, `lp1-form`, etc. on a landing-page board

The id survives Compose as `data-palate-section` on the composed section, which
is what makes a pick checkable rather than asserted: `scripts/gate-fidelity.mjs`
compares the two.

On a Vercel preview this works alongside Toolbar Comments - the ids give the
client structured pointing ("b3 hero"), Comments give them free-form notes on
the same page. On the canvas the same job is done by selecting the element.

## The explore page (`/explore`) - the one thing the client opens first

**A PILE OF FIVE BOARDS DOES NOT COMMUNICATE A RANGE.** Everything expensive about the
ladder is spent on the assumption that the client understands they are being shown a
span. They do not, unless something says so. Handed five stills with no framing,
a client reads five guesses, opens two, picks whichever is nearest what they already
had in mind, and the restrained rung reads as "the boring one" rather than as one
deliberate end of a distance the boldest rung defines. So the preview always ships
`src/pages/explore.astro`, and it is the URL you hand over whenever there is no canvas.
It shows each direction inline (its entrance still from `/_explore/<id>.png`, its
argument, its motion plan), shows the donor still beside each direction card from
`/_explore/<id>-donor.jpg`, captioned `Drawn from <donor>`, so the reference a
direction reproduces is on the page the client actually opens, links each card to
the whole board at
`/_explore/<id>-full.png`, draws the calibration row above the ladder, and links
the canvas first when one exists. **It also shows the other three boards of the
direction**, `<id>-inner.png`, `<id>-mobile.png` and `<id>-sheet.png`, captioned
as the inner page, the phone and the details, because those three are what make
the card a direction rather than a home page and the client should not have to
open the canvas to see them. A landing board is shown on the canvas only:
nothing draws a still for one, so `/explore` lists it without a link.

It does four things a list of links cannot:

1. **Says what just happened**, in the client's language: we sampled many genuinely
   different concepts, kept the ones worth building, and put them in order from most
   restrained to boldest. This is a range, not a shortlist.
2. **DRAWS the ladder**, so the span is visible before anything is clicked: one bar per
   rung, rising left to right, labelled `more restrained` and `bolder` at the ends, with
   the calibration answer marked on it. A client who can see the ends can say "somewhere
   around 4, with 5's motion on the hero", which is worth ten times "I like that one".
3. **Gives every rung its own argument**: `what` it is (the structural idea, not the
   mood), `why` it is doing that for THIS business, and the `feeling` it carries. This is
   also a check on the BUILD, which is the half worth remembering: a rung whose `why`
   restates its `what`, or whose feeling is "modern and clean", did not have an idea, and
   it is far cheaper to find that out before a client reads it.
4. **Says what happens next** (below), because that is the step clients most often do not
   know they have.

`scripts/gate-explore.mjs` enforces all of it and is wired into the done gate: it blocks
when boards are registered and the page is missing, when a rung carries no
`what`/`why`/`feeling`, when a registered board's artboard was never drawn, when two rungs
claim the same position, when the ladder has gaps, when a name is "Option 2" or a feeling would
describe any website ever built, and when the boards were shown and `explore.canvas` records
neither a published `{ url }` nor a declined `{ skipped: true, reason }`. It has
no opinion at all when no boards are registered, so it never touches a non-Explore
build, and it SAYS that rather than exiting clean: `gate-explore: skipped (<reason>)` with
exit 2, which the done gate records as `explore=skipped(<reason>)`. Exiting 0 there used to
put `explore=pass` in the summary of every build that never ran Explore. The page is DELETED at Compose, with `public/_explore/`; `gate-shipready.mjs` catches
it if it survives, because it names the rejected directions and belongs to nobody but this
client.

## The hand-off - what you SAY when the preview is ready

The preview being ready is the moment the build is most often mis-handled, because the
natural instinct is to ask "which direction?" and stop. That collapses a range into a vote.
Say all four of these, in this order:

1. **Send them to `/explore`, not to a board.** "Start here: it explains the set and
   walks the range from restrained to bold." One link, not eight.
2. **Invite reaction, not selection.** Ask them to open BOTH ENDS before forming a view,
   and say plainly that mixing is normal and expected: "direction 5, but with 8's hero and
   2's navigation" is a better answer than a single page, and the section marks exist so
   they can point at one by name.
3. **Offer another pass, and mean it.** Anything they want tried gets redrawn onto the
   canvas so they look at the thing itself rather than a description of one. Changes are
   cheap here and expensive after Compose, and saying so is what gets the useful feedback
   out rather than a polite yes.
4. **THEN name the next phase explicitly.** Once a direction is settled it becomes the
   design system, and the rest of the site (services, about, contact, blog, legal) is
   built on it end to end, with accessibility, performance and mobile checked on every
   page. Say that out loud: a client who thinks the preview IS the site will not
   understand why there is more work, and a client who does not know the offer exists
   will not ask for it.

Do not skip step 3 to reach step 4 faster. A direction chosen without a round of changes
is a direction nobody has argued with, and it comes back at Compose when it is expensive.

## The two surfaces - the canvas and `/explore`

There are exactly two places a client looks at the set, and they show the same
artboards.

The **canvas** is the first choice whenever the design skill can run: the boards
laid out in ladder order with the calibration references as row 0, where the
client selects an element, retypes a word, drags a value and leaves a note, and
`/pick --canvas` reads all of it back.

**`/explore`** is the surface every tool can open and it ships either way: the
entrance stills at `/_explore/<id>.png` over the whole board at
`/_explore/<id>-full.png`, the calibration row, the drawn ladder, each
rung's own argument, and the canvas link first when one exists. Each board gets
a short, evocative **name** (not just `b1`) so the pick conversation is human:
the client can say "go with Deep Trawl" or "b2 hero".

There is no floating direction picker any more, and no board route behind one. A
client moves through the set by scrolling one page or panning one canvas, which
is what makes it read as a range rather than as a stack of tabs.

## Compose - turning picks into the canonical pages

Compose is a DESIGN ACT, page by page. The model composes when it is asked to
compose, and until this rewrite nothing after the pick asked it: one build's home
page was the picked board degraded by six safe-looking edits, and its eighteen
inner pages were kit assembly done in a single 22-minute burst with no board, no
library call and nobody opening a page. Every mechanical gate passed, because
every mechanical gate measures whether a page rendered.

The mechanic when the client says "b3 hero + b5 menu":

1. **LIFT THE PICKED BOARD, do not rebuild it from the kit.** A board is a
   drawing, so open `.palate/explore/shots/b3/rendered.html` and its `hero.png`
   and re-skin the board's own markup into Astro, on the board's rhythm. This is
   the FIRST Astro of the build.
2. Write a new `src/pages/index.astro` composing the picked sections in the
   board's order, using the canonical `loadPage(query, params, fallback)` pattern,
   and carry each section's id across as `data-palate-section="b3-hero"`. The
   board was the whole home page, so the sections it drew are the sections the
   page has; honour `explore.question_round.mix` for anything carried across from
   another rung, and `question_round.motion` for what moves.
2b. **A DEPARTURE FROM THE BOARD IS AN OVERRIDE, AND IT IS RECORDED.** Bleed to
   inset, the h1's role or size, a section's shape, the form's field count: each
   of those changes the framing the client chose, and each is defensible on its
   own, which is exactly why six of them can invert a direction with nothing
   objecting. Record it:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> --override <route> --section <band> --what "<what was done instead>" --reason "<why>"`.
   `gate-fidelity.mjs` suppresses exactly the measurement the override names and
   prints its reason beside the report; an unrecorded departure is
   indistinguishable from drift, which is why it is refused as one.
3. **Adopt the design tokens of the dominant board** - by default, whichever
   supplied the hero (the hero sets the tone). Confirm with the client if it
   is ambiguous. Token overrides live in `src/styles/globals.css` (or the
   brand-package overrides layer) - keep them inside the brand's range.
3b. **PROVE IT MOVING BEFORE BUILDING ANYTHING ELSE.** Run the full verify loop
   on `/` alone, hand the client the URL, and record the proof:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-pick.mjs" <project-dir> --proof <preview-url>`.
   That command MEASURES the page and refuses a page where nothing moves, so the
   proof is a measurement rather than a claim; it has to match the board's motion
   note in kind. Only after that is the rest of the site built. The fidelity gate
   does not run until that stamp exists, so skipping it silently turns the check
   off.
4. **Compose each remaining PAGE TYPE as a designed page, not as a fill.** One
   per page in `manifest.architecture` (W16), and the sheet `S<rung>` is the
   vocabulary: the navigation, footer, closing band, form, card and trust strip
   exactly as drawn. The kit is parts and states, never the page.
   - **The drawn inner page is lifted too.** `I<rung>` is the picture of what this
     direction's inner pages were meant to be, so the route the primary action
     lands on is built from it and marked `--primary` when its look is recorded.
   - **A page template is composed ONCE as a designed page type**, and its content
     and its photographs are chosen per route, not just its words. `[service].astro`
     rendering the same option grid for twelve routes is one page repeated twelve
     times, and it is what put two identical five-card grids back to back.
   - **Choose the page's one idea and decide its rhythm.** Ground, density and
     media alternate, and no two consecutive sections share a silhouette:
     `verify-rendered.sh` reports `repeated-silhouette` and it blocks.
   - **Crop the photographs by looking at them** (`references/assets.md`). A hero
     photograph under the bleed floor is cropped to its subject and served at the
     size it has, or it is not the hero.
   **Ground EVERY inner page in a page-type-matched donor (gap4 W18), not just the
   conversion ones.** For each archetype page (about, work, case-study, team, process,
   pricing, contact, ...), pull the best donor PAGES OF THAT TYPE via
   `refs_search { pageType:"about" }` (W17 ranks pages-as-units by craft), VIEW the
   matched inner-page screenshot (`refs_get_screenshot { slug, page }`), and re-skin its
   composition for this brand. An about page built from memory regresses to a generic
   "team + mission + values" template; an about page built from how the best about pages
   are made does not. Record the page-type-matched donor on the page in
   `manifest.architecture.pages[].donor_slug`.
   For every conversion section (pricing, booking, menu, services, contact) and
   every conversion-critical inner page, run the **section-build recipe**
   (`reference-library-usage.md`): facet-search 2-3 donors for THAT section, view
   their inner-page screenshots, build each component from
   `refs_get { slug, layer:"component_prompts" }`, and check the result against
   `refs_get { slug, layer:"do_dont" }` before emit. The composed section is grounded
   in how the best sites build that page, not assembled from memory.
4b. **RECORD THE LOOK, ONE PER PAGE TYPE, AND THEN JUDGE THE PAGES, LAST.** The
   visual loop and its hygiene fixes run FIRST on the composed pages, because
   that loop rebuilds and a page rebuilt after it was judged makes its
   comparison stale; the judge runs on the settled build, immediately before the
   local grade and done. Open the
   page beside the thing it was composed from and say what you see:
   `--looked <route> --shot .palate-shots/<file>.png --verdict "<what you can see>"`
   (the shot under `.palate-shots/` and newer than the built page, the verdict
   past 40 characters and never "looks good"). `gate-look.mjs` refuses a build
   where a page type was never opened. Then
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-page-judge.mjs" <project-dir>` shoots
   each looked route's entrance and ending and states two comparisons per surface:
   the home against the board's `hero.png` and `foot.png`, the primary inner page
   against `inner.png`, every other page type against the direction's donor. The
   MAIN AGENT dispatches one fresh subagent per comparison, exactly as for the
   boards, then re-runs the gate with `--judgements <file>`. The bar is the board
   judge's own, comparable or better on every surface, and a refused page is
   recomposed rather than accepted. `PALATE_GATE_JUDGE=0` releases both.
5. **Leave no Explore surface on the site.** Delete `public/_explore/`, clear
   `src/lib/variants.ts`, and delete `src/pages/explore.astro`. There is no
   board route to archive: `.palate/explore/` is working state and never ships.
   `gate-shipready.mjs` fails the hand-over if the page or the stills survive,
   because they name the directions the client did not choose.

After Compose: `PUBLIC_EXPLORE_MODE` flips to `false` for the rest of the
preview/production flow.

## Visual editing co-existence

`PUBLIC_EXPLORE_MODE` (which is what makes `/explore` render at all) and
`PUBLIC_SANITY_VISUAL_EDITING_ENABLED` (Sanity overlay) are independent. During
Explore the visual-editing flag is normally OFF - we're picking structure, not
editing content. It flips ON for the preview deployment after Compose, once
the canonical pages exist. Same pattern as today.

## Where this lives in the codebase

The artboards are the direction; the Astro project is the site. During Explore
the project carries `.palate/explore/seed/B1.dc.html`..`BN.dc.html` with
`I<rung>`, `M<rung>` and `S<rung>` beside each of them, and their
images (working state, never shipped), `src/lib/variants.ts` and
`src/pages/explore.astro`, and it has no page of its own at all. Beside them, all
generated and all re-derivable from what the surveyor and the operator wrote:
`.palate/explore/donor-heroes.json` (the surveyor's, one entry per rung),
`seed/D<rung>.dc.html` + `seed/d<rung>-hero.jpg` (the donor card and its fetched
hero), `shots/<id>/donor.jpg` and `public/_explore/<id>-donor.jpg` (the same
still, for the judge and for `/explore`), and
`.palate/explore/judge-request.json` + the judgements file the verifier collects
(`.palate/explore/judgements.json` by convention), which is the one record of
what the judge was asked and what it answered. **It acquires
its first page at Compose**, when the picked rung's home page is written in full
and proved moving. One project, one build, and only the chosen direction is ever
built.