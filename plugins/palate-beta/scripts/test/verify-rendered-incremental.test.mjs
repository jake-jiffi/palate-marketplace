/**
 * Incremental re-verify: the per-route record in the shots manifest, and --changed.
 *
 * A BROWSER SUITE. It is in the SLOW list in run.sh, so --fast skips it; run it by hand.
 *
 * The defect it pins: one verify pass ran over thirty minutes, a check failed at minute
 * twenty-five, and the next pass re-shot the whole site because one file had changed. The
 * gate had no memory, so every re-run after every fix paid for the whole site again.
 *
 * Three directions, because a cache that is wrong is worse than no cache:
 *   1. a second run over UNCHANGED source keeps the first run's record, hashes and all,
 *      so the skip rests on a hash rather than on a wall clock;
 *   2. --changed renders the blast radius and nothing else, measurably faster;
 *   3. a file the index has never heard of falls WIDE and says why, because a narrowed
 *      gate that guessed is the failure this whole feature could introduce.
 *
 * The server is an in-process node:http listener on port 0, so two of these can run at
 * once in sibling worktrees without a port to collide over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VR = join(HERE, '..', 'reference-capture', 'verify-rendered.mjs');

// A page with real text (the gate skips axe on a blank page, which would make the
// per-route cost unrepresentative) and no internal links, so the view-transition probe
// returns early and the fixed overhead stays small enough for the ratio to mean something.
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:16px/1.6 system-ui;color:#1a1a1a;background:#fff}
main{max-width:60rem;margin:0 auto;padding:2rem}h1{font-size:2.5rem}
a,button{color:#0b4a6f;min-height:44px;display:inline-block}
:focus-visible{outline:3px solid #0b4a6f}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;

const filler = (n) => Array.from({ length: n }, (_, i) =>
  `<section><h2>Section ${i + 1}</h2><p>A paragraph of ordinary body copy that gives the ` +
  'accessibility pass something real to read on this route.</p></section>').join('');

/**
 * A brand package reached through an EXPORTS MAP, the way the real one is published: the files
 * live at `tokens/tokens.css` and `fonts/fonts.css` and the short names are mapped. A resolver
 * that joins `node_modules/<spec>` finds neither, which is how both files sat outside the
 * global digest on every real build while the docs promised the opposite.
 */
