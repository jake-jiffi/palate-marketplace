#!/usr/bin/env node
/**
 * gate-facts.mjs - does the site contradict itself?
 *
 * ======================== THE BUILD THAT WROTE THIS FILE ========================
 *
 * A real build of about 3,400 pages said "42 reviews" in some places and "41 reviews" in
 * others, and nothing noticed. The single-source rule this repo already enforces is about
 * PROVENANCE: one business record, every surface reads it, change it once and every surface
 * follows. That rule is silent here, because a number typed straight into two hand-written
 * pages was never in the record to begin with. Nothing compared one labelled value against
 * the same labelled value somewhere else, so the site was free to disagree with itself in
 * front of a customer deciding whether to trust it.
 *
 * ADVISORY, ON PURPOSE. It exits 0 whatever it finds. Two numbers can differ for a reason a
 * gate cannot see (a franchise page, a second location, a figure that is deliberately per
 * branch), and blocking a build on a judgement call is how a useful check gets switched off.
 * The done gate folds the count into its summary and /sweep lists them.
 *
 * ============ THE FAILURE MODE IS THE FALSE ALARM, NOT THE MISS ============
 *
 * A consistency check that fires on a 2019 blog post quoting the review count of the day, or
 * on a code sample, or on the same phone number written two conventional ways, is switched
 * off inside a week and then catches nothing at all. So the rules below are deliberately
 * narrow and every one of them errs toward silence:
 *
 *   A LABELLED VALUE, NEVER ANY NUMBER.  The number has to be bound to a label the page
 *                                        states. "42 reviews" is a fact; "42" is not.
 *   DATED CONTENT IS EXCLUDED.           A post, a listing card, or any page whose own JSON-LD
 *                                        calls it an article. It was true when it was written.
 *   CODE IS EXCLUDED.                    A sample is not the site making a claim.
 *   THE VALUE IS NORMALISED.             4.9 and 4.90 are one rating; 4,200 and 4200 are one
 *                                        count; +61 2 9876 5432 and (02) 9876 5432 are one
 *                                        phone. Two conventions are not two opinions.
 *   ONE VALUE IS SILENT.                 A label carrying the same value on 3,400 pages says
 *                                        nothing, and a label appearing once says nothing.
 *   MANY VALUES IS A LIST.                A rating on every product card. Named and set aside,
 *                                        never reported as a contradiction and never silently
 *                                        dropped.
 *   A PHONE IS ALWAYS A LIST.             A business can have a landline, a mobile, a fax and a
 *                                        depot, and every one of them is correct. Measured as
 *                                        the largest single cause of a 46 per cent false-alarm
 *                                        rate, so phone is listed and never reported.
 *
 * Usage:  node gate-facts.mjs [project-dir] [--all]
 *          --all also prints the labels set aside as lists, with their values and pages.
 * Exit:   0 always when it could run (clean OR findings: it is advisory),
 *         2 cannot check (never a pass).
 *
 * KNOWN AND ACCEPTED: tags are stripped with a regex, so an attribute value containing a literal
 * `>` leaks its text into the prose. Built output essentially never carries one, and a scanner
 * that respects quoted attributes buys accuracy this check does not need.
 */
import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";
import { invokedDirectly } from "./lib/invoked-directly.mjs";
import { findOutputRoot, builtPages, OUT_CANDIDATES, EXPLORE_ROUTE, NEVER_INDEXED } from "./palate-index.mjs";

/**
 * Not a page of the site: `/explore`, the direction boards, the older variants.
 *
 * Rungs differ in their copy ON PURPOSE, so reading a board's number as a claim about the
 * business reports the range as a contradiction during the one stage whose job is to show a
 * range. `palate-index.mjs` already states this rule and already excludes these routes from the
 * orphan and dead-link reports; the predicate is imported rather than copied so the two cannot
 * drift, and `gate-shipready` deletes the routes before hand-over anyway.
 */
const notASitePage = (route) => NEVER_INDEXED.has(route) || EXPLORE_ROUTE(route);

