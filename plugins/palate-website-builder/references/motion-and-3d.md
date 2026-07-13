# Motion and 3D - the recipe layer

The recipe layer the build reaches for when a concept earns motion, scroll
choreography or 3D. It exists so the skill can reach the 2026 ceiling even where the
reference library is thin on a frontier mechanic (the buildability oracle in
`reference-library-usage.md` falls back to these recipes when a donor query fails
closed). Each recipe has a fixed shape: **when to use it, the minimal working
implementation, a performance budget, and a `prefers-reduced-motion` fallback.**

Stack (all already in the template, except the opt-in Tier-2 packages): Astro 6 +
the Vercel adapter, `@astrojs/react`, `gsap` + `ScrollTrigger` + `@gsap/react`,
`lenis`. Tier 2 (`three`, `@react-three/fiber`, `@react-three/drei`) is **opt-in per
build, not a default dependency** - see the budget below.

## The one law: the LCP is never a canvas

The hydration ladder is non-negotiable. **The LCP element is always static text or a
static image, never a `<canvas>` or a Lottie.** Every Tier-1 / Tier-2 effect is
`client:visible` / `client:idle` so its bundle never touches first paint, and every
ceiling effect ships a static poster that is simultaneously the LCP, the no-JS state
and the reduced-motion state.

Example files referenced below live in `templates/astro-project/src/`:
`lib/motion.ts` (the Tier-0 / Tier-1 entry), `components/Motion.astro` (the wrapper),
`components/ThreeScene.tsx` (the opt-in Tier-2 R3F island example).

---

## Tier 0 - always ship (zero-JS, in every template, no island)

The default motion floor. Compositor-thread, 0 KB of framework JS, and degrades to
the finished state with no animation.

### Recipe 5 - CSS scroll-driven animation
- **When:** all reveals, parallax, progress bars. The default for entrance motion;
  it replaces a JS IntersectionObserver reveal.
- **Implementation:** `animation-timeline: view()` (or `scroll()`), `@supports`-gated,
  with `animation-fill-mode: both` so the no-animation state is the *finished* state
  (never an element stuck at `opacity:0`).
  ```css
  @supports (animation-timeline: view()) {
    [data-animate] {
      animation: reveal linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 30%;
    }
    @keyframes reveal { from { opacity: 0; transform: translateY(1.5rem); } to { opacity: 1; transform: none; } }
  }
  ```
- **Budget:** 0 KB JS, runs on the compositor thread. Animate only `opacity` and
  `transform`.
- **Reduced motion:** the global `@media (prefers-reduced-motion: reduce)` switch in
  `globals.css` neutralises it; `fill-mode: both` already leaves the element in its
  finished state.

### Recipe 6 - View Transitions
- **When:** SPA-feel page-to-page on the MPA, shared-element morphs (a gallery
  thumbnail growing into the detail hero). Highest payoff-per-effort move on Astro.
- **Implementation:** `<ClientRouter />` (already in `BaseLayout.astro`) plus
  `transition:name="..."` on the shared element on both pages.
- **Budget:** near-zero; Astro handles it. Cross-document VT support is ~92%.
- **Reduced motion:** Astro disables transitions automatically under reduced motion.

### Recipe 7 - kinetic / variable-font typography
- **When:** a scroll-mapped or hover-driven display headline. The 2026 "variable axis
  on scroll" hero at near-zero cost. Fraunces (`wght` / `opsz` / `SOFT`) is already
  self-hosted in the brand package.
- **Implementation:** animate `font-variation-settings` (or a CSS custom property the
  font reads), driven by Recipe 5's `animation-timeline: view()` or a CSS transition
  on hover. Never animate `font-weight` directly.
- **Budget:** 0 KB JS.
- **Reduced motion:** the global CSS switch neutralises the animation; the static
  weight is the resting state.

---

## Tier 1 - opt-in singletons / per-section islands

Reach for these when a section earns real motion. Section-scoped, lazy-hydrated,
each with its own JS reduced-motion guard (the global CSS switch alone cannot stop a
GSAP timeline or a Lenis RAF loop).