function addBrandPackage(root) {
  const pkg = join(root, 'node_modules', '@x', 'brand');
  mkdirSync(join(pkg, 'tokens'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({
    name: '@x/brand', version: '1.0.0', type: 'module',
    exports: { './tokens.css': './tokens/tokens.css' },
  }, null, 2));
  writeFileSync(join(pkg, 'tokens', 'tokens.css'), ':root { --brand: #e2553d; }\n');
  return join(pkg, 'tokens', 'tokens.css');
}

/**
 * A generated fixture: `count` static routes, each importing one of two shared components,
 * plus the index the gate reads to decide what to render.
 *
 * `sharedFor(i)` decides which component route i imports, so a test can size the blast
 * radius it wants without a second fixture.
 */
function makeFixture(count, sharedFor) {
  const root = mkdtempSync(join(tmpdir(), 'palate-incremental-'));
  for (const d of ['src/pages', 'src/components', 'src/styles', 'src/layouts', '.palate']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  for (const c of ['Alpha', 'Beta']) {
    writeFileSync(join(root, 'src', 'components', `${c}.astro`), `<div class="${c.toLowerCase()}">${c}</div>\n`);
  }
  // The shared inputs no route's import closure has to name: the layout every page uses, the
  // stylesheet it imports, and the config. Editing any of them changes what every route
  // renders, which is what the global digest exists to notice.
  writeFileSync(join(root, 'src', 'styles', 'globals.css'), ':root { --ink: #1a1a1a; }\n');
  writeFileSync(join(root, 'src', 'layouts', 'BaseLayout.astro'),
    '---\nimport "@x/brand/tokens.css";\nimport "../styles/globals.css";\n---\n<slot />\n');
  writeFileSync(join(root, 'astro.config.mjs'), 'export default { output: "static" };\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }, null, 2));
  addBrandPackage(root);
  const routes = [];
  const html = new Map();
  html.set('/', page('Home', filler(2)));
  for (let i = 1; i <= count; i++) {
    const id = String(i).padStart(2, '0');
    const shared = sharedFor(i);
    const src = `src/pages/p${id}.astro`;
    writeFileSync(join(root, src), `---\nimport ${shared} from '../components/${shared}.astro';\n---\n<${shared} />\n<h1>Page ${id}</h1>\n`);
    routes.push({
      path: `/p${id}`,
      source: src,
      kind: 'static',
      dependsOn: [`src/components/${shared}.astro`],
      links: [],
    });
    html.set(`/p${id}`, page(`Page ${id}`, filler(3)));
  }
  writeFileSync(join(root, '.palate', 'index.json'), JSON.stringify({
    root, routes, entries: [], counts: { routes: routes.length, entries: 0, drafts: 0 },
    links: { parsed: 0, files: 0, orphans: [], dead: [], stale: 0 },
  }, null, 2));
  return { root, html, index: join(root, '.palate', 'index.json') };
}

function serve(html) {
  const server = createServer((req, res) => {
    // DECODED: a dynamic route is fetched as `/blog/%5Bslug%5D`, so a literal-path fixture
    // never matches without this.
    let path = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
    try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
    const body = html.get(path);
    if (!body) { res.writeHead(404, { 'content-type': 'text/html' }); res.end(page('Not found', '<p>No such page.</p>')); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/**
 * Run the gate and hand back BOTH streams: the findings go to stdout, every diagnostic to
 * stderr, and a run that exits 1 on a High finding must still say what it found.
 *
 * ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE. The fixture server runs in this process, so
 * a synchronous spawn holds the event loop and the server answers nothing: the first draft
 * used spawnSync, every navigation timed out at twenty seconds, and a clean fixture came
 * back with a High finding on all three routes. A harness that starves its own server
 * measures the harness.
 */
function runGate(argv, env = {}) {
  const started = Date.now();
  return new Promise((done) => {
    const p = spawn('node', [VR, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => done({ ms: Date.now() - started, out, status }));
  });
}

test('a second run over unchanged source keeps the first run\'s per-route record', async (t) => {
  const fx = makeFixture(3, () => 'Alpha');
  const server = await serve(fx.html);
  const url = `http://127.0.0.1:${server.address().port}`;
  const out = join(fx.root, '.palate-shots');
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const first = await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals']);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.ok(m1.routes, `the first run wrote no routes map (exit ${first.status})\n${first.out.slice(-1200)}`);
  assert.deepEqual(Object.keys(m1.routes).sort(), ['/p01', '/p02', '/p03']);
  for (const rec of Object.values(m1.routes)) {
    assert.match(rec.sourcesHash, /^[0-9a-f]{64}$/);
    assert.match(rec.renderedHash, /^[0-9a-f]{64}$/);
    assert.ok(Date.parse(rec.passed_at) > 0);
  }

  const second = await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals']);
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(m2.routes, m1.routes, 'the second run rewrote records it should have carried forward');
  // PER ROUTE, not the tally. The first version matched /unchanged, skipped/, which the
  // summary line also carries, so deleting the per-route line left the test green.
  for (const r of ['/p01', '/p02', '/p03']) {
    assert.match(second.out, new RegExp(`${r} unchanged, skipped`), `the second run did not name ${r} as skipped`);
  }

  // A route with a changed source is NOT skipped: the record must rest on the hash.
  writeFileSync(join(fx.root, 'src', 'pages', 'p02.astro'), '<h1>Page 02, edited</h1>\n');
  await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals']);
  const m3 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.notEqual(m3.routes['/p02'].sourcesHash, m1.routes['/p02'].sourcesHash);
  assert.notEqual(m3.routes['/p02'].passed_at, m1.routes['/p02'].passed_at);
  assert.equal(m3.routes['/p01'].passed_at, m1.routes['/p01'].passed_at, 'an untouched route was re-rendered');
});

test('--changed renders the blast radius and nothing else', async (t) => {
  // Alpha is imported by three of the thirty routes, so the blast radius is a tenth of the
  // sweep. The home-route probes cost the same in both runs, so a failure to narrow cannot
  // hide inside that fixed overhead.
  const fx = makeFixture(30, (i) => (i <= 3 ? 'Alpha' : 'Beta'));
  const server = await serve(fx.html);
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  // NO --out on either run. With no manifest there is no record to skip against, so the
  // difference measured is the narrowing alone rather than the narrowing plus the skip.
  const common = ['--url', url, '--index', fx.index, '--no-vitals', '--max-routes', '30'];
  const full = await runGate(common);
  assert.match(full.out, /: 30 route\(s\) from /, `the full sweep did not select 30 routes\n${full.out.slice(-800)}`);

  const blast = await runGate([...common, '--changed', 'src/components/Alpha.astro']);
  assert.match(blast.out, /: 3 route\(s\) from .*, narrowed by --changed/, `--changed did not narrow to the blast radius\n${blast.out.slice(-800)}`);
  assert.match(blast.out, /blast radius of 3 of 30 route\(s\)/);
  for (const r of ['/p04', '/p30']) {
    assert.ok(!blast.out.includes(`${r} @`), `${r} is outside the blast radius and was rendered anyway`);
  }
  // Printed on a pass as well as a failure: the acceptance here is a timing claim, and a
  // claim nobody can read the number behind is a claim nobody can check.
  t.diagnostic(`full sweep ${full.ms}ms over 30 route(s), blast radius ${blast.ms}ms over 3`);
  assert.ok(
    blast.ms < full.ms / 5,
    `--changed took ${blast.ms}ms against a full sweep of ${full.ms}ms, which is not under a fifth`,
  );
});

test('a file the index has never heard of falls wide and says which one', async (t) => {
  // A small fixture: this direction is about the message and the count, and paying for
  // another thirty-route sweep to read one line is the cost this whole epic is against.
  const fx = makeFixture(6, () => 'Beta');
  const server = await serve(fx.html);
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const wide = await runGate(['--url', url, '--index', fx.index, '--no-vitals',
    '--changed', 'astro.config.mjs,src/components/Beta.astro']);
  assert.match(wide.out, /verify-rendered: astro\.config\.mjs is not in the index, falling wide/);
  assert.match(wide.out, /: 6 route\(s\) from /, `an unknown file did not fall wide\n${wide.out.slice(-800)}`);
  // The known file in the same list must not narrow the run behind the unknown one's back.
  assert.ok(!/blast radius of/.test(wide.out), 'a wide fall still reported a blast radius');
});

test('--changed with no file list says so rather than quietly narrowing nothing', async (t) => {
  const fx = makeFixture(1, () => 'Alpha');
  const server = await serve(fx.html);
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const r = await runGate(['--url', `http://127.0.0.1:${server.address().port}`,
    '--index', fx.index, '--no-vitals', '--changed']);
  assert.match(r.out, /--changed was given with no file list, so nothing was narrowed/);
});

test('a change to a shared input re-renders every route and says why', async (t) => {
  // THE HOLE THE IMPORT CLOSURE LEAVES. Edit the brand tokens, globals.css, the shared layout
  // or astro.config and every route's own source is byte-identical, so every passing record
  // stays valid and a plain re-run skips the whole site while the output has moved. Relying
  // on somebody remembering --full is not a safeguard.
  const fx = makeFixture(30, (i) => (i <= 3 ? 'Alpha' : 'Beta'));
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--max-routes', '30', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const first = await runGate(common);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(m1.routes).length, 30, `the first run recorded ${Object.keys(m1.routes).length} routes\n${first.out.slice(-900)}`);

  // No page changed. Only the stylesheet the shared layout imports.
  writeFileSync(join(fx.root, 'src', 'styles', 'globals.css'), ':root { --ink: #0b0b0b; }\n');
  const second = await runGate(common);
  assert.match(second.out, /global inputs changed, all routes re-rendered/);
  assert.ok(!/unchanged, skipped/.test(second.out), 'a route was skipped after a shared input changed');
  assert.match(second.out, /across 30 rendered route\(s\)/);
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.notEqual(m2.routes['/p30'].sourcesHash, m1.routes['/p30'].sourcesHash,
    'a route that imports neither the layout nor the stylesheet kept its hash');

  // And one page on its own still narrows to itself: the global digest must not pin every
  // route open once it has changed once.
  writeFileSync(join(fx.root, 'src', 'pages', 'p01.astro'), '<h1>Page 01, edited</h1>\n');
  const third = await runGate(common);
  assert.ok(!/global inputs changed/.test(third.out), 'the shared inputs were reported as changed twice');
  assert.match(third.out, /across 1 rendered route\(s\) \(29 unchanged, skipped\)/);
  assert.match(third.out, /\/p02 unchanged, skipped/);
});

test('the brand package reached through an exports map is inside the digest', async (t) => {
  // The resolver used to join node_modules/<spec> and require the file to exist. The brand
  // package publishes tokens/tokens.css and maps the short name, so the joined path is never
  // on disk and the file dropped out with nothing printed, on every real build.
  const fx = makeFixture(3, () => 'Alpha');
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  await runGate(common);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(m1.routes).length, 3);

  writeFileSync(join(fx.root, 'node_modules', '@x', 'brand', 'tokens', 'tokens.css'),
    ':root { --brand: #0b4a6f; }\n');
  const second = await runGate(common);
  assert.match(second.out, /global inputs changed, all routes re-rendered/,
    `an exports-mapped brand token edit did not invalidate the records\n${second.out.slice(-900)}`);
  assert.ok(!/unchanged, skipped/.test(second.out), 'a route was skipped after the brand tokens changed');
});

test('a layout CSS import that cannot be resolved is named, never dropped in silence', async (t) => {
  const fx = makeFixture(1, () => 'Alpha');
  writeFileSync(join(fx.root, 'src', 'layouts', 'BaseLayout.astro'),
    '---\nimport "@nope/missing-brand/tokens.css";\n---\n<slot />\n');
  const server = await serve(fx.html);
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const r = await runGate(['--url', `http://127.0.0.1:${server.address().port}`,
    '--index', fx.index, '--no-vitals']);
  assert.match(r.out, /layout CSS import\(s\) could not be resolved and are NOT in the global digest/);
  assert.match(r.out, /@nope\/missing-brand\/tokens\.css \(in src\/layouts\/BaseLayout\.astro\)/);
});

// A blog: one entry, the [slug] route that renders it and the listing that links it. The
// closure follows imports and a page does not import its markdown, so this is the shape where
// blastRadius selected the right routes and the skip then threw them away.
function makeBlogFixture({ draft = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'palate-incremental-blog-'));
  for (const d of ['src/pages/blog', 'src/content/blog', 'src/styles', 'src/layouts', '.palate']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'blog-fixture', private: true }, null, 2));
  writeFileSync(join(root, 'src', 'styles', 'globals.css'), ':root { --ink: #1a1a1a; }\n');
  writeFileSync(join(root, 'src', 'layouts', 'BaseLayout.astro'), '---\nimport "../styles/globals.css";\n---\n<slot />\n');
  writeFileSync(join(root, 'src', 'content.config.ts'), 'export const collections = {};\n');
  writeFileSync(join(root, 'src', 'content', 'blog', 'hello.md'), '---\ntitle: Hello\n---\nFirst post.\n');
  writeFileSync(join(root, 'src', 'pages', 'blog', '[slug].astro'),
    '---\nimport { getCollection } from "astro:content";\nconst posts = await getCollection("blog");\n---\n<h1>post</h1>\n');
  writeFileSync(join(root, 'src', 'pages', 'blog', 'index.astro'),
    '---\nimport { getCollection } from "astro:content";\nconst posts = await getCollection("blog");\n---\n<h1>blog</h1>\n');

  const routes = [
    { path: '/blog', source: 'src/pages/blog/index.astro', kind: 'static', dependsOn: [], links: [] },
    { path: '/blog/[slug]', source: 'src/pages/blog/[slug].astro', kind: 'dynamic', dependsOn: [], links: [] },
  ];
  const entries = [{ id: 'hello', collection: 'blog', file: 'src/content/blog/hello.md', draft }];
  writeFileSync(join(root, '.palate', 'index.json'), JSON.stringify({
    root, routes, entries, counts: { routes: 2, entries: 1, drafts: 0 },
    links: { parsed: 0, files: 0, orphans: [], dead: [], stale: 0 },
  }, null, 2));

  const html = new Map();
  html.set('/', page('Home', filler(2)));
  html.set('/blog', page('Blog', filler(2)));
  html.set('/blog/[slug]', page('Template, not a page', filler(2)));
  html.set('/blog/hello', page('Hello', filler(2)));
  return { root, html, index: join(root, '.palate', 'index.json') };
}

test('editing a post is not skipped as unchanged', async (t) => {
  const fx = makeBlogFixture();
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const first = await runGate(common);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  // The template is rendered as a REAL post, from the index's entries, so the record is of a
  // page that exists rather than of the site's 404. The KEY is the template, which does not
  // move when the collection gains an earlier-sorting post.
  assert.deepEqual(Object.keys(m1.routes).sort(), ['/blog', '/blog/[slug]'],
    `the blog fixture recorded ${Object.keys(m1.routes)}\n${first.out.slice(-900)}`);

  writeFileSync(join(fx.root, 'src', 'content', 'blog', 'hello.md'), '---\ntitle: Hello\n---\nEdited post.\n');
  const second = await runGate([...common, '--changed', 'src/content/blog/hello.md']);
  assert.ok(!/unchanged, skipped/.test(second.out),
    `a route named by the blast radius was skipped anyway\n${second.out.slice(-900)}`);
  assert.match(second.out, /rebuilt .*index\.json first/, '--changed did not rebuild the index');
  assert.match(second.out, /rendered as a real page from the index entries: \/blog\/\[slug\] -> \/blog\/hello/,
    'the post\'s own page was never fetched');
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.notEqual(m2.routes['/blog/[slug]'].sourcesHash, m1.routes['/blog/[slug]'].sourcesHash);
  assert.notEqual(m2.routes['/blog'].sourcesHash, m1.routes['/blog'].sourcesHash);
});

test('--changed rebuilds the index, so a newly imported file still reaches its page', async (t) => {
  // Two fixes in a row is what it takes. Add an import to a page (the page renders, its own
  // source changed), then edit the newly imported file: with a stale index that file is not in
  // the index at all, so the run falls WIDE instead of narrowing to the page that imports it.
  const fx = makeFixture(3, () => 'Alpha');
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  await runGate(common);
  writeFileSync(join(fx.root, 'src', 'components', 'Gamma.astro'), '<div class="gamma">Gamma</div>\n');
  writeFileSync(join(fx.root, 'src', 'pages', 'p01.astro'),
    '---\nimport Gamma from "../components/Gamma.astro";\n---\n<Gamma />\n<h1>Page 01</h1>\n');
  await runGate([...common, '--changed', 'src/pages/p01.astro']);

  writeFileSync(join(fx.root, 'src', 'components', 'Gamma.astro'), '<div class="gamma">Gamma, edited</div>\n');
  const third = await runGate([...common, '--changed', 'src/components/Gamma.astro']);
  assert.ok(!/is not in the index, falling wide/.test(third.out),
    `the index was stale, so a real component read as unknown\n${third.out.slice(-900)}`);
  assert.match(third.out, /blast radius of 1 of 3 route\(s\)/);
});

test('a probe failure drops the record of a route that was skipped', async (t) => {
  // The no-JS, focus, hover-nav, vitals and design probes all file against `/` and run whatever
  // the route selection is. A skipped home route with a failing probe used to keep its passing
  // record and be skipped again, so the run exited 1 for ever with nothing re-rendered.
  const root = mkdtempSync(join(tmpdir(), 'palate-incremental-probe-'));
  for (const d of ['src/pages', 'src/styles', 'src/layouts', '.palate']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'probe-fixture', private: true }, null, 2));
  writeFileSync(join(root, 'src', 'styles', 'globals.css'), ':root { --ink: #1a1a1a; }\n');
  writeFileSync(join(root, 'src', 'layouts', 'BaseLayout.astro'), '---\nimport "../styles/globals.css";\n---\n<slot />\n');
  writeFileSync(join(root, 'src', 'pages', 'index.astro'), '<h1>Home</h1>\n');
  writeFileSync(join(root, 'src', 'pages', 'p01.astro'), '<h1>Page 01</h1>\n');
  writeFileSync(join(root, '.palate', 'index.json'), JSON.stringify({
    root,
    routes: [
      { path: '/', source: 'src/pages/index.astro', kind: 'static', dependsOn: [], links: [] },
      { path: '/p01', source: 'src/pages/p01.astro', kind: 'static', dependsOn: [], links: [] },
    ],
    entries: [], counts: { routes: 2, entries: 0, drafts: 0 },
    links: { parsed: 0, files: 0, orphans: [], dead: [], stale: 0 },
  }, null, 2));

  // The served HTML is what the probes read, and the source files are what the hash reads, so
  // the fixture can move the render without moving the hash. That is the real case: something
  // outside the hash changed what the page does.
  const html = new Map();
  html.set('/', page('Home', filler(2)));
  html.set('/p01', page('Page 01', filler(2)));
  const server = await serve(html);
  const out = join(root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`,
    '--index', join(root, '.palate', 'index.json'), '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

  // The hygiene floor files its own High against `/` on a fixture this bare, which would mean
  // the home route never earns a record and the test proves nothing. Turned off so the focus
  // probe is the only thing that can fail this route.
  const noFloor = { PALATE_MIN_HYGIENE: '0' };
  const first = await runGate(common, noFloor);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m1.routes).sort(), ['/', '/p01'],
    `the probe fixture recorded ${Object.keys(m1.routes)}\n${first.out.slice(-900)}`);

  // Four focusable controls with focus styling deliberately removed: the keyboard traversal
  // check files a High against `/`.
  html.set('/', page('Home', `<style>a:focus-visible{outline:none}</style>
    <p><a href="#a">one</a> <a href="#b">two</a> <a href="#c">three</a> <a href="#d">four</a></p>${filler(2)}`));
  const second = await runGate(common, noFloor);
  assert.match(second.out, /\/ unchanged, skipped/, 'the home route was not skipped, so this proves nothing');
  assert.equal(second.status, 1, `the probe did not fail the run\n${second.out.slice(-900)}`);
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(m2.routes['/'], undefined, 'a route with a High finding kept its passing record');
  assert.ok(m2.routes['/p01'], 'an unrelated route lost its record');
});

test('a wide fall sets the records aside, and an absolute path is a known file', async (t) => {
  // The wide fall used to print "falling wide" and then let the unchanged-route skip throw the
  // selection away: on a real site that rendered two routes out of eleven, neither of them one
  // the operator had touched, under a line saying everything was being checked.
  const fx = makeFixture(3, (i) => (i <= 1 ? 'Alpha' : 'Beta'));
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  await runGate(common);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(m1.routes).length, 3, 'the records were not established');

  mkdirSync(join(fx.root, 'src', 'data'), { recursive: true });
  writeFileSync(join(fx.root, 'src', 'data', 'prices.json'), '{"call-out": 120}\n');
  const wide = await runGate([...common, '--changed', 'src/data/prices.json']);
  assert.match(wide.out, /prices\.json is not in the index, falling wide/);
  assert.match(wide.out, /records are set aside for this run/);
  assert.ok(!/unchanged, skipped/.test(wide.out),
    `a wide fall skipped recorded routes anyway\n${wide.out.slice(-900)}`);
  assert.match(wide.out, /across 3 rendered route\(s\)/);

  // The path an editor hands over. Relative to the project it is a file the index knows.
  const abs = join(fx.root, 'src', 'components', 'Alpha.astro');
  writeFileSync(abs, '<div class="alpha">Alpha, edited</div>\n');
  const narrow = await runGate([...common, '--changed', abs]);
  assert.ok(!/is not in the index, falling wide/.test(narrow.out),
    `an absolute path to a known file fell wide\n${narrow.out.slice(-900)}`);
  assert.match(narrow.out, /blast radius of 1 of 3 route\(s\)/);
});

test('a run that renders nothing exits 2, skipped rather than passed', async (t) => {
  const fx = makeFixture(1, () => 'Alpha');
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const first = await runGate(common);
  assert.equal(first.status, 0, `the first run did not pass\n${first.out.slice(-900)}`);

  const nothing = await runGate(common);
  assert.match(nothing.out, /SKIPPED, not passed \(exit 2\)/);
  assert.equal(nothing.status, 2, 'a run that inspected no route reported a pass');
});

test('the run records how much of the site it covered', async (t) => {
  // NOTHING DOWNSTREAM COULD TELL A FULL SWEEP FROM A PARTIAL ONE. `public/` sits outside the
  // per-route digest, so replacing a hero photograph moves no route's hash; the mitigation is
  // the full sweep before hand-over, and until this field existed nothing recorded whether one
  // had happened. A pass from a run that rendered one route of three looked exactly like a
  // pass from one that rendered all three.
  const fx = makeFixture(3, () => 'Alpha');
  const server = await serve(fx.html);
  const url = `http://127.0.0.1:${server.address().port}`;
  const out = join(fx.root, '.palate-shots');
  const read = () => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).sweep;
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const first = await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals']);
  const s1 = read();
  assert.ok(s1, `the first run recorded no sweep (exit ${first.status})\n${first.out.slice(-900)}`);
  assert.deepEqual(
    { full: s1.full, selected: s1.selected, rendered: s1.rendered, skipped: s1.skipped, narrowed: s1.narrowed },
    { full: false, selected: 3, rendered: 3, skipped: 0, narrowed: null },
    'a run without --full rendered every route and still is not a full sweep',
  );
  assert.ok(Date.parse(s1.at) > 0, 'the sweep carries no timestamp');

  // Every route unchanged: the run exits 2 and the record says nothing was rendered, which is
  // the case that was already handled and must stay handled.
  const nothing = await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals']);
  assert.equal(nothing.status, 2);
  const s2 = read();
  assert.equal(s2.rendered, 0, 'a run that rendered nothing recorded routes it did not render');
  assert.equal(s2.skipped, 3);

  // --full is the sweep that certifies.
  await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals', '--full']);
  const s3 = read();
  assert.equal(s3.full, true, '--full over every route was not recorded as a full sweep');
  assert.equal(s3.rendered, 3);
  assert.equal(s3.skipped, 0);

  // --full OVER A BLAST RADIUS IS NOT A FULL SWEEP, and recording the flag rather than the
  // answer would have said it was. That is the same silence one layer down.
  await runGate(['--url', url, '--index', fx.index, '--out', out, '--no-vitals', '--full',
    '--changed', 'src/components/Alpha.astro']);
  const s4 = read();
  assert.equal(s4.full, false, 'a narrowed run was recorded as a full sweep');
  assert.equal(s4.requested_full, true, 'the flag as given was not recorded');
  assert.equal(s4.narrowed, 'changed');
});

test('--routes leaves the records it cannot hash alone', async (t) => {
  // Every run-site command passes --routes, so deleting the records of a route it cannot hash
  // meant one /post between two build-loop passes emptied the loop's memory.
  const fx = makeFixture(2, () => 'Alpha');
  const server = await serve(fx.html);
  const url = `http://127.0.0.1:${server.address().port}`;
  const out = join(fx.root, '.palate-shots');
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  await runGate(['--url', url, '--index', fx.index, '--no-vitals', '--out', out]);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(m1.routes).length, 2);

  await runGate(['--url', url, '--routes', '/p01', '--no-vitals', '--out', out]);
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(m2.routes, m1.routes, 'a --routes run threw away records it could not hash');
});

// A site with a real 404 route, answering 404 the way a dev server and a static host both do.
function make404Fixture(extraBody = '') {
  const root = mkdtempSync(join(tmpdir(), 'palate-incremental-404-'));
  for (const d of ['src/pages', 'src/styles', 'src/layouts', '.palate']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'nf-fixture', private: true }, null, 2));
  writeFileSync(join(root, 'src', 'styles', 'globals.css'), ':root { --ink: #1a1a1a; }\n');
  writeFileSync(join(root, 'src', 'layouts', 'BaseLayout.astro'), '---\nimport "../styles/globals.css";\n---\n<slot />\n');
  writeFileSync(join(root, 'src', 'pages', 'index.astro'), '<h1>Home</h1>\n');
  writeFileSync(join(root, 'src', 'pages', '404.astro'), '<h1>Not found</h1>\n');
  writeFileSync(join(root, '.palate', 'index.json'), JSON.stringify({
    root,
    routes: [
      { path: '/', source: 'src/pages/index.astro', kind: 'static', dependsOn: [], links: [] },
      { path: '/404', source: 'src/pages/404.astro', kind: 'static', dependsOn: [], links: [] },
    ],
    entries: [], counts: { routes: 2, entries: 0, drafts: 0 },
    links: { parsed: 0, files: 0, orphans: [], dead: [], stale: 0 },
  }, null, 2));

  const html = new Map();
  html.set('/', page('Home', filler(2)));
  // The 404 route answers 404 and the server says so, which is what makes the browser log the
  // document's own load as a console error.
  const notFound = { status: 404, body: page('Not found', `<p>No such page.</p>${extraBody}${filler(1)}`) };
  return { root, html, notFound, index: join(root, '.palate', 'index.json') };
}

