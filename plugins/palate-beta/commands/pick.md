---
description: Record which direction the client picked, what they said, and anything they changed on the canvas.
argument-hint: "--hero b3 [--section b5] [--intensity 3] [--answer motion=... --answer mix=... --answer cms=...] [--cta \"...\"] [--note \"...\"] [--canvas <dir>] [--canvas-url <url>] [--canvas-skipped \"<reason>\"] [--proof <url> [--proof-unmeasured \"<reason>\"]] [--second-pass] [--looked <route> --shot <path> --verdict \"...\" [--primary]] [--override <route> --section <band> --what \"...\" --reason \"...\"]"
---

For a project with `palate.project.json` (including a parent directory), use the live-design route below. If the marker is corrupt or unsupported, report it and leave state unchanged.

Read current project status, record the choice through the pinned runtime select operation, and continue from the selected direction. Preserve the person's combined-design instructions. The input and revision contract is in the live-build reference. Read `../references/live-build.md` for the exact commands, then finish this command without executing the legacy instructions below. Projects without the new marker retain the following workflow.


Record the client's pick from the Explore boards, on the canvas or from `/explore`. This is the
only moment the Explore stage produces a number, so it runs even when the pick arrived in a
sentence over the phone.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}`; if that variable is unset you are in a skill
checkout, so use the checkout root. `$SITE` is the project directory (the first argument if it
is a directory, else the current directory).

## 1. Get the pick, in the client's own words

A pick is a surface and a board, never a vote on a whole set. "Direction 4, but with 5's hero" is two
picks and the normal answer. If they named one board for everything, that is a hero pick and a
section pick on the same board, and it is worth saying back to them so a mix is not lost by
politeness.

Ask for the calibration answer too, if it was not already given: which of the references on
row 0 was closest to how bold they want to be. That is `--intensity`, 1 to 4, and it is the
position they pointed at, never a score.

## 2. Record it

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --hero b3 --section b5 --intensity 3 \
  --cta "Book a table" --note "Warmer photography on the hero"
```

It refuses an id that is not registered, a direction number outside the registered set, and a second pick on a
surface that already has one. That last refusal is deliberate: pass `--replace` so a change of
mind is a decision rather than an accident, and the record keeps one pick per surface.

`--second-pass` counts a round of changes. It counts rather than latching, because the question
worth answering is how many rounds a direction takes, not whether there was one.

## 3. Ask the question round, once, and record it

The moment the direction is settled, ask all three together and record them in one call:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" \
  --answer motion="Hero type settles in on load; the process band draws its rule on scroll" \
  --answer mix="b5's services rows, everything else from b3" \
  --answer cms="Yes, the owner will edit the services copy"
```

- **motion**: what should actually MOVE on the picked direction. The board is a still and the note
  written on it is a plan, not something the client has agreed to.
- **mix**: which sections come across from other boards, in their words.
- **cms**: whether anyone but us will ever edit this site. It decides the CMS, and it has to be
  answered before a page shape depends on the answer.

Only `motion`, `mix` and `cms` are accepted and an empty value is refused. Repeat calls merge, so
a later `--answer cms=...` does not erase an earlier `--answer motion=...`. `gate-done.sh` refuses
a build that recorded a pick and never recorded a complete round, because asking the three one at
a time across the build is how a client answers the CMS question after the pages are written.

## 3b. Record where the boards went, the moment they go

The canvas is published as soon as the boards are validated, and the manifest says so:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --canvas-url https://claude.ai/code/artifact/<id>
```

When no design skill can run in this session, say that instead, with the reason:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --canvas-skipped "no design skill in this session"
```

One or the other, never both in one call: they are opposite claims about the same set. A link
that is not http(s), and a skip with no reason, are both refused. `gate-explore.mjs` blocks a
build that recorded `explore.shown_at` and then said nothing about the canvas, because silence
reads as "the client never saw a canvas at all", which is worse than either honest outcome.

## 4. Read the canvas back, when there is one

If the client worked on the design canvas, ask the design skill to extract it to a directory,
then:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --canvas <extract-dir>
```

That diffs each artboard against the seed, keyed on the `data-palate-k` attribute
`boards-render.mjs` stamped on every element, and writes `.palate/explore/feedback.json`. Three
kinds land in it:

- **text**: a word the client changed. Compose MUST honour these on the picked surfaces. A
  client who retyped a headline has written your copy.
- **note**: a sentence they left on the canvas. Compose must answer each one in its summary,
  saying what was done about it, including "nothing, because" when that is the answer.
- **style**: a value they dragged. Evidence of intent, not an instruction. Someone pulling a
  font size on a flattened snapshot is saying "bigger", not specifying 72px.

The canvas is where the direction lives until Compose; the Astro project is the site.

## 5. At Compose, record the motion proof

Once Compose has written the home page and you have shown it to the client MOVING, record it:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --proof <preview-url>
```

That command MEASURES the page with `scripts/motion-proof.mjs` and records what it read, so the
proof is a measurement rather than a claim, and it REFUSES a page where nothing measurably
moves. What it measures has to match the picked board's motion note in kind: a promised
parallax as a parallax ratio, a promised marquee as `running`. If the preview cannot be reached
from this machine, record the reason instead of skipping:
`--proof <url> --proof-unmeasured "<reason>"`.

That stamp is what `gate-done.sh` reads to decide there is a composed home page to measure
against the picked board. Without it the fidelity gate skips on every build after Compose, and
the one check on whether the client got the direction they chose never runs.

## 5b. At Compose, record the look at each page type, and any departure from the board

Compose is a design act, so the two things it produces besides pages are a reading of each page
type and a reason for anything that left the board. Both are recorded here, because a build that
records neither passes every mechanical gate while quietly becoming a different site.

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" \
  --looked /security-windows --shot .palate-shots/security-windows.png \
  --verdict "<three things you can actually see in the shot>" --primary
node "$PALATE/scripts/palate-pick.mjs" "$SITE" \
  --override / --section hero --what "photo inset instead of bleed" \
  --reason "the only photograph over 900px is soft at full bleed"
```

- `--looked` takes ONE look per page type (home, service, about, contact, reviews, landing), and
  a second look at the same route replaces the first. The shot has to sit under `.palate-shots/`
  and be NEWER than the built page, and the verdict has to run past 40 characters and must not be
  "looks good", "matches the board", "no issues", "as designed" or "fine", which is the sentence
  somebody writes who did not open anything. `scripts/gate-look.mjs` refuses a picked build with
  a page type nobody looked at.
- `--primary` marks the route the DRAWN INNER PAGE (`I<rung>`) became, at most one per build and
  never the home page. With it, the page judge holds that route against `inner.png`, which is the
  picture the client was shown; without it, it falls back to the donor's home page and says so.
- `--override` records a deliberate departure from the board with the reason attached. The reason
  IS the record: `gate-fidelity.mjs` suppresses exactly the framing measurement the override names
  and prints the reason beside the report, and a departure with no reason is indistinguishable
  from the drift the gate exists to catch. Overrides append, because two decisions taken at two
  moments are two decisions.

One record per call: `--looked` and `--proof` in the same command is refused, the way
`--canvas-url` and `--canvas-skipped` already are.

## 6. Say what happens next

Read the picks back in one sentence, then name the next step: the home page is built first, in
full, and shown to them moving before anything else is written on top of it. Do not go straight
into building the rest of the site. See `references/explore-stage.md`.
