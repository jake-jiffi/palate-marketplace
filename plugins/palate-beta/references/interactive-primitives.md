# Interactive primitives - the behaviour layer (reuse the brain, re-skin every pixel)

The behaviour layer the build reaches for when a concept needs an interactive widget:
a dialog / modal, combobox, listbox, menu, tabs, accordion, carousel, tooltip or toggle.
Its hard part is invisible: keyboard operation, focus management (trap + return), ARIA
roles and relationships, and async / open-closed state. That invisible plumbing is exactly
what hand-built AI output gets wrong (WebAIM Million 2026: 95.9% of home pages fail WCAG,
the first regression in six years, with pages that hand-add ARIA averaging MORE errors;
Abu Doush 2025 and Aljedaani 2024 both find LLM-generated comboboxes / accordions / forms
ship keyboard and focus violations). So we stop rebuilding it from scratch each time.

**The doctrine: share the behaviour, never the look.** Reuse a vetted, UNSTYLED state
machine for the brain; re-skin every pixel in the brand's tokens. This is the
behaviour-not-markup line: behaviour is the commodity worth sharing (it is not where a
brand differentiates), visuals are what must stay custom. It is the two-layer doctrine
(`reference-library-usage.md`) applied to interaction: reuse the craft of the interaction,
protect the identity. A shared library of MARKUP would do the opposite and homogenise the
output (Goree, CHI 2021), which is the disease this skill exists to beat. This layer
shares no markup, only the machine.

The engine is **Zag.js** (framework-agnostic finite state machines, MIT), consumed in
VANILLA JS through `@zag-js/vanilla` so it runs in a plain Astro `<script>` with NO React /
framework island. This keeps Astro's a11y + performance baseline (WebAIM: Astro ships the
fewest detectable errors of any framework, 9.0 vs React 43.5) intact. Do NOT reach for the
React-only libraries (Radix, React Aria, Base UI, Headless UI) as the default: each forces
a ~40 KB React island onto an otherwise-static page.

This layer is **proven on this stack** (the `sec-svz.2` spike, recorded in
`docs/interaction-layer-recheck-2026-06-26.md`): a dialog, combobox and carousel built
this way scored 0 axe violations once wired, full keyboard operation matching or exceeding
the hand-built version, and 46 KB gzip for all three machines combined with no framework
runtime in the bundle.

## Lean default - opt-in per build (the same rule as Tier 2)

