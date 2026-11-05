/*
 * ============================================================================
 * OPT-IN EXAMPLE - Tier 2, the 3D ceiling (see references/motion-and-3d.md).
 * ============================================================================
 *
 * This is Recipe 1 (an R3F 3D island) as a reference implementation. It is NOT
 * part of the default scaffold and NOT wired into any page, so the default
 * template never ships a WebGL bundle. Enable it ONLY for a variant whose concept
 * genuinely needs 3D, and only after the buildability oracle
 * (references/reference-library-usage.md) has confirmed there is no closer donor
 * to ground it on.
 *
 * To enable it for one build:
 *   1. Install the Tier-2 packages (lean default stays lean - this is per-build):
 *        pnpm add three @react-three/fiber @react-three/drei
 *        pnpm add -D @types/three
 *      @astrojs/react + React 19 are already configured, so astro.config.mjs
 *      needs no change.
 *   2. Mount it as an Astro ISLAND on the ONE page that needs it, hydrated lazily
 *      and never as the LCP. In e.g. src/pages/v1.astro:
 *
 *        ---
 *        import ThreeScene from "../components/ThreeScene";
 *        ---
 *        <section class="relative" style="aspect-ratio: 16 / 9;">
 *          <ThreeScene client:visible posterSrc="/img/scene-poster.webp" />
 *        </section>
 *
 *      Use client:visible (or client:only="react" if three trips SSR). The
 *      reserved aspect-ratio box above prevents layout shift while it hydrates.
 *
 * Performance budget (enforced here): one canvas per page, dpr capped at 2,
 * frameloop="demand" (and "never" under reduced motion), triangles < 150k,
 * textures <= 2048px KTX2, a static poster that is the LCP and the no-JS state.
 *
 * THE ONE LAW: under prefers-reduced-motion this renders the static poster image
 * and never mounts the canvas - the global CSS switch cannot stop a three.js draw
 * loop, so the guard is in JS here.
 */
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Mesh } from "three";

interface Props {
  /** Static poster: the LCP, the no-JS state, and the reduced-motion fallback. */
  posterSrc: string;
  posterAlt?: string;
}

function SpinningModel() {
  // Replace this primitive with a Draco-compressed glTF via drei useGLTF in a
  // real build. Animate via useFrame + a delta clock, NEVER React state per frame.
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.3;
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.4} metalness={0.1} />
    </mesh>
  );
}

export default function ThreeScene({ posterSrc, posterAlt = "" }: Props) {
  const [reduced, setReduced] = useState(true); // default to the safe poster

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Reduced motion (or pre-hydration default): the static poster, no canvas.
  if (reduced) {
    return (
      <img
        src={posterSrc}
        alt={posterAlt}
        loading="lazy"
        decoding="async"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 4], fov: 45 }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 3, 3]} intensity={1.2} />
      <SpinningModel />
      <OrbitControls enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
