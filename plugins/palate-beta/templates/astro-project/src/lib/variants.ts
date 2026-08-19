/**
 * Registry of Explore-stage variants.
 *
 * Read by `src/pages/explore.astro` (the coaching page the client opens FIRST) and by
 * `src/components/ExploreSwitcher.astro` (the bottom-right picker that follows them from
 * variant to variant, never the site's own navigation). See `references/explore-stage.md`.
 *
 * ===================== THIS SET IS A LADDER, NOT A BAG =====================
 *
 * The variants are ordered by AMBITION: rung 1 is genuinely restrained, rung N is genuinely
 * bold, and every rung between is a real step. The order IS the product. Nobody can say how
 * bold they want to be until they have seen both ends, so the set is a declared RANGE rather
 * than N alternatives of the same intensity. `ambition` is what makes that range legible, and
 * the explore page draws it.
 *
 * Rung 1 is restrained and EXCELLENT, never the weak option: it carries a signature move like
 * every other rung, the move is simply quiet.
 *
 * ================== WHY EVERY VARIANT ARGUES FOR ITSELF ====================
 *
 * `what`, `why` and `feeling` are REQUIRED, and they are the difference between a client
 * saying "I like that one" and saying "somewhere around 5, with 8's motion on the hero". A
 * page with no stated intent can only be judged on taste; a page that says what it is trying
 * to do can be judged on whether it did it, which is the conversation worth having. Writing
 * them is also a check on the build: a variant whose `why` is a restatement of its `what`, or
 * whose `feeling` is "modern and clean", did not have an idea.
 *
 * At Compose time, after the client picks, this file is CLEARED (both arrays back to []),
 * `explore.astro` and the `/vN` routes are deleted, and the picker stops rendering.
 */
export interface Variant {
  /** Route id, e.g. "v1" (full-site) or "lp1" (landing page). */
  id: string;
  /** Short evocative direction name, e.g. "The Quiet Room". Never "Option 3". */
  name: string;
  /** Route href, e.g. "/v1". */
  href: string;
  /**
   * Position on the ambition ladder, 1..N. 1 = most restrained, N = boldest. Required:
   * without it the set renders as a bag of options and the range is invisible.
   */
  ambition: number;
  /** WHAT it is. One sentence naming the structural idea, not the mood. */
  what: string;
  /** WHY it is doing that: the argument for this business, in one or two sentences. */
  why: string;
  /** THE FEELING it carries. Two or three words a person would actually use. */
  feeling: string;
  /** The library reference whose craft this rung reproduces. One distinct donor per rung. */
  donor?: string;
  /** The one thing to look at first, so the client knows where to point. */
  lookAt?: string;
}

/**
 * Full-site home-page variants, in ladder order. Routes /v1 .. /vN.
 * Claude appends one entry per variant during Explore, after that variant has PASSED its
 * gates. A variant that has not passed is not registered, so the client never sees it.
 */
export const variants: Variant[] = [
  // Example of the shape (delete when the real ones land):
  // {
  //   id: "v1",
  //   name: "The Quiet Room",
  //   href: "/v1",
  //   ambition: 1,
  //   what: "One column, one photograph, and a great deal of air.",
  //   why: "The people arriving here are anxious and have usually been dismissed once already. Nothing on the page asks anything of them before they have read a sentence.",
  //   feeling: "unhurried, private, adult",
  //   donor: "therapy-in-london",
  //   lookAt: "The way the first screen holds a single idea rather than a menu of them.",
  // },
];

/** Landing-page variants, only when the brief warrants. Routes /lp1, ... Same required fields. */
export const landingVariants: Variant[] = [];

/** Ladder order, and the single place that order is decided. */
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
