# Audit dimensions - the pre-production reviewer pass

After Compose, before the production checkpoint, Claude takes a deliberate
reviewer stance and walks the canonical pages against this 11-dimension audit.
The output is a findings list in the format described at the bottom of this
file. Critical and High findings block the build; the verify-fail loop in
`errors.md` applies.

This pass is interpretive (the structural counterpart is
`verify-is-real-astro.sh`; the aesthetic-mechanical counterpart is
`scripts/ux-lint.sh`). A senior reviewer's eye, codified.

## The dimensions

### 1. Visual hierarchy

Is the most important thing on the page also the most visually weighted? Is
there exactly one Z1 element per screen, or are several fighting? A typical
failure: the hero, the nav CTA and a feature card all use the brand accent at
the same weight.

PLACEMENT, not only weight. Is the focal element where attention actually lands,
or stranded in the dead bottom-left fallow with the eye led away from the action?
This is the composition/attention floor (`references/composition-and-attention.md`):
a stranded hero focal, a weight-vs-focal mismatch, or a divorced / orphaned key
element is a High finding (the deterministic complement is
`scripts/reference-capture/measure-composition.mjs`). It is a floor against broken
composition, not a centring rule, a bold off-centre hero that still leads the eye to
the action passes.

### 2. Spacing rhythm

Is vertical spacing on a documented scale (8 / 12 / 16 / 24 / 32 / 48 / 80),
or has it been freelanced per section? Are section padding choices consistent
within a page (e.g. all `py-20` or all `py-24`, not a mix)? Compare against the
donor's documented scale from `refs_get { slug, layer:"tokens" }` (or
`format:"design"`), not just internal consistency.

### 3. Typography pairing

Is there a clear display / body distinction at scale, weight, or family?
Are there fewer than three font sizes per section? Is line-length between
50 and 80 characters for body text? Compare against the donor's documented
type scale from `refs_get { slug, layer:"tokens" }` (or `format:"design"`), not
just internal consistency.

### 4. Empty states

Does every list / collection / search result have a designed empty state?
Does the blog index render gracefully when zero items have been published?
Forms with no submissions yet, dashboards with nothing to show, search with
no matches - all named, all designed.

### 5. Loading states

Every async region (CMS-fetched content, OG image generation, form submit)
has a designed loading state. No bare spinners; named skeletons or
explicit progress.

### 6. Error states

Forms render their error states deliberately (per-field message, accessible
to a screen reader, not red-on-red); fetch failures degrade to the `content.ts`
fallback rather than a blank section; 404 and 500 routes exist and feel like
they belong to the site, not generic Astro defaults. Validation fires on blur
for a filled field and on submit for an empty required one, never mid-typing;
the form has explicit submitting, success and failure states with visible,
announced feedback.

### 7. Dark mode (only if the brand supports it)

If the brand has a documented dark mode, every page passes a dark-mode pass:
contrast on text holds, brand accents do not glow, images that were tuned
for a light background still read.

### 8. Density and breathing room

The page does not feel either claustrophobic (every gap collapsed to 8px) or
unfocused (every gap blown out to 96px). Density matches the audience: dense
for power users, breathing room for narrative / consumer pages.

### 9. Accessibility (WCAG 2.2 AA minimum)

Visible focus on every interactive element. Colour contrast >= 4.5:1 for body,
>= 3:1 for large text. Forms have labels and `aria-describedby` for errors;
each label sits above its field (a placeholder is never the only label), and
inputs carry the right `type` / `inputmode` / `autocomplete`.
No motion that violates `prefers-reduced-motion`. Headings descend in order
without skipping levels.

**Interaction states + interruptibility** (the invisible layer AI output omits).
Every interactive element designs its full state set, not just its resting look:
hover (the `>= 8%` lightness floor), a visible **pressed / `:active`** state so a tap
does not feel dead, and a **disabled** state at the 40% floor where one applies. The
focus ring is keyboard-only, style it on `:focus-visible`, not `:focus`, so a mouse
click does not paint a ring. Everything is operable by keyboard in a sane tab order
with no keyboard trap: a modal moves focus in on open, keeps Tab inside while open,
closes on `Escape`, and returns focus to the trigger on close; a positive `tabindex`
is a finding (`positive-tabindex` in `references/anti-patterns.md`). Animations are
interruptible, a user input cancels or reverses an in-flight transition instead of
queueing behind it (never `transition: all`), and they still honour
`prefers-reduced-motion`. Governed by fit: a static page with no controls does not
invent states it has nothing to attach them to.

