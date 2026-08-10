# Rendered bug classes - the recurring defects the bold builds shipped, and the gates that catch them

When the skill was pushed to BOLD output (motion-heavy, real Three.js, scroll
timelines - `references/build-commission.md`, "The bold mandate"), a recurring set of
defects shipped that NEITHER `ux-lint.sh` (it reads code, not the render) NOR the old
visual loop caught (it only tested the reduced-motion / `scrollTo` path, which MASKS
these). They are listed here as named classes, each with the fix-by-construction
pattern and the gate that now catches it, so a future bold build gets them right the
first time.

The deterministic counterpart to this doc is **`scripts/verify-rendered.sh`** (the
rendered, multi-viewport, real-wheel, JS-on AND JS-off gate). It extends the base
rendered gate (overflow / console / blank / focus / 404) with the motion-path and
no-JS checks below. Run it after Compose / before hand-off, alongside the visual loop.
The interpretive counterpart is the defect-checklist additions in
`references/visual-rubric.md` and the verifier steps in `agents/palate-verifier.md`.

The headline lesson, learned the hard way: **verify the DEFAULT motion path with REAL
wheel events, JS ON, motion ON. Reduced-motion and `scrollTo` both hide these bugs.**
A site can pass a reduced-motion screenshot pass and still show normal visitors blank,
overprinted, or canvas-blank pages.

---

## (a) NO-JS / LCP-is-never-a-canvas - the hero must show a FINISHED static state

**The bug:** with JavaScript disabled (and under reduced-motion), the hero / LCP showed
either a preloader that JS was supposed to dismiss (so it covers the hero forever
without JS) or a blank `<canvas>` (a WebGL hero with no poster). 3 of 4 bold demos
failed this: preloaders defaulted VISIBLE and were dismissed by JS; one WebGL hero
shipped no poster.

**The rule:** the LCP element is always static text or a static image, never a
`<canvas>`, a Lottie, or a JS-dismissed overlay. The hero's no-JS state and its
reduced-motion state are the FINISHED state.

**The fix-by-construction pattern:**
- **Preloaders default HIDDEN; JS SHOWS them.** Either the preloader is `display:none` /
  `opacity:0` by default and a JS boot class reveals it, or it is wrapped in
  `html.js .preloader { ... }` (and a tiny inline `document.documentElement.classList.add('js')`
  runs first) so `html:not(.js)` never shows it. Never the reverse (default-visible,
  JS-dismissed) - that leaves the hero covered forever without JS.
- **Every WebGL / canvas hero ships a static poster `<img>` behind the canvas**, which
  is the LCP, the no-JS state, the mobile state and the reduced-motion state (Recipe 1 /
  1b / 2 in `references/motion-and-3d.md`). Capture the poster by screenshotting the live
  canvas, not by drawing an SVG.

**The gate:** `verify-rendered.sh` loads each route with **JavaScript disabled** and
fails (High) if the hero region renders blank, is covered by a fixed full-viewport
overlay, or the largest above-the-fold element is a `<canvas>` with no sibling poster
`<img>`.

---

## (b) MOTION-ON reveal must reach the FINISHED state (test it with a real wheel)

**The bug:** `[data-reveal]` / scroll-reveal elements were authored to START at
`opacity:0` and animate in via JS - but the JS path left a large fraction of the body
stuck at `opacity:0` for NORMAL (JS-on, motion-on) visitors. The Axis demo shipped with
55-79% of the body invisible to normal visitors. The old gate missed it because it only
checked the reduced-motion path, where a `prefers-reduced-motion` rule forced
`opacity:1` and hid the bug.

**The rule:** reveal elements must REST at `opacity:1` by default and only animate FROM a
transient state via JS (or via CSS scroll-driven animation with `animation-fill-mode:
both`, Recipe 5 - which lands in the finished state by definition). The default,
no-animation, end state is always the finished, visible state. Reduced-motion forcing
visibility is a SAFETY NET, never the mechanism that makes content appear.

