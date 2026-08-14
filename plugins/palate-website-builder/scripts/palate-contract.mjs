#!/usr/bin/env node
/**
 * palate-contract.mjs - what a contribution has to satisfy before it ships.
 *
 * ============================ THE TWO PRINCIPLES ============================
 *
 * JUDGED ON THE DELTA, NEVER THE ABSOLUTE. A contribution inherits the site's
 * standing and is accountable only for its own change. Without this rule the
 * contract is unusable on every site we did not build, which is the half worth
 * having: a site adopted at 44 must still be able to merge a typo fix.
 *
 * SCOPED BY DIFF CLASS. A blog post is never judged on originality or signature
 * move; those were decided at build time, on a template. A new component is.
 * Running the design ladder on a copy edit is not rigour, it is a tax on the
 * most frequent action in the product, and a tax people remove.
 *
 * ============================== THE VERDICTS ==============================
 *
 *   HEAL        mechanical and fixable. The agent fixes it and re-runs BEFORE a
 *               human sees anything. Bounded: two flat iterations is a stall,
 *               and a stall is reported, never waved through.
 *   MERGE       everything passed. Nobody is asked to look at anything.
 *   REVIEW      a threshold was crossed but nothing is broken. Names the lane,
 *               the route, the number, the threshold and the smallest fix.
 *   BLOCK       cannot ship. Clearing it needs a fix, or an override commit
 *               with a written reason that lands in the audit trail.
 *   UNGROUNDED  not a quality verdict at all. Stamped when the taste layer was
 *               unreachable, so a report can never imply a judgement it did not
 *               make. Orthogonal to the other four: a build can be MERGE and
 *               UNGROUNDED at once, and saying so is the whole point.
 *
 * The rubric weights and check ids are the grader's own
 * (scripts/reference-capture/rubric.mjs), so what we enforce and what we score
 * are the same object. A customer can read why a post was held back and see it
 * in the number they are given.
 *
 * ===================== WHAT THE CLI DOES, AND DOES NOT =====================
 *
 * The CLI is a PLANNER. It answers "what will be checked, on which routes, and
 * why" and then stops. It does NOT run the lanes and it does NOT return a
 * verdict, because the lanes need a browser, a served URL and (for the ladder)
 * an agent, none of which belong inside an argument parser.
 *
 * Callers fold a verdict themselves with `fold()` after running the lanes. An
 * earlier version of this header advertised exit codes for merge/review/block
 * that `main()` never returned, which would have had every caller read a
 * verdict off exit 0 and be wrong every single time. Saying what a thing does
 * not do is part of saying what it does.
 *
 * Usage:
 *   node palate-contract.mjs <project-dir> --changed <file> [<file>...]
 *   node palate-contract.mjs <project-dir> --changed <file> --json
 * Exit: 0 a plan was produced, 4 bad args or not a site. Nothing else.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, blastRadius } from './palate-index.mjs';

export const VERDICT = { MERGE: 'merge', REVIEW: 'review', BLOCK: 'block', HEAL: 'heal' };

// ------------------------------------------------------------- diff classes

/**
 * Three classes, because they carry completely different risk.
 *
 * The boundary that matters is CONTENT vs STRUCTURAL. Content changes what a
 * page says; structural changes what every page looks like. Treating them alike
 * is how a gate ends up either too slow for a typo or too weak for a redesign.
 */
