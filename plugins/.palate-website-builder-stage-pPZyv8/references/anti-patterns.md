# Anti-patterns - the rules `scripts/ux-lint.sh` enforces

This file is BOTH the human spec and the machine source of truth. The linter
parses every `### Rule: ...` heading below and runs its `Pattern` against the
project's files at the listed `Files` globs. Add a rule by adding a section.
Disable a single hit in code with a `ux-lint-disable <rule-id>` comment on the
same or previous line.

Severities: **Critical** halts the build. **High** halts the build by default
(`--fail-on=High`). **Medium** reports but does not halt. **Cosmetic** is
advice only.

Modes: **always** (every run), **variant-time** (per-variant during Explore),
**compose-time** (after Compose, before Finalise), **production** (Phase B
onward).

The seed below combines the named bad-actor list from Anthropic's
frontend-design skill, the curated subset of anti-slop-ui's 34 tells, the
Vercel `web-interface-guidelines/command.md` code-level rules (copied in, NOT
remote-fetched), and Palate's house style (no em dashes, Australian English).

The canonical catalogue of every known tell (the checklist a build is held to,
including the structural / substance / trust-chrome ones a linter cannot reliably
catch, and the Quick QA pass) is `references/ai-slop-tells.md`. This file is the
deterministic and doctrinal subset that the skill enforces; that file is the full
map of what those rules are chasing. Read it when adding a rule.

---

## House style

### Rule: no-em-dash
- Severity: Critical
- Mode: always
- Files: *.astro,*.css,*.ts,*.tsx,*.mjs,*.md,*.mdx,*.json
- Pattern: `—`
- Fix: Em dashes are not Palate house style. Replace with " - " (a spaced hyphen), a comma, parentheses, or a colon. Apply to copy and to inline comments.

### Rule: no-en-dash-as-em
- Severity: Medium
- Mode: always
- Files: *.astro,*.md,*.mdx
- Pattern: `–`
- Fix: En dashes are for number / date ranges (e.g. `9-5`, `2024-2025`); not a substitute for em dashes. If you meant a sentence break, use " - ".

---

## Known default display faces - JUSTIFY-OR-FLAG (not a hard ban)

These four faces (Inter, Roboto, Arial, Space Grotesk used as a DISPLAY family)
are the AI / no-opinion defaults: the face a model reaches for when it has no
opinion. They are a **yellow flag, not forbidden**. No font is banned and none is
the default; type is chosen because it fits THIS brand's voice and the website
vision, then used with craft (`references/type-selection.md`).

The rule below still FIRES on each of these faces used as display. The PASS
condition is a justified decision: a `ux-lint-disable banned-display-<face>`
directive on the same or preceding line, **accompanied by a one-line reason
comment** (e.g. `the brand calls for Inter because ...`). A disable with no reason
is itself the default tell, so `ux-lint.sh` flags a bare disable too. If you cannot
state the brand reason, it is the default tell: replace it with a face the brand
actually chose. Treat type exactly as colour: reproduce the donor's type SYSTEM
and decide the FACE per brief.

### Rule: banned-display-inter
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Inter`
- Fix: Inter is a known AI/no-opinion default display face, so it must be a DECISION, not a fallback. Justify it with a one-line reason on a `ux-lint-disable banned-display-inter` directive (the brand calls for it because ...) - and only if the type system carries real contrast and craft. Otherwise it reads as average: replace it with a more committed face the brand actually chose (a contemporary grotesque, a humanist sans, an editorial serif, a display).

### Rule: banned-display-roboto
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Roboto`
- Fix: Roboto is Material's default - a known no-opinion display face. Same justify-or-flag rule as Inter: a `ux-lint-disable banned-display-roboto` with a one-line brand reason, or replace it with a face the brand decided on.

### Rule: banned-display-arial
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Arial`
- Fix: Arial as a primary display family signals "no design opinion". Known default: justify with a one-line brand reason on a `ux-lint-disable banned-display-arial`, or replace it with a face the brand chose.

### Rule: banned-display-space-grotesk
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Space Grotesk`
- Fix: Space Grotesk is the 2023-2024 startup default; overuse has made it generic. Known default: justify with a one-line brand reason on a `ux-lint-disable banned-display-space-grotesk`, or replace it with a face the brand actually chose.