// A page that is only ever machine output. 2MB is gate-shipready's ceiling and the same
// reasoning applies: past that it is a data dump, not a page somebody wrote a claim onto.
const MAX_PAGE_BYTES = 2_000_000;

// ---------------------------------------------------------------- markup to text

/** Elements whose contents are never the site speaking to a reader. */
const NOT_PROSE = ["script", "style", "noscript", "template", "svg", "pre", "code", "kbd", "samp"];

/**
 * Remove `<tag>...</tag>` outright. Non-greedy, and these do not meaningfully nest, so the
 * first close is the right one. `<pre>` swallows any `<code>` inside it.
 */
function stripElements(html, tags) {
  let out = html;
  for (const t of tags) out = out.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, "gi"), " ");
  return out;
}

/** The index just past the close of the element opened before `from`, or -1. Depth-counted. */
function closeOf(html, tag, from) {
  const re = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

/**
 * Cut out every `<tag>` block that carries a `datetime` attribute.
 *
 * THE BLOCK, NOT THE PAGE. Excluding a whole page the moment any `<time datetime>` appears
 * would be simpler and would switch the gate off across an entire site the first time a footer
 * carried a copyright year in a `<time>`. A check that silently stops looking is the class of
 * fault this repo hunts, so the exclusion is scoped to the entry that carries the date.
 *
 * FOUR WRAPPERS, NOT TWO. `<article>` is the post and `<li>` is the listing card, which is what
 * the shipped scaffold emits, and a hand-built listing grid of `<div>` or `<a>` cards is just as
 * ordinary on a customer build. Those two are loose enough to need a bound, and the first bound
 * was the wrong one.
 *
 * SIZE IS THE WRONG AXIS. The bound was 4,000 characters, and an ordinary built page body is
 * smaller than that: every page in this repo's own fixture is under 745 bytes, so a whole page
 * wrapped in an app div with a copyright `<time>` in its footer read as nothing at all, which is
 * exactly what the bound was written to prevent. A card is a card because it sits INSIDE the
 * page, not because it is short. So a `<div>` or `<a>` is only a card when it holds no page
 * landmark and does not cover nearly the whole document.
 */
const PAGE_REGION = /<(?:main|header|footer|nav|h1|article)\b/i;
const PAGE_SHARE = 0.8;
function stripDatedBlocks(html) {
  let out = html;
  for (const tag of ["article", "li", "a", "div"]) {
    const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    const keep = [];
    let last = 0;
    let m;
    while ((m = open.exec(out))) {
      const end = closeOf(out, tag, open.lastIndex);
      if (end < 0) continue;                       // unbalanced markup: leave it alone
      const block = out.slice(m.index, end);
      if (!/\bdatetime\s*=/i.test(block)) continue;
      if ((tag === "a" || tag === "div")
          && (PAGE_REGION.test(block) || block.length > out.length * PAGE_SHARE)) continue;
      keep.push(out.slice(last, m.index));
      last = end;
      open.lastIndex = end;
    }
    keep.push(out.slice(last));
    out = keep.join(" ");
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-" };
const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (_, k) => ENTITIES[k.toLowerCase()])
    .replace(/&#(\d{1,6});/g, (_, d) => { const c = Number(d); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; });

/** Every dash a person might type in an hours range, folded to one. */
const dashes = (s) => s.replace(/[‐-―−]/g, "-");

/**
 * Does the page declare itself a dated content entry?
 *
 * The scaffold's post page emits BlogPosting in its own JSON-LD. That is the page saying what
 * it is, which beats any guess about its URL: /news, /journal and /field-notes are all the same
 * thing and no path list ever holds all of them.
 */
function declaresArticle(html) {
  const ARTICLE = /"@type"\s*:\s*"(?:BlogPosting|Article|NewsArticle|TechArticle|ReportageNewsArticle|LiveBlogPosting|AdvertiserContentArticle|SocialMediaPosting)"/;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (ARTICLE.test(m[1])) return true;
  }
  return false;
}

// ------------------------------------------------------------------ normalisers

const digitsOf = (s) => s.replace(/\D/g, "");

/**
 * A phone number's identity: digits, with the international form folded onto the national one.
 *
 * Stripping punctuation alone (which is all "ignores spaces and brackets" asks for) leaves
 * `+61 2 9876 5432` and `(02) 9876 5432` looking like two different numbers, and a site that
 * writes the international form in its schema and the local form in its footer would be
 * permanently in disagreement with itself.
 *
 * THE LENGTH-KEYED FOLDS MISSED THE TWELVE-DIGIT SHAPES. `+61 1300 123 456` is twelve digits
 * and kept its country code while `1300 123 456` did not, so the two spellings of one service
 * number disagreed. Every fold is now keyed on the country code rather than on a length that
 * varies by number type.
 *
 * THE `(0)` STRIP WAS DELETED ONCE AND CAME BACK. A mutation check returned zero failures and
 * the conclusion drawn was that nothing depended on it, because the AU branch preserves a
 * leading zero it already finds. That reasoning holds only inside the AU branch: `+44 (0)20 7946
 * 0958` folded to thirteen digits against `020 7946 0958`, so a UK or NZ site writing both
 * spellings of one number argued with itself. A zero-failure mutation means the SUITE did not
 * cover the behaviour, not that nothing did.
 */
export function normalisePhone(raw) {
  // One number written for two audiences at once. The bracketed trunk digit belongs to the
  // national form and is never dialled internationally.
  let d = digitsOf(String(raw).replace(/\(\s*0\s*\)/g, ""));
  if (d.startsWith("00")) d = d.slice(2);                                  // international access code
  if (d.startsWith("61") && d.length >= 10 && d.length <= 12) {            // AU, landline mobile or service
    const rest = d.slice(2);
    // A 1300 or 1800 service number has no trunk zero to restore, and giving it one invents a
    // number nobody dials. Everything else gains the zero the national form is written with.
    return rest.startsWith("0") || /^1[38]00/.test(rest) ? rest : "0" + rest;
  }
  if (d.startsWith("44") && d.length >= 11 && d.length <= 12) return "0" + d.slice(2);  // UK
  if (d.startsWith("64") && d.length >= 9 && d.length <= 11) return "0" + d.slice(2);   // NZ
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);             // NANP
  return d;
}

/**
 * Is this candidate a written date rather than a number anyone can ring?
 *
 * FOUND BY REVIEW: "Effective 01.05.2024" is eight digits with a leading zero, which is exactly
 * the shape the phone guard accepts, so a policy page carrying an effective date argued with the
 * site's real phone number.
 *
 * THE SHAPE ALONE DECIDES IT. A first draft also checked that the month was one to twelve, so a
 * run like `12 34 5678` could stay a phone, and no test could be written for it: there is no
 * real phone number written in two-two-four. An undemonstrable guard is the thing this file
 * removed once already, so it went. Every grouping a phone is actually written in (two-four-four
 * bracketed, four-three-three mobile or service, one-plus-country-code) is a different shape and
 * is untouched.
 */
function looksLikeDate(raw) {
  const shape = String(raw).trim().split(/\D+/).filter(Boolean).map((g) => g.length).join(",");
  return shape === "2,2,4" || shape === "4,2,2";
}

const DAY_KEY = {
  mon: "mon", monday: "mon", tue: "tue", tues: "tue", tuesday: "tue", wed: "wed", weds: "wed",
  wednesday: "wed", thu: "thu", thur: "thu", thurs: "thu", thursday: "thu", fri: "fri",
  friday: "fri", sat: "sat", saturday: "sat", sun: "sun", sunday: "sun",
  weekday: "weekdays", weekdays: "weekdays", weekend: "weekends", weekends: "weekends",
};

/** `9am` -> `09:00`, `17:00` -> `17:00`, `9:30 PM` -> `21:30`. Null when it is not a time. */
function normaliseTime(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mer = (m[3] || "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (h > 24) return null;
  return { hhmm: `${String(h % 24).padStart(2, "0")}:${m[2] || "00"}`, hour: h % 24, meridiem: Boolean(mer) };
}

// ----------------------------------------------------------------- the patterns
//
// Each one is anchored on the LABEL the page states. `(?<![\d.,])` keeps a pattern from
// biting off the tail of a bigger number: without it "4.9 reviews" reads as nine reviews.

const P_REVIEWS = /(?<![\d.,])(\d[\d,]*)\s*\+?\s*(?:google\s+|verified\s+|customer\s+|client\s+|online\s+|five[- ]star\s+|5[- ]star\s+)?reviews?\b/gi;
// A measured average, never a category boast. "5 star service" is a claim about the class of
// service; reading it as a rating puts every site that also prints "4.9 stars" in permanent
// disagreement with itself, which is exactly the false alarm that gets a check switched off.
const P_STARS = /(?<![\d.,])(\d+\.\d+)\s*(?:\/\s*5)?\s*(?:★\s*)?\b(?:stars?|star\s+rating|rating)\b/gi;
// `4.9/5` is a rating and `1/5/2024` is a date, and the second one was being read as a rating
// of one. The slash form therefore refuses a neighbour on either side: a digit or a slash
// before it, and a slash or another digit after the 5.
const P_OUT_OF_5 = /(?<![\d.,\/])(\d+(?:\.\d+)?)\s*(?:\/\s*5(?!\s*[\/\d])|\bout\s+of\s+5\b)/gi;
// A WHOLE NUMBER OUT OF FIVE IS USUALLY A PROPORTION, NOT A RATING. "4 out of 5 customers
// recommend us" and "4/5 calls answered within the hour" are ordinary testimonial copy, and
// reading them as a rating put them in argument with the site's real 4.9 on the same page. A
// decimal is self-evidently a measured average; a whole number needs something nearby to say
// so, which "rated 5 out of 5" and "5 out of 5 stars" both do.
//
// ADJACENT, NOT NEARBY. The first version allowed twelve non-word characters between the rating
// word and the number, and a full stop and a space fit inside that, so "42 reviews. 4 out of 5
// customers recommend us." reopened the whole class from the previous sentence. A sentence
// terminator now ends the window. `reviews?` is gone from the leading set for the same reason:
// a review count in front of a proportion is the commonest way the two collide, and it licenses
// nothing on its own.
// TWO GUARDS, AND EACH ONE STOPS WHAT THE OTHER CANNOT. The character class stops an intervening
// WORD and a sentence terminator. The count stops an intervening run of PUNCTUATION, which is
// what a star glyph row is: "Rated ★★★★★ 4 out of 5 customers recommend us" put the whole class
// back on the commonest markup a rating has.
//
// The counts were deleted once, for being inert: widening either from four to twelve passed the
// whole suite. That was true and the conclusion was wrong. Nothing in the suite separated four
// from twelve because every case tested had a WORD in the gap, which the class already handled,
// so the measurement said the tests were thin rather than that the bound did nothing. Restored,
// with the punctuation cases that make the number able to fail.
const RATING_WORD_BEFORE = /\b(?:rated|rating|rate|scored?)[^\w.!?;]{0,4}$/i;
// The word boundary belongs to the WORDS. `★\b` can never match a row of stars, because the
// character after a star is another star and neither is a word character, so the glyph
// alternative sat there unable to fire until the boundary was moved inside the alternation.
const RATING_WORD_AFTER = /^[^\w.!?;]{0,3}(?:stars?\b|rating\b|★)/i;
const P_RATING_OF = /\brating\b\s*(?:of|is|:)?\s*(?<![\d.,])(\d+(?:\.\d+)?)/gi;
// THE QUALIFIER IS PART OF THE LABEL, and it was not until a clean fixture proved it had to
// be. "25 years in the trade, 20 years in business under this name" is one ordinary sentence
// making two true claims, and reading both as a bare `years` label put a correct site in
// permanent disagreement with itself. A qualifier is also REQUIRED: an unqualified span
// ("over 20 years ago", "20 years later") is a number in a story, not a claim about the firm.
const P_YEARS = /(?:\b(?:over|more\s+than|for\s+over|with\s+over|almost|nearly)\s+)?(?<![\d.,])(\d[\d,]*)\s*\+?\s*years?\s+(?:of\s+)?((?:combined\s+)?(?:experience|expertise|service|trading|serving|servicing|in\s+business|in\s+the\s+trade|in\s+the\s+industry))\b/gi;
const P_ABN = /\bABN\b\s*(?:no\.?|number)?\s*:?\s*((?:\d[\s-]?){10}\d)/gi;
// A run of digits and phone punctuation. Validated afterwards rather than in the pattern,
// because the pattern that tries to express "is a phone number" catches years and prices.
//
// A FULL STOP ONLY COUNTS WHEN A DIGIT FOLLOWS IT. Allowing it anywhere let a run cross a
// sentence boundary: "Phone (02) 9876 5432. 2026" read as one fourteen-digit number, which is a
// phone number nobody has and a disagreement nobody can act on. `555.123.4567` still reads as
// one run, and `01.05.2024` still reaches the date guard below.
const P_PHONE_TEXT = /[+(]?\d(?:[\d\s()+-]|\.(?=\d)){6,}\d/g;
const P_TEL_HREF = /href\s*=\s*["']tel:([^"']+)["']/gi;
// A TIME RANGE AFTER A DAY NAME IS NOT AUTOMATICALLY WHEN THE BUSINESS IS OPEN. A class
// timetable, an inspection schedule, a market stall, a service, a committee meeting and an
// event all state one, and none of them is the trading hours. Measured as the second largest
// cause of a 46 per cent false-alarm rate: a gym and an estate agent were both told their
// opening hours contradicted themselves. So the page has to SAY these are the trading hours.
//
// THE LICENCE CARRIES DOWN A LIST, because a real hours block is a heading and then a line per
// day, and the seventh line is nowhere near the heading. A match is licensed when a trading
// word sits within `LICENCE_WINDOW` before it, or when it follows an already licensed match
// within `LICENCE_CHAIN`, which is how a block of day lines reads as one thing.
const P_TRADING_WORD = /\b(?:open|opens|opening|hours|trading|closed|closes)\b/i;
const LICENCE_WINDOW = 90;
const LICENCE_CHAIN = 40;
const DAYS = "mon|monday|tues|tue|tuesday|weds|wed|wednesday|thurs|thur|thu|thursday|fri|friday|sat|saturday|sun|sunday|weekdays|weekday|weekends|weekend";
const P_HOURS = new RegExp(
  `\\b(${DAYS})\\b(?:\\s*(?:-|to|through|thru)\\s*\\b(${DAYS})\\b)?\\s*[:,]?\\s*` +
  `(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\s*(?:-|to|until|till)\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`,
  "gi",
);

const CONTEXT_PAD = 40;
const context = (text, at, len) =>
  text.slice(Math.max(0, at - CONTEXT_PAD), at + len + CONTEXT_PAD).replace(/\s+/g, " ").trim();

/**
 * Every labelled value this page states, in document order.
 *
 * @param {string} html one built page
 * @returns {{label: string, value: string, context: string}[]}
 */
export function extractFacts(html) {
  if (typeof html !== "string" || !html) return [];
  if (declaresArticle(html)) return [];

  const body = stripDatedBlocks(stripElements(html, NOT_PROSE));
  const found = [];
  // ONE ENTRY PER DISTINCT CLAIM. "Over 20 years of experience" answers two of the patterns
  // below, and counting it twice would inflate every total this gate prints. Two DIFFERENT
  // values under one label on one page are both kept: that is a page arguing with itself.
  const seen = new Set();
  const push = (label, value, text, at, len) => {
    if (value === null || value === undefined || value === "") return;
    const key = `${label}\u0000${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ label, value: String(value), context: context(text, at, len) });
  };

  // The one read taken from an attribute rather than from prose: a tel: href is the most
  // reliable phone on any page, and stripping tags first would throw it away.
  for (const m of body.matchAll(P_TEL_HREF)) {
    const v = normalisePhone(m[1]);
    if (v.length >= 6) push("phone", v, body, m.index, m[0].length);
  }

  const text = dashes(decode(body.replace(/<[^>]*>/g, " "))).replace(/\s+/g, " ").trim();
  if (!text) return found;

  for (const m of text.matchAll(P_ABN)) {
    const d = digitsOf(m[1]);
    if (d.length !== 11) continue;
    push("ABN", d, text, m.index, m[0].length);
  }

  for (const m of text.matchAll(P_REVIEWS)) push("reviews", digitsOf(m[1]), text, m.index, m[0].length);

  for (const re of [P_STARS, P_OUT_OF_5, P_RATING_OF]) {
    for (const m of text.matchAll(re)) {
      const n = Number.parseFloat(m[1]);
      if (!Number.isFinite(n) || n < 0 || n > 5) continue;
      if (re === P_OUT_OF_5 && !m[1].includes(".")
          && !RATING_WORD_BEFORE.test(text.slice(0, m.index))
          && !RATING_WORD_AFTER.test(text.slice(m.index + m[0].length))) continue;
      push("rating", String(n), text, m.index, m[0].length);
    }
  }

  for (const m of text.matchAll(P_YEARS)) {
    push(`years ${m[2].toLowerCase().replace(/\s+/g, " ")}`, digitsOf(m[1]), text, m.index, m[0].length);
  }

  for (const m of text.matchAll(P_PHONE_TEXT)) {
    let raw = m[0];
    let d = digitsOf(raw);
    if (d.length < 8 || d.length > 15) continue;
    // A phone is written the way a phone is written: an international prefix, a bracketed area
    // code, a leading trunk zero, or one of the AU service prefixes. Anything else in this
    // shape is a year range, a price or an order number.
    // A UNIT OR DEPOT NUMBER BEFORE A BRACKETED PHONE IS NOT PART OF IT. "Depot 0 (02) 9876
    // 5432" read as one run, the stray zero was absorbed, and the normaliser then stripped it as
    // an international access code, so the same number read two ways depending on what sat
    // beside it. A short run of digits in front of an opening bracket is the thing before the
    // number, not the start of it, and the number begins at the bracket.
    //
    // NEVER ON AN INTERNATIONAL FORM: `+61 (0)412 345 678` brackets its own trunk digit, and
    // cutting there would throw the country code away and leave a number nobody can ring. That
    // is what "digits only" in the prefix test buys, and it is the whole guard: a run beginning
    // `+` carries the plus in its prefix and can never match. An explicit second check for the
    // plus was written first and removed, because no input could reach it.
    const bracket = raw.indexOf("(", 1);
    if (bracket > 0 && /^\d{1,6}\D{0,3}$/.test(raw.slice(0, bracket))) {
      raw = raw.slice(bracket);
      d = digitsOf(raw);
    }
    if (d.length < 8 || d.length > 15) continue;
    // An AU service number is ten digits. Eight digits behind a 1300 is a reference, not a line
    // anyone can ring, and an invoice number is the commonest place to find one.
    if (/^1[38]00/.test(d) && d.length < 10 && !/^[+(]/.test(raw.trim())) continue;
    if (!(/^[+(]/.test(raw.trim()) || d.startsWith("0") || /^1[38]00/.test(d))) continue;
    if (looksLikeDate(raw)) continue;
    // Nobody punctuates a number this short with full stops, and plenty of pages punctuate a
    // date that way. Longer dotted runs (555.123.4567) are left alone.
    if (raw.includes(".") && d.length < 9) continue;
    push("phone", normalisePhone(raw), text, m.index, raw.length);
  }

  let licensedTo = -1;
  for (const m of text.matchAll(P_HOURS)) {
    const licensed = (licensedTo >= 0 && m.index - licensedTo <= LICENCE_CHAIN)
      || P_TRADING_WORD.test(text.slice(Math.max(0, m.index - LICENCE_WINDOW), m.index));
    if (!licensed) continue;
    licensedTo = m.index + m[0].length;
    const from = DAY_KEY[m[1].toLowerCase()];
    const to = m[2] ? DAY_KEY[m[2].toLowerCase()] : null;
    const open = normaliseTime(m[3]);
    let close = normaliseTime(m[4]);
    if (!from || !open || !close) continue;
    // "9-5" means nine in the morning to five in the afternoon. Reading the close literally
    // would make the same hours written two ways disagree, which is a false alarm about
    // punctuation rather than a finding about the business.
    if (!close.meridiem && !open.meridiem && close.hour < open.hour && close.hour < 12) {
      close = { ...close, hour: close.hour + 12, hhmm: `${String(close.hour + 12).padStart(2, "0")}:${close.hhmm.slice(3)}` };
    }
    push(`hours ${to && to !== from ? `${from}-${to}` : from}`, `${open.hhmm}-${close.hhmm}`, text, m.index, m[0].length);
  }

  return found;
}

/**
 * Which labels carry two values, and which pages carry each.
 *
 * @param {Map<string, object[]>|Record<string, object[]>} byPage route -> its facts
 * @returns {{label: string, values: {value: string, pages: string[], context: string}[]}[]}
 */
export function disagreements(byPage) {
  const rows = byPage instanceof Map ? [...byPage.entries()] : Object.entries(byPage || {});
  const byLabel = new Map();
  for (const [page, facts] of rows) {
    for (const f of facts || []) {
      if (!f || !f.label) continue;
      if (!byLabel.has(f.label)) byLabel.set(f.label, new Map());
      const values = byLabel.get(f.label);
      if (!values.has(f.value)) values.set(f.value, { value: f.value, pages: [], context: f.context || "" });
      const slot = values.get(f.value);
      if (!slot.pages.includes(page)) slot.pages.push(page);
    }
  }
  const out = [];
  for (const [label, values] of byLabel) {
    if (values.size < 2) continue;
    out.push({
      label,
      values: [...values.values()].sort((a, b) => b.pages.length - a.pages.length || String(a.value).localeCompare(String(b.value))),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ------------------------------------------------------------------------- CLI

const PAGES_NAMED = 3;

/**
 * Past this many values, a label is a LIST rather than a claim.
 *
 * A product grid with a rating on every card, or a multi-branch site with a phone number per
 * location, hands one label a dozen values. Every one of them is correct and reporting them as
 * a contradiction is the false alarm that gets a check switched off. Two values is somebody
 * having typed the number twice; twelve is a catalogue.
 *
 * SET ASIDE, NEVER SILENT, AND NOW WITH A ROUTE TO THE DETAIL. Naming the label and its count
 * was half the job: a genuine clash can hide inside a suppressed label (the home page's 4.9
 * against the reviews page's 4.7, buried under five card ratings) and nothing printed the
 * values, so the operator could not judge whether the suppression mattered. `--all` prints
 * them, and the set-aside clause says so. A count with no route to the detail is the same
 * defect this gate's own summary line was fixed for.
 */
const MAX_VALUES_REPORTED = 3;

/**
 * Labels a business can legitimately hold several of. Never a disagreement, always a list.
 *
 * THE RATE IS WHAT DECIDED THIS. An independent critic wrote thirteen clean small-business
 * builds and this gate fired on six of them, against a kill condition of one in ten, and the
 * largest single cause was a second phone number: an after-hours mobile, a fax, two depots.
 *
 * The threshold was not the problem, the label was. Every other label here is single-valued by
 * nature: a business has one review count, one rating, one ABN, one age, and one set of trading
 * hours per day, so two values means somebody typed one of them twice. It can have any number of
 * phone numbers, so two values means nothing at all. Raising `MAX_VALUES_REPORTED` would only
 * have moved the same wrong answer to three numbers.
 *
 * WHAT IT COSTS, stated rather than hidden: an old number left behind on one page after a change
 * is a real fault and this will no longer report it. It is still printed under `--all`, which is
 * where /sweep already asks whether every published number is current.
 */
const SET_VALUED = new Set(["phone"]);
const namePages = (pages) =>
  pages.length <= PAGES_NAMED
    ? pages.join(", ")
    : `${pages.slice(0, PAGES_NAMED).join(", ")} and ${pages.length - PAGES_NAMED} more`;

function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes("--all");
  const dir = args.find((a) => !a.startsWith("-")) || ".";

  // NEVER GRADE THE PLUGIN'S OWN FILES. This defaults to ".", and the plugin's own templates
  // and doctrine quote example numbers on purpose.
  const refusal = pluginRootRefusal(dir);
  if (refusal) {
    console.error(`gate-facts: refused: ${refusal}. Name the site directory explicitly. NOT a pass.`);
    process.exit(2);
  }

  const outRoot = findOutputRoot(dir);
  if (!outRoot) {
    console.error(
      `gate-facts: skipped (no built output under ${OUT_CANDIDATES.join(", ")}; nothing to inspect). NOT a pass.`,
    );
    process.exit(2);
  }

  const byPage = new Map();
  let inspected = 0;
  let values = 0;
  let unreadable = 0;
  for (const { file, route } of builtPages(outRoot)) {
    if (notASitePage(route)) continue;
    let html;
    try {
      if (statSync(file).size > MAX_PAGE_BYTES) continue;
      html = readFileSync(file, "utf8");
    } catch {
      unreadable += 1;
      continue;
    }
    inspected += 1;
    const facts = extractFacts(html);
    values += facts.length;
    if (facts.length) byPage.set(route || "/", facts);
  }

  // HOW MUCH DID IT ACTUALLY READ. A gate that walks a tree, finds nothing to walk and exits 0
  // is indistinguishable from one that read three hundred pages and found them consistent.
  if (inspected === 0) {
    console.error(
      `gate-facts: skipped (${relative(dir, outRoot) || "the build output"} holds no indexable page` +
      `${unreadable ? `; ${unreadable} unreadable` : ""}; nothing to inspect). NOT a pass.`,
    );
    process.exit(2);
  }

  const all = disagreements(byPage);
  const isList = (d) => SET_VALUED.has(d.label) || d.values.length > MAX_VALUES_REPORTED;
  const found = all.filter((d) => !isList(d));
  const setAside = all.filter(isList);
  const asideClause = setAside.length
    ? ` ${setAside.length} label(s) set aside as a list rather than a claim: ` +
      `${setAside.map((d) => `${d.label} (${d.values.length} values)`).join(", ")}.` +
      (showAll ? "" : " Re-run with --all for their values and pages.")
    : "";
  const printValues = (d) => {
    for (const v of d.values) console.error(`      ${v.value}  on ${namePages(v.pages)}  "${v.context}"`);
  };
  const asideWhy = (d) => SET_VALUED.has(d.label)
    ? "a business can legitimately have more than one"
    : "a list rather than a claim";
  const printSetAside = () => {
    if (!showAll || !setAside.length) return;
    for (const d of setAside) {
      console.error(`  [${d.label}] ${d.values.length} values, set aside: ${asideWhy(d)}:`);
      printValues(d);
    }
  };

  if (!found.length) {
    console.log(
      `gate-facts: clean (inspected ${inspected} page(s), ${values} labelled value(s); no label carries two values).${asideClause}`,
    );
    printSetAside();
    process.exit(0);
  }

  console.error(
    `gate-facts: ${found.length} disagreement(s) (inspected ${inspected} page(s), ${values} labelled value(s)).${asideClause} ` +
    `ADVISORY: nothing is blocked. One of each pair is wrong, or they are about different things and should say so.\n`,
  );
  for (const d of found) {
    console.error(`  [${d.label}] ${d.values.length} values across ${new Set(d.values.flatMap((v) => v.pages)).size} page(s):`);
    printValues(d);
  }
  printSetAside();
  process.exit(0);
}

if (invokedDirectly(import.meta.url)) main();
