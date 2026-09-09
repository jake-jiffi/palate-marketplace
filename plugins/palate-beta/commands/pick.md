---
description: Record which direction the client picked, what they said, and anything they changed on the canvas.
argument-hint: "--hero b3 [--section b5] [--intensity 3] [--cta \"...\"] [--note \"...\"] [--canvas <dir>] [--proof <url>] [--second-pass]"
---

Record the client's pick from the Explore boards. This is the only moment the Explore stage
produces a number, so it runs even when the pick arrived in a sentence over the phone.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}`; if that variable is unset you are in a skill
checkout, so use the checkout root. `$SITE` is the project directory (the first argument if it
is a directory, else the current directory).

## 1. Get the pick, in the client's own words

A pick is a surface and a board, never a vote on a whole set. "Rung 4, but with 5's hero" is two
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

It refuses an id that is not registered, a rung outside the ladder, and a second pick on a
surface that already has one. That last refusal is deliberate: pass `--replace` so a change of
mind is a decision rather than an accident, and the record keeps one pick per surface.

`--second-pass` counts a round of changes. It counts rather than latching, because the question
worth answering is how many rounds a direction takes, not whether there was one.

## 3. Read the canvas back, when there is one

If the client worked on the design canvas, ask the design skill to extract it to a directory,
then:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --canvas <extract-dir>
```

That diffs each artboard against the seed and writes `.palate/explore/feedback.json`. Three
kinds land in it:

- **text**: a word the client changed. Compose MUST honour these on the picked surfaces. A
  client who retyped a headline has written your copy.
- **note**: a sentence they left on the canvas. Compose must answer each one in its summary,
  saying what was done about it, including "nothing, because" when that is the answer.
- **style**: a value they dragged. Evidence of intent, not an instruction. Someone pulling a
  font size on a flattened snapshot is saying "bigger", not specifying 72px.

The canvas is never the source of truth. The Astro project is.

## 4. At Compose, record the motion proof

Once Compose has written the home page and you have shown it to the client MOVING, record it:

```bash
node "$PALATE/scripts/palate-pick.mjs" "$SITE" --proof <preview-url>
```

That stamp is what `gate-done.sh` reads to decide there is a composed home page to measure
against the picked board. Without it the fidelity gate skips on every build after Compose, and
the one check on whether the client got the direction they chose never runs.

## 5. Say what happens next

Read the picks back in one sentence, then name the next step: the home page is built first, in
full, and shown to them moving before anything else is written on top of it. Do not go straight
into building the rest of the site. See `references/explore-stage.md`.