An interactive widget (dialog, combobox, menu, tabs, accordion, carousel, tooltip) is
either backed by the vetted behaviour layer (`references/interactive-primitives.md`,
which makes the keyboard / focus / ARIA correct by construction) OR it passes this full
keyboard + focus + ARIA audit on its own. A hand-rolled widget that does neither, the
default for AI output, is the finding: name it and route it to the behaviour layer.

### 10. Copy quality

Body copy is specific (passes the Conceptual Grounding Test from
`critique-discipline.md`); CTAs use a verb + noun shape ("See pricing" not
"Learn more"); the page would not be improved by deleting another 30% of the
words.

### 11. Reference fidelity / bespoke-ness

Does the page reproduce the lead reference's signature compositional move(s),
named and located? Point to it ("the donor's full-bleed pinned hero stage, at
`index.astro` L12-40, re-skinned to the brand"). Is the type / motion / grid the
reference's actual system (its scale, easings, rhythm re-skinned) or a Tailwind
default standing in for it? This is the positive counterpart to the anti-default
detector in `critique-discipline.md`: the audit fails not just for being slop,
but for being generic where a reference should have been reproduced.

Before the pass, re-pull the lead donor's tokens: `refs_get { slug, layer:"tokens" }`
(or `format:"design"` for the DESIGN.md with the rationale) plus
`refs_get_screenshot`, and compare the built page's type scale, easings and spacing
rhythm against the donor's documented numbers, not your memory of them. Auditing
from memory is itself a finding: if the pass did not re-pull the donor, say so.

Check against structured data, not memory: the donor's `sections[]` name the move
per section (`signatureMove`); read the move via `refs_get { slug,
layer:"signature_moves" }` and the rules via `refs_get { slug, layer:"do_dont" }`.
`format:"design"` returns a DESIGN.md the reviewer can diff the built page against.
Name the move, locate it in the code, and confirm the page does not break the
donor's `do_dont`.

A page that is **default-shaped with no reproduced signature move** is a Critical
finding (it is the exact failure this skill exists to beat). A page that uses
Tailwind-default type / spacing / motion where the lead reference had a distinct
system is High. Identity-layer borrowing (exact hexes, wordmark, font files,
photos, a trademark-grade gimmick) is also a finding - the fidelity is to the
craft layer, never the trade dress (see the two-layer doctrine in
`reference-library-usage.md`).

### 12. Landing conversion (landing / single-action routes only)

On a landing page or any single-action route, the conversion craft is its own
dimension. One primary action, repeated down a long page rather than hunted for;
the global site nav dropped (use `LandingLayout`, which omits the header slot,
not `BaseLayout`); a social-proof unit next to the primary CTA, not only in the
footer, and specific rather than vague (name three, not "trusted by 1000+"); the
lead form kept to one or two fields. A landing page that carries the full nav,
buries its one action, or asks for more fields than it needs is a High finding.
This applies only to landing / conversion routes; content pages keep their nav.

---

## Output format (for the reviewer pass)

Follow the Vercel review format, copied in. No preamble. No padding. No
encouraging sentences. Findings grouped by file, in this shape:

```
src/pages/index.astro
  L23 [Critical / hierarchy] Hero CTA and nav CTA both use --brand-accent at
       100%; the hero loses primacy. Suggest desaturating nav to --brand-muted.
  L78 [High / empty-state] Features grid renders nothing when content array
       is empty; add a one-line note and a sample card.
  pass

src/pages/blog/index.astro
  L14 [High / empty-state] Blog index has no zero-items state; add a copy
       block "First post coming soon" and a subscribe link.
  L42 [Medium / typography] Three font sizes in one card (24, 18, 14).
       Drop the 18; promote 14 if it carries metadata.
```

`pass` is allowed on a file with no Critical or High findings, but skipping
files because they "look fine" is a regression. Walk every page on the audit
route.

Severity mapping: Critical halts the build; High halts by default
(`--fail-on=High` is the default for the reviewer pass); Medium reports;
Cosmetic is advice.

After fixes, re-run the reviewer pass and re-run `scripts/ux-lint.sh`. Both
must come back clean before the production checkpoint.