### Rule: banned-display-system-ui
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?system-ui['"]?\s*[,;]`
- Fix: `system-ui` as the FIRST family in a display stack means the page renders different fonts on different OSes; do not use as primary. Acceptable only at the tail of a stack as a safety net.

The faces below are the CURRENT of-the-moment defaults (the 2025-2026 successors
to Space Grotesk): the trendy display serifs and the trendy geometric sans a model now
reaches for when it has no opinion. Same JUSTIFY-OR-FLAG model as the four above, a
`ux-lint-disable banned-display-<face>` with a one-line brand reason passes; a bare
disable does not.

### Rule: banned-display-instrument-serif
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Instrument Serif`
- Fix: Instrument Serif is the current of-the-moment display serif and a named 5-second AI giveaway (`references/ai-slop-tells.md`) - the face bolted onto a generic sans body by reflex. Justify it with a one-line brand reason on a `ux-lint-disable banned-display-instrument-serif` (the brand calls for it because ...) only if the type system carries real contrast and craft, or replace it with an editorial serif the brand actually chose.

### Rule: banned-display-fraunces
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Fraunces`
- Fix: Fraunces is a current of-the-moment display serif that now reads as a recognisable AI-build / "Opus" tell (the giveaway F letterforms); Palate dropped it from its own brand for exactly this reason. Justify it with a one-line brand reason on a `ux-lint-disable banned-display-fraunces` (the brand calls for it because ...) only if the type system carries real contrast and craft, or replace it with an editorial serif the brand actually chose.

### Rule: banned-display-geist
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Geist(?!\s+Mono)`
- Fix: Geist (Vercel's default sans) is the new Inter - the no-opinion geometric sans of the v0 / Next starter, named in the field guide alongside Inter. Justify with a one-line brand reason on a `ux-lint-disable banned-display-geist`, or replace it with a more committed face the brand chose. (Pattern excludes "Geist Mono", which is a legitimate code face, not a display tell.)

The pair below is THIS skill's own de-facto default: across recent builds the model
kept reaching for **Bricolage Grotesque** (display) + **Hanken Grotesk** (body) when it
had no opinion, so they have become the 2025-2026 Palate reflex pairing, the exact
self-tell this skill must break. Same JUSTIFY-OR-FLAG model as the faces above, a
`ux-lint-disable banned-display-<face>` with a one-line brand reason passes; a bare
disable does not. If the build cannot state why THIS brand chose Bricolage or Hanken,
it is the reflex, not a decision: choose the face fresh for the brand's voice and the
website vision (`references/type-selection.md`).

### Rule: banned-display-bricolage
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Bricolage Grotesque`
- Fix: Bricolage Grotesque has become this skill's reflex display face, reached for build after build with no brand reason - the current Palate self-tell, exactly the kind of recurring face the type doctrine warns against. Justify it with a one-line brand reason on a `ux-lint-disable banned-display-bricolage` (the brand calls for it because ...) only if the type system carries real contrast and craft, or replace it with a display face the brand actually chose. Treat type like colour: decide the face per brief.

### Rule: banned-body-hanken
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `font-family\s*:\s*['"]?Hanken Grotesk`
- Fix: Hanken Grotesk is the body half of this skill's reflex pairing (with Bricolage Grotesque as display) - the face the model defaults to for body text when it has no opinion. Justify it with a one-line brand reason on a `ux-lint-disable banned-body-hanken`, or replace it with a body face the brand decided on. The recurring face is the smell, not the family.

---

## Banned visual defaults

### Rule: gradient-purple-to-pink
- Severity: Critical
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `(?i)(linear|radial)-gradient\([^)]*purple[^)]*pink`
- Fix: Purple-to-pink linear gradients are the AI hero default and an instant tell. Pick a single brand colour and use weight, contrast and composition for emphasis.

### Rule: gradient-pink-to-purple
- Severity: Critical
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `(?i)(linear|radial)-gradient\([^)]*pink[^)]*purple`
- Fix: Same as the reverse direction; this is the same gradient.

### Rule: neon-text-glow
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `text-shadow\s*:\s*[^;]*0\s+0\s+\d+`
- Fix: Big-blur neon text glows on body type are decorative slop. If glow is a brand decision, it lives in the brand package as a documented effect, not inline.

### Rule: many-stop-gradient
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `gradient\((?:[^,()]|\([^)]*\))*,(?:[^,()]|\([^)]*\))*,(?:[^,()]|\([^)]*\))*,(?:[^,()]|\([^)]*\))*,`
- Fix: A gradient with four or more colour stops reads as a sticker. Two stops at most for marketing surfaces; three only if the brand documents it. (Pattern counts only top-level commas, so an `rgba()`/`hsl()`/`calc()` colour's internal commas do not falsely trip a 2-stop scrim or vignette.)

### Rule: inline-style-hex
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `style=["'][^"']*#[0-9a-fA-F]{3,6}`
- Fix: A hard-coded hex in an inline `style` bypasses the brand tokens and drifts from the system. Use a `brand-*` utility or a `var(--brand-*)` token; if a one-off colour is genuinely needed, add it to the brand package.

---

## Gradient-text, gradient-overuse and glassmorphism (JUSTIFY-OR-FLAG)

### Rule: gradient-text-clip
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `(?i)(bg-clip-text[^>"']*text-transparent|text-transparent[^>"']*bg-clip-text|-webkit-background-clip\s*:\s*text|(?<!-webkit-)background-clip\s*:\s*text)`
- Fix: Gradient-clipped text on a headline (`bg-clip-text text-transparent` with a `from-*/to-*` gradient, or `background-clip:text` + `color:transparent`) is the universal #1 5-second AI giveaway (`references/ai-slop-tells.md`). The purple-pink CSS gradient is already a hard Critical block; this catches the Tailwind utility idiom the colour rule misses, in ANY hue. Carry hierarchy with weight, size and composition, not rainbow text. If a single gradient word is a genuine brand device, justify it on a `ux-lint-disable gradient-text-clip` with a one-line reason.

### Rule: gradient-overuse
- Severity: Medium
- Mode: always
- Files: *.css
- Pattern: `(?im)^(?=(?:[^\n]*\bgradient\([^\n]*){3,})`
- Fix: Three or more `gradient()` declarations on one CSS line (or gradient-on-everything across a stylesheet) reads as decoration by reflex. Gradients earn their place one or two at a time; if every surface has one, the page has none. Justify a genuine multi-gradient system on a `ux-lint-disable gradient-overuse` with a one-line brand reason. (Per-line, low-FP: only fires when three gradients stack on a single line, e.g. a layered `background` shorthand.)

### Rule: glassmorphism-decorative
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `(?i)(backdrop-filter\s*:\s*[^;{}]*blur|\bbackdrop-blur(-(sm|md|lg|xl|2xl|3xl|none))?\b)`
- Fix: Frosted-glass panels (`backdrop-filter: blur`, Tailwind `backdrop-blur`) used as decoration are a named tell, now in backlash, and routinely drop body text below the contrast floor. Reserve a blur for a genuine overlay where the layer beneath must read through (a sticky nav over a photo). If glass is a brand decision, justify it on a `ux-lint-disable glassmorphism-decorative` with a one-line reason, and keep it off body copy. See the glassmorphism doctrine below.

### Anti-pattern: the two-tone (two solid colours) hero heading

A hero `<h1>` whose inner spans use **two or more DISTINCT solid text colours** to fake
hierarchy (`<h1><span class="text-slate-900">Give your AI</span> <span
class="text-indigo-500">a palate</span></h1>`). It is the solid-colour sibling of the
gradient-clipped headline, named in the field guide ("two-tone, gradient or
italic-and-colour headings", `references/ai-slop-tells.md`). Gradient text is already a
hard / flag-with-justify rule (`gradient-text-clip`); this catches the two-SOLID-colour
variant that the gradient rule misses. The tell is the same: hierarchy reached for with
a second colour instead of with weight, size and composition.

Carry the emphasis with the page's real type system (weight, size, the leading, the
line break), not a recolour of part of the heading. This is JUSTIFY-OR-FLAG, enforced by
the block-aware check `two-tone-heading` in `scripts/ux-lint.sh`: it reads each `<h1>`
and counts the distinct solid colours its inner elements set (inline `color:`, Tailwind
arbitrary `text-[#hex]`, or `text-{hue}-{shade}` utility classes); two or more distinct
colours flag. A single accent word, or one colour repeated, does not fire. A genuine
two-colour brand wordmark passes with `ux-lint-disable two-tone-heading` plus a one-line
reason on the heading's opening line or the line above it.

---

## Raw untuned accent colours used AS the brand accent (JUSTIFY-OR-FLAG)

These flag the framework / genre-default accent colours when they are used AS the
primary accent (a custom property named accent/primary/brand/cta, or a Tailwind
accent class), not anywhere the colour merely appears. A brand that genuinely owns
the colour passes with a `ux-lint-disable accent-<rule>` plus a one-line reason; a
bare disable does not. Tints (50-300) and deep shades (700+) are NOT flagged, only the
accent band (400-600). The render-side complement is the visual rubric defect
"the accent reads as a raw framework default / the genre cliche".

### Rule: accent-indigo-default
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `(?i)--[a-z-]*(accent|primary|brand|cta)[a-z-]*\s*:\s*#?(6366f1|818cf8|8b5cf6|a855f7|7c3aed|6d28d9|3b82f6|2563eb)\b`
- Fix: The raw Tailwind indigo / violet / blue hex (#6366F1, #3B82F6, #2563EB and family) assigned to an accent / primary / brand / cta custom property is "that one shade of purple", or Tailwind's default blue (the `bg-indigo-500` successor) - the single most universal visual AI tell (`references/ai-slop-tells.md`). Tune a real brand accent. If the brand genuinely owns this colour, justify it on a `ux-lint-disable accent-indigo-default` with a one-line reason.

### Rule: accent-tailwind-class
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.ts,*.html
- Pattern: `(?i)\b(bg|text|border|from|to|ring|fill)-(indigo|violet|purple)-(4|5|6)\d\d\b`
- Fix: A raw Tailwind indigo / violet / purple accent class (e.g. `bg-indigo-500`, `text-violet-600`, `from-purple-500`) used as the brand accent is the default-palette tell. Tune a brand colour into the Tailwind config and use a brand token. If the brand owns purple, justify it on a `ux-lint-disable accent-tailwind-class` with a one-line reason. (Only the 400-600 accent band fires; tints and deep shades are fine.)

### Rule: accent-cyan-on-dark
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.ts,*.html
- Pattern: `(?i)\b(bg|text|border|from|to|ring|fill)-cyan-(3|4|5)\d\d\b`
- Fix: A bright cyan accent class (the "cyan-on-dark" tell) is a very common generated-look default. Decide a brand accent instead. If cyan is genuinely the brand, justify it on a `ux-lint-disable accent-cyan-on-dark` with a one-line reason.

### Rule: accent-emerald-cta
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.ts,*.html
- Pattern: `(?i)\b(bg|from|to)-emerald-(4|5|6)\d\d\b`
- Fix: A raw emerald CTA (`bg-emerald-500`) is the SaaS default-green accent. Pick a brand colour; green is a genre default even when executed well (`critique-discipline.md` habit 5, category-default palette). If green is the brand, justify it on a `ux-lint-disable accent-emerald-cta` with a one-line reason.

### Rule: accent-friendly-teal
- Severity: Medium
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro,*.mjs
- Pattern: `(?i)--[a-z-]*(accent|primary|brand|cta)[a-z-]*\s*:\s*#?008275\b`
- Fix: The "friendly" teal-green (~#008275) assigned to the brand accent is the newer anti-purple-but-still-generic palette (soft beige + teal + curved friendly fonts). It is a default, just a different one. Tune a real accent or justify it on a `ux-lint-disable accent-friendly-teal` with a one-line reason.

---

## Stock card / heading shapes (JUSTIFY-OR-FLAG)

### Rule: accent-side-border-card
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.ts,*.html
- Pattern: `(?i)class="[^"]*\bborder-l-4\b[^"]*\b(border|from|bg)-(indigo|violet|purple|cyan|emerald|blue|teal)-(4|5|6)\d\d\b`
- Fix: A thick coloured stripe down one side of a rounded card (`border-l-4` + an accent colour) is the Tailwind-UI "callout" reflex (`references/ai-slop-tells.md`). Reserve a coloured edge for a real state (an error, a selected plan) where the colour means something; do not put it on every card as default decoration. If this is a genuine callout, justify it on a `ux-lint-disable accent-side-border-card` with a one-line reason. See the side-border doctrine below.

### Rule: reseed-serif-italic-heading
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `(?i)<h[1-3][^>]*>[^<]*<(span|em|i)[^>]*(font-family[^>]*serif|class="[^"]*\b(italic[^"]*(serif|font-serif)|(serif|font-serif)[^"]*italic)\b)`
- Fix: A serif-italic accent word dropped into a sans heading (the Reseed "slop" treatment, e.g. `<h1 class="font-sans">give your AI a <em class="font-serif italic">palate</em></h1>`) is a named, very-common typographic tell. The mix faked emphasis by reflex. Carry the emphasis with weight, size or the page's real type system instead. If a single italic word is a deliberate brand device, justify it on a `ux-lint-disable reseed-serif-italic-heading` with a one-line reason. (Catches the inline-markup form only; the broader pattern is doctrine in `references/type-selection.md`.)

---

## Interaction states and touch (JUSTIFY-OR-FLAG)

### Rule: custom-cursor-not-gated
- Severity: Medium
- Mode: always
- Files: *.css,*.astro,*.tsx,*.jsx,*.vue,*.svelte
- Pattern: `(?i)(cursor\s*:\s*none\b|\bcursor-none\b)`
- Fix: `cursor: none` hides the native cursor. A custom cursor built on it strands anyone without a fine pointer: on touch there is no cursor at all, and if the cursor script fails or the visitor is on a keyboard / assistive tech the affordance is simply gone. Gate it behind `@media (hover: hover) and (pointer: fine) { ... }` so it only applies where a real pointer exists, and keep a visible `:focus-visible` path. This is JUSTIFY-OR-FLAG (build-commission.md mandates a custom cursor; this is the touch-degradation guard for it): if it is correctly gated, or a deliberate case like a fullscreen player, justify it on a `ux-lint-disable custom-cursor-not-gated` with a one-line reason.

---

## AI-tell phrases (anti-slop-ui curated subset)

The lint rules below are the mechanical floor: a fixed list of the highest-signal
tells, caught deterministically so they never ship. They are not the full copy
pass. For that, run the `humanizer` skill over the copy: it sweeps 40+ patterns
(rhythm, hedging, structure, the puffery the regex cannot see) that no fixed
pattern list catches. Lint first to clear the obvious tells, then humanise for the
full sweep.

### Rule: ai-tell-leverage
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `\bleverage\b`
- Fix: "Leverage" is the highest-frequency AI tell in marketing copy. Say "use", "apply", or just name the action.

### Rule: ai-tell-fast-paced
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)in today's fast-?paced`
- Fix: Pure boilerplate. Open with a specific observation about the reader's actual situation; never with a sentence the reader has read 100 times.

### Rule: ai-tell-let-dive
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)let'?s dive (in|into)`
- Fix: Tutorial-template language. Replace with the actual first step, named directly.

### Rule: ai-tell-game-changer
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)game[- ]chang(er|ing)`
- Fix: Empty intensifier. Either delete it or replace with the concrete change.

### Rule: ai-tell-synergy
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)synerg(y|ies|istic)`
- Fix: Corporate filler. Say what two things actually do together.

### Rule: ai-tell-unleash
- Severity: Critical
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bunleash(ing|es)?\b`
- Fix: Marketing cliche. Say "let people do X" or just describe the action. (Matches the verb forms unleash/unleashing/unleashes, not the proper noun "Unleashed" - the real inventory product some ops businesses partner with.)

### Rule: ai-tell-seamless
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bseamless(ly)?\b`
- Fix: "Seamless" describes everything and nothing. Specify what was previously friction-full and is now smooth, with a number or example.

### Rule: ai-tell-crafted-with-care
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)(crafted with care|lovingly crafted|handcrafted with)`
- Fix: Etsy template. Either delete or say what makes the work careful (the named technique, the time spent, the person who did it).

### Rule: ai-tell-revolutionise
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)revolution(is|iz)e`
- Fix: Outsized claim. Replace with the concrete change being delivered.

