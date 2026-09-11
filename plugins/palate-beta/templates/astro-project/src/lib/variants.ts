/**
 * Registry of Explore-stage DIRECTION BOARDS.
 *
 * Read by `src/pages/explore.astro` (the coaching page the client opens FIRST, and shows
 * STILLS of the artboards, not routes) and by `scripts/boards-render.mjs`, which reads each
 * artboard under `.palate/explore/seed/` and turns it into a canvas artboard. Nothing under
 * `/boards/` exists: the board IS the artboard file, never a page. See
 * `references/explore-stage.md`.
 *
 * ===================== THIS SET IS A LADDER, NOT A BAG =====================
 *
 * The boards are ordered by AMBITION: rung 1 is genuinely restrained, rung N is genuinely
 * bold, and every rung between is a real step. The order IS the product. Nobody can say how
 * bold they want to be until they have seen both ends, so the set is a declared RANGE rather
 * than N alternatives of the same intensity. `ambition` is what makes that range legible, and
 * the explore page draws it.
 *
 * Rung 1 is restrained and EXCELLENT, never the weak option: it carries a signature move like
 * every other rung, the move is simply quiet.
 *
 * ================== WHY EVERY BOARD ARGUES FOR ITSELF ======================
 *
 * `what`, `why` and `feeling` are REQUIRED, and they are the difference between a client
 * saying "I like that one" and saying "somewhere around 4, with 5's motion on the hero". A
 * board with no stated intent can only be judged on taste; a board that says what it is trying
 * to do can be judged on whether it did it, which is the conversation worth having. Writing
 * them is also a check on the build: a board whose `why` is a restatement of its `what`, or
 * whose `feeling` is "modern and clean", did not have an idea.
 *
 * `motion` and `ctas` are required for a reason the old variant set hid. A board is a still
 * surface plus a notes panel, so the motion plan has to be WRITTEN or the client is choosing
 * a direction with its most expensive property invisible; and offering two or three CTA
 * labels turns a guess into a decision the client can make in the same sitting.
 *
 * At Compose time, after the client picks, this file is CLEARED (both arrays back to []) and
 * `explore.astro` is deleted: the board IS the artboard, so there is no route to archive.
 */
export interface Variant {
  /** The board's id, e.g. "b1" (board) or "lp1" (landing page). The board IS the artboard file; there is no route. */
  id: string;
  /** Short evocative direction name, e.g. "The Quiet Room". Never "Option 3". */
  name: string;
  /**
   * The artboard file under .palate/explore/seed/, e.g. "B1.dc.html". REQUIRED: the board IS
   * this file. There is no route; Astro is built once, for the picked direction, at Compose.
   */
  artboard: string;
  /** Deprecated. Boards have no route since canvas-first Explore; kept optional for old registries. */
  href?: string;
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
  /**
   * The library reference whose craft this rung reproduces. REQUIRED, and one distinct donor
   * per rung: a set of boards drawn from one donor is one idea wearing five skins.
   */
  donor: string;
  /** The inner section this board shows beneath the hero, e.g. "menu", "proof", "services". */
  section: string;
  /**
   * The motion plan in plain words, one to three sentences. A board is mostly a still, so a
   * direction whose motion is never written is chosen with its most expensive property unseen.
   * Say what moves, when, and how it feels, never a restatement of `what`.
   */
  motion: string;
  /** Two or three CTA labels the client can choose between. */
  ctas: string[];
  /** URL of the donor's library clip, when the MCP returned one. */
  clip?: string;
  /** The one thing to look at first, so the client knows where to point. */
  lookAt?: string;
}

/**
 * Direction boards, in ladder order. Each names an artboard under .palate/explore/seed/;
 * there is no route. Claude appends one entry per board during Explore, after that board has
 * PASSED its gates. A board that has not passed is not registered, so the client never sees it.
 */
export const variants: Variant[] = [
  // Example of the shape (delete when the real ones land):
  // {
  //   id: "b1",
  //   name: "The Quiet Room",
  //   artboard: "B1.dc.html",
  //   ambition: 1,
  //   what: "One column, one photograph, and a great deal of air.",
  //   why: "The people arriving here are anxious and have usually been dismissed once already. Nothing on the page asks anything of them before they have read a sentence.",
  //   feeling: "unhurried, private, adult",
  //   donor: "therapy-in-london",
  //   section: "services",
  //   motion: "Nothing moves on load. The photograph fades in slowly once it is scrolled to, and that is the whole budget.",
  //   ctas: ["Book a first visit", "Ask a question"],
  //   lookAt: "The way the first screen holds a single idea rather than a menu of them.",
  // },
];

/** Landing-page boards, only when the brief warrants. Routes /lp1, ... Same required fields. */
export const landingVariants: Variant[] = [];

/** Ladder order, and the single place that order is decided. */
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