function serveWith404(html, notFound) {
  const server = createServer((req, res) => {
    let path = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
    try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
    const body = html.get(path);
    if (body) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); return; }
    res.writeHead(notFound.status, { 'content-type': 'text/html' });
    res.end(notFound.body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

test('the 404 route answering 404 is not a finding, and a real error on it still is', async (t) => {
  // Every plain run and every certify sweep on the shipped template exited 1 on this: the
  // dev server answers /404 with 404, the browser logs the document's own load as a console
  // error, and the console rule filed a High at all three viewports. The operator cannot fix
  // it, so the sweep's exit code could not tell a clean site from a broken one.
  const clean = make404Fixture();
  const s1 = await serveWith404(clean.html, clean.notFound);
  t.after(() => { s1.close(); rmSync(clean.root, { recursive: true, force: true }); });
  const ok = await runGate(['--url', `http://127.0.0.1:${s1.address().port}`, '--index', clean.index,
    '--no-vitals'], { PALATE_MIN_HYGIENE: '0' });
  assert.ok(!/\/404 @\w+ +\[High\]/.test(ok.out),
    `the 404 route's own status was filed as a finding\n${ok.out.slice(-1200)}`);
  assert.equal(ok.status, 0, `a clean site with a 404 route did not pass\n${ok.out.slice(-1200)}`);

  // The other direction, which is the half that makes the exemption safe: a script error and a
  // missing subresource on the SAME page are still Highs.
  const noisy = make404Fixture('<script>console.error("a real script error")</script><img alt="x" src="/missing.png">');
  const s2 = await serveWith404(noisy.html, noisy.notFound);
  t.after(() => { s2.close(); rmSync(noisy.root, { recursive: true, force: true }); });
  const bad = await runGate(['--url', `http://127.0.0.1:${s2.address().port}`, '--index', noisy.index,
    '--no-vitals'], { PALATE_MIN_HYGIENE: '0' });
  assert.match(bad.out, /\/404 @\w+ +\[High\] +console error: a real script error/,
    `a real script error on /404 was swallowed\n${bad.out.slice(-1200)}`);
  assert.match(bad.out, /missing\.png/, 'a subresource that 404s on /404 was swallowed');
  assert.equal(bad.status, 1);
});

test('a dynamic template keeps one record key when an earlier-sorting post arrives', async (t) => {
  const fx = makeBlogFixture();
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  await runGate(common);
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.ok(m1.routes['/blog/[slug]'], `the record was filed under ${Object.keys(m1.routes)}`);

  // A post that sorts before the old representative. The template is still one route with one
  // record; keying on the rendered page would orphan the old key and render for nothing.
  writeFileSync(join(fx.root, 'src', 'content', 'blog', 'aardvark.md'), '---\ntitle: Aardvark\n---\nEarlier.\n');
  const entries = [
    { id: 'aardvark', collection: 'blog', file: 'src/content/blog/aardvark.md', draft: false },
    { id: 'hello', collection: 'blog', file: 'src/content/blog/hello.md', draft: false },
  ];
  const idx = JSON.parse(readFileSync(fx.index, 'utf8'));
  writeFileSync(fx.index, JSON.stringify({ ...idx, entries }, null, 2));
  fx.html.set('/blog/aardvark', page('Aardvark', filler(2)));

  const second = await runGate(common);
  const m2 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m2.routes).sort(), Object.keys(m1.routes).sort(),
    `the record key moved with the representative\n${second.out.slice(-900)}`);
  assert.notEqual(m2.routes['/blog/[slug]'].sourcesHash, m1.routes['/blog/[slug]'].sourcesHash,
    'a new post must still invalidate the template');
});