### Rule: ai-tell-elevate-your
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)elevate your`
- Fix: "Elevate your workflow / experience / brand" is template glue. Name the actual lift.

### Rule: ai-tell-cutting-edge
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)cutting[- ]edge`
- Fix: Decade-old startup filler. Describe the actual newness, dated.

### Rule: ai-tell-delve
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bdelve\b`
- Fix: The signature LLM verb. Say "look at", "dig into", or just make the point directly.

### Rule: ai-tell-in-the-realm-of
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)in the realm of`
- Fix: Throat-clearing that adds nothing. Name the field plainly ("in payments", "for restaurants") or drop the phrase.

### Rule: ai-tell-its-worth-noting
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)it'?s worth noting`
- Fix: Filler hedge. If it is worth saying, just say it; if it is not, cut it.

### Rule: ai-tell-underscore
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bunderscore(s|d)?\b(?! ?_)`
- Fix: "Underscores the importance of" is LLM emphasis filler. Say "shows", "proves", or state the point. (The negative look-ahead skips the literal `_` character used in code and identifiers.)

### Rule: ai-tell-testament-to
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)testament to`
- Fix: "A testament to" is empty praise. Give the concrete evidence instead (the number, the outcome, the named result).

The rules below extend the AI-tell list with the field guide's tapestry talk, contrast
framing, therapy-mode openers and the exact stock pricing / free-tier phrases
(`references/ai-slop-tells.md`). Same mechanism as the phrases above: a bare
`ux-lint-disable <rule>` suppresses a genuine quote / proper-noun use.