### Recipe 4 - Lenis smooth scroll (the one mandatory singleton)
- **When:** smooth scroll under any scroll-choreography. Mount ONCE.
- **Implementation:** `SmoothScroll` mounted once in `BaseLayout` via `Motion.astro`
  (`client:idle`, `transition:persist`). `autoRaf:false`; drive `lenis.raf` from
  `gsap.ticker` so there is ONE RAF; `lenis.on('scroll', ScrollTrigger.update)`;
  `gsap.ticker.lagSmoothing(0)`; `destroy()` on cleanup; on `astro:after-swap` ->
  `ScrollTrigger.refresh()` + reset scroll. This is what `lib/motion.ts` wires.
- **Budget:** one RAF loop only. Never add a second manual `requestAnimationFrame`.
- **Reduced motion:** `lib/motion.ts` early-returns on
  `matchMedia('(prefers-reduced-motion: reduce)').matches` and never boots Lenis;
  native scroll remains.

### Recipe 3 - GSAP ScrollTrigger pin / scrub
- **When:** pin a section and scrub a sequence (a product story, a stepped reveal).
- **Implementation:** a `client:visible` island built with `useGSAP({ scope })` for
  auto-cleanup, wrapped in
  `gsap.matchMedia('(prefers-reduced-motion: no-preference)')` so the timeline is
  simply never created under reduced motion. Animate transforms only;
  `invalidateOnRefresh:true`.
- **Budget:** ~50 KB, section-scoped, `client:visible`.
- **Reduced motion:** the `matchMedia` wrapper means no timeline is created; the
  section renders static.

### Recipe 8 - Lottie
- **When:** a below-the-fold vector animation (an illustrated step, a looping mark).
  Never above the fold, never the LCP.
- **Implementation:** a `client:visible` island that `import('lottie-web')`
  dynamically, gated on an IntersectionObserver, with a static poster fallback and
  `anim.destroy()` on unmount.
- **Budget:** dynamic import, below-the-fold only.
- **Reduced motion:** render the static poster, do not load `lottie-web`.

---

## Tier 2 - the optional R3F island (the ceiling, gated behind a perf budget)

The ceiling. Shipped as an **optional** module the build enables ONLY when a 3D /
shader moment earns its weight. One canvas per page, never the LCP. `three`,
`@react-three/fiber` and `@react-three/drei` are **not** in the default template
dependencies; the build installs them only for the variant that needs 3D (see the
budget). The example island is `components/ThreeScene.tsx`.

### Recipe 1 - R3F 3D island (glTF / interactive 3D product)
- **When:** a real 3D product moment (drag-to-orbit, explode-view, scroll-pinned
  product). For premium hardware / DTC / automotive briefs.
- **Implementation:** an Astro island hydrated `client:visible` (or
  `client:only="react"` if `three` trips SSR). `frameloop="demand"` (`"never"` under
  reduced motion), `dpr={[1,2]}`, Draco-compressed glTF, triangles < 150k, textures
  <= 2048px KTX2, a reserved aspect-ratio box, and a `<noscript>` / poster image.
- **Budget:** ~120-180 KB lazy bundle, never on first paint. One canvas per page.
- **Reduced motion:** the island renders its static poster image and never mounts the
  canvas (see `ThreeScene.tsx`).

### Recipe 1b - the proven interactive R3F hero (spin / scroll-explode), with the mobile-perf lazy-split

The hardened, shipped version of Recipe 1 for a high-intensity brand's hero INTERACTION
(`references/build-commission.md`, "The bold mandate"): a real R3F object the visitor
drag-spins and scroll-explodes (shipped as the Axis demo: live Lighthouse mobile P93 /
A11y100 after the split below). Reach for it when the bold mandate calls for a hero
interaction and 3D earns its weight; use a hand-built morphing-SVG-behind-a-glow instead
when it does not.

- **Deps (proven, pinned):** `three@^0.169.0` + `@react-three/fiber@^9` +
  `@react-three/drei@^10` + `@astrojs/react` + React 19. `astro.config` `output:"static"`;
  `tsconfig` needs `jsx:"react-jsx"`, `jsxImportSource:"react"`, `types:["@types/three"]`.
  These are the opt-in Tier-2 packages, added only for the variant that needs 3D.

