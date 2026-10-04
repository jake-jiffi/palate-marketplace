# Type selection - fit over familiarity

The doctrine that governs how a Palate build chooses a typeface. It revises the
long-standing hard font-ban (Inter / Roboto / Arial / Space Grotesk as display)
into a justify-or-flag model. The rest of the hygiene floor (em dashes, AI-tell
copy) is unchanged. The mechanical counterpart lives in `references/anti-patterns.md`
(the `banned-display-*` rules, now JUSTIFY-OR-FLAG) and `scripts/gate-novelty.mjs`
(the cross-build type-face recurrence smell).

## Type selection: fit over familiarity (no font is banned, no font is the default)

A typeface is never chosen because it is safe, familiar, or what the last build
used. It is chosen because it fits THIS brand's voice and the website's overall
vision, and is then used with craft. Any face can win on the right project, an
editorial serif, a neo-grotesque, a humanist sans, an expressive display, a
monospace, even a "default" face like Inter, when the brand's character genuinely
calls for it and the type system does the work. Equally, any face is wrong when it
is reached for out of habit rather than decided.

Treat type exactly as we treat colour. Reproduce the donor's type SYSTEM (the
scale, pairing logic, weight contrast, optical sizing, tracking, line-length and
motion) and choose the FACE fresh, per brief, to fit the brand and the concept.
The craft is in how type is used, not in which name is set; an AI cannot own a
typeface.

Decide the face against: the brand voice, the feeling the page must create, the
vertical's expectations and whether to meet or subvert them, contrast with the
reference set, and above all whether it serves the website vision. The failure is
not any particular family, it is the unconsidered choice: the same face on
unrelated builds, or a system sans at one weight standing in for a decision.
Across Explore, faces differ because the directions genuinely differ, not to tick
a box, and a face recurring across unrelated builds is the smell to catch, not the
face itself.

- Fix: This face is a known AI/no-opinion default, so it must be a DECISION, not a
  fallback. It passes only if it genuinely fits the brand voice and website vision
  and the type system carries real contrast and craft. If so, justify it inline
  with `ux-lint-disable banned-display-<face>` plus a one-line reason (the brand
  calls for it because ...). If you cannot state that reason, it is the default
  tell, replace it with a face the brand actually chose.

## Two typographic tells to avoid by reflex

These are named in the field guide (`references/ai-slop-tells.md`) as 5-second
giveaways. Both have a mechanical flag (`banned-display-instrument-serif`,
`banned-display-geist`, `reseed-serif-italic-heading` in `references/anti-patterns.md`),
but the doctrine is the real lever because both are too variable to catch on every
authoring shape.

- **The of-the-moment display serif used by reflex.** Instrument Serif (and whatever
  trendy display serif follows it) bolted onto a generic sans body is the current
  version of the same default Space Grotesk was in 2023. The face is not banned, but
  reaching for it because it is current, not because the brand chose it, is the tell.
  Decide the editorial serif the brand voice actually calls for.
- **The serif-italic accent word in a sans heading (the Reseed "slop" treatment).** A
  single word inside a sans headline flipped to a serif italic to fake emphasis (e.g.
  "give your AI a *palate*"). It has become an instant AI-design signature because the
  generators all reach for it. Carry emphasis with the brand's real type system, weight,
  size, a genuine display face, not a borrowed italic word. If a one-word italic IS a
  deliberate brand device, it is a justified `ux-lint-disable reseed-serif-italic-heading`
  with a one-line reason, not a default.