### Rule: ai-tell-rich-tapestry
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\brich tapestry\b`
- Fix: "A rich tapestry of ..." is signature LLM metaphor. Name the actual things plainly instead of weaving them into a tapestry.

### Rule: ai-tell-landscape-of
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bthe landscape of\b`
- Fix: "The landscape of {industry}" is throat-clearing stock metaphor. Name the field plainly ("in payments", "for restaurants") or drop the phrase.

### Rule: ai-tell-fast-paced-world
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)in today'?s fast[- ]?paced world`
- Fix: "In today's fast-paced world" is pure boilerplate (caught with or without the apostrophe and with a hyphen or a space). Open with a specific observation about the reader's actual situation. (Complements `ai-tell-fast-paced`, which catches the shorter "in today's fast-paced" stem.)

### Rule: ai-tell-contrast-framing
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bit'?s (not just|not only) [a-z]|\bit'?s [a-z]+, not [a-z]`
- Fix: Contrast-framing headline formulas ("It's not just X, it's Y", "It's X, not Y") are an overused AI copy shape. State the one true thing directly; you rarely need the foil. Quote a real source on a `ux-lint-disable ai-tell-contrast-framing` if it is genuine.

### Rule: ai-tell-and-honestly
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)(^|[>"'(])\s*and honestly[,?\s]`
- Fix: "And honestly?" / "And honestly," as an opener is therapy-mode tic copy. Cut the throat-clearing and lead with the point. (Anchored to a sentence / element start, so "and honestly earned" mid-sentence does not fire.)