export function classify(changed) {
  const cls = { content: [], structural: [], config: [], other: [] };
  for (const f of changed.map((c) => c.replace(/^\.\//, ''))) {
    if (/^src\/content\//.test(f) || /^src\/lib\/business\.(ts|js)$/.test(f)) cls.content.push(f);
    else if (/^(package\.json|pnpm-lock|package-lock|astro\.config|tsconfig|.*\.config\.(ts|js|mjs)|\.github\/)/.test(f)) cls.config.push(f);
    else if (/^src\/.*\.(astro|tsx?|jsx?|svelte|vue|css|scss)$/.test(f)) cls.structural.push(f);
    else cls.other.push(f);
  }
  // The class of the change as a whole is the most dangerous class present.
  const primary = cls.structural.length ? 'structural'
    : cls.config.length ? 'config'
    : cls.content.length ? 'content'
    : 'none';
  return { ...cls, primary };
}

// ------------------------------------------------------------------- lanes

/**
 * Which lanes run for which class, in cost order.
 *
 * `taste` is deliberately absent from a content change. That is not a
 * concession, it is the finding: across every documented migration failure, not
 * one was a taste failure. They were functional, SEO and performance failures.
 * A gate that only judges beauty catches none of what actually broke.
 */
export const LANES = {
  caps: { cost: 'instant', blocking: true, classes: ['content', 'structural', 'config'] },
  schema: { cost: 'instant', blocking: true, classes: ['content', 'structural', 'config'] },
  voice: { cost: 'seconds', blocking: true, classes: ['content', 'structural'] },
  functional: { cost: 'seconds', blocking: true, classes: ['content', 'structural', 'config'] },
  a11y: { cost: 'tens of seconds', blocking: true, classes: ['content', 'structural'] },
  perf: { cost: 'tens of seconds', blocking: true, classes: ['content', 'structural', 'config'] },
  tokens: { cost: 'instant', blocking: true, classes: ['structural'] },
  geometry: { cost: 'tens of seconds', blocking: true, classes: ['structural'] },
  drift: { cost: 'seconds', blocking: false, classes: ['content', 'structural'] },
  taste: { cost: 'a minute', blocking: false, classes: ['structural'] },
};

export function lanesFor(primary) {
  return Object.entries(LANES)
    .filter(([, l]) => l.classes.includes(primary))
    .map(([name, l]) => ({ name, ...l }));
}

// ---------------------------------------------------------------- the plan

/**
 * What this contribution will be checked against, before anything is run.
 *
 * Separated from execution on purpose: the plan is cheap, deterministic and
 * testable, and it is what makes the latency budget inspectable. If a content
 * edit ever plans a whole-site render, that is visible here rather than
 * discovered by a person waiting five minutes.
 */
export function plan(projectDir, changed) {
  const index = buildIndex(projectDir);
  if (!index) return null;
  const diff = classify(changed);
  const routes = blastRadius(index, changed);
  const lanes = lanesFor(diff.primary);
  return {
    diffClass: diff.primary,
    changed,
    files: { content: diff.content, structural: diff.structural, config: diff.config, other: diff.other },
    routes,
    lanes: lanes.map((l) => l.name),
    blocking: lanes.filter((l) => l.blocking).map((l) => l.name),
    // The honest cost signal. A content edit touching 1-3 routes is the case the
    // whole design is tuned for; anything wide is a structural change wearing a
    // content change's clothes and should be seen as such before it runs.
    scope: routes.length <= 3 ? 'narrow' : routes.length <= 10 ? 'moderate' : 'wide',
    index,
  };
}

// ------------------------------------------------------------------ verdict

/**
 * Fold a set of findings into one verdict.
 *
 * Order matters and is not negotiable: a cap outranks everything, then blocks,
 * then heals, then reviews. HEAL sits ABOVE review because a mechanically
 * fixable problem should never reach a person: the whole labour saving is the
 * agent fixing it and re-running before anyone is asked to look.
 */
export function fold(findings, { grounded = true } = {}) {
  const has = (sev) => findings.some((f) => f.severity === sev);
  const verdict = has('cap') || has('block') ? VERDICT.BLOCK
    : has('heal') ? VERDICT.HEAL
    : has('review') ? VERDICT.REVIEW
    : VERDICT.MERGE;
  return {
    verdict,
    grounded,
    // Orthogonal, never folded into the verdict. An ungrounded MERGE is a real
    // and reportable state: the change was fine on everything we could measure,
    // and the taste layer was not among the things we could measure.
    grounding: grounded ? 'grounded' : 'ungrounded',
    counts: {
      cap: findings.filter((f) => f.severity === 'cap').length,
      block: findings.filter((f) => f.severity === 'block').length,
      heal: findings.filter((f) => f.severity === 'heal').length,
      review: findings.filter((f) => f.severity === 'review').length,
    },
    findings,
  };
}

// ---------------------------------------------------------------- baselines

const baselinePath = (projectDir, route) =>
  join(projectDir, '.palate', 'baselines', (route === '/' ? '_root' : route.replace(/^\//, '').replace(/[\\/]/g, '_')) + '.json');

export function readBaseline(projectDir, route) {
  const p = baselinePath(projectDir, route);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Baselines hold NUMBERS, never pixels.
 *
 * Per route: throttled vitals, the appearance embedding, axe counts, a structure
 * hash. A few KB of diffable JSON. Storing stills instead would repeat the
 * mistake that left github/docs a 574MiB checkout inside a 2.23GiB repository,
 * because every superseded image is permanent and history cannot be un-fattened
 * without a rewrite. Stills are regenerated for the before/after review; they
 * are an output, not a record.
 */
/**
 * MERGE, NEVER REPLACE. Three callers write DISJOINT halves of a baseline and a wholesale
 * write meant each one destroyed the others:
 *
 *   palate-baseline.mjs  {takenAt, source, vitals, axe, design, embedding}
 *   /drift --rebaseline  {at, model, image, embedding}          <- and nothing else
 *   /publish             vitals/axe/hygiene, explicitly NO embedding
 *
 * So the real sequence on a managed site was: adopt writes the embedding, a copy edit is
 * published and destroys it, and /drift then reports "first baseline written, nothing to
 * compare yet" on a route that has been baselined three times. Drift could never report a
 * distance on any route anyone had actually touched, and it failed looking like a cautious
 * first run rather than like a bug. The reverse held too: a rebaseline threw away the vitals,
 * axe and design facts that /status and /report read back.
 *
 * Merging by field means each writer owns the keys it actually measured and leaves the rest
 * alone, which is the only arrangement that survives three writers and no owner.
 */
export function writeBaseline(projectDir, route, data) {
  const p = baselinePath(projectDir, route);
  mkdirSync(dirname(p), { recursive: true });
  let prior = {};
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prior = parsed;
  } catch {
    // No prior, or an unreadable one. An unreadable baseline is not worth preserving, and
    // refusing to write here would leave the route with no baseline at all.
  }
  writeFileSync(p, JSON.stringify({ ...prior, route, ...data }, null, 2) + '\n');
  return p;
}

// -------------------------------------------------------------------- drift

/**
 * Appearance drift: how far this render has moved from the route's own baseline.
 *
 * Cosine distance between two l2-normalised SigLIP embeddings, both computed on
 * the customer's machine. Entirely local and free, and it is the FREE half of
 * the line: it answers "has this page moved", never "was the move good".
 *
 * Whether the move was an improvement needs the learned head, which stays on
 * our server because the plugin repo is public. That split is not a pricing
 * decision dressed up as architecture; it is the only part of the pipeline that
 * genuinely cannot run locally.
 */
export function cosineDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return null;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The drift threshold is advisory, and it must stay that way until it is
 * calibrated on real edits. Blocking on an uncalibrated perceptual distance is
 * how a gate earns a reputation for crying wolf in its first week, and a gate
 * people switch off protects nothing.
 */
export const DRIFT_REVIEW_AT = 0.08;

export function driftFinding(route, distance) {
  if (distance == null) return null;
  if (distance < DRIFT_REVIEW_AT) return null;
  return {
    lane: 'drift', severity: 'review', route,
    message: `appearance moved ${distance.toFixed(3)} from this route's baseline (review threshold ${DRIFT_REVIEW_AT})`,
    fix: 'If the change was intended, accept it and re-baseline. If not, the layout or tokens moved further than the copy did.',
  };
}

// ---------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const projectDir = resolve(argv[0] || '.');
  const at = argv.indexOf('--changed');
  if (at === -1) { console.error('palate-contract: --changed <file>... is required'); process.exit(4); }
  const changed = argv.slice(at + 1).filter((a) => !a.startsWith('--'));
  const p = plan(projectDir, changed);
  if (!p) { console.error(`palate-contract: no site at ${projectDir}`); process.exit(4); }

  if (argv.includes('--json')) {
    const { index, ...rest } = p;
    console.log(JSON.stringify(rest, null, 2));
    return;
  }

  console.log(`contribution class : ${p.diffClass}`);
  console.log(`routes affected    : ${p.routes.length} (${p.scope})`);
  for (const r of p.routes.slice(0, 12)) console.log(`  ${r}`);
  if (p.routes.length > 12) console.log(`  ... and ${p.routes.length - 12} more`);
  console.log(`lanes              : ${p.lanes.join(', ')}`);
  console.log(`blocking           : ${p.blocking.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
