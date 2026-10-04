# Motion + 3D performance budget

The performance and `prefers-reduced-motion` budget every motion / 3D moment in this
project must hold to. The full recipe layer (Tier 0/1/2) is documented in the skill
at `references/motion-and-3d.md`; this file is the enforceable budget that ships with
the project so the rule travels with the code.

## The targets

- **LCP target: a fast LCP from a STATIC element (text or image), never a canvas.**
  Every Tier-1 / Tier-2 island is `client:visible` / `client:idle` so its bundle
  (~120-180 KB for the 3D tier) never touches first paint.
- **One WebGL canvas per page.** No full-page-height WebGL canvas as a permanent
  background. Mind the main thread and mobile-GPU thermals.
- **`dpr` capped at 2** for any R3F canvas (`dpr={[1, 2]}`).
- **`frameloop="demand"`** (pause when off-screen); never a free-running loop.
- **Triangles < 150k, textures <= 2048px** (KTX2 / Draco) for any glTF.
- **One RAF loop only.** Lenis runs on `gsap.ticker`; R3F runs its own demand loop.
  Never add a second manual `requestAnimationFrame`.

## The reduced-motion rule (layered, not one switch)

`prefers-reduced-motion: reduce` is handled in FOUR layers, because no single layer
covers everything:

1. **Global CSS switch** (`src/styles/globals.css`) - neutralises CSS animation /
   transition. It CANNOT stop a GSAP timeline, a Lenis RAF loop, or a three.js draw
   loop.
2. **JS guard in `src/lib/motion.ts`** - `initMotion()` early-returns on
   `matchMedia('(prefers-reduced-motion: reduce)').matches`, so Lenis and the
   ScrollTrigger recipes never boot.
3. **`@supports` gate** for CSS scroll-driven animation, with `animation-fill-mode:
   both` so the no-animation state is the finished state.
4. **A static poster** for every Tier-2 ceiling effect (the R3F island / shader hero)
   - it is simultaneously the LCP, the no-JS state, and the reduced-motion state.

**Every ceiling effect MUST have a static fallback.** If a 3D / shader moment cannot
render a static poster under reduced motion, it does not ship.

## Keeping the default lean

The default `package.json` depends only on `gsap` + `lenis` (Tier 0/1). The 3D tier
(`three`, `@react-three/fiber`, `@react-three/drei`) is installed PER BUILD, only for
the variant that genuinely needs 3D - see the header of
`src/components/ThreeScene.tsx`. A calm brief never pays for the 3D tier.
