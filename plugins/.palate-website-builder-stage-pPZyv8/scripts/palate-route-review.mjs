#!/usr/bin/env node
/**
 * palate-route-review.mjs - who has to look at this change, and why.
 *
 * =============================== THE PROBLEM ===============================
 *
 * One person sets the site up and then reviews everything forever. That is the
 * bottleneck, and it is not a tooling problem, it is a routing problem: every
 * change arrives in the same queue at the same priority, so a typo in an
 * opening hours line waits behind a landing page rebuild, and the reviewer
 * reads both at the same depth. Nobody reads fifty diffs carefully. They read
 * the first three and skim the rest, which is worse than not reviewing at all
 * because it produces a signature.
 *
 * So the queue has to get smaller, not faster. This script decides, per change,
 * whether a human is needed at all.
 *
 *   CONTENT-ONLY AND EVERY BLOCKING LANE GREEN  -> nobody. Merge it.
 *   STRUCTURAL, CONFIG, OR A BLOCKING LANE RED  -> the technologist, with the
 *                                                  one-line reason.
 *   ANYTHING IN THE FROZEN SCAFFOLD CONTRACT    -> the technologist, always,
 *                                                  green or not.
 *
 * The first branch is the entire labour saving. Everything else here exists to
 * make that branch safe enough to trust.
 *
 * ========================== WHAT COUNTS AS GREEN ==========================
 *
 * Only a lane that ran and passed. A lane that was skipped, errored, or is
 * simply absent from the report is NOT green, and a change is never auto-merged
 * on a missing result. This is the difference between "we checked and it was
 * fine" and "we did not check", and a router that conflates them auto-merges
 * every change on the day CI breaks.
 *
 * ============================= EXIT CODES =============================
 *
 *   0  no human review needed
 *   1  a human is needed. NOT an error: it is the expected outcome for most
 *      structural work, and it is the answer the tool exists to give. It is
 *      also what node returns if this script throws, which is the correct
 *      direction to fail in: a router that crashes must not merge anything.
 *   4  bad args, or no changed files supplied.
 *
 * Usage:
 *   node palate-route-review.mjs --changed <file>... [--lanes a11y=pass,perf=fail]
 *   node palate-route-review.mjs --changed <file>... --lanes-file lanes.json --json
 *   [--grounded | --ungrounded]   recorded in the output, never routed on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify, lanesFor } from './palate-contract.mjs';

export const REVIEWER = { NONE: 'none', TECHNOLOGIST: 'technologist' };

// ------------------------------------------------------- the frozen contract

/**
 * The scaffold contract: the files a human reads with their own eyes, every
 * time, whatever the checks say.
 *
 * WHY A VERDICT CANNOT COVER THIS. Every other lane judges the RENDERED page.
 * An agent that quietly rewrites the layout wrapper has already won by the time
 * anything renders: it can move the canonical tag, drop the skip link, widen
 * the CSP, swap the token import for a hardcoded palette, or change the very
 * thing the checks measure, and the page it hands the gate still renders
 * beautifully and passes. The output is the only thing a rendered gate can see,
 * and the output is exactly what a compromised wrapper controls. The diff is
 * the only place that change is visible, so the diff is where a person has to
 * be. Same argument for the CI workflow (it decides whether the gate runs at
 * all) and for `.palate/` (it is the record the gate compares against, so
 * editing it moves the ruler rather than the site).
 *
 * THE OVERLAP WITH DIFF CLASS IS DELIBERATE. Most of these already classify as
 * structural or config and would route to a human on that basis today. This
 * list is the FLOOR that survives any future loosening of the class rules: if
 * someone later decides small structural changes can auto-merge, these still
 * cannot. Defence in depth is cheap here because the list is short and it is
 * defined in exactly one place, right here.
 *
 * WHAT IS DELIBERATELY NOT FROZEN: `src/lib/business.ts`. It is the single
 * source of the business facts, so freezing it would put a human in front of
 * every phone number change, which is the most ordinary edit in the product and
 * a change with no blast radius beyond the text it prints.
 */