test('a template whose only entry is a draft is not rendered, and the run says why', async (t) => {
  // Found by sweeping the shipped template rather than by reading code. Its one post ships as
  // a draft, so nothing is built for it, and substituting it swapped a literal path that 404s
  // for an invented path that 404s: three Highs at three viewports on a page that does not
  // exist. A template with no published entry has no page.
  const fx = makeBlogFixture({ draft: true });
  fx.html.delete('/blog/hello');
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const r = await runGate(['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out], { PALATE_MIN_HYGIENE: '0' });
  assert.match(r.out, /NOT rendered, because no published entry exists.*\/blog\/\[slug\]/);
  assert.ok(!/\/blog\/hello/.test(r.out), 'a draft entry was rendered as a page');
  assert.equal(r.status, 0, `the draft template was fetched and failed\n${r.out.slice(-1200)}`);
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m.routes), ['/blog'], 'a route that was never rendered earned a record');
});

test('a run that measures no hygiene says so, rather than printing nothing', async (t) => {
  // The loop the doctrine prescribes is `--changed <files> --no-vitals`, and on a blast radius
  // that excludes `/` neither the design checks nor the vitals are computed, so the whole
  // hygiene block was skipped and three of the loop's own runs printed no hygiene line and no
  // trend line at all. Silence reads as a run with nothing to report, not as one that measured
  // nothing.
  const fx = makeFixture(3, (i) => (i <= 1 ? 'Alpha' : 'Beta'));
  const server = await serve(fx.html);
  const out = join(fx.root, '.palate-shots');
  const common = ['--url', `http://127.0.0.1:${server.address().port}`, '--index', fx.index,
    '--no-vitals', '--out', out];
  t.after(() => { server.close(); rmSync(fx.root, { recursive: true, force: true }); });

  const r = await runGate([...common, '--changed', 'src/components/Alpha.astro']);
  assert.match(r.out, /blast radius of 1 of 3 route\(s\)/, `the fixture did not narrow\n${r.out.slice(-900)}`);
  assert.match(r.out, /build hygiene was NOT measured/);
  assert.match(r.out, /the home route was not rendered this run/);
});