- **The lazy-split is the whole perf win (do this, it is not optional).** The heavy
  `three` / R3F / drei imports MUST live in a SEPARATE module (e.g. `HeroScene.tsx`) that
  the wrapper (`Hero.tsx`, which imports NO three) loads with
  `React.lazy(() => import("./HeroScene"))` ONLY on the desktop path. Mount the wrapper
  `client:only="react"` (three trips SSR). Gate the lazy import to
  `!reduced && matchMedia("(hover:hover)").matches && matchMedia("(pointer:fine)").matches
  && matchMedia("(min-width:768px)").matches`. On mobile / touch / reduced-motion the gate
  is false: the static **poster `<img>` is the LCP, the no-JS state, the mobile state and the
  reduced-motion state**, and the ~900KB-plus three chunk NEVER downloads. Before this split
  the shipped demo scored mobile Perf 49 (TBT 4200ms); after, 93 (TBT 0ms). This is bug-class
  (f) closed by construction (`references/rendered-bug-classes.md`).

- **The shared-scroll-CSS-var -> `useFrame` pattern (never per-frame React state).** The
  page's GSAP ScrollTrigger (`scrub`) writes a 0..1 progress to a CSS var on `<html>` (e.g.
  `--hero-explode`); the R3F `useFrame` reads it via `getComputedStyle` and lerps each part
  along its blast vector. One source of truth keeps the DOM and the 3D in sync, and nothing
  re-renders React per frame (per-frame `setState` is the jank source the proof contract
  fails on).

- **`frameloop` + dpr.** `frameloop="always"` while the canvas is in view, `"never"`
  off-screen (toggle via an IntersectionObserver) so the draw loop pauses off-screen for the
  perf budget; `dpr={[1,2]}` (cap DPR at 2).

- **Object-design gotchas (hours of iteration, recorded so the next build skips them):**
  (1) the EXPLODE must be CENTROID-BALANCED and CAPPED (~0.86) or parts fly off-frame - fan
  them up / down / left / right, not all one way. (2) A near-front camera looking INTO a
  tipped concave object reads as a flat disc / orb, not the object - tip it only ~0.6rad and
  raise the camera to look slightly down. (3) `MeshTransmissionMaterial` glass goes GREEN
  from a cool fill + emissive bleed - warm the `attenuationColor` (~`#ffe8c8`), drop
  `chromaticAberration` to ~0.015, warm / dim the fill light. (4) Capture the static poster
  by screenshotting the LIVE `#stage-canvas` (hide the headline / HUD / grain first) - far
  better than a hand-drawn SVG, and it IS the LCP.

- **Reduced motion / no-JS:** the gate above never mounts the canvas; the poster is the
  finished state. The pinned ScrollTrigger that drives the explode must RELEASE (a proper
  `end` + `pinSpacing`, or `position:sticky` in a bounded container) so the pinned hero never
  overprints later sections (bug-class (c), `references/rendered-bug-classes.md`).

- **The vanilla (non-React) Three.js variant works the same way.** For a marketing hero that
  does not want React in the bundle, raw `three` in a `client:only` / `client:visible` island
  follows the identical contract: separate heavy module, desktop-and-fine-pointer-and-motion
  gate, static poster as LCP, shared scroll CSS var -> the render loop, one canvas, dpr
  capped, pause off-screen. (Shipped this way in the Nocturne and Kern demos.)

### Recipe 2 - GLSL shader hero (the lowest-cost ceiling effect)
- **When:** a flagship shader surface (fluid-distortion, gradient-mesh, noise,
  refraction-on-hover). The 2026 hero ceiling.
- **Implementation:** a `client:visible` island using drei `shaderMaterial`, a
  fullscreen clip-space quad, `precision mediump`, `antialias:false`, and `dt`-based
  uniform mutation inside `useFrame` (NEVER React state per frame). The WebP poster is
  the LCP and the no-JS state; `@media (prefers-reduced-motion: reduce) { canvas { display:none } }`.