Zag is **not** in the default template dependencies, and the worked example
(`templates/astro-project/src/components/ZagDialog.astro`) is a commented opt-in, not wired
into any page, so a build that needs no widget ships no Zag. When a build does need a
primitive, install only the machines it uses (each `@zag-js/<name>` is its own package, so
a single dialog ships far less than the spike's three-machine 46 KB):

```
pnpm add @zag-js/vanilla @zag-js/dialog        # add @zag-js/combobox, @zag-js/carousel, ... as needed
```

## The proven vanilla pattern

Zag v1 made `machine` a spec OBJECT (not a factory), and the vanilla adapter
(`VanillaMachine`, `normalizeProps`, `spreadProps`) lives in the separate `@zag-js/vanilla`
package. The loop is: construct the machine, render on every change, start it.

```ts
import * as dialog from "@zag-js/dialog"
import { VanillaMachine, normalizeProps, spreadProps } from "@zag-js/vanilla"

// 1. Cache DOM refs BEFORE the first render (see gotcha 1 - Zag rewrites element ids).
const trigger = document.querySelector('[data-part="trigger"]')
// ...cache positioner, content, title, description, close...

// 2. One machine instance per widget; the id namespaces its parts.
const machine = new VanillaMachine(dialog.machine, { id: "hero-dialog" })

// 3. Re-derive the API and apply props on every state change.
function render() {
  const api = dialog.connect(machine.service, normalizeProps)
  if (trigger) spreadProps(trigger, api.getTriggerProps(), machine.scope.id)
  // toggle [hidden] off the positioner/backdrop when api.open, then spread their props
}

machine.subscribe(render)
machine.start()
render()
```

`spreadProps` is the fix for the old GitHub #1512 ("vanilla example does not update
props"): it tracks applied attributes per element in a WeakMap, removes stale listeners and
updates attributes on each render. Use it; do not set attributes by hand.

## The five gotchas (each cost real time in the spike - do not relearn them)

1. **`spreadProps` rewrites the element's `id`.** It replaces your HTML `id` with Zag's
   colon-format id (`dialog:hero-dialog:trigger`). Any `getElementById` / `#id` selector run
   AFTER init will miss the element. Fix: cache every DOM ref (query by `data-testid` /
   `data-part`, a stable attribute) BEFORE the first `render()`. If you build several
   primitives, wrap this in a small `createVanillaMachine()` helper that caches refs before
   `start()`.
2. **`@zag-js/vanilla` is a separate install.** `VanillaMachine` is not in `@zag-js/dialog`.
   Without it you get "machine is not a function" because v1's `machine` is a spec object.
3. **The combobox label needs `getLabelProps()` wired explicitly.** Zag sets the input's id
   but does not update the `<label for>`. Cache the label and
   `spreadProps(labelEl, api.getLabelProps(), scope.id)` or axe reports a CRITICAL "label"
   violation.
4. **The carousel root has no accessible name by default.** Add an `aria-label` to the
   carousel root (e.g. `aria-label="Featured work"`), or it degrades from a landmark to a
   plain div in the accessibility tree. (Zag does auto-set `tabindex="0"` on the scrollable
   item group, so the scrollable-region-focusable rule passes.)
5. **`[hidden]` must win.** If any positional CSS sets `display` on the dialog backdrop /
   positioner without respecting `[hidden]`, the closed overlay covers the viewport. Ship
   `[hidden] { display: none !important; }` in the global stylesheet.

## Coverage (per-primitive packages)

`@zag-js/dialog`, `@zag-js/combobox`, `@zag-js/listbox`, `@zag-js/menu`, `@zag-js/tabs`,
`@zag-js/accordion`, `@zag-js/carousel`, `@zag-js/tooltip`, `@zag-js/switch` (toggle), and
more in the Zag catalogue. Each follows the identical construct / connect / spread loop.

## What you get for free vs what you still wire

- **Free, correct by construction:** roles + ARIA relationships, keyboard operation (arrow /
  Enter / Escape / Tab), focus trap + focus return on the dialog, `aria-expanded` /
  `aria-activedescendant` tracking, live-region announcements.
- **Still yours to wire:** the combobox label (gotcha 3), the carousel `aria-label`
  (gotcha 4), and EVERY pixel of the look.

## Re-skin doctrine (where the brand lives)

Zag sets `data-state` (`open` / `closed`), `data-part`, `data-highlighted`,
`data-disabled` and friends on each element. Style against THOSE, with the brand's tokens:

```css
[data-part="content"][data-state="open"] { /* brand surface, radius, shadow, motion */ }
[data-part="item"][data-highlighted]      { /* brand highlight - the >=8% hover floor */ }
[data-part="trigger"]:active              { /* the pressed-state floor */ }
```

The behaviour is identical across brands; the tokens make two builds look nothing alike.
Pull the section's LOOK from the donor (`refs_get { slug, layer:"component_prompts" }` +
`layer:"do_dont"`), skin the Zag parts to it, and confirm against the donor's `do_dont`.
The focus ring is keyboard-only (`:focus-visible`), motion honours `prefers-reduced-motion`,
and every interactive state from `audit-dimensions.md` dim 9 still applies to the skin.

## When NOT to use it

A static page with no interactive widgets needs none of this (fit governs, as with Tier 2).
A single native `<details>` / `<summary>` accordion or a plain `<dialog>` element with the
light-dismiss + focus handled may be enough; reach for the behaviour layer when the widget
is genuinely custom (a filtering combobox, a focus-trapping modal, a keyboard carousel)
where hand-rolled ARIA is where AI output breaks.

## Verification (how the audit checks this)

`audit-dimensions.md` dim 9 reads: an interactive widget is either backed by this layer
(correct by construction) OR it passes the full keyboard + focus + ARIA audit on its own.
Run axe (the rendered-gate already drives a headless browser) on the page with each widget
in BOTH states (dialog open, combobox expanded), walk the keyboard path (open / arrow /
select / Escape / focus return), and confirm no `positive-tabindex` finding
(`references/anti-patterns.md`).