**The fix-by-construction pattern:** in CSS, `[data-reveal] { opacity: 1 }` is the
resting state; the entrance is a transient `from` (a keyframe, or a `.is-pre` class JS
removes). If JS fails to run its reveal, every section is still fully visible.

**The gate:** `verify-rendered.sh` drives a **real `mouse.wheel` scroll** down the full
page with **JS ON and motion ON** (NOT `scrollTo`, NOT reduced-motion), settles, then
counts elements still at `opacity:0` (or `visibility:hidden`) inside the viewport-passed
region. More than zero stuck-hidden sections = High.

---

## (c) PINNED SCROLLTRIGGER scenes must RELEASE

**The bug:** a pinned hero (a fixed headline / pinned 3D stage) never released its pin,
so the pinned element overprinted every later section and the footer. Axis shipped with
"FEWER. BETTER." painted over the whole page.

**The rule:** a pinned scene has a proper `end` and `pinSpacing` (GSAP creates the spacer
that pushes later content down), OR it uses `position:sticky` inside a bounded container.
Either way the pin RELEASES and later sections own their own space.

**The fix-by-construction pattern:** prefer `position:sticky` in a tall bounded wrapper
for a hero that scrubs then releases (it cannot leak past its container). If using
ScrollTrigger `pin:true`, set a finite `end` and let `pinSpacing:true` (the default)
create the spacer; never `pinSpacing:false` on a hero.

**The gate:** `verify-rendered.sh` scrolls to the bottom and checks that no element that
was in the hero region still covers the footer / last section (a fixed / pinned element
whose bounding box overlaps content far below its origin) = High.

---

## (d) KINETIC / variable-font / split headings must not break MID-WORD

**The bug:** per-character split headings (a char-by-char GSAP stagger, a variable-font
kinetic hero) wrapped mid-word because each character was an inline element free to wrap
at any point. "NOCTURNE" became "NOCTUR\nNE".

**The rule:** a per-character split needs a per-WORD wrapper that is `white-space:nowrap`
(or `display:inline-block`), so characters stagger but words never split across lines.

**The fix-by-construction pattern:** split into WORDS first (each word a
`white-space:nowrap` span / `inline-block`), THEN split each word into characters inside
it. GSAP SplitText does this with `type:"words,chars"` - keep the word wrappers, do not
flatten to chars only. Hand-rolled splits must add the word wrapper.

**The gate:** the single-line lint rule `kinetic-heading-char-split` in
`references/anti-patterns.md` flags a per-character split heading idiom with no word
wrapper (a heading whose chars are individually wrapped without an enclosing
`white-space:nowrap` / `inline-block` word span). The render-side complement is the
visual-rubric defect "kinetic / split heading breaks mid-word", caught on the 390 shot.

---

## (e) EYEBROW / KICKER creep - it is the tell however it is dressed

**The bug:** the eyebrow / kicker label (a small label above a heading) crept back into 3
bold demos disguised as "functional chrome": a mono "console" label, a "placard" above a
section, a tracked-caps eyebrow. The styling changed; the tell did not.

