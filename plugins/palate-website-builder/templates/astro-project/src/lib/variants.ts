/**
 * Registry of Explore-stage variants. Consumed by
 * src/components/ExploreSwitcher.astro to render the bottom-right "pick a
 * direction" picker (NOT a top nav bar - it must never sit in the site's own
 * navigation). See references/explore-stage.md.
 *
 * Claude UPDATES this file during the Explore stage as each variant is
 * generated, giving every variant a short evocative `name`. At Compose time,
 * after the client picks, this file is CLEARED (both arrays back to []) and the
 * picker stops rendering.
 */
export interface Variant {
  /** Route id, e.g. "v1" (full-site) or "lp1" (landing page). */
  id: string;
  /** Short evocative direction name shown in the picker, e.g. "Deep Trawl". */
  name: string;
  /** Route href, e.g. "/v1". */
  href: string;
}

/** Full-site home-page variants. Routes /v1, /v2, ... */
export const variants: Variant[] = [
  // Example - the rest are added by Claude during Explore:
  // { id: "v1", name: "Deep Trawl", href: "/v1" },
];

/** Landing-page variants, only when the brief warrants. Routes /lp1, ... */
export const landingVariants: Variant[] = [
  // { id: "lp1", name: "Direct Response", href: "/lp1" },
];
