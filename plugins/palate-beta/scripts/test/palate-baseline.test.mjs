/**
 * Baseline capture: the route-selection rules, which are the part that can be wrong silently.
 *
 * The capture itself needs a browser and a served site, so it is exercised by running the script.
 * What is testable without either, and what would rot unnoticed, is WHICH routes get baselined.
 * Two selections are actively harmful rather than merely wrong:
 *
 *   A DYNAMIC ROUTE. `/blog/[slug]` is a template, not a page. Baselining the literal bracket path
 *   stores a 404 as the thing every future post is compared against, so every post then reads as
 *   an enormous drift from a baseline that was never a real page.
 *
 *   AN ENDPOINT. robots.txt has no appearance. An embedding of it is noise that the drift check
 *   would then treat as signal.
 *
 * Run: node --test scripts/test/palate-baseline.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex } from '../palate-index.mjs';
import { routesToCapture } from '../palate-baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'templates', 'astro-project');
const CLI = join(HERE, '..', 'palate-baseline.mjs');
const index = buildIndex(TEMPLATE);

test('--all selects only real, static pages', () => {
  const routes = routesToCapture(index, { routes: [], all: true });
  assert.ok(routes.length > 0, 'selected nothing');
  assert.ok(routes.includes('/'), 'home must be baselined');
  assert.ok(routes.includes('/blog'), 'the listing must be baselined');
});

test('a dynamic route is never baselined', () => {
  const routes = routesToCapture(index, { routes: [], all: true });
  const dynamic = routes.filter((r) => r.includes('['));
  assert.deepEqual(dynamic, [],
    'baselining a bracket path stores a 404 as the comparison point for every future entry');
});

test('endpoints are never baselined', () => {
  const routes = routesToCapture(index, { routes: [], all: true });
  for (const r of ['/robots.txt', '/llms.txt', '/api/contact']) {
    assert.ok(!routes.includes(r), `${r} has no appearance to drift`);
  }
});

test('an explicit route list wins over --all', () => {
  const routes = routesToCapture(index, { routes: ['/blog'], all: true });
  assert.deepEqual(routes, ['/blog'],
    'an explicit list is a deliberate scope and must not be widened');
});

test('no routes and no --all selects nothing rather than everything', () => {
  // Defaulting to the whole site here would make an accidental invocation re-baseline every
  // route, silently destroying the comparison points the contract depends on.
  assert.deepEqual(routesToCapture(index, { routes: [], all: false }), []);
});

test('an explicit route list needs no index at all', () => {
  // `buildIndex` returns null for anything without `src/pages`, which is most adopted sites.
  // Requiring an index here is what made --routes unusable on the tier-2 case it exists for.
  assert.deepEqual(routesToCapture(null, { routes: ['/', '/about'], all: false }), ['/', '/about']);
  assert.deepEqual(routesToCapture(null, { routes: [], all: true }), [],
    'no index means no derivable routes, and that must not throw on null.routes');
});

test('--routes works on a site with no src/pages (WordPress, Shopify, static HTML)', async (t) => {
  // The whole tier-2 adoption path. `buildIndex` was called unconditionally and its null exited 2,
  // so a WordPress site could not be baselined even with every route named by hand.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'palate-baseline-')));
  writeFileSync(join(dir, 'index.html'), '<html><title>not astro</title></html>');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { stdout } = await promisify(execFile)(
    process.execPath,
    [CLI, dir, '--base', 'http://127.0.0.1:8899', '--routes', '/,/about', '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.match(stdout, /^\/\s+would CREATE/m);
  assert.match(stdout, /^\/about\s+would CREATE/m);
});

test('--all on a non-Astro site refuses loudly and names the way out', async (t) => {
  // Refusing is correct here: there is no route list to derive. What must never happen is a
  // silent empty run that reads like "this site has no routes".
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'palate-baseline-')));
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let status = 0, stderr = '';
  try {
    await promisify(execFile)(process.execPath, [CLI, dir, '--base', 'http://x', '--all', '--dry-run'], { encoding: 'utf8' });
  } catch (e) { status = e.code; stderr = e.stderr; }
  assert.equal(status, 2);
  assert.match(stderr, /no Astro src\/pages/);
  assert.match(stderr, /palate-crawl/, 'the error must name the tool that produces a real route list');
});
