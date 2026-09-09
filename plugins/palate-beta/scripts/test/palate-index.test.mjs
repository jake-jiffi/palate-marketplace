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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildIndex, blastRadius, readBuildFormat, resolveBuildFormat } from '../palate-index.mjs';

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

/** A throwaway site. `config` is the astro.config.mjs body, or null for a project with none. */
function site(files, config = null) {
  const dir = mkdtempSync(join(tmpdir(), 'palate-idx-fmt-'));
  if (config) writeFileSync(join(dir, 'astro.config.mjs'), config);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

test('a route linked only from a component is not an orphan', () => {
  // The link graph was empty on every site Palate has built, because only the page file was
  // read. A site whose nav lives in a Header component had every page in that nav reported as
  // an orphan, and the report was a statement about the parser rather than about the site.
  const dir = site({
    'src/pages/index.astro': '---\nimport Header from "../components/Header.astro";\n---\n<Header />',
    'src/pages/contact.astro': '<h1>Contact</h1>',
    'src/components/Header.astro': '<nav><a href="/contact">Contact</a></nav>',
  });
  try {
    const ix = buildIndex(dir);
    assert.ok(!ix.links.orphans.includes('/contact'), `the header links /contact: ${ix.links.orphans}`);
    assert.deepEqual(ix.routes.find((r) => r.path === '/').links, ['/contact']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the shipped template has a link graph, and says how much of one it read', () => {
  assert.ok(index.links.parsed > 0, 'the template parsed no links at all, so nothing downstream can be trusted');
  assert.ok(index.links.files > 0, 'no files were scanned for links');
  assert.ok(index.routes.find((r) => r.path === '/').links.length > 0,
    'home reaches no internal link, so every page it links to reads as an orphan');
  assert.ok(!index.links.orphans.includes('/explore'),
    'the switcher in the shared layout links /explore, so it is reached from every page');
});

test('orphans are not computed when no link was parsed at all', () => {
  // Zero parsed links is the signature of a parser that saw nothing. Listing every page as an
  // orphan then reports the parser's blindness as a property of the site.
  const dir = site({ 'src/pages/index.astro': '<h1>Home</h1>', 'src/pages/about.astro': '<h1>About</h1>' });
  try {
    const ix = buildIndex(dir);
    assert.equal(ix.links.parsed, 0);
    assert.deepEqual(ix.links.orphans, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Explore scaffolding is neither a dead link nor an orphan, in either direction', () => {
  // MEASURED ON THE MERGED TREE BEFORE THIS TEST EXISTED: a scaffold with two boards registered
  // and no dist reported orphans ["/404","/blog","/boards/b1","/boards/b2","/contact"]. The
  // boards are reached from /explore and from the switcher through `href={v.href}`, which is an
  // expression and not a literal, so a source read cannot see the link; `/explore` escapes only
  // because the switcher happens to carry a literal href to it. `/publish` reads the report, and
  // a board route is scaffolding either way: it is deleted at Compose and it was never meant to
  // be linked from the site.
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L /><a href="/contact">c</a>',
    'src/pages/contact.astro': '<h1>c</h1>',
    'src/pages/explore.astro': '<h1>directions</h1>',
    'src/pages/boards/b1.astro': '<h1>b1</h1>',
    'src/pages/boards/b2.astro': '<h1>b2</h1>',
    'src/pages/v3.astro': '<h1>v3</h1>',
    'src/layouts/L.astro': '<a href="/contact">c</a>',
  });
  try {
    const ix = buildIndex(dir);
    for (const p of ['/explore', '/boards/b1', '/boards/b2', '/v3']) {
      assert.ok(!ix.links.orphans.includes(p), `${p} is Explore scaffolding, not an orphan: ${ix.links.orphans}`);
    }
    assert.ok(ix.links.orphans.length === 0 || !ix.links.orphans.some((p) => p.startsWith('/boards/')),
      `a board route reached the orphan list: ${ix.links.orphans}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a 404 page is not an orphan, because nothing is meant to link to it', () => {
  // The scaffold ships src/pages/404.astro and nothing links to it, which is correct: it is
  // served on a miss. It was reported as an orphan on every build the scaffold has ever
  // produced, because the orphan filter excluded `/` and the Explore scaffolding and had no
  // idea the never-indexed routes existed. gate-seo and gate-facts each carried their own copy
  // of that set; it is exported from here now and all three read the one list.
  const dir = site({
    'src/pages/index.astro': '<a href="/contact">c</a>',
    'src/pages/contact.astro': '<h1>c</h1>',
    'src/pages/404.astro': '<h1>not found</h1>',
    'src/pages/500.astro': '<h1>error</h1>',
    'src/pages/about.astro': '<h1>about</h1>',
  });
  try {
    const ix = buildIndex(dir);
    for (const p of ['/404', '/500']) {
      assert.ok(!ix.links.orphans.includes(p), `${p} is served on a miss, not an orphan: ${ix.links.orphans}`);
    }
    // AND A REAL ORPHAN STILL IS ONE, or the fix above is "stop reporting orphans".
    assert.ok(ix.links.orphans.includes('/about'),
      `an unlinked ordinary page must still be reported: ${ix.links.orphans}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board href that outlives its route is not a dead link, and a real one still is', () => {
  // The mirror case, and the one EXPLORE_ROUTE was written for at `/vN`: a page that still
  // links a board after Compose has archived it. The link is real, the route is gone, and the
  // page carrying it is on its way out too, so calling it dead stops a publish over a page that
  // was meant to go.
  const dir = site({
    'src/pages/index.astro': '<a href="/boards/b1">b1</a><a href="/v2">v2</a><a href="/explore">x</a><a href="/gone">dead</a>',
    'src/pages/contact.astro': '<h1>c</h1>',
  });
  try {
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, ['/gone'],
      `only the genuinely dead href should fire: ${JSON.stringify(ix.links.dead)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an asset href in the shared layout is not a dead link', () => {
  // BaseLayout carries <link rel="icon" href="/favicon.svg">. Reading the closure without
  // this filter puts a favicon in every route's link list and then reports it as a broken page.
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L />',
    'src/pages/contact.astro': '<h1>c</h1>',
    'src/layouts/L.astro': '<link rel="icon" href="/favicon.svg" /><a href="/brochure.pdf">pdf</a><a href="/contact">c</a>',
  });
  try {
    assert.deepEqual(buildIndex(dir).links.dead, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI reports how many links it read, over how many files', () => {
  const dir = site({
    'src/pages/index.astro': '---\nimport Header from "../components/Header.astro";\n---\n<Header />',
    'src/pages/contact.astro': '<h1>Contact</h1>',
    'src/components/Header.astro': '<nav><a href="/contact">Contact</a></nav>',
  });
  try {
    const r = spawnSync(process.execPath, [join(HERE, '..', 'palate-index.mjs'), dir], { encoding: 'utf8' });
    assert.match(`${r.stdout}${r.stderr}`, /links: \d+ parsed across \d+ files/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a link that never rendered is not a link, and not a dead one either', () => {
  // THE DEFECT THIS CLOSES. ExploreSwitcher carries a literal href="/explore" inside a
  // `{show && ...}` that is false once the variant registry is cleared, and BaseLayout mounts it
  // on every route. Reading the source, every finished Palate site reported a dead link to a
  // page Compose had deleted, and /publish reads a dead link as not done.
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L />',
    'src/pages/contact.astro': '<h1>c</h1>',
    'src/layouts/L.astro': '{show && <a href="/explore">Explore</a>}<a href="/contact">c</a>',
    // The composed build: the switcher rendered nothing, so /explore is nowhere in the output.
    'dist/index.html': '<html><body><a href="/contact">c</a></body></html>',
    'dist/contact/index.html': '<html><body><a href="/">home</a></body></html>',
  });
  try {
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, [], `nothing shipped a link to /explore: ${ix.links.dead}`);
    assert.ok(!ix.routes.find((r) => r.path === '/').links.includes('/explore'));
    assert.ok(!ix.links.orphans.includes('/contact'), 'the built home links /contact');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Set a file's mtime, so staleness is decided by the test rather than by how fast it ran. */
const age = (dir, rel, seconds) => {
  const t = new Date(Date.now() + seconds * 1000);
  utimesSync(join(dir, rel), t, t);
};

test('a dead href added AFTER the build is reported without a rebuild', () => {
  // The index reads the built output, /check runs the index and never builds, and /edit builds
  // without re-indexing. So a link added in source went unreported until after the deploy, and
  // the cap /check documents fired for the first time when the link was already live.
  const dir = site({
    'src/pages/index.astro': '<a href="/contact">c</a>',
    'src/pages/contact.astro': '<a href="/gone">a link the build has not seen</a>',
    'dist/index.html': '<html><body><a href="/contact">c</a></body></html>',
    'dist/contact/index.html': '<html><body><a href="/">home</a></body></html>',
  });
  try {
    age(dir, 'dist/index.html', 0);
    age(dir, 'dist/contact/index.html', 0);
    age(dir, 'src/pages/index.astro', -60);
    age(dir, 'src/pages/contact.astro', 60); // edited after the build
    const ix = buildIndex(dir);
    assert.ok(ix.links.dead.includes('/gone'), `expected /gone dead, got ${JSON.stringify(ix.links)}`);
    assert.equal(ix.links.stale, 1, 'one route should be reading its source');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('and once it is rebuilt the built page is trusted again', () => {
  const dir = site({
    'src/pages/index.astro': '<a href="/contact">c</a>',
    'src/pages/contact.astro': '<a href="/gone">gone</a>',
    'dist/index.html': '<html><body><a href="/contact">c</a></body></html>',
    // The rebuild rendered the page without that href, which is the state the site is in.
    'dist/contact/index.html': '<html><body><a href="/">home</a></body></html>',
  });
  try {
    age(dir, 'src/pages/index.astro', -60);
    age(dir, 'src/pages/contact.astro', -60);
    age(dir, 'dist/index.html', 0);
    age(dir, 'dist/contact/index.html', 0);
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, []);
    assert.equal(ix.links.stale, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a route the build knew about and rendered nothing for is trusted empty', () => {
  // The guard on the guard. A draft-only [slug] route, an endpoint and an on-demand page all
  // produce no HTML, and falling back for them would put the switcher's unrendered
  // href="/explore" straight back into every composed site.
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L />',
    'src/pages/blog/[slug].astro': '---\nimport L from "../../layouts/L.astro";\n---\n<L />',
    'src/layouts/L.astro': '{show && <a href="/explore">Explore</a>}',
    'dist/index.html': '<html><body>home</body></html>',
  });
  try {
    age(dir, 'src/pages/index.astro', -60);
    age(dir, 'src/pages/blog/[slug].astro', -60);
    age(dir, 'src/layouts/L.astro', -60);
    age(dir, 'dist/index.html', 0);
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, [], `the build rendered no post page on purpose: ${ix.links.dead}`);
    assert.equal(ix.links.stale, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale route reading source does not resurrect the Explore phantom', () => {
  // The fallback is a source read, and a source read cannot see that the switcher renders
  // nothing. Without this the round-1 defect came back for every route edited since the last
  // build, which on a site under active edit is most of them.
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L /><a href="/gone">gone</a>',
    'src/layouts/L.astro': '{show && <a href="/explore">Explore</a>}<a href="/v3">v3</a>',
    'dist/index.html': '<html><body>home</body></html>',
  });
  try {
    age(dir, 'dist/index.html', 0);
    age(dir, 'src/pages/index.astro', 60);
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, ['/gone'], `only the real one: ${ix.links.dead}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a route added since the build reads its source', () => {
  const dir = site({
    'src/pages/index.astro': '<a href="/contact">c</a>',
    'src/pages/new.astro': '<a href="/nowhere">new page, never built</a>',
    'src/pages/contact.astro': '<h1>c</h1>',
    'dist/index.html': '<html><body><a href="/contact">c</a></body></html>',
    'dist/contact/index.html': '<html><body>c</body></html>',
  });
  try {
    for (const f of ['src/pages/index.astro', 'src/pages/contact.astro']) age(dir, f, -60);
    for (const f of ['dist/index.html', 'dist/contact/index.html']) age(dir, f, 0);
    age(dir, 'src/pages/new.astro', 60);
    assert.ok(buildIndex(dir).links.dead.includes('/nowhere'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI says when it read source because the build was older', () => {
  const dir = site({
    'src/pages/index.astro': '<a href="/gone">gone</a>',
    'dist/index.html': '<html><body>home</body></html>',
  });
  try {
    age(dir, 'dist/index.html', 0);
    age(dir, 'src/pages/index.astro', 60);
    const r = spawnSync(process.execPath, [join(HERE, '..', 'palate-index.mjs'), dir], { encoding: 'utf8' });
    assert.match(`${r.stdout}${r.stderr}`, /built output older than source for 1 route\(s\), links read from source/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI carries the adapter warning the gate carries', () => {
  // /publish reads the index, not the gate, so an operator seeing 45 dead links had no cause.
  const dir = site(
    { 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>A</h1>' },
    'import vercel from "@astrojs/vercel";\nexport default { adapter: vercel(), build: { format: "file" } };\n',
  );
  try {
    const r = spawnSync(process.execPath, [join(HERE, '..', 'palate-index.mjs'), dir], { encoding: 'utf8' });
    assert.match(`${r.stdout}${r.stderr}`, /overrides it to "directory"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no build to read, the source closure is still the fallback', () => {
  const dir = site({
    'src/pages/index.astro': '---\nimport L from "../layouts/L.astro";\n---\n<L />',
    'src/pages/contact.astro': '<h1>c</h1>',
    'src/layouts/L.astro': '<a href="/contact">c</a>',
  });
  try {
    assert.deepEqual(buildIndex(dir).routes.find((r) => r.path === '/').links, ['/contact']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a built entry page belongs to the dynamic route that rendered it', () => {
  const dir = site({
    'src/pages/index.astro': '<a href="/blog/welcome">post</a>',
    'src/pages/blog/[slug].astro': '<h1>post</h1>',
    'dist/index.html': '<html><body><a href="/blog/welcome">post</a></body></html>',
    'dist/blog/welcome/index.html': '<html><body><a href="/">home</a></body></html>',
  });
  try {
    const ix = buildIndex(dir);
    assert.deepEqual(ix.routes.find((r) => r.path === '/blog/[slug]').links, ['/']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the OUTPUT decides the format, so .html files mean file even with no config', () => {
  const dir = site({
    'src/pages/index.astro': '<a href="/about.html">about</a>',
    'src/pages/about.astro': '<h1>About</h1>',
    'dist/index.html': '<html><body><a href="/about.html">about</a></body></html>',
    'dist/about.html': '<html><body><a href="/">home</a></body></html>',
  });
  try {
    assert.equal(resolveBuildFormat(dir).format, 'file');
    assert.deepEqual(buildIndex(dir).links.dead, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Vercel adapter overrides build.format, and the .html links really are dead', () => {
  // @astrojs/vercel calls updateConfig({ build: { format: "directory" } }) unconditionally, so
  // a project that declares "file" ships /about/ and /about.html is a 404. Reading the config
  // alone made both tools report those links as live pages, which is a check saying the
  // opposite of the truth.
  const dir = site(
    {
      'src/pages/index.astro': '<a href="/about.html">about</a>',
      'src/pages/about.astro': '<h1>About</h1>',
      'dist/index.html': '<html><body><a href="/about.html">about</a></body></html>',
      'dist/about/index.html': '<html><body><a href="/">home</a></body></html>',
    },
    'import vercel from "@astrojs/vercel";\nexport default { adapter: vercel(), build: { format: "file" } };\n',
  );
  try {
    const resolved = resolveBuildFormat(dir);
    assert.equal(resolved.format, 'directory');
    assert.match(resolved.warning, /overrides it to "directory"/);
    assert.ok(buildIndex(dir).links.dead.includes('/about.html'), 'that href 404s on this host');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no output at all the adapter still decides, and says so', () => {
  const dir = site(
    { 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>A</h1>' },
    'import vercel from "@astrojs/vercel";\nexport default { adapter: vercel(), build: { format: "file" } };\n',
  );
  try {
    const resolved = resolveBuildFormat(dir);
    assert.equal(resolved.format, 'directory');
    assert.match(resolved.warning, /@astrojs\/vercel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('declared file with no adapter is honoured, and is silent', () => {
  const dir = site(
    { 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>A</h1>' },
    'export default { build: { format: "file" } };\n',
  );
  try {
    const resolved = resolveBuildFormat(dir);
    assert.equal(resolved.format, 'file');
    assert.equal(resolved.warning, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readBuildFormat reads the config, and defaults to Astro\'s own default', () => {
  const bare = site({ 'src/pages/index.astro': '<h1>x</h1>' });
  const filed = site({ 'src/pages/index.astro': '<h1>x</h1>' }, 'export default { build: { format: "file" } };\n');
  try {
    assert.equal(readBuildFormat(bare), 'directory');
    assert.equal(readBuildFormat(filed), 'file');
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(filed, { recursive: true, force: true });
  }
});

test('a commented-out build.format is prose, not a setting', () => {
  // A commented example of format: "file" would switch .html stripping on for the whole build,
  // and every genuinely broken /about.html link would then read as fine.
  const dir = site(
    { 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>About</h1>' },
    '// build: { format: "file" },\nexport default { output: "static" };\n',
  );
  try {
    assert.equal(readBuildFormat(dir), 'directory');
    assert.ok(buildIndex(dir).links.dead.includes('/about.html'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('under build.format "file" a /about.html link is a link, not a dead one', () => {
  // The site's own URLs ARE /about.html under that format, and every one of them read as a
  // dead link because the normaliser only ever stripped a trailing slash.
  const dir = site(
    { 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>About</h1>' },
    'export default { build: { format: "file" } };\n',
  );
  try {
    const ix = buildIndex(dir);
    assert.deepEqual(ix.links.dead, [], `expected no dead links, got ${ix.links.dead}`);
    assert.ok(!ix.links.orphans.includes('/about'), 'home links /about, so it is not an orphan');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same .html link IS dead under the default directory format', () => {
  // The strip has to be keyed on the format. Applied everywhere it would hide a real 404,
  // because /about.html and /about are two different URLs on a directory-format host.
  const dir = site({ 'src/pages/index.astro': '<a href="/about.html">about</a>', 'src/pages/about.astro': '<h1>About</h1>' });
  try {
    assert.ok(buildIndex(dir).links.dead.includes('/about.html'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns null rather than throwing on a directory that is not a site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palate-idx-empty-'));
  try {
    assert.equal(buildIndex(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
