/**
 * Review routing: the tests are almost entirely about the two ways this can be
 * wrong, because only one of them is survivable.
 *
 *   ROUTES TOO MUCH   everything reaches the technologist, the queue is exactly
 *                     as long as it was, and the product has done nothing.
 *   ROUTES TOO LITTLE   a change merges with nobody having read it and nothing
 *                     having checked it. That is worse than the bottleneck: the
 *                     bottleneck is slow, this is silent.
 *
 * So the auto-merge branch gets attacked hardest: every test below that ends in
 * `none` is a claim that nothing needs to look at that change, ever.
 *
 * Run: node --test scripts/test/palate-route-review.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lanesFor } from '../palate-contract.mjs';
import { routeReview, frozenHits, formatText, FROZEN, REVIEWER } from '../palate-route-review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'palate-route-review.mjs');

// Built from the contract rather than hardcoded, so this suite keeps telling
// the truth if the lane set ever changes.
const allGreen = (cls) =>
  Object.fromEntries(lanesFor(cls).filter((l) => l.blocking).map((l) => [l.name, 'pass']));

const POST = 'src/content/posts/spring-sale.md';

// -------------------------------------------------------- the labour saving

test('a blog post with every blocking lane green needs no human at all', () => {
  const d = routeReview([POST], { lanes: allGreen('content') });
  assert.equal(d.reviewer, REVIEWER.NONE);
  assert.equal(d.humanReviewRequired, false);
  assert.deepEqual(d.reasons, [], 'a clean content change must produce no reasons to hold it');
});

test('a phone number change merges without a human', () => {
  // business.ts is the single source of the facts and is deliberately NOT in
  // the frozen set. If this ever routes to a person, the most ordinary edit in
  // the product has been given a reviewer and the bottleneck is back.
  const d = routeReview(['src/lib/business.ts'], { lanes: allGreen('content') });
  assert.equal(d.reviewer, REVIEWER.NONE);
  assert.equal(d.diffClass, 'content');
});

test('docs and images do not drag anyone in', () => {
  const d = routeReview(['README.md', 'docs/tone.md', 'public/hero.jpg'], { lanes: {} });
  assert.equal(d.reviewer, REVIEWER.NONE, `held for: ${d.reasons.map((r) => r.code)}`);
});

// ------------------------------------------------- what is NOT green enough

test('a missing lane result is not a pass', () => {
  const lanes = allGreen('content');
  delete lanes.a11y;
  const d = routeReview([POST], { lanes });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.equal(d.reasons[0].code, 'lane-missing');
  assert.deepEqual(d.lanes.missing, ['a11y']);
});

test('skipped and errored lanes are not passes either', () => {
  for (const status of ['skip', 'error', 'unknown', '', 'PASS']) {
    const d = routeReview([POST], { lanes: { ...allGreen('content'), perf: status } });
    assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST, `status ${JSON.stringify(status)} was treated as green`);
  }
});

test('a null lane report answers rather than crashes', () => {
  // A CI job that hands us a JSON `null` must get "hold this", not a stack
  // trace. It happens to fail in the safe direction either way, but a router
  // that throws teaches people to ignore it.
  const d = routeReview([POST], { lanes: null });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.deepEqual(d.lanes.status, {});
});

test('no lane report at all holds everything', () => {
  // The day CI breaks, every PR arrives with an empty report. If that reads as
  // green the router auto-merges the entire backlog on the worst possible day.
  const d = routeReview([POST], { lanes: {} });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.equal(d.lanes.missing.length, d.lanes.required.length);
});

test('a failing blocking lane names the lane in one line', () => {
  const d = routeReview([POST], { lanes: { ...allGreen('content'), functional: 'fail' } });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  const r = d.reasons.find((x) => x.code === 'lane-failed');
  assert.equal(r.lane, 'functional');
  assert.match(r.message, /functional/);
});

test('an empty changed set is treated as a broken diff, not an empty change', () => {
  const d = routeReview([], { lanes: allGreen('content') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.equal(d.reasons[0].code, 'no-diff');
});

// ------------------------------------------------------------ by diff class

test('a component change routes to the technologist even when everything passes', () => {
  const d = routeReview(['src/components/Hero.astro'], { lanes: allGreen('structural') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.ok(d.reasons.some((r) => r.code === 'class-structural'));
});

test('a lockfile change routes to the technologist', () => {
  const d = routeReview(['pnpm-lock.yaml'], { lanes: allGreen('config') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.ok(d.reasons.some((r) => r.code === 'class-config'));
});

test('one component in a batch of fifty posts routes the whole batch to a human', () => {
  const files = [...Array(50)].map((_, i) => `src/content/posts/p${i}.md`);
  files.push('src/components/Card.astro');
  const d = routeReview(files, { lanes: allGreen('structural') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST, 'the most dangerous file in the batch decides');
});

// --------------------------------------------------------- the frozen floor

test('every frozen surface routes to a human with everything green', () => {
  const cases = [
    'src/layouts/BaseLayout.astro',
    'src/pages/robots.txt.ts',
    'tailwind.config.ts',
    'src/styles/globals.css',
    'astro.config.mjs',
    'src/content.config.ts',
    'src/pages/api/lead.ts',
    '.github/workflows/ci.yml',
    '.palate/baselines/_root.json',
  ];
  for (const f of cases) {
    const d = routeReview([f], { lanes: { ...allGreen('content'), ...allGreen('structural'), ...allGreen('config') } });
    assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST, `${f} was allowed to merge unread`);
    assert.ok(d.reasons.some((r) => r.code === 'frozen' && r.file === f), `${f} did not report a frozen reason`);
  }
});

test('a baseline edit is caught by the frozen list, not by its diff class', () => {
  // `.palate/baselines/*.json` classifies as `other`, so the class rules would
  // never hold it. Rewriting a baseline moves the ruler instead of the site,
  // which is the one edit that makes every future drift number a lie.
  const d = routeReview(['.palate/baselines/_root.json'], { lanes: allGreen('content') });
  assert.equal(d.diffClass, 'none', 'precondition: the class rules do not see this file');
  assert.equal(d.reasons[0].code, 'frozen');
});

test('the frozen reason is stated first, before the verdict-shaped ones', () => {
  const d = routeReview(['src/layouts/BaseLayout.astro'], { lanes: {} });
  assert.equal(d.reasons[0].code, 'frozen', 'the most specific reason has to lead');
  assert.ok(d.reasons.some((r) => r.code === 'class-structural'), 'and the class reason is still recorded');
});

test('the brand package is frozen by prefix, not just as a bare directory string', () => {
  // The first draft wrote `packages/brand/` inside a `$`-anchored alternation,
  // so it only matched the literal directory name and froze no actual file.
  // Every test above still passed, which is why this one exists.
  assert.equal(frozenHits(['packages/brand/index.ts']).length, 1);
  assert.equal(frozenHits(['packages/brand/tokens/colour.json']).length, 1);
  assert.equal(routeReview(['packages/brand/index.ts'], { lanes: {} }).reasons[0].code, 'frozen');
});

test('the token rule does not sweep in a file that merely ends in tokens.css', () => {
  assert.deepEqual(frozenHits(['src/components/mytokens.css']), []);
  assert.equal(frozenHits(['src/styles/tokens.css']).length, 1);
});

test('a file listed twice produces one reason, not two', () => {
  const d = routeReview(['src/layouts/BaseLayout.astro', './src/layouts/BaseLayout.astro'], { lanes: {} });
  assert.equal(d.frozen.length, 1);
  assert.equal(d.reasons.filter((r) => r.code === 'frozen').length, 1);
  assert.equal(d.changed.length, 1);
});

test('the frozen list explains itself, in one place', () => {
  for (const rule of FROZEN) {
    assert.ok(rule.why && rule.why.length > 20, `frozen rule ${rule.id} has no usable reason`);
    assert.ok(rule.id && rule.test instanceof RegExp);
  }
  assert.deepEqual(frozenHits(['src/layouts/A.astro'])[0].rule, 'layout');
});

// ------------------------------------------------- what the router refuses

test('an unrecognised path is never guessed at', () => {
  const d = routeReview(['scripts/deploy.sh'], { lanes: allGreen('content') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
  assert.equal(d.reasons[0].code, 'unclassified');
});

test('an SVG in public is not treated as inert media', () => {
  // Every other format on the inert list is decoded as an image. An SVG is a
  // document the browser parses, it can carry script, and it is served from the
  // site's own origin.
  const d = routeReview(['public/logo.svg'], { lanes: allGreen('content') });
  assert.equal(d.reviewer, REVIEWER.TECHNOLOGIST);
});

test('grounding is carried but never routed on', () => {
  const ungrounded = routeReview([POST], { lanes: allGreen('content'), grounded: false });
  assert.equal(ungrounded.reviewer, REVIEWER.NONE, 'an unreachable taste layer is not a reason to call a person');
  assert.equal(ungrounded.grounding, 'ungrounded');
  assert.equal(routeReview([POST], { lanes: allGreen('content') }).grounding, 'unknown');
});

// ---------------------------------------------------------------- the CLI

test('the human output says who and why without being read twice', () => {
  const text = formatText(routeReview(['src/layouts/BaseLayout.astro'], { lanes: {} }));
  assert.match(text, /reviewer\s+: technologist/);
  assert.match(text, /frozen scaffold contract \(layout\)/);
});

test('exit 0 means merge it, exit 1 means a human, exit 4 means bad args', () => {
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  const green = Object.keys(allGreen('content')).map((l) => `${l}=pass`).join(',');
  const merge = run(['--changed', POST, '--lanes', green]);
  assert.equal(merge.status, 0, merge.stdout + merge.stderr);
  assert.match(merge.stdout, /merge without human review/);

  const held = run(['--changed', 'src/layouts/BaseLayout.astro', '--lanes', green]);
  assert.equal(held.status, 1, 'a human being needed is exit 1, and it is not an error');

  assert.equal(run(['--lanes', green]).status, 4, 'no --changed at all');
  assert.equal(run(['--changed', '--json']).status, 4, '--changed with no files');
});

test('the JSON is shaped for a CI job to branch on', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--changed', POST, '--json'], { encoding: 'utf8' });
  const d = JSON.parse(r.stdout);
  assert.equal(d.humanReviewRequired, true, 'no lane report was supplied, so it must hold');
  assert.equal(d.reviewer, 'technologist');
  assert.ok(Array.isArray(d.reasons) && d.reasons[0].message);
  assert.ok(Array.isArray(d.lanes.required) && d.lanes.required.length);
});
