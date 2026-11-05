/**
 * The content graph, and the two properties everything downstream depends on.
 *
 * 1. PROPAGATION IS TRANSITIVE. "Change a fact once and every surface follows"
 *    is only true if the graph reaches surfaces that never name the fact. The
 *    llms.txt route and the contact endpoint both read the business record
 *    through an import, so a grep for the literal finds neither. If this test
 *    ever passes with a smaller set than the grep would find, propagation has
 *    quietly become a search-and-replace and the guarantee is gone.
 *
 * 2. BLAST RADIUS FAILS WIDE. An unrecognised change must return EVERY route,
 *    never none. A gate that checks too much is slow and survivable; a gate
 *    that checks too little is the gate that passed the change which broke the
 *    site. The asymmetry is the whole reason the default is expensive.
 *
 * Run: node --test scripts/test/palate-index.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildIndex, blastRadius } from '../palate-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'templates', 'astro-project');

const index = buildIndex(TEMPLATE);

test('builds an index over the shipped template', () => {
  assert.ok(index, 'expected an index for templates/astro-project');
  assert.ok(index.counts.routes >= 8, `too few routes: ${index.counts.routes}`);
  const paths = index.routes.map((r) => r.path);
  for (const p of ['/', '/blog', '/contact', '/llms.txt']) {
    assert.ok(paths.includes(p), `missing route ${p}`);
  }
});

test('the bracket-free dynamic route is indexed as the route it becomes', () => {
  // The scaffold ships `slug.astro.tpl` so the skill zip uploads cleanly. If the
  // index reported `/blog/slug` the blast radius for a post would miss its own
  // detail page, which is the one route a post change is guaranteed to affect.
  const paths = index.routes.map((r) => r.path);
  assert.ok(paths.includes('/blog/[slug]'), `dynamic route not resolved: ${paths.join(', ')}`);
});

test('propagation reaches surfaces that never name the fact', () => {
  assert.ok(index.facts, 'no business record found');
  const readBy = index.facts.readBy;
  // The endpoint and the layout-rendered pages all read it through an import.
  for (const p of ['/', '/llms.txt', '/api/contact']) {
    assert.ok(readBy.includes(p), `${p} reads a business fact but is not in readBy`);
  }
  assert.ok(readBy.length >= 6, `propagation set suspiciously small: ${readBy.length}`);
});

test('one content entry has a small blast radius', () => {
  const entry = index.entries[0];
  assert.ok(entry, 'template ships no content entries');
  const routes = blastRadius(index, [entry.file]);
  // Its own detail route plus the listing. If this grows to the whole site the
  // latency budget for a content edit is gone and the gate gets switched off.
  assert.ok(routes.length > 0 && routes.length <= 3, `post blast radius = ${routes.length}: ${routes}`);
  assert.ok(routes.some((r) => r.startsWith('/blog')), `expected a /blog route, got ${routes}`);
});

test('one page affects one route', () => {
  const routes = blastRadius(index, ['src/pages/contact.astro']);
  assert.deepEqual(routes, ['/contact']);
});

test('the shared layout affects every page that reaches it', () => {
  const routes = blastRadius(index, ['src/layouts/BaseLayout.astro']);
  assert.ok(routes.length >= 5, `layout blast radius too small: ${routes.length}`);
  assert.ok(routes.includes('/'), 'home does not depend on the layout?');
});

test('blast radius fails WIDE on an unknown source file', () => {
  const routes = blastRadius(index, ['src/lib/something-nobody-imports-yet.ts']);
  assert.equal(routes.length, index.routes.length,
    'an unresolvable source change must check every route, never none');
});

test('config changes affect everything', () => {
  assert.equal(blastRadius(index, ['package.json']).length, index.routes.length);
  assert.equal(blastRadius(index, ['astro.config.mjs']).length, index.routes.length);
});

test('non-source changes affect nothing', () => {
  assert.deepEqual(blastRadius(index, ['README.md']), []);
  assert.deepEqual(blastRadius(index, ['.github/workflows/ci.yml']), []);
});

test('the index is a pure function of the repo', () => {
  // No timestamp inside the data: two runs over unchanged source must be byte
  // identical, or every rebuild shows as a diff and the file becomes noise.
  assert.equal(JSON.stringify(buildIndex(TEMPLATE)), JSON.stringify(buildIndex(TEMPLATE)));
  assert.ok(!JSON.stringify(index).includes('generatedAt'), 'generatedAt must not live inside the index data');
});

test('dead internal links are detected, and dynamic routes are not false positives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-idx-'));
  try {
    mkdirSync(join(dir, 'src', 'pages', 'blog'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'index.astro'),
      '<a href="/blog/real-post">ok</a><a href="/nope">dead</a>');
    writeFileSync(join(dir, 'src', 'pages', 'blog', 'index.astro'), '<p>list</p>');
    writeFileSync(join(dir, 'src', 'pages', 'blog', '[slug].astro'), '<p>one</p>');
    const ix = buildIndex(dir);
    assert.ok(ix.links.dead.includes('/nope'), `expected /nope dead, got ${ix.links.dead}`);
    assert.ok(!ix.links.dead.includes('/blog/real-post'),
      'a path served by a dynamic route must not be reported dead');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null rather than throwing on a directory that is not a site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-idx-empty-'));
  try {
    assert.equal(buildIndex(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