- **Budget:** lowest-cost ceiling effect; still one canvas, `dpr` capped at 2,
  `client:visible`.
- **Reduced motion:** the poster shows, the canvas is hidden, `useFrame` never runs.

---

## Mid-tier interaction textures (the recurring award-site mechanics)

The 2026 award shelf is carried less by one 3D hero than by a vocabulary of mid-tier
"texture" interactions that recur across the winners. These are the recipe FLOOR for that
vocabulary: reach for them when the commission calls for texture, pull the live exemplar
from the MCP (`refs_search { query: "<mechanic>" }`) where the library has one, and fall
back to the recipe here when it fails closed. Each is a re-skinnable MECHANISM, not a look,
and each carries the thing the copy-paste libraries (React Bits, Aceternity) do not give:
the cliche line plus the a11y / perf gate. Most collapse onto two engines already in the
template's reach (GSAP, now 100% free since the Webflow acquisition, and the Three.js /
Codrops EffectShell pattern).

**The law for this whole tier: one signature moment, not twenty** (Utsubo). If a page
reaches for three of these at once it reads as a demo reel, not a brand. Pick the one that
carries the concept and cut the rest. Each recipe MUST keep its cliche + a11y + perf line,
or the corpus becomes a slop generator.

### Recipe 9 - split-text reveal
- **Engine / precedent:** GSAP SplitText (now free) + ScrollTrigger, or a zero-JS CSS
  `animation-timeline` stagger. Live exemplar: `refs_search { query: "split text reveal" }`.
- **Re-skin:** the unit (word / line / char), the stagger curve + overlap, the mask
  (clip-path / translate / blur), the easing token.
- **Cliche when:** every heading on the page char-staggers with the default ~0.05s step
  and no masking. One hero reveal earns it; a page of them is slop.
- **A11y + perf:** split into `words,chars` so a heading never breaks mid-word
  (`kinetic-heading-char-split`); gate the whole thing on `prefers-reduced-motion` (the set
  text is its own finished state); animate `transform` / `clip-path`, never `font-weight`.

### Recipe 10 - text-scramble / decode
- **Engine / precedent:** a small rAF loop swapping glyphs toward the target string (no
  library needed); GSAP for the timing. Exemplar: `refs_search { query: "text scramble decode" }`.