**The rule (restated):** a small label above a heading IS the generic-AI tell regardless
of styling, including when it is dressed as console chrome, a placard, a tracked-caps
overline, or a status pill. The default is to DROP the label and let the heading carry
the section (`references/ai-slop-tells.md`, `references/anti-patterns.md`). On the HERO a
pill / eyebrow must not appear at all (Jake's directive).

**The gate (already present, reinforced):** `hero-status-pill` (hard High, hero-scoped),
`ai-tell-tracked-eyebrow` (the tracked-mono / kicker-class case) and the
`two-tone-heading` sibling in `scripts/ux-lint.sh`; the render-side defect
"eyebrow / status pill / kicker / placard above a heading" in
`references/visual-rubric.md`. This class is a reminder that the bold register is where
the eyebrow comes back wearing a costume - hunt it as "console chrome" and "placards",
not just as "Now in beta".

---

## (f) HEAVY WebGL must DEGRADE on mobile

**The bug:** a transmission-material / high-poly WebGL hero mounted on mobile, where the
GPU ReadPixels stalls tanked the mobile Lighthouse score (Perf 49, TBT 4200ms) and the
device ran hot. Zoop mounted WebGL on mobile instead of degrading to a poster.

**The rule:** gate the canvas to desktop + fine-pointer + motion; touch / coarse-pointer
/ low-end devices get the static poster and the heavy three chunk never downloads. This
is the lazy-split in Recipe 1b (`references/motion-and-3d.md`).

**The fix-by-construction pattern:** the `React.lazy` import of the heavy scene module is
guarded by `matchMedia("(hover:hover)") && matchMedia("(pointer:fine)") &&
matchMedia("(min-width:768px)") && !reduced`; the poster is the LCP everywhere the gate
is false.

**The gate:** `verify-rendered.sh` checks the **mobile (390)** viewport: a `<canvas>`
present in the above-the-fold hero at 390 (where the gate should have served the poster)
= High, and a console / requestfailed error from a three.js chunk on mobile = High. The
visual loop's 390 shot is the interpretive complement.

---

## (h) INTERACTION states must actually respond (pointer + keyboard)

**The bug:** the bold mandate ships custom cursors, magnetic buttons and hover/expand navs,
but the loop only ever drove a scroll, so a hover wired to nothing, a deleted focus ring, or
a hover menu that traps the keyboard all passed. The rubric (dim 9) described these states;
nothing exercised them.

**The rule:** every interactive element the build declares must respond the way a human
triggers it. Focus must be visible on a keyboard `:focus-visible` (WCAG 2.4.7); a nav
disclosure that opens on hover must be dismissible with Escape (WCAG 1.4.13); a custom
`cursor: none` must be gated to a fine pointer so touch / keyboard are not stranded.

**The gate:** `verify-rendered.sh` drives a REAL pointer and keyboard on the home route
(desktop). It Tabs the focusable elements and compares each one's resting vs focused style
(any outline / ring / border / background shift counts, so a border-based focus style is not
false-flagged; only a byte-identical focused style is a missing indicator), and it hover-opens
any `aria-expanded` nav then presses Escape. The OBJECTIVE failures (a systematic missing
focus indicator; a hover-opened nav Escape cannot dismiss) are written to
`.palate-shots/interaction.json` and BLOCK by default via the enforce-on-evidence layer in
`hooks/palate-stop.mjs`; softer signals (weak hover feedback) stay advisory findings for the
verifier. The `custom-cursor-not-gated` `ux-lint.sh` rule is the static complement. Only the
home route, desktop, is driven today.

---

## How this maps to the gates (one table)

| Class | Deterministic gate | Interpretive gate |
|-------|--------------------|-------------------|
| (a) no-JS / canvas LCP | `verify-rendered.sh` (JS-off pass) | visual-rubric defect |
| (b) motion-on reveal stuck | `verify-rendered.sh` (real-wheel, JS-on pass) | visual-rubric defect |
| (c) pin never releases | `verify-rendered.sh` (overprint check) | visual-rubric defect |
| (d) mid-word heading break | `ux-lint.sh` `kinetic-heading-char-split` | visual-rubric defect (390) |
| (e) eyebrow / kicker creep | `ux-lint.sh` `hero-status-pill` + `ai-tell-tracked-eyebrow` | visual-rubric defect |
| (f) heavy WebGL on mobile | `verify-rendered.sh` (390 canvas / chunk check) | visual-rubric defect (390) |
| (h) dead interaction / focus / hover-nav | `verify-rendered.sh` (pointer+keyboard pass) to `.palate-shots/interaction.json` to `palate-stop.mjs`; `ux-lint.sh` `custom-cursor-not-gated` | visual-rubric defect |

`verify-rendered.sh` is fail-open on a missing browser (exit 3 = BLOCKED, surfaced, never
a silent pass) exactly like the visual loop, so it never traps a build where a browser
cannot run; it gates hard where it can.