export const FROZEN = [
  {
    id: 'layout',
    test: /^src\/layouts\//,
    why: 'the wrapper every page renders inside; a change here is invisible in any single rendered page',
  },
  {
    id: 'head-seo',
    test: /^(src\/components\/(BaseHead|Head|SEO|Seo|Meta)\.astro|src\/pages\/(robots\.txt|llms\.txt|sitemap[^/]*)\.(ts|js))$/,
    why: 'the head and machine-readable SEO wiring; wrong here and the page looks perfect and is invisible',
  },
  {
    id: 'tokens',
    // Two anchored halves: exact token files, and everything under the brand
    // package. Written as `packages/brand/` INSIDE the `$`-anchored group in an
    // earlier draft, where it only ever matched the bare directory string and
    // silently froze nothing. `(.*\/)?tokens\.` rather than `.*tokens\.` so a
    // component's own `mytokens.css` is not swept in.
    test: /^(tailwind\.config\.[a-z]+|src\/styles\/(globals|tokens)\.css|(.*\/)?tokens\.(css|json|ts))$|^packages\/brand\//,
    why: 'the token source; the whole site inherits it, so nothing local can prove it safe',
  },
  {
    id: 'routing',
    test: /^(astro\.config\.[a-z]+|src\/content\.config\.ts|src\/pages\/api\/)/,
    why: 'the route and collection conventions; changes what URLs exist, not just what they say',
  },
  {
    id: 'ci',
    test: /^\.github\//,
    why: 'the workflow that runs the gate; a change here can switch off every other check',
  },
  {
    id: 'record',
    test: /^\.palate\//,
    why: 'the measured record the gate compares against; editing it moves the ruler instead of the site',
  },
];

/**
 * Paths that genuinely cannot affect a rendered route, so they do not drag a
 * docs-only or image-only change in front of a person.
 *
 * SVG IS NOT ON THE LIST, on purpose. Every other format here is decoded as an
 * image; an SVG is a document the browser parses, it can carry script, and it
 * is served from the site's own origin. "It is just a logo" is how that lands.
 */
