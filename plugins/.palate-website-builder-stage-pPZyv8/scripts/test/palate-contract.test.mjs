/**
 * The contribution contract: the properties that stop it being either useless
 * or unbearable.
 *
 * The two failure modes are symmetrical and both are fatal.
 *
 *   TOO SLOW    a copy edit that plans a whole-site render costs minutes, and a
 *               gate that costs minutes on a typo is switched off in week two.
 *               Once off it protects nothing, so a slow gate and no gate are
 *               the same product.
 *   TOO WEAK    a structural change that skips the design and geometry lanes
 *               ships the regression the contract exists to catch.
 *
 * Most of these tests are therefore about SCOPE rather than correctness of any
 * individual check: what runs, on how many routes, for which class of change.
 *
 * Run: node --test scripts/test/palate-contract.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  classify, lanesFor, plan, fold, VERDICT,
  cosineDistance, driftFinding, DRIFT_REVIEW_AT,
  readBaseline, writeBaseline,
} from '../palate-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'templates', 'astro-project');

// ------------------------------------------------------------------ classify

test('a post is content, a component is structural, a lockfile is config', () => {
  assert.equal(classify(['src/content/posts/x.md']).primary, 'content');
  assert.equal(classify(['src/components/Hero.astro']).primary, 'structural');
  assert.equal(classify(['package.json']).primary, 'config');
});

test('the business record is a CONTENT change, not a structural one', () => {
  // It is a .ts file in src/lib, so a naive extension rule calls it structural
  // and runs the full design ladder on a phone-number change. It is a fact.
  assert.equal(classify(['src/lib/business.ts']).primary, 'content');
});

test('a mixed change takes the most dangerous class present', () => {
  const c = classify(['src/content/posts/x.md', 'src/components/Hero.astro']);
  assert.equal(c.primary, 'structural', 'a change touching a component is structural regardless of what else it touches');
  assert.equal(c.content.length, 1);
  assert.equal(c.structural.length, 1);
});

// --------------------------------------------------------------------- lanes

test('a content change never meets the design ladder', () => {
  const lanes = lanesFor('content').map((l) => l.name);
  assert.ok(!lanes.includes('taste'), 'the ladder must not run on a copy edit');
  assert.ok(!lanes.includes('tokens'), 'a copy edit cannot introduce a token');
  assert.ok(!lanes.includes('geometry'), 'a copy edit does not move the layout');
});

test('a content change still meets everything that actually broke for people', () => {
  // Sentry's form-validation regression, StackOne's LCP and 404 wall: all
  // functional, performance and SEO, none of them taste. If these ever leave
  // the content lane set, the contract stops catching the documented failures.
  const lanes = lanesFor('content').map((l) => l.name);
  for (const l of ['functional', 'perf', 'a11y', 'schema', 'caps']) {
    assert.ok(lanes.includes(l), `content change must run the ${l} lane`);
  }
});

test('a structural change meets everything', () => {
  const lanes = lanesFor('structural').map((l) => l.name);
  for (const l of ['tokens', 'geometry', 'taste', 'functional', 'perf', 'a11y']) {
    assert.ok(lanes.includes(l), `structural change must run the ${l} lane`);
  }
});

test('drift is advisory, never blocking, until it is calibrated', () => {
  assert.equal(lanesFor('content').find((l) => l.name === 'drift').blocking, false);
  assert.equal(lanesFor('structural').find((l) => l.name === 'taste').blocking, false);
});

// ---------------------------------------------------------------------- plan

test('a blog post plans a narrow scope', () => {
  const p = plan(TEMPLATE, ['src/content/posts/welcome.md']);
  assert.ok(p, 'expected a plan');
  assert.equal(p.diffClass, 'content');
  assert.equal(p.scope, 'narrow', `a post planned ${p.routes.length} routes: ${p.routes}`);
  assert.ok(p.routes.length <= 3);
});

test('a fact change is content class but reaches wide, and the plan says so', () => {
  // This is propagation showing up in the plan: cheap lanes, many routes. The
  // distinction matters because the cost driver is route count, not class.
  const p = plan(TEMPLATE, ['src/lib/business.ts']);
  assert.equal(p.diffClass, 'content');
  assert.ok(p.routes.length >= 6, `a fact change should reach most routes, got ${p.routes.length}`);
  assert.ok(!p.lanes.includes('taste'), 'still a content change: no ladder');
});

test('an unrecognised source change plans every route rather than none', () => {
  const p = plan(TEMPLATE, ['src/lib/brand-new-thing.ts']);
  assert.equal(p.routes.length, p.index.routes.length,
    'failing narrow here is how the gate misses the change that broke the site');
});

// ------------------------------------------------------------------- verdict

test('the fold order: cap outranks block outranks heal outranks review', () => {
  assert.equal(fold([{ severity: 'review' }]).verdict, VERDICT.REVIEW);
  assert.equal(fold([{ severity: 'heal' }, { severity: 'review' }]).verdict, VERDICT.HEAL);
  assert.equal(fold([{ severity: 'block' }, { severity: 'heal' }]).verdict, VERDICT.BLOCK);
  assert.equal(fold([{ severity: 'cap' }, { severity: 'review' }]).verdict, VERDICT.BLOCK);
  assert.equal(fold([]).verdict, VERDICT.MERGE);
});

test('heal outranks review, so a fixable problem never reaches a person', () => {
  const f = fold([{ severity: 'review' }, { severity: 'heal' }]);
  assert.equal(f.verdict, VERDICT.HEAL);
});

test('grounding is orthogonal: an ungrounded MERGE is a real, reportable state', () => {
  const f = fold([], { grounded: false });
  assert.equal(f.verdict, VERDICT.MERGE, 'absence of the taste layer is not a quality failure');
  assert.equal(f.grounding, 'ungrounded');
  assert.equal(f.grounded, false);
});

// --------------------------------------------------------------------- drift

test('cosine distance is 0 for identical vectors and ~1 for orthogonal ones', () => {
  assert.equal(cosineDistance([1, 0, 0], [1, 0, 0]), 0);
  assert.ok(Math.abs(cosineDistance([1, 0, 0], [0, 1, 0]) - 1) < 1e-9);
});

test('cosine distance refuses rather than guesses on bad input', () => {
  // Returning 0 on a length mismatch would read as "no drift" and silently
  // pass every check, which is the worst available failure for this function.
  assert.equal(cosineDistance([1, 0], [1, 0, 0]), null);
  assert.equal(cosineDistance([], []), null);
  assert.equal(cosineDistance([0, 0], [1, 0]), null);
  assert.equal(cosineDistance(null, [1]), null);
});

test('drift below the threshold is silent, above it asks rather than blocks', () => {
  assert.equal(driftFinding('/x', 0), null);
  assert.equal(driftFinding('/x', null), null);
  const f = driftFinding('/x', DRIFT_REVIEW_AT + 0.01);
  assert.equal(f.severity, 'review', 'drift must never block on an uncalibrated threshold');
  assert.ok(f.fix, 'a finding without a fix is a complaint');
});

// ----------------------------------------------------------------- baselines

test('baselines round-trip and hold numbers, not pixels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-bl-'));
  try {
    assert.equal(readBaseline(dir, '/blog'), null, 'no baseline yet');
    const p = writeBaseline(dir, '/blog', { lcp: 1768, embedding: [0.1, 0.2], axe: 0 });
    assert.ok(existsSync(p));
    const back = readBaseline(dir, '/blog');
    assert.equal(back.route, '/blog');
    assert.equal(back.lcp, 1768);
    assert.deepEqual(back.embedding, [0.1, 0.2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the root route gets a filename rather than an empty one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-bl-root-'));
  try {
    const p = writeBaseline(dir, '/', { lcp: 1 });
    assert.ok(!p.endsWith('/.json'), `root baseline wrote a nameless file: ${p}`);
    assert.equal(readBaseline(dir, '/').lcp, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a nested route cannot escape the baselines directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-bl-nest-'));
  try {
    const p = writeBaseline(dir, '/blog/some-post', { lcp: 2 });
    assert.ok(p.includes(join('.palate', 'baselines')), `baseline escaped: ${p}`);
    assert.equal(readBaseline(dir, '/blog/some-post').lcp, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- baseline merge
// Three writers own disjoint halves of a baseline (palate-baseline: vitals/axe/design/
// embedding; /drift --rebaseline: embedding only; /publish: vitals/axe/hygiene and
// explicitly no embedding). A wholesale write meant each destroyed the others, so /drift
// reported "first baseline written, nothing to compare yet" on routes baselined three
// times, failing like a cautious first run rather than like a bug.
test('writeBaseline merges by field so three writers cannot clobber each other', () => {
  const d = mkdtempSync(join(tmpdir(), 'palate-bl-'));
  try {
    const p = writeBaseline(d, '/contact', {
      takenAt: 't1', source: 'adopt', vitals: { lcp: 1200 }, axe: { v: 0 },
      design: { a: 1 }, embedding: [0.1, 0.2],
    });

    writeBaseline(d, '/contact', { vitals: { lcp: 900 }, axe: { v: 1 } });   // a publish
    const afterPublish = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(Array.isArray(afterPublish.embedding), true, 'publish destroyed the embedding');
    assert.deepEqual(afterPublish.design, { a: 1 }, 'publish destroyed the design facts');
    assert.deepEqual(afterPublish.vitals, { lcp: 900 }, 'publish did not update what it measured');

    writeBaseline(d, '/contact', { at: 't2', model: 'siglip', embedding: [0.9] }); // a rebaseline
    const afterRebase = JSON.parse(readFileSync(p, 'utf8'));
    assert.deepEqual(afterRebase.vitals, { lcp: 900 }, 'rebaseline destroyed the vitals');
    assert.deepEqual(afterRebase.embedding, [0.9], 'rebaseline did not replace the embedding');
    assert.equal(afterRebase.route, '/contact');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