- **Re-skin:** the glyph set (mono symbols vs the brand's own alphabet), settle duration,
  per-character delay, whether it fires on load, on scroll-in, or on hover.
- **Cliche when:** the matrix-green mono "hacker" decode used as decoration on a brand that
  is not technical. It must mean something (a reveal of the one true word), not garnish.
- **A11y + perf:** the final string is in the DOM as real text from first paint (the scramble
  is a visual overlay), so it is readable to a screen reader and with JS off; skip the loop
  entirely under `prefers-reduced-motion`.

### Recipe 11 - magnetic / custom cursor
- **Engine / precedent:** pointer-move - a `ref` lerped in the animation frame (never React
  state per move, `useState-for-mouse-coords`). Exemplar: `refs_search { query: "magnetic cursor" }`.
- **Re-skin:** the follower (dot / ring / blob / inverted-difference), the magnet radius +
  pull strength on interactive targets, the lag.
- **Cliche when:** a big lagging blob on every page with no purpose; it is the loudest
  "creative-studio template" tell when it is the only idea.
- **A11y + perf:** NEVER replace the real cursor (Eric Bailey: a custom CSS cursor overrides
  the OS cursor a low-vision user has enlarged / high-contrasted, and can make it vanish) -
  augment, keep the native cursor visible, and disable the follower under
  `prefers-reduced-motion`, on touch (`pointer:coarse`) and for keyboard users. It is decoration,
  never the only affordance.

### Recipe 12 - image distortion + image-trail
- **Engine / precedent:** the Three.js / Codrops EffectShell pattern - a displacement /
  RGB-shift shader on a textured plane, driven by pointer velocity. Exemplar:
  `refs_search { query: "image distortion hover" }` / `{ query: "image trail" }`.
- **Re-skin:** the displacement map + amplitude, the trail length / decay, whether it fires
  on hover (distortion) or on move (trail).
- **Cliche when:** the stock Codrops liquid-hover on a gallery that did not need it; lifted
  one-to-one from the tutorial with the demo's own displacement texture.
- **A11y + perf:** one WebGL context, `dpr` capped at 2, pause off-screen; a static `<img>`
  is the LCP and the no-JS / reduced-motion state; the canvas is `display:none` under
  `prefers-reduced-motion`.

### Recipe 13 - draggable + inertia slider
- **Engine / precedent:** GSAP Draggable + InertiaPlugin (both now free), or a CSS
  scroll-snap track for the zero-JS version. Exemplar: `refs_search { query: "draggable inertia slider" }`.
- **Re-skin:** the throw resistance + snap, the card overhang, the progress indicator, whether
  the wheel / trackpad also drives it.
- **Cliche when:** a horizontal drag-gallery used because it looks expensive, hiding content
  that wanted a plain grid. Drag is for browsing, not for burying.
- **A11y + perf:** it is ALSO operable without dragging - keyboard arrows move between items,
  focus follows, and there are visible prev / next controls; respect `prefers-reduced-motion`
  for the inertia easing; never trap the page scroll.

### Recipe 14 - FLIP layout animation
- **Engine / precedent:** GSAP Flip (free), or the View Transitions recipe (Recipe 6) for the
  cross-document case. Exemplar: `refs_search { query: "FLIP layout transition" }`.
- **Re-skin:** what morphs (a filtered grid reflow, a thumbnail growing into a detail hero),
  the duration band (150-300ms per the motion floor), the easing.
- **Cliche when:** everything animates its position on every state change, so the page never
  settles. FLIP is for one meaningful continuity, not for constant motion.
- **A11y + perf:** measure-then-animate `transform` only (the whole point of FLIP is no layout
  thrash); honour `prefers-reduced-motion` with an instant cut; keep focus on the moved element.

### Recipe 15 - infinite marquee (+ scroll-velocity skew)
- **Engine / precedent:** a CSS-only translate loop for the base marquee; GSAP + ScrollTrigger
  `velocity` to skew / speed it with scroll. Exemplar: `refs_search { query: "marquee scroll velocity" }`.
- **Re-skin:** the content (logos / words / images), speed, direction, the skew amount mapped
  from scroll velocity, the edge fade.
- **Cliche when:** the "trusted by" logo marquee on autopilot, or a tracked-caps word-marquee
  used as filler chrome. It must carry real content, not pad the page.
- **A11y + perf:** duplicate content is `aria-hidden` so a screen reader hears the string once;
  pause on hover / focus and under `prefers-reduced-motion`; transform-only, compositor thread.

### Recipe 16 - scroll-driven SVG path-draw
- **Engine / precedent:** CSS `animation-timeline: view()` on `stroke-dashoffset` (zero-JS),
  or GSAP DrawSVG (free) for finer control. Exemplar: `refs_search { query: "svg path draw on scroll" }`.
- **Re-skin:** the path (a route, a signature, a diagram, an underline), draw speed mapped to
  scroll range, stroke weight + cap, whether fill follows.
- **Cliche when:** a generic squiggle drawing itself next to every heading. The line should be
  the concept (a journey, a connection), not decoration.
- **A11y + perf:** the SVG has a `<title>` / is `aria-hidden` if purely decorative; the fully
  drawn state is the no-JS / reduced-motion state (dashoffset 0); transform / stroke only.

### Recipe 17 - page-transition vocabulary (overlay / wipe / morph)
- **Engine / precedent:** Astro View Transitions (Recipe 6) for the shared-element morph;
  a GSAP overlay timeline on `astro:before-swap` for an overlay / wipe. Distinct from the
  bare View Transitions API. Exemplar: `refs_search { query: "page transition overlay wipe" }`.
- **Re-skin:** the device (a colour wipe, a masked overlay, a shared-element morph), duration
  (150-300ms), easing, and whether one element persists across the swap.
- **Cliche when:** a full-screen black overlay on every navigation that just adds latency, or a
  morph applied where a plain cut would be faster and calmer.
- **A11y + perf:** keep it under ~300ms so it never blocks interaction; Astro disables View
  Transitions under `prefers-reduced-motion` automatically, and a hand-built overlay must do the
  same; move focus to the new page's `<h1>` / main on swap so keyboard + screen-reader users
  are not stranded.

---

## The performance + prefers-reduced-motion budget

Ship and enforce this so ambition stays ~60fps and accessible. The full budget also
lives as `templates/astro-project/MOTION_BUDGET.md` next to the recipe files.

- **LCP is always static.** Tier-1 / Tier-2 islands are `client:visible` /
  `client:idle` so their bundles never touch first paint. Target a fast LCP from
  static text / image, never a canvas.
- **Reduced motion is layered, not one switch.** The global CSS
  `@media (prefers-reduced-motion: reduce)` switch in `globals.css` neutralises CSS
  animation ONLY - it cannot stop a GSAP timeline, a Lenis RAF loop or a three.js
  draw loop. So EVERY Tier-1 / Tier-2 recipe also needs its own JS guard
  (`matchMedia('(prefers-reduced-motion: reduce)').matches` early-return, or
  `gsap.matchMedia`), plus the `@supports` gate for CSS scroll-driven animation, plus
  a static poster for every ceiling effect. Every ceiling effect MUST have a static
  fallback.
- **One WebGL canvas per page.** Never a full-page-height WebGL canvas as a permanent
  background. `dpr` capped at 2. `frameloop="demand"` (pause when off-screen). Mind
  the main-thread cost and mobile-GPU thermal limits; budget DPR / triangle count /
  visibility-pausing.
- **One RAF loop only.** Lenis runs on `gsap.ticker`; R3F runs its own demand loop.
  Never a second manual `requestAnimationFrame`.

### Keeping the default template lean (why Tier 2 is opt-in)
`three` + R3F + drei add ~120-180 KB to a bundle. If they sat in the template's
default `package.json`, every generated site would ship (or at least install) a WebGL
toolchain it does not use, which violates the lean-default invariant. So:
- the default template depends only on `gsap` + `lenis` (Tier 0/1, already present);
- `ThreeScene.tsx` ships as a commented / opt-in EXAMPLE, not a wired-in component;
- the build adds `three` / `@react-three/fiber` / `@react-three/drei` to the
  project's `package.json` ONLY for the variant that genuinely needs 3D, and mounts
  the island only on that page. A calm brief never pays for the 3D tier.

## Reach (document, do not pre-build)
- **WebGPU + TSL** (`three/webgpu`, automatic WebGL2 fallback) as the Recipe-1 / 2
  upgrade path. WebGPU shipped in Safari 26 / iOS 26 (Sept 2025) and Chrome 121+ on
  Android, but mobile support is still gated and uneven by OS / GPU tier, so treat it as
  an enhancement behind the automatic WebGL2 fallback, not a baseline you can assume.
- **GSAP SplitText** (now free) for character-stagger kinetic type.
- **Rive** for data-driven vector UI motion alongside GSAP.

## Note for CURATE (library / moat work, not implementable in the skill)
The reference library is deep on motion craft per ref but **narrow on the frontier**:
only ~21 of ~229 entries carry any WebGL and the live MCP fails closed on the three
highest-value frontier mechanics - **shader-surface hero**, **interactive 3D
product** and **cursor-driven physics** (the queries return real-but-wrong
fallbacks). Until a CURATE-side audit tags and sources award-grade motion / 3D donors
(`hasWebgl`, motion-intensity, a complete `astro_recipe`, plus the new `shader-surface`
/ `cursor-physics` / `model-viewer-3d` mechanics and `renderer` / `shaderFamily` /
`canvasLightness` facets), the buildability oracle will return thin or wrong
precedents for those mechanics and MUST fall back to the recipes here. The
demand-ranked donor work-list is tracked internally for future library sourcing.
This is the one genuine external dependency of Move 4; the recipe layer is the floor
that keeps the build unblocked until a donor lands.