export const INERT = [
  { test: /^(README|CHANGELOG|LICENCE|LICENSE|CONTRIBUTING)(\.[a-z]+)?$/i, why: 'repository prose, renders no route' },
  { test: /^docs\//i, why: 'documentation, renders no route' },
  { test: /^public\/.*\.(png|jpe?g|webp|avif|gif|mp4|webm|ico|pdf|woff2?)$/i, why: 'static media, served byte for byte' },
];

const norm = (f) => String(f).replace(/^\.\//, '').replace(/\\/g, '/');

export function frozenHits(changed) {
  const hits = [];
  for (const raw of changed) {
    const file = norm(raw);
    const rule = FROZEN.find((r) => r.test.test(file));
    if (rule) hits.push({ file, rule: rule.id, why: rule.why });
  }
  return hits;
}

const isInert = (file) => INERT.some((r) => r.test.test(file));

// ------------------------------------------------------------------- routing

/**
 * Decide who must review.
 *
 * `lanes` is a map of lane name to status, as reported by whatever ran them.
 * Only the exact string 'pass' is green (see the header). Everything else,
 * including a lane that is absent, holds the change for a person.
 */
export function routeReview(changed, { lanes = {}, grounded = null } = {}) {
  // Deduped: a caller that lists a file twice (a rename reported as both sides,
  // a concatenated diff) would otherwise get the same reason printed twice and
  // read as two problems.
  const files = [...new Set((Array.isArray(changed) ? changed : []).map(norm))];

  // An empty set is almost never an empty change. It is a `git diff` against
  // the wrong ref, and answering "nothing to review" to a broken diff command
  // auto-merges whatever it failed to list. Fail toward the person.
  if (!files.length) {
    return decide(files, 'none', [{
      code: 'no-diff',
      message: 'no changed files were supplied, which is far more likely a broken diff command than an empty change',
    }], { lanes: { required: [], status: {}, failing: [], missing: [] }, grounded });
  }

  const diff = classify(files);
  const required = lanesFor(diff.primary).filter((l) => l.blocking).map((l) => l.name);
  // A JSON `null` report is a plausible thing for a CI job to hand us, and the
  // default parameter does not cover it. Treated as no results, which holds.
  const status = (lanes && typeof lanes === 'object') ? lanes : {};
  const failing = required.filter((l) => status[l] === 'fail');
  // Skipped, errored, absent: all the same answer, and the answer is not green.
  const missing = required.filter((l) => status[l] !== 'pass' && status[l] !== 'fail');

  const reasons = [];

  // Frozen first: it is the most specific thing that can be said about a file,
  // and it is the reason that does not change if the verdict later does.
  for (const hit of frozenHits(files)) {
    reasons.push({
      code: 'frozen', file: hit.file, rule: hit.rule,
      message: `${hit.file} is frozen scaffold contract (${hit.rule}): ${hit.why}`,
    });
  }

  for (const lane of failing) {
    reasons.push({ code: 'lane-failed', lane, message: `the ${lane} lane failed, and it blocks` });
  }
  if (missing.length) {
    reasons.push({
      code: 'lane-missing', lanes: missing,
      message: `no pass recorded for blocking lane(s) ${missing.join(', ')}; not checked is not the same as fine`,
    });
  }

  if (diff.primary === 'structural') {
    reasons.push({
      code: 'class-structural',
      message: `${diff.structural.length} structural file(s) changed; a component change alters every page that renders it`,
    });
  } else if (diff.primary === 'config') {
    reasons.push({
      code: 'class-config',
      message: `${diff.config.length} config file(s) changed; the build itself moved`,
    });
  }

  // The catch-all bucket. Anything the classifier could not place is unknown
  // risk, and unknown risk goes to a person unless it is provably inert.
  const unclassified = diff.other.filter((f) => !isInert(f) && !FROZEN.some((r) => r.test.test(f)));
  if (unclassified.length) {
    reasons.push({
      code: 'unclassified', files: unclassified,
      message: `unrecognised path(s) ${unclassified.slice(0, 3).join(', ')}${unclassified.length > 3 ? ` and ${unclassified.length - 3} more` : ''}; the router will not guess`,
    });
  }

  return decide(files, diff.primary, reasons, { lanes: { required, status, failing, missing }, grounded });
}

// One place decides who, and it decides on exactly one thing: whether anything
// was found worth a person's time. Every rule above therefore has to express
// itself as a reason, which is also why the report can never say "technologist"
// without saying why.
function decide(files, diffClass, reasons, { lanes, grounded }) {
  const who = reasons.length ? REVIEWER.TECHNOLOGIST : REVIEWER.NONE;
  return {
    reviewer: who,
    humanReviewRequired: who !== REVIEWER.NONE,
    diffClass,
    changed: files,
    reasons,
    frozen: frozenHits(files),
    lanes,
    // Carried, never routed on. Whether the taste layer was reachable is not a
    // quality judgement, and letting it decide who reviews would blur the one
    // line the product cannot afford to blur.
    grounding: grounded == null ? 'unknown' : grounded ? 'grounded' : 'ungrounded',
  };
}

// -------------------------------------------------------------------- output

export function formatText(d) {
  const out = [];
  out.push(`changed        : ${d.changed.length} file(s) (${d.diffClass})`);
  const laneLine = d.lanes.required.length
    ? d.lanes.required.map((l) => `${l} ${d.lanes.status[l] || 'not run'}`).join(', ')
    : 'none required for this class';
  out.push(`blocking lanes : ${laneLine}`);
  out.push(`grounding      : ${d.grounding} (does not affect routing)`);
  out.push(d.humanReviewRequired
    ? 'reviewer       : technologist'
    : 'reviewer       : none - merge without human review');
  if (d.reasons.length) {
    out.push('because        :');
    for (const r of d.reasons) out.push(`  - ${r.message}`);
  } else {
    // Not "content only": a docs or image change reaches here with no class and
    // no required lanes, and claiming its lanes passed would be a small lie in
    // the one line people will quote back at us.
    out.push(`because        : ${d.diffClass === 'content' ? 'content only' : `nothing route-bearing changed (${d.diffClass})`}, nothing blocking outstanding`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------- main

function parseLanes(spec) {
  const lanes = {};
  for (const pair of spec.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) lanes[k.trim()] = v.trim();
  }
  return lanes;
}

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--changed');
  if (at === -1) {
    console.error('palate-route-review: --changed <file>... is required');
    process.exit(4);
  }
  const changed = [];
  for (let i = at + 1; i < argv.length && !argv[i].startsWith('--'); i++) changed.push(argv[i]);
  if (!changed.length) {
    console.error('palate-route-review: --changed was given no files');
    process.exit(4);
  }

  let lanes = {};
  const lanesAt = argv.indexOf('--lanes');
  if (lanesAt !== -1 && argv[lanesAt + 1]) lanes = parseLanes(argv[lanesAt + 1]);
  const fileAt = argv.indexOf('--lanes-file');
  if (fileAt !== -1 && argv[fileAt + 1]) {
    try {
      lanes = { ...lanes, ...JSON.parse(readFileSync(argv[fileAt + 1], 'utf8')) };
    } catch (e) {
      console.error(`palate-route-review: could not read --lanes-file: ${e.message}`);
      process.exit(4);
    }
  }

  // Boolean flags rather than a value, so `--grounded` with a missing value
  // cannot silently become the opposite of what the caller meant. Unset stays
  // unset: "we do not know" is a real third state and it is reported as one.
  const grounded = argv.includes('--ungrounded') ? false : argv.includes('--grounded') ? true : null;

  const d = routeReview(changed, { lanes, grounded });
  console.log(argv.includes('--json') ? JSON.stringify(d, null, 2) : formatText(d));
  process.exit(d.humanReviewRequired ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
