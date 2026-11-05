# Canvas-first Explore (spec)

Date: 2026-09-11. Decided by Jake on the eastcoast v2 build. Branch: `beta` of the skill repo.

## The problem

Explore V3 (9 Sept) made every direction board a real Astro page that must pass rendering,
uniqueness, phantom and the visual rubric before it may be shown. On a real build the five boards
were written by 14:22 and nothing had been shown by 15:01; `/explore` rendered four blank stills;
the boards converged on the safest page that clears the gates ("a website, not a direction");
the idea that made each rung a rung (motion, a struck-through word, column rules drawing down)
was invisible in a static Astro render and lived only as a text row. Jake: "Explore was to get
the concepts out very, very quickly by using Palate and the MCP as the reference checks... doing
it as an artboard. Once we pick the direction, it moves into the Astro build, asking questions."

## The shape

1. **Boards are drawn, not built, and each is a whole page.** Each rung is a hand-authored `.dc.html` artboard at
   `.palate/explore/seed/B{ambition}.dc.html`, grounded in the survey and the locked brand tokens,
   following the Claude Design authoring contract (see "Artboard contract"). No Astro is written
   for a board. Astro is built ONCE, at Compose, for the picked direction.
2. **The canvas is published straight away** when the design skill is present, and that is
   recorded: `manifest.explore.canvas = { url }` or `{ skipped: true, reason }`. Silent omission is
   a gate failure.
3. **Static artboards on `/explore`** when there is no design skill (Cursor, Codex, plain
   sessions). Same artboards, screenshotted, shown as stills with the ladder and the calibration
   row. One board format everywhere; only interactive editing is lost. `/boards/*` routes,
   `BoardFrame`, `BoardNotes`, `SectionMark` and `ExploreSwitcher` go away.
4. **The pick and any second pass happen on the canvas**; `/pick --canvas <extract-dir>` reads
   edits back (unchanged), keyed on `B{ambition}.dc.html` and `data-palate-k`.
5. **A short question round at the pick, recorded**: motion for the picked rung, sections to mix in
   from other boards, the CMS question. `palate-pick.mjs --answer motion=... --answer mix=...
   --answer cms=...` writes `explore.question_round`; the done gate refuses a build that picked
   without it.
6. **Proof of motion first at Compose**: the picked rung's hero is built alone and recorded with
   `/pick --proof <url>` before the rest (unchanged doctrine, now the FIRST Astro of the build).
7. **The write wall reaches the artboards**: `.palate/explore/seed/*.dc.html` counts as page-and-
   section design source, so DIVERGE, the plan checkpoint and the survey wall bind before the
   first board is drawn.
8. **Every downstream artefact path is preserved** so the gates keep working: `boards-render.mjs`
   becomes a validator + measurer that writes `shots/<id>/rendered.html` (the artboard itself,
   self-contained), `shots/<id>/hero.png`, `public/_explore/<id>.png`, `canvas.json`, and
   `manifest.explore = { ran, shown_at, boards }`.

## Artboard contract (what the agent authors)

- Skeleton verbatim: `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>…</style></helmet>…</x-dc></body></html>`.
- `x-dc` is 1440px wide (`x-dc{display:block;width:1440px;overflow:hidden}`); the frame `h` is measured, never guessed.
- **An artboard is the WHOLE home page in that direction, nav to footer, composed from the website kit** (`src/lib/kit.ts`, 17 pieces, the rhythms in `src/lib/kit-grounding.ts`), never a hero plus one section. It declares its rhythm the way the kit pages do. Every kit section it renders is a root carrying `data-section-id="{id}-{piece}"` where `piece` is the kit piece id (`navigation`, `hero`, `trust`, `problem`, `benefits`, `demo`, `process`, `proof`, `pricing`, `faq`, `cta`, `footer`, `locality`, ...). Required at minimum: `{id}-navigation`, `{id}-hero`, `{id}-cta`, `{id}-footer`, and `{id}-{section}` where `section` is the registry's `Variant.section` (the inner section the person is asked to look at). The hero is found by name, not by position.
- **The planned motion is written ON the artboard as text**: one block with `class="motion-note"` and `data-palate-motion` carrying the registry's `Variant.motion` sentence(s) (what moves, when, how it feels), placed where the person reads it beside the design (typically under the hero or at the foot of the board). An artboard is a still, so the direction's most expensive property is written where it is judged, not in a side panel.
- Every block element carries at least one class token naming its role (uniqueness signs structure by class; inline-styles-only artboards sign blind). Copy is literal markup (viewers retype in place); inline `style` on the few properties a viewer should tweak.
- Images: bare basename beside the artboard, ≤ 70 KB each, `<img src="b1-img1.jpg">` double-quoted; only png/jpg/jpeg/gif/webp/avif/bmp/svg. No remote URLs except Google Fonts via `<link>`/`@import` in `<helmet>`; other faces as `@font-face` data URIs. No `<script>` other than `support.js`. `a` and `a:hover` defined.
- Registry: `src/lib/variants.ts` keeps `Variant` with `artboard: "B{ambition}.dc.html"` REQUIRED and `href` OPTIONAL (deprecated, no route exists). `id`, `name`, `ambition`, `what`, `why`, `feeling`, `donor`, `section`, `motion`, `ctas` unchanged.
- Refs row unchanged: `.palate/explore/refs.json` → `Ref{position}.dc.html`.

## Out of scope

Compose internals beyond the question round and the proof; the visual rubric; the kit.

## Proof

The next real build (eastcoast v2 re-run) is the acceptance test: boards visible on the canvas
within minutes of the survey, the pick recorded from the canvas, one Astro build.