### Rule: ai-tell-youre-not-alone
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\byou(?:'re| are) not (alone|broken)\b`
- Fix: "You're not alone" / "you're not broken" is therapist-talk that has become an AI tell in marketing copy. Speak to the specific situation, not the reassurance template.

### Rule: ai-tell-simple-honest-pricing
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bsimple,? honest pricing\b`
- Fix: "Simple, honest pricing" is a verbatim stock phrase (`references/ai-slop-tells.md`). Show the price and what it buys; the adjectives prove nothing. Write the heading the brand would actually use.

### Rule: ai-tell-free-forever
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\b(completely )?free forever\b`
- Fix: "Completely free forever" is free-tier microcopy slop. Say exactly what the free tier includes and where it ends, in plain words.

### Rule: ai-tell-no-registration-required
- Severity: Medium
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bno (registration|sign-?up|credit card) required\b`
- Fix: "No registration required" / "No credit card required" is generated free-tier eyebrow microcopy. If frictionless start is a real selling point, say it in the brand's own voice and only once, not as a stock badge.

---

## AI-washing copy (JUSTIFY-OR-FLAG)

### Rule: ai-washing-copy
- Severity: High
- Mode: always
- Files: *.md,*.mdx,*.astro,*.ts,*.tsx
- Pattern: `(?i)\bAI[- ]?(powered|driven|enabled|native|first)\b|\bpowered by AI\b`
- Fix: "AI-powered" / "powered by AI" / "AI-driven" is AI-washing, a now-regulated claim and a universal tell. The test: remove the word "AI" and read the sentence again - if the product is unchanged, the AI is decoration. Lead with the outcome; if the AI is real, name what only a model could do. Justify a true claim on a `ux-lint-disable ai-washing-copy` with a one-line reason naming what the AI actually does (a bare disable does not pass - the reason IS the test). See the AI-washing doctrine below.

---

## Code-level rules (Vercel web-interface-guidelines, copied in)

### Rule: transition-all
- Severity: High
- Mode: always
- Files: *.css,*.ts,*.tsx,*.astro
- Pattern: `transition\s*:\s*all\b`
- Fix: `transition: all` animates every property and causes layout thrash. List the specific properties (e.g. `transition: color 200ms, background-color 200ms`).

### Rule: tailwind-transition-all
- Severity: Medium
- Mode: always
- Files: *.astro,*.ts,*.tsx,*.html
- Pattern: `class[^=]*=\s*["'][^"']*\btransition-all\b`
- Fix: Same as `transition: all`. Use `transition-colors`, `transition-transform`, or a custom utility for the specific property.

### Rule: input-missing-autocomplete
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `<input(?![^>]*\bautocomplete=)[^>]*>`
- Fix: Inputs without `autocomplete` break browser autofill and harm conversion. Set the correct token (`email`, `name`, `tel`, `street-address`, `current-password`, etc.) or `autocomplete="off"` if truly free-form.

### Rule: input-missing-name
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `<input(?![^>]*\bname=)[^>]*>`
- Fix: Inputs without `name` cannot be submitted. Add a `name`; pair it with `id` and a `<label for=...>`.

### Rule: input-missing-type
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `<input(?![^>]*\btype=)[^>]*>`
- Fix: An input with no `type` falls back to `text`, so the wrong mobile keyboard and the wrong validation apply. Set the real type (`email`, `tel`, `search`, `number`, `checkbox`, ...), and add `inputmode` where the keyboard matters.

### Rule: placeholder-as-label
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `<input(?![^>]*aria-label)(?![^>]*\bid=)[^>]*\bplaceholder=`
- Fix: An input with a placeholder but no `id` (so no `<label for>` can target it) and no `aria-label` is using the placeholder as its label - the text vanishes on focus and fails screen readers. Add a visible `<label for>` above the field (give the input an `id`), or an `aria-label`. A correctly-labelled input has an `id`, so it does not trip this rule.

### Rule: brand-name-needs-translate-no
- Severity: Medium
- Mode: always
- Files: *.astro
- Pattern: `(?i)(?<![\w@/."])(palate|sanity|cloudflare|vercel|astro|stripe|claude|anthropic)(?![\w/.-])`
- Fix: Wrap brand names with `<span translate="no">` so machine translators do not mangle them. Apply once per page where the name appears; not every mention needs wrapping in body prose. (Pattern skips import paths, `*.astro` filenames and the `Astro.*` global so it only flags brand names in visible text, not code.)

### Rule: useState-for-mouse-coords
- Severity: High
- Mode: always
- Files: *.tsx,*.ts
- Pattern: `useState[^(]*\(\s*\{[^}]*x\s*:[^,}]*,[^}]*y\s*:`
- Fix: `useState` for continuous mouse / pointer values triggers a re-render per move. Use a `ref` and read it in the animation frame, or use Motion's `useMotionValue`.

### Rule: fullpage-webgl-canvas
- Severity: High
- Mode: always
- Files: *.tsx,*.astro
- Pattern: `<Canvas\b(?=[^>]*(?:h-screen|min-h-screen|height:\s*100vh|height:\s*100dvh))`
- Fix: A full-viewport-height WebGL `<Canvas>` (`h-screen` / `100vh`) as a permanent background blows the motion budget (`references/motion-and-3d.md`): one canvas per page, never full-page, `frameloop="demand"`, `dpr` capped at 2. Constrain the canvas to a bounded, reserved aspect-ratio box, hydrate it `client:visible`, and ship a static poster as the LCP and the reduced-motion fallback.

### Rule: r3f-frameloop-always
- Severity: Medium
- Mode: always
- Files: *.tsx
- Pattern: `<Canvas(?![^>]*frameloop)[^>]*>`
- Fix: An R3F `<Canvas>` without `frameloop` runs a free RAF loop and drains mobile battery / GPU. Set `frameloop="demand"` (and `"never"` under reduced motion) per the motion budget (`references/motion-and-3d.md`). The Tier-2 island MUST also gate on `prefers-reduced-motion` in JS and render a static poster - the global CSS switch cannot stop a three.js draw loop. ux-lint-disable r3f-frameloop-always to opt out for a deliberately animated above-the-fold hero with a poster fallback.

### Rule: kinetic-heading-char-split
- Severity: High
- Mode: always
- Files: *.ts,*.tsx,*.astro,*.mjs
- Pattern: `(?i)SplitText[^;]*\btype\s*:\s*["'](?:chars|characters)["']`
- Fix: A per-CHARACTER split with NO word grouping (`SplitText({ type: "chars" })`) lets a kinetic / variable-font heading break MID-WORD ("NOCTUR\\nNE") because each character is free to wrap (`references/rendered-bug-classes.md` (d)). Split into WORDS first - `type: "words,chars"` - so characters stagger but words never split, and keep the per-word wrapper at `white-space:nowrap` / `display:inline-block`. A hand-rolled char split needs the same per-word wrapper. ux-lint-disable kinetic-heading-char-split only if the element is a single word (no wrap is possible) and you say so.

### Rule: button-without-type
- Severity: Medium
- Mode: always
- Files: *.astro,*.tsx
- Pattern: `<button(?![^>]*\btype=)[^>]*>`
- Fix: Inside a `<form>`, a button without `type` defaults to `submit` and accidentally submits. Always set `type="button" | "submit" | "reset"`.

---

## Accessibility and state

### Rule: img-missing-alt
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `<img(?=[\s/>])(?![^>]*\balt=)[^>]*>`
- Fix: Every `<img>` needs an `alt`. Describe the content for meaningful images; use `alt=""` for purely decorative ones so screen readers skip them. (The `(?=[\s/>])` guard means it does not falsely trip on SVG `<image>`.)

### Rule: disabled-opacity-half
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html,*.css
- Pattern: `disabled:opacity-50\b`
- Fix: Match the disabled-state floor in `references/brand/perceptual-floors.md`: use `disabled:opacity-40`, not 50, so disabled reads as disabled rather than as a loading state.

### Rule: positive-tabindex
- Severity: High
- Mode: always
- Files: *.astro,*.tsx,*.html
- Pattern: `(?i)(?<![-\w])tabindex\s*=\s*["'{]?\s*[1-9]`
- Fix: A positive `tabindex` (1 or higher) hijacks the keyboard tab order and breaks navigation (Vercel web-interface-guidelines "Keyboard works everywhere"; WCAG 2.4.3 Focus Order). Use `tabindex="0"` to put an element in the natural DOM tab order, or `tabindex="-1"` to make it focusable only programmatically; never a positive value.

---

## Anti-stock-shape rules (anti-slop-ui-derived)

### Rule: stock-hero-centred-stack
- Severity: Medium
- Mode: compose-time
- Files: src/pages/index.astro
- Pattern: `(?s)class="[^"]*text-center[^"]*"[^>]*>\s*<h1[^>]*>.*?</h1>\s*<p[^>]*>.*?</p>\s*<(a|button)[^>]*>.*?</(a|button)>\s*</(section|div)>`
- Fix: A centred H1 + sub + single button as the entire hero is the AI default. Add a real visual element (a product still, a chart, a quote, an asymmetric image), or build the hero off-centre, or commit to a maximalist text-only treatment with extreme type. Note: this regex is only a backstop - it catches the one literal shape, and a generic hero can dodge it a dozen ways. The real judgement is the interpretive audit (dimension 11 / critique habit 5), which reads the composition against the donor and asks whether it actually earns its layout, not whether it matched a pattern.

### Rule: emoji-as-icon
- Severity: Medium
- Mode: always
- Files: src/components/**/*.astro,src/components/**/*.tsx
- Pattern: `>\s*[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]\s*<`
- Fix: Emoji as section / feature icons signals AI shortcut. Use SVGs from the brand package, Lucide, or commissioned marks. Do NOT default every build to Lucide, though: one icon set reused build-to-build is its own genericness tell, the same as a recurring display face. Pick a set that FITS the brand from the open-source Iconify catalogue (https://iconify.design, ~250k icons across 200+ sets: Phosphor reads friendly, Tabler technical, Solar / Remix editorial, Material Symbols product), and ship the chosen glyphs as inline SVG (commit the SVG or use an offline component), never Iconify's runtime API loader. Treat icons like type and colour: chosen to fit, not reached for by default.

---

## The eyebrow / kicker label above a heading

### Anti-pattern: a small label above a section heading (the eyebrow / kicker)

**Do not place a small label above a section heading at all.** The eyebrow / kicker
(a tiny line of text sitting above the heading, e.g. `THE LIBRARY`, `GET STARTED`,
`WHAT WE DO`) is a generic-AI tell **regardless of styling** - it is the PATTERN
that reads as a template, not just the way it is set. Let the heading carry the
section. A confident display heading needs no label announcing that a section has
begun; the label is scaffolding the page does not need, and a stack of them down a
page is one of the loudest "assembled by a model" signals. Drop it.

This BROADENS the older rule, which only caught the most-styled form (mono + caps +
wide tracking). That trio is still the worst case and still flagged, but the kicker
PATTERN itself - a small label above a heading, however tastefully styled - is the
thing to avoid. When a section genuinely needs more than its heading, prefer a short
standfirst sentence below the heading, or a hairline rule, over a label above it.

**In the BOLD register the eyebrow comes back wearing a costume - hunt it as "chrome".**
On high-intensity / motion-heavy builds the label does not disappear, it re-skins as
"functional chrome": a mono **console label** ("SYS://READY", a fake terminal prompt),
a **placard** above a section, an HUD overline, a tracked-caps "section marker". It is
the same tell. Three of four bold demos shipped one (`references/rendered-bug-classes.md`
(e)). Console chrome, a placard and a status marker above a heading are eyebrows; drop
them and let the heading carry the section. The deterministic floor (`hero-status-pill`,
`ai-tell-tracked-eyebrow`) still fires on the worst-placed and worst-styled cases; the
render-side defect in `references/visual-rubric.md` catches the costumed rest.

### Anti-pattern: the tracked-mono eyebrow kicker (the worst case of the above)

Tiny section labels set in **monospace + ALL CAPS + wide letter-spacing (>=0.1em)**,
usually in the accent colour, floating above a heading (e.g. `THE LIBRARY`,
`GET STARTED`, `WATCH THE TASTE ARRIVE`). This trio is one of the loudest
AI / template tells. It reads as a code comment dressed up as editorial, and it
is **absent from the flagship tier** of the reference library.

**Why it reads as AI.** Genuinely high-craft editorial and studio sites do the
opposite. They either drop the kicker entirely and let a confident display
heading carry the section (coffee-collective, jiffi.co), or they keep a **small
CASED label in the page's own brand sans** at medium weight with near-zero
tracking (aesop's section primitive; the type-foundry november). Grounded in our
own library via `mcp__palate`:

- **aesop** (photo-driven-consumer, craft 77): the section-title primitive is a
  small cased / lightly-cased label set in the same humanist body sans (Suisse
  Intl), never a mono. The notes call it "the cheapest 'this is a section'
  affordance" and state hierarchy is "by size + colour + case, never weight
  contrast", with "no accent CTA colour".
- **coffee-collective** (editorial-serif-modern, craft 76): one neo-grotesque;
  the signature is the contrast between tight negative-tracked headings and small
  labels. Positive tracking is reserved only for genuinely tiny nav micro-labels;
  it never uses a mono + uppercase + wide kicker as a section primitive.
- **november / nvmbr.in** (type-foundry, craft 81): the most type-disciplined
  cluster in the library labels sections with the page's own type at small size,
  not a tracked mono eyebrow.

Cross-corpus signal from `refs_insights(trends)`: roughly 70% of flagship sites
lead with one distinctive face and let it do the work; the tracked-mono eyebrow
is absent from the flagship tier. Jake's taste refs agree: jiffi.co opens with a
huge confident serif and no tracked kickers; leoleo.studio uses bold maximal type
and minimal cased labels.

**The rule.** Default to NO label above the heading: let the heading carry the
section (the kicker pattern itself is the tell, see the anti-pattern above). If a
build genuinely keeps a small label, never combine uppercase + wide tracking +
monospace, and pick at most one device per label selector:

- `text-transform: none` (keep the source sentence / Title case, do not uppercase
  in CSS and do not rewrite the copy to caps; the cased reading is the whole point),
- the brand **sans or serif display** (not mono),
- `letter-spacing` near 0 (<=0.01em),
- ~13px / weight 500,
- inherit the per-section colour from a utility rather than hardcoding accent.

If a section needs more punctuation than its heading, prefer a short standfirst
sentence BELOW the heading, or a hairline rule, over a label above it. Better still
on hero / flagship sections: delete the kicker and let the heading stand alone. The
intentional-craft move, when a label is truly warranted, is a small cased label in
the brand sans (the sibling of the display heading, an editorial caption), not a
template chip - but the default is no label at all.

The mechanical floor for this anti-pattern is enforced two ways. The inline-style
markup variant (all three properties on one element) is caught by the per-line
rule below. The far more common multi-line CSS-block variant (each property on its
own declaration line inside one `{ ... }` rule) cannot be expressed as a per-line
regex, so it is enforced by the dedicated brace-block check
`ai-tell-tracked-eyebrow` baked into `scripts/ux-lint.sh` (same severity, same TSV
output, same `ux-lint-disable ai-tell-tracked-eyebrow` escape on the rule's
opening line). Keep both in step if you tune the threshold.

### Anti-pattern: the status pill / badge above the hero heading (the worst-PLACED case)

Where the tracked-mono eyebrow is the worst-STYLED kicker, the **status pill above the
hero heading** is the worst-PLACED one: a short sentence-case label (`Now in beta`,
`Backed by Y Combinator`, `New: feature X`) inside a **rounded pill** (a `rounded-full`
class or a large `border-radius`, plus a border or a background), very often with a
small **status dot**, sitting immediately above the hero `<h1>`. It is the exact chip
v0 / Lovable / Bolt emit at the top of the default hero, so it reads as "started from
the template and never touched the hero". The tracked-mono eyebrow rule above misses it
because it is sentence-case and not mono.

**On the HERO it must not appear at all.** Delete it and let the heading carry the hero.
If the announcement genuinely matters, give it a real home (a sentence in the subhead, a
banner above the nav, a dedicated changelog link), not a pill stuck above the h1. This
is a hard High flag, enforced by the dedicated block-aware check `hero-status-pill`
baked into `scripts/ux-lint.sh`: it fires only when a pill-shaped, bordered/backed,
short-text, non-link element sits within a short window immediately before the FIRST
`<h1>` (the hero), so an ordinary rounded button or a pill chip lower down the page does
not trip it. Escape a genuine exception with `ux-lint-disable hero-status-pill` on the
pill's line or the line above it.

### Rule: ai-tell-tracked-eyebrow-inline
- Severity: High
- Mode: always
- Files: *.astro,*.html
- Pattern: `style="[^"]*text-transform\s*:\s*uppercase[^"]*(mono|monospace|font-mono)[^"]*letter-spacing\s*:\s*0?\.(1[0-9]|[2-9])[^"]*"`
- Fix: This is the tracked-mono eyebrow kicker as an inline style: uppercase + a mono font + letter-spacing >=0.1em on one element. It is the worst-styled case of the kicker tell - but the kicker PATTERN itself (any small label above a heading, however styled) is the thing to avoid. The default fix is to DELETE the label and let the heading carry the section. If a label is truly warranted, set `text-transform:none`, swap to the brand sans (not mono), and drop letter-spacing to <=0.01em. See the section above for the doctrine and the grounded alternative.

---

## Structural / substance / trust-chrome tells (DOCTRINE, not lintable)

These are the AI-slop tells from `references/ai-slop-tells.md` that a regex cannot
catch reliably: they are shapes, substance failures, copy patterns and trust smells.
They are checked by judgement, at Compose and in the verifier's render read (the six
axes + the defect checklist + the Quick QA pass). Each is the why plus the do-instead,
in the same voice as the lint rules. None of these blocks the build mechanically; the
combination is the smell, and the verifier names and locates the offenders.

### Anti-pattern: the identical hero formula

An eyebrow pill, a big centred H1, a one-line subhead and a primary + ghost button,
stacked and centred, with nothing else above the fold. Very common. This is the exact
shape v0 / Lovable / Bolt emit by default, so it reads as "started from the template
and never touched the hero". The structure is not wrong, the untouched-ness is.

Do instead: build the hero off-centre, or add a real visual element the brief earns (a
product still, a chart, an editorial quote, an asymmetric image), or commit to a
maximalist text-only hero with extreme type. Drop the eyebrow pill, let the heading
carry it (cross-ref the eyebrow / kicker doctrine above). The deterministic backstop is
`stock-hero-centred-stack`, but it only catches one literal markup shape; the real lever
is reproducing a named signature move from the lead reference (`critique-discipline.md`
habit 5).

### Anti-pattern: feature-pill rows

A row of one-word capability chips (`Automated`  `Scalable`  `Efficient`  `Intelligent`
 `Secure`), usually small rounded pills under the hero. Common. They say nothing
specific, they are adjective soup wearing the shape of a feature, and a model reaches
for them because they fill the band cheaply. Bonus tell if any pill repeats a word from
the headline.

Do instead: name the actual capabilities as short specific phrases tied to a user
outcome, or cut the band entirely. If the page needs a scannable capability list, give
each item a real verb and object ("Reconciles Stripe payouts nightly"), not a single
abstract adjective.

### Anti-pattern: the universal feature card (rounded icon-tile above a heading)

A small rounded-square icon container (a tinted box with a Lucide / Heroicons glyph
inside) sitting above a feature heading, repeated three across in a symmetric row. Very
common. It is the single most-copied SaaS component of the era and now reads as a
template even when executed cleanly. The icon tile in particular is the tell: it is
decoration standing in for a decision.

Do instead: vary the card aspect ratios, mix in a real screenshot, split the features
across two visual treatments, or carry the page's own signature motif (a numbered index,
an editorial ledger, the donor's real component) into the band instead of three equal
icon-tile cards. If a glyph genuinely helps, it inherits the brand's icon language, it is
not a generic tinted square. Cross-ref `industry-patterns.md` SaaS ("no three-feature
cards with identical icons") and `critique-discipline.md` habit 5.

### Anti-pattern: a thick coloured border on one side of a rounded card

A rounded card with a thick accent-coloured stripe down one edge (`border-l-4` and the
brand colour, the "callout" / "alert" card shape). Very common. It is a Tailwind-UI
reflex: a quick way to make a plain card look "designed" without a real layout decision.
A page where every card wears the same accent stripe reads as generated.

Do instead: let the card's content, spacing and type carry it; reserve a coloured edge
for a genuine state (an error, a selected plan) where the colour means something, not as
default decoration on every card. There is a flag-with-justify lint for the
`border-l-4` + accent shape (`accent-side-border-card` below) so a real callout passes
with a one-line reason.

### Anti-pattern: a bento grid used as lazy decoration

A "bento" grid (mixed-size tiles in a rounded grid) reached for as a trendy name rather
than because the content wants asymmetric emphasis. Very common, now in backlash. The
grid itself is fine, the tell is the trendy-label-as-substitute-for-craft: equal-weight
tiles dressed up as a bento, nothing in the layout actually prioritising one tile over
another, the same card content a plain grid would hold.

Do instead: only build a bento when one or two tiles genuinely deserve more weight, and
let the size differences encode real priority (the headline metric large, the supporting
ones small). If every tile is equal, it is a card grid, build it as one and put the craft
into type and spacing.

### Anti-pattern: glassmorphism used as decoration

Frosted-glass panels (`backdrop-filter: blur` behind a translucent card or nav) applied
because it looks current, not because layering depth serves clarity. Very common, now in
backlash, and it routinely drops body text below the contrast floor. The tell is glass on
everything: a blurred nav, blurred cards, blurred modals, all at once, with no
content reason.

Do instead: use a solid or near-solid surface with a real border and shadow; reserve a
blur for a genuine overlay where the layer beneath must read through (a sticky nav over a
photo). If glass is a brand decision, it lives in the brand package as a documented
effect with a tested contrast floor, not sprinkled inline. The lint flags decorative
`backdrop-filter: blur` (`glassmorphism-decorative` below); justify a real overlay use.

### Anti-pattern: decorative motion for its own sake

Motion added because a site "should have motion", not because it is the argument: a
cursor-following line, a hover that hides the very button it decorates, scroll-jacking, a
parallax that fights reading, particles behind the hero. Common. The motion budget
(`references/motion-and-3d.md`) catches the implementation cost; this is the taste
failure underneath, motion that the page would be better without.

Do instead: every motion finishes the sentence "this moves because {a specific product
or user reason}" (the Conceptual Grounding Test, `critique-discipline.md` habit 3). Cut
any motion that fails it. Motion serves the concept or it goes (`creative-principles.md`).
The reduced-motion state must be the finished state, never a stuck `opacity:0`.

### Anti-pattern: inconsistent visual language across sections

Sections that look like they came from different sites: the type scale, spacing rhythm,
corner radius, border weight, accent usage and density all shift band to band because the
page was generated piecemeal with no shared constraints. Common. It is the signature of
"generated section by section and never reconciled", and it is the inverse of the
uniqueness the build is meant to hold across one page.

Do instead: set the constraints once (the scale, the spacing unit, the radius, the border
weight, where the accent is allowed) and hold every section to them. A section that reads
as assembled next to designed ones is a named recurring-finish failure
(`critique-discipline.md` habit 7); the verifier checks cross-section consistency from the
render (`audit-dimensions.md` dims 1, 2, 8).

### Anti-pattern: vanity stat strips

A row of big numbers with no context or source ("10,000+  99.9%  24/7  150+"). Common. The
numbers are decoration: unsourced, unexplained, often invented to fill a band. It is the
cross-vertical sibling of the SaaS "trusted by 1000+" tell, promoted here as a general
anti-pattern.

Do instead: every number names what it counts and, where it is a proof claim, who it comes
from ("1,240 invoices reconciled for {named customer}"). If a number cannot be sourced,
cut it; an honest two real numbers beat four invented round ones. Cross-ref
`creative-principles.md` ("real, or honestly placeheld; never fake it").

### Anti-pattern: AI-washing ("AI-powered" on a product the AI does not change)

"AI-powered", "powered by AI", "AI-driven" bolted onto a product whose behaviour does not
actually depend on a model. Universal, and now a regulated claim in several markets. **The
test: remove the word "AI" and read the sentence again. If the product is unchanged, the
AI is decoration, cut the word.** This matters doubly for Palate's own category, where the
positioning has to earn the claim.

Do instead: lead with the outcome, not the mechanism. If the AI is real, show it doing
something only a model could do (the specific task, the specific input to output), and name
that, not the buzzword. There is a flag-with-justify lint (`ai-washing-copy` below): the
justification must name what the AI actually does.

### Anti-pattern: a "native app" that is just a browser wrapper

Marketing a web view packaged in Electron / Capacitor / a WKWebView as a "native app" when
nothing about it is native (no platform conventions, no offline, no native performance).
Field observation, lower confidence, and largely out of scope for a website build, but if a
build's copy makes the claim, hold it to honesty: do not call a wrapper native.

Do instead: describe what it actually is ("works in your browser, installs to your home
screen"), and only claim native where the build genuinely uses native capabilities.

### Anti-pattern: a token / credit pricing page that over-explains

A pricing page that spends more words explaining its credit / token accounting than
describing the value (conversion tables, "1 credit = ", tiered multipliers, a calculator the
visitor has to operate to find out what it costs). Field observation. Over-explaining the
unit is a tell that the pricing model is doing the talking instead of the product.

Do instead: lead with what the plan lets the visitor do and a plain price; if a credit model
is genuinely necessary, give one clear sentence and a single worked example, not a ledger.
Cross-ref the CTA / pricing discipline in `critique-discipline.md` habit 7.

### Anti-pattern: fake glossy mockups where real product UI belongs

A polished, fabricated product mockup (a rendered "dashboard" that the product does not
actually show, a hero device frame with invented UI) presented as if it were a real
screenshot. Common. It passes the empty-frame defect (it is not blank), so only judgement
catches it: the UI is too clean, the data too tidy, nothing matches the real product.

Do instead: show the real product UI (a true screenshot), or honestly placehold it and say
so; never ship a glossy fake as if it were real (`creative-principles.md`: "real, or honestly
placeheld; never fake it"). The verifier's render read includes a check for fabricated
mockups standing in for real screens (`references/visual-rubric.md`, defect 4 extended).

### Anti-pattern: trust-chrome smells on a brand-new microsite

The stickers a generated agency site reaches for to fake credibility it has not earned. Each
is a field observation, low confidence alone; a cluster is the smell.

- **A cookie banner on a brand-new microsite.** A single-page launch site with no analytics
  and no third-party cookies does not need a consent banner; one bolted on is cargo-culted
  trust chrome (and often a generated copy-paste). Add a banner only when the site actually
  sets cookies that require consent.
- **An "As seen on Product Hunt" badge** (or any "as seen on" sticker) with no real launch
  or link behind it. Drop the badge; if the launch is real, link it.
- **A dual "Book a free call" + "Get a free audit" CTA** (two competing free-X actions side
  by side). It reads as a lead-gen funnel template and dilutes the primary action. Pick ONE
  primary verb and let the secondary inherit it (cross-ref `critique-discipline.md` habit 7,
  CTA-verb sprawl).
- **A generic security flex** ("AES-256", "BYOK", "SOC 2" with nothing earned). Naming an
  encryption standard proves nothing; everyone uses AES. State the specific guarantee that
  matters to this buyer, or drop the flex.

Do instead: earn trust with specifics, real names, real numbers, real proof, a real link.
Drop the stickers.

---

## Landing pages

### Rule: lp-uses-full-nav-layout
- Severity: High
- Mode: compose-time
- Files: src/pages/lp*.astro,src/pages/landing/**/*.astro
- Pattern: `import .*BaseLayout`
- Fix: A landing page is single-focus: no global site nav competing with the one action you want. Use `LandingLayout` (it omits the header/nav slot) instead of `BaseLayout`. Scoped to the `lp*` / `landing/` route convention; for differently-named landing routes the "Landing conversion" dimension in `references/audit-dimensions.md` applies instead.

---

## How to extend

Add a `### Rule: <slug-id>` heading and the metadata block. Keep `Pattern`
as a single backtick-quoted regex when possible. For multi-line or
backtick-using regex, use a fenced code block immediately after `- Pattern:`
with the language tag `regex`. Every rule must have a Fix paragraph; an
unfixable rule is documentation, not enforcement.

Run after any edit: `scripts/ux-lint.sh <project-dir>` (defaults: rules from
this file, `--fail-on High`).
