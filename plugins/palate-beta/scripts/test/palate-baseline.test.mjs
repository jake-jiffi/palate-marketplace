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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex } from '../palate-index.mjs';
import { routesToCapture } from '../palate-baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'templates', 'astro-project');
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
