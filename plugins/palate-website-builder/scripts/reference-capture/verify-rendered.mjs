#!/usr/bin/env node
/**
 * verify-rendered.mjs - the rendered, multi-viewport, real-motion gate for a BUILT site.
 *
 * The mechanical gate (ux-lint.sh) and the visual loop / reviewer pass read CODE / a
 * still. This one loads the RUNNING site in a real browser at phone / tablet / desktop
 * and asserts what only shows up when it renders. It extends the rendered gate
 * (no horizontal scroll, no console errors, no blank pages, a visible focus ring, a real
 * 404) with the BOLD-build bug-class checks from references/rendered-bug-classes.md:
 *
 *   (a) NO-JS / LCP-is-never-a-canvas: with JS disabled, the hero shows a FINISHED static
 *       state - no JS-dismissed preloader covering it, no blank <canvas> with no poster.
 *   (b) MOTION-ON reveal reaches the finished state: a REAL wheel scroll (JS on, motion
 *       on - NOT scrollTo, NOT reduced-motion) leaves 0 sections stuck at opacity:0.
 *       Reduced-motion forcing visibility MASKS this bug, so we test the default path.
 *   (c) PINNED scenes RELEASE: a pinned/fixed hero element does not overprint the footer.
 *   (f) HEAVY WebGL degrades on mobile: no above-the-fold <canvas> at 390 (the lazy-split
 *       in motion-and-3d.md Recipe 1b should serve a poster on touch/low-end).
 *
 * It lives beside capture.mjs so it reuses the same installed Playwright + Chromium.
 *
 * With --out set it also writes an ordered scroll-through FILMSTRIP for the home route at
 * mobile + desktop (<out>/filmstrip/<vp>-NN.png, viewport frames evenly spaced across the
 * scroll, captured from the SAME wheel-scroll pass - no second run). The verifier reads these
 * IN ORDER to judge motion choreography (purposeful vs absent / janky / gratuitous; restraint
 * counts) - the build-side analogue of the library's motionJudge, so the motion verdict rests
 * on the actual scroll, not a single still.
 *
 * Usage:
 *   node verify-rendered.mjs --url <base> [--routes /,/contact,/blog] [--out <dir>]
 *
 * Exit codes:
 *   0  clean (no finding at or above High), on a run that rendered at least one route
 *   1  findings at or above High
 *   2  bad arguments, OR every selected route was unchanged and no route was rendered: the run
 *      is SKIPPED, not passed, and says so
 *   3  a browser could not be launched - the gate is BLOCKED, never a pass
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
// Commerce route resolution lives with the survey that produces the catalogue.
// It is a NO-OP without one, so a brochure build is untouched.
import { resolveDynamic } from '../palate-shopify.mjs';
// The content graph already knows which routes a changed file can reach, and it fails wide
// when it cannot tell. Imported rather than reimplemented: two answers to "what does this
// change affect" is how a narrowed gate ends up narrower than the change.
import { blastRadius } from '../palate-index.mjs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { measurePage, scoreDesignFacts, DESIGN_MEASURE_VERSION, DESIGN_MEASURE_SHA } from './design-measure.mjs';
import { measureVitals, scoreVitals, VITALS_SHA } from './vitals.mjs';
import { score as scoreRubric } from './rubric.mjs';
import {
  HISTORY_FILE, DEFAULT_STALL_ITERS, basisOf, entryFor, readHistory, writeHistory,
  comparableTail, compare, detectStall, blockMessage, summaryLine,
} from './hygiene-loop.mjs';

// ----------------------------------------------------------------- args ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const base = (args.url || '').replace(/\/+$/, '');
if (!base) { console.error('verify-rendered: --url <base> is required'); process.exit(2); }
/**
 * WHICH ROUTES GET RENDERED, and why this is not a hardcoded list any more.
 *
 * It used to default to ['/', '/contact', '/blog']. Nothing in the skill passes --routes, so in
 * practice EVERY build was verified against three guessed paths, two of which often do not exist
 * on the site being built. A real 57-page storefront was reported "all gates green" while the
 * template behind 54 of those pages had never been rendered by anything, and a collection page
 * opened with a 653px band of air and zero products above the fold. Grepping HTML passed it.
 *
 * The content graph already knows every route, so ask it:
 *   - every STATIC route, because each is its own code and can fail on its own
 *   - ONE representative per DYNAMIC template, because 54 pages sharing one source fail together;
 *     rendering one catches the template, rendering all 54 buys nothing and costs minutes
 *   - never endpoints, which have nothing to render
 *
 * NO SILENT TRUNCATION. Whatever is collapsed or dropped is printed, because a gate that quietly
 * narrows its own coverage reads exactly like a gate that passed.
 */
function routesFromIndex(indexPath) {
  try {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    const all = Array.isArray(idx.routes) ? idx.routes : [];
    if (!all.length) return null;
    const statics = all.filter((r) => r.kind === 'static' && r.path);
    const dynamic = all.filter((r) => r.kind === 'dynamic' && r.path);
    const bySource = new Map();
    for (const r of dynamic) if (!bySource.has(r.source)) bySource.set(r.source, r);
    // Dynamic representatives first: each stands in for the most pages, so if anything is
    // truncated below it must not be these.
    const reps = [...bySource.values()];
    const picked = [...reps, ...statics];
    return {
      index: idx,
      picked,
      reps: reps.length,
      collapsed: dynamic.length - reps.length,
      statics: statics.length,
      endpoints: all.filter((r) => r.kind === 'endpoint').length,
    };
  } catch { return null; }
}

/**
 * Rebuild the content index in place. NEVER FATAL: a build with no src/pages, a missing script
 * or a parse failure leaves whatever index is already there and says what happened, because a
 * stale index is worse than none only when nobody is told.
 */
function rebuildIndex(projectRoot, indexPath) {
  const script = fileURLToPath(new URL('../palate-index.mjs', import.meta.url));
  try {
    execFileSync(process.execPath, [script, projectRoot, '--out', resolve(indexPath)], { stdio: 'pipe' });
    console.error(`verify-rendered: --changed rebuilt ${indexPath} first, so the blast radius and the route hashes read current source.`);
  } catch (e) {
    console.error(
      `verify-rendered: could not rebuild ${indexPath} (${(e?.message ?? e).toString().split('\n')[0]}). ` +
      'The blast radius and the route hashes are read from the index ALREADY on disk, which may be stale. ' +
      'Run palate-index.mjs yourself, or use --full.',
    );
  }
}

/**
 * WHICH OF THE SELECTED ROUTES A SET OF CHANGED FILES CAN REACH.
 *
 * The gate had no memory, so every re-run after every fix paid for the whole site again: one
 * pass ran past thirty minutes, a check failed at minute twenty-five, and the next pass
 * re-shot all of it because one file had changed. `--changed` is the answer, and the only way
 * it can be worse than no narrowing at all is by narrowing WRONG.
 *
 * So it fails wide three times over. A file the index has never heard of takes every route
 * and SAYS which file did it, because silence would read as a clean narrow. A change that
 * reaches nothing takes every route rather than rendering none, because a gate that inspected
 * nothing must never look like one that passed. And the blast radius itself comes from
 * palate-index.mjs, which already falls wide on a config file and on a dynamic import its
 * parser cannot see.
 *
 * A WIDE FALL ALSO SETS THE RECORDS ASIDE, and that is the half the first version missed. It
 * printed "falling wide", took every route, and then the unchanged-route skip threw nine of
 * eleven of them away: an unknown file is precisely one whose effect on the hashes is unknown
 * too, so the routes it touches hash as unchanged and are skipped. The run said it had widened
 * and rendered the two routes with no record, neither of them one the operator had edited.
 */
function narrowToChanged(index, picked, files) {
  const known = (f) => index.routes.some((r) => r.source === f || (r.dependsOn || []).includes(f))
    || (index.entries || []).some((e) => e.file === f);
  const unknown = files.filter((f) => !known(f));
  for (const f of unknown) console.error(`verify-rendered: ${f} is not in the index, falling wide`);
  const wide = (why) => {
    console.error(`verify-rendered: the unchanged-route records are set aside for this run, because ${why}.`);
    return { picked, concrete: new Map(), wide: true };
  };
  if (unknown.length) return wide('a changed file could not be placed in the index, so its effect on any route hash is unknown');

  const blast = blastRadius(index, files);
  // A dynamic template is selected by its own path (`/blog/[slug]`) while the blast radius names
  // the PAGE (`/blog/winter-pipes`). Keeping the template alone meant the gate fetched the
  // literal bracket path, got the site's 404, and recorded a pass for a page it never opened.
  const concrete = new Map();
  const hit = picked.filter((r) => {
    if (blast.includes(r.path)) return true;
    if (r.kind !== 'dynamic') return false;
    const stem = r.path.replace(/\/\[[^\]]+\]$/, '') + '/';
    const page = blast.find((b) => b.startsWith(stem));
    if (!page) return false;
    concrete.set(r.path, page);
    return true;
  });
  if (!hit.length) return wide('the change reaches no route in the index, and rendering nothing must never look like a pass');
  console.error(`verify-rendered: --changed ${files.join(', ')} is a blast radius of ${hit.length} of ${picked.length} route(s).`);
  return { picked: hit, concrete, wide: false };
}

/**
 * A changed file as the INDEX spells it. An editor hands over an absolute path and the index
 * stores paths relative to the project, so `/Users/.../src/components/ServiceCard.astro` read
 * as a file the index had never heard of, fell wide, and then skipped the very routes that
 * import it. Anything outside the project is left alone: it is genuinely unknown.
 */
function toProjectRelative(root, f) {
  const raw = f.replace(/^\.\//, '');
  if (!isAbsolute(raw)) return raw;
  const rel = relative(root, raw);
  return rel && !rel.startsWith('..') ? rel : raw;
}

/**
 * The page a dynamic template actually serves, from the index's own entries.
 *
 * `resolveDynamic` maps a template to a real handle from a Shopify catalogue and does nothing
 * on a brochure build, so `/blog/[slug]` was fetched literally, returned the site's 404, and
 * was recorded as a pass. The entries carry the ids palate-index wrote, so a blog can answer
 * the same question a catalogue answers for a store. Only a single trailing `[param]` is
 * substituted, and only when the route names one collection: anything less certain keeps the
 * literal path rather than inventing a URL.
 *
 * PUBLISHED ONLY, and the first version had a draft fallback that a sweep of the shipped
 * template caught immediately. The scaffold's one post ships as a draft, so nothing is built
 * for it, and substituting it swapped a literal path that 404s for an invented path that
 * 404s: three Highs on a route that does not exist. A template with no published entry has no
 * page, and the caller drops it and says so.
 */
function publishedPageFor(route, entries, root, fromBlast) {
  if (route.kind !== 'dynamic' || !/\/\[[^\]]+\]$/.test(route.path)) return null;
  const names = collectionsFor(route, root).filter((n) => n !== '*');
  const live = entries.filter((e) => e.draft !== true && (names.length !== 1 || e.collection === names[0]));
  if (fromBlast) {
    // The blast radius names the page for a CHANGED entry. A changed draft still has no page.
    const id = fromBlast.split('/').filter(Boolean).pop();
    return live.some((e) => e.id === id) ? fromBlast : null;
  }
  if (names.length !== 1) return null;
  const entry = live.find((e) => e.collection === names[0]);
  return entry ? route.path.replace(/\[[^\]]+\]$/, entry.id) : null;
}

/**
 * THE GLOBAL INPUTS: the shared files that change what EVERY route renders and that no
 * route's import closure necessarily names.
 *
 * The closure alone was not enough, and the gap was the dangerous kind. Edit the brand
 * tokens, globals.css, the shared layout, astro.config or a dependency and every route's
 * own source is byte-identical, so every passing record stays valid and a plain re-run
 * skips the whole site while the rendered output has moved underneath it. Relying on
 * somebody remembering --full is not a safeguard, it is the shape of every silent skip
 * this product has shipped.
 *
 * So the digest below is folded into every route's hash: one shared byte changes and no
 * record survives. It reads the config and the lockfile, everything under src/styles and
 * src/layouts, and the CSS those layouts import from anywhere, which is how the brand
 * package's tokens.css and fonts.css are reached without hardcoding a package name.
 *
 * A file that is absent contributes nothing, so DELETING one changes the digest as surely
 * as editing it does.
 */
const GLOBAL_FILES = [
  'astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.cjs',
  'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
];
// `src/pages/api` IS A GLOBAL INPUT, and it is the one entry here that is not shared styling.
// A page that carries the contact form does not import the endpoint: it posts to a URL. So the
// endpoint sits in no route's import closure, every page hashes the same after it is edited,
// and the form round trip below would be skipped on precisely the run where the endpoint is
// what moved. Over-reading costs a render; under-reading costs the whole point of the probe.
const GLOBAL_DIRS = ['src/styles', 'src/layouts', 'src/pages/api'];

function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

/**
 * The CSS a layout imports, resolved to real files.
 *
 * NODE'S RESOLVER, NOT A PATH JOIN, and the difference was a whole silent hole. A bare
 * specifier used to become `node_modules/<spec>` and was kept only if that path existed. The
 * brand package publishes `tokens/tokens.css` and `fonts/fonts.css` and exposes the short
 * names through an `exports` map, so `@palate-projects/<slug>-brand/tokens.css` is never on
 * disk: both files dropped out of the digest on every real build while the docs promised that
 * editing the brand tokens re-renders the site. `createRequire().resolve()` honours `exports`
 * for any subpath, `.css` included.
 *
 * AND AN IMPORT THAT CANNOT BE RESOLVED IS NAMED. That is the whole lesson of the defect: the
 * exclusion was correct-looking code doing nothing, with nothing printed.
 */
function importedCss(root, layoutFiles) {
  const out = new Set();
  const unresolved = [];
  const req = createRequire(resolve(root, 'package.json'));
  for (const f of layoutFiles) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/import\s+["']([^"']+\.css)["']/g)) {
      const spec = m[1];
      let cand = null;
      if (spec.startsWith('.')) cand = resolve(dirname(f), spec);
      else if (spec.startsWith('@/')) cand = resolve(root, 'src', spec.slice(2));
      else {
        try { cand = req.resolve(spec); }
        catch { const p = resolve(root, 'node_modules', spec); cand = existsSync(p) ? p : null; }
      }
      if (cand && existsSync(cand)) out.add(cand);
      else unresolved.push(`${spec} (in ${relative(root, f)})`);
    }
  }
  if (unresolved.length) {
    console.error(
      `verify-rendered: ${unresolved.length} layout CSS import(s) could not be resolved and are NOT in the ` +
      `global digest, so editing them will not invalidate any record: ${unresolved.join(', ')}.`,
    );
  }
  return [...out];
}

function globalInputsHash(root) {
  const layouts = walkFiles(resolve(root, 'src/layouts'));
  const files = [
    ...GLOBAL_FILES.map((f) => resolve(root, f)).filter((p) => existsSync(p)),
    ...GLOBAL_DIRS.flatMap((d) => walkFiles(resolve(root, d))),
    ...importedCss(root, layouts),
  ];
  const uniq = [...new Set(files)].sort();
  const h = createHash('sha256');
  for (const p of uniq) {
    let body;
    try { body = readFileSync(p); } catch { continue; }
    h.update(relative(root, p)); h.update('\0'); h.update(body); h.update('\0');
  }
  return { hash: h.digest('hex'), count: uniq.length };
}

/**
 * THE CONTENT A ROUTE RENDERS, which its import closure never names.
 *
 * `closure()` follows imports, and a page does not import the markdown it renders: it asks
 * for it by collection name. So blastRadius mapped `src/content/blog/x.md` to the post's
 * route and its listing exactly as its own comment promises, and then the skip compared a
 * hash that had never read the post, found it unchanged, and printed "unchanged, skipped"
 * for the very routes the operator had just named. Exit 0, nothing rendered, on any build
 * with a blog.
 *
 * The collection is read the way gate-seo reads it, from a literal getCollection call, and
 * across the closure rather than the route file alone, because a listing is often rendered by
 * a component. A route that reaches `content.config.ts` without naming a collection folds in
 * EVERY entry: that is the third case blastRadius selects, and over-reading there costs a
 * render while under-reading costs the whole point of the gate.
 *
 * Digests are memoised per collection, so a 200-post blog is read once and not once per route.
 */
const COLLECTION_CALL = /\bget(?:Collection|Entry|EntryBySlug)\s*\(\s*["'`]([\w-]+)["'`]/g;
const collectionDigests = new Map();

function collectionsFor(route, root) {
  const names = new Set();
  let reachesConfig = false;
  for (const f of [route.source, ...(route.dependsOn || [])].filter(Boolean)) {
    if (/content\.config\.(ts|js|mjs)$/.test(f)) reachesConfig = true;
    let src;
    try { src = readFileSync(resolve(root, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(COLLECTION_CALL)) names.add(m[1]);
  }
  if (!names.size && reachesConfig) names.add('*'); // every entry: see above
  return [...names].sort();
}

function collectionDigest(root, entries, name) {
  if (!collectionDigests.has(name)) {
    const h = createHash('sha256');
    const mine = entries.filter((e) => name === '*' || e.collection === name);
    for (const e of mine.sort((a, b) => a.file.localeCompare(b.file))) {
      let body;
      try { body = readFileSync(resolve(root, e.file)); } catch { body = Buffer.from('<unreadable>'); }
      h.update(e.file); h.update('\0'); h.update(body); h.update('\0');
    }
    collectionDigests.set(name, h.digest('hex'));
  }
  return collectionDigests.get(name);
}

/**
 * The identity of a route's SOURCE: the global inputs above, its own file, its whole import
 * closure (which the index has already computed) and the content entries it renders. Two runs
 * over the same bytes get the same hash, so "has this route changed since it last passed" is
 * answered by a comparison rather than by a clock. An unreadable file hashes as its own
 * marker, so DELETING an import changes the hash.
 */
function sourcesHashFor(route, root, globalHash, entries = []) {
  const h = createHash('sha256');
  h.update('global'); h.update('\0'); h.update(globalHash); h.update('\0');
  for (const f of [route.source, ...(route.dependsOn || [])].filter(Boolean).sort()) {
    let body;
    try { body = readFileSync(resolve(root, f)); } catch { body = Buffer.from('<unreadable>'); }
    h.update(f); h.update('\0'); h.update(body); h.update('\0');
  }
  for (const name of collectionsFor(route, root)) {
    h.update('collection:' + name); h.update('\0');
    h.update(collectionDigest(root, entries, name)); h.update('\0');
  }
  return h.digest('hex');
}
// Whitespace is collapsed first: a reflow is not a content change, and a hash that moves on
// every render is a hash nobody can compare.
const textHash = (s) => createHash('sha256').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex');

const MAX_ROUTES = Number(args['max-routes'] && args['max-routes'] !== 'true' ? args['max-routes'] : 14);
// --changed narrows BEFORE the cap applies. The other order would make a two-file fix compete
// with the route budget, which is the opposite of what an incremental pass is for.
let changed = args.changed && args.changed !== 'true'
  ? String(args.changed).split(',').map((s) => s.trim().replace(/^\.\//, '')).filter(Boolean)
  : null;
// The full sweep. The unchanged-route skip below is what makes a fix loop cheap, and the sweep
// before hand-over is where it must not apply: a record is only as good as the source list it
// was taken over, and a config or a dependency change is outside that list.
const FULL = args.full === 'true';
// `--changed` with nothing after it parses as the string "true", which would silently mean
// "no narrowing" on a command the operator wrote precisely to narrow.
if (args.changed === 'true') {
  console.error('verify-rendered: --changed was given with no file list, so nothing was narrowed. Pass --changed <file,...>.');
}
let routes;
// A rendered path back to the index record that produced it, which is the only place the
// route's source and its import closure are known. Empty under --routes: a hand-named route
// cannot be hashed, so it is never skipped and never recorded.
const routeOf = new Map();
let projectRoot = '.';
// The index's content entries, for the collection digest a dynamic route's hash folds in.
let indexEntries = [];
// Set by a wide fall: the records cannot be trusted for a change that could not be placed.
let setAside = false;
/**
 * THE KEY A ROUTE'S RECORD IS FILED UNDER, which is not always the path that was fetched.
 *
 * A dynamic template is rendered as a real page, and which page that is moves: with no
 * --changed the representative is the first entry of the collection in index order, so adding
 * a post that sorts earlier renamed the key from /blog/winter-pipes to /blog/<new>, orphaned
 * the old record and rendered the page again for nothing. The TEMPLATE is what the record is
 * about, and the template path does not move.
 */
const recordKeyOf = new Map();
const keyOf = (p) => recordKeyOf.get(p) ?? p;
// WHY THE SELECTION IS NOT THE WHOLE SITE, recorded rather than inferred. `routes.length` is
// the number this run looked at, and on its own it cannot say whether that WAS the site: a
// --changed blast radius, an explicit --routes list, a fall back to three guessed paths and a
// site capped by --max-routes all produce a short list for different reasons, and only one of
// them is "this site is small". The sweep record below reads these.
let narrowedBy = null;   // 'routes' | 'changed' | 'fallback' | null
let overCap = 0;         // route(s) dropped by --max-routes
if (args.routes) {
  routes = String(args.routes).split(',').map((r) => r.trim()).filter(Boolean);
  narrowedBy = 'routes';
  if (changed) console.error('verify-rendered: --routes names the routes explicitly, so --changed is ignored on this run.');
} else {
  const indexPath = args.index && args.index !== 'true' ? args.index : '.palate/index.json';
  // The index lives at <project>/.palate/index.json and its paths are relative to <project>.
  projectRoot = resolve(dirname(indexPath), '..');
  // --changed READS THE INDEX TWICE OVER, for the blast radius and for every route's import
  // closure, so a stale index narrows to the wrong routes AND leaves their records valid. The
  // failure needs two fixes to land: add an import to a page (the page renders, its own source
  // changed), then edit the newly imported file, and the page is neither selected nor
  // invalidated because dependsOn predates the import. palate-index.mjs is a static parse
  // costing well under a second, so it is rebuilt rather than trusted.
  if (changed) {
    // Spelled the way the INDEX spells it, before anything looks it up.
    changed = changed.map((f) => toProjectRelative(projectRoot, f));
    rebuildIndex(projectRoot, indexPath);
  }
  const found = routesFromIndex(indexPath);
  if (found) {
    const narrowed = changed
      ? narrowToChanged(found.index, found.picked, changed)
      : { picked: found.picked, concrete: new Map(), wide: false };
    const picked = narrowed.picked;
    setAside = narrowed.wide;
    indexEntries = Array.isArray(found.index.entries) ? found.index.entries : [];
    const catPath = args.catalogue && args.catalogue !== 'true' ? args.catalogue : '.palate/catalogue.json';
    const res = resolveDynamic(picked.map((r) => r.path), catPath);
    if (res.resolved > 0) {
      console.error(`verify-rendered: ${res.resolved} dynamic route(s) resolved to real handles from ${catPath}`);
    }
    // A dynamic template is fetched as a real page or not at all. The blast radius names the
    // page when a post changed; otherwise the index's entries name a representative, the way
    // the catalogue names one for a store. Either beats fetching `/blog/[slug]` and recording
    // the 404 it returns as a pass.
    const substituted = [];
    const unrenderable = [];
    const pairs = [];
    res.paths.forEach((p, i) => {
      if (!p.includes('[')) { pairs.push([p, picked[i]]); return; }
      const page = publishedPageFor(picked[i], indexEntries, projectRoot, narrowed.concrete.get(p));
      if (!page) { unrenderable.push(p); return; }
      substituted.push(`${p} -> ${page}`);
      recordKeyOf.set(page, p); // the record is about the template, not about today's post
      pairs.push([page, picked[i]]);
    });
    if (substituted.length) {
      console.error(`verify-rendered: ${substituted.length} dynamic template(s) rendered as a real page from the index entries: ${substituted.join(', ')}`);
    }
    if (unrenderable.length) {
      console.error(
        `verify-rendered: ${unrenderable.length} dynamic template(s) NOT rendered, because no published entry ` +
        `exists to render them as a real page: ${unrenderable.join(', ')}. Fetching the literal path returns the ` +
        'site\'s 404 and would be reported as a build fault. Publish an entry, or pass --routes to name a page.',
      );
    }
    routes = pairs.slice(0, MAX_ROUTES).map(([path]) => path);
    routes.forEach((p, i) => routeOf.set(p, pairs[i][1]));
    const dropped = pairs.length - routes.length;
    overCap = dropped;
    if (changed) narrowedBy = 'changed';
    const over = dropped > 0 ? `, ${dropped} NOT rendered, over --max-routes ${MAX_ROUTES}` : '';
    // A narrowed run gets its own sentence. The index-wide tallies below describe the whole
    // site, and printed against a blast-radius count they read as a contradiction.
    console.error(changed
      ? `verify-rendered: ${routes.length} route(s) from ${indexPath}, narrowed by --changed${over}`
      : `verify-rendered: ${routes.length} route(s) from ${indexPath} ` +
        `(${found.reps} dynamic template representative(s) standing in for ${found.reps + found.collapsed} page(s), ` +
        `${found.statics} static, ${found.endpoints} endpoint(s) not rendered)${over}`);
  } else {
    routes = ['/', '/contact', '/blog'];
    narrowedBy = 'fallback';
    console.error(
      `verify-rendered: no readable ${indexPath}, so falling back to ${routes.join(', ')}. ` +
      'THESE ARE GUESSES AND MAY NOT EXIST. Run palate-index.mjs first, or pass --routes, ' +
      'or this gate is checking three paths instead of your site.',
    );
  }
}
const outDir = args.out && args.out !== 'true' ? args.out : '';
if (outDir) mkdirSync(outDir, { recursive: true });

/**
 * THE UNCHANGED-ROUTE SKIP.
 *
 * The shots manifest carries a `{ sourcesHash, renderedHash, passed_at }` per route, written
 * only for a route that rendered clean. A route whose sources hash to the same value has
 * nothing new to say, so it is not rendered again and the run says so per route.
 *
 * The record is the ONLY thing trusted here. It is dropped the moment a route fails, so the
 * next run cannot skip the route that broke, and it is ignored entirely under --full.
 *
 * WHAT IT DOES NOT COVER, said plainly because the skip is only safe while this is understood:
 * the hash is taken over the route's own source, its import closure and the global inputs
 * (see globalInputsHash above). Remote content, public/ assets and environment values are
 * outside all three, so an unchanged source can still render differently. That is why the
 * sweep before hand-over runs --full, and why any file the index does not know falls wide
 * rather than narrow.
 */
const shotsManifest = outDir ? `${outDir}/manifest.json` : '';
let priorRoutes = {};
let priorGlobal = '';
if (shotsManifest) {
  try {
    const m = JSON.parse(readFileSync(shotsManifest, 'utf8'));
    if (m && typeof m.routes === 'object' && m.routes && !Array.isArray(m.routes)) priorRoutes = m.routes;
    if (typeof m?.globalInputs === 'string') priorGlobal = m.globalInputs;
  } catch { /* no manifest yet, or an unreadable one: nothing is skipped, which is the safe way to be wrong */ }
}
// Recorded alongside the routes purely so the run can SAY why every record went. Folding the
// digest into each hash is what invalidates them; without this the operator would see thirty
// routes re-render and no reason given.
const globalInputs = globalInputsHash(projectRoot);
if (priorGlobal && priorGlobal !== globalInputs.hash) {
  console.error(
    `verify-rendered: global inputs changed, all routes re-rendered (${globalInputs.count} shared file(s): ` +
    'the config and lockfile, src/styles, src/layouts, src/pages/api and the CSS those layouts import).',
  );
}
const sourcesHashes = new Map();
const skipped = [];
for (const p of routes) {
  const r = routeOf.get(p);
  if (!r) continue; // no index record behind this route, so it cannot be hashed and always renders
  const sh = sourcesHashFor(r, projectRoot, globalInputs.hash, indexEntries);
  sourcesHashes.set(p, sh);
  const prior = priorRoutes[keyOf(p)];
  if (!FULL && !setAside && prior && prior.sourcesHash === sh && prior.passed_at) skipped.push(p);
}
for (const p of skipped) console.error(`verify-rendered: ${p} unchanged, skipped`);
const rendering = routes.filter((p) => !skipped.includes(p));
if (skipped.length) {
  console.error(
    `verify-rendered: ${skipped.length} of ${routes.length} route(s) unchanged since their last passing render. ` +
    'Pass --full to render every one; the sweep before hand-over should.',
  );
}
if (skipped.includes('/')) {
  console.error(
    'verify-rendered: the home route was skipped, so build hygiene, the design measurement and the ' +
    'accessibility pass on / are UNMEASURED this run. --full measures them.',
  );
}

/**
 * WHAT THIS RUN ACTUALLY COVERED, written down where a gate can read it.
 *
 * Two accepted rulings met here and neither could see the other. The first: `public/**` stays
 * out of the per-route digest, because an asset swap sits with remote content and the full
 * sweep before hand-over is what covers it. The second: nothing recorded whether the last run
 * WAS a full sweep, so that mitigation was a sentence of doctrine and nothing more.
 *
 * The narrow case was already honoured, and still is: if EVERY selected route is unchanged,
 * `rendering` is empty and the run exits 2 saying SKIPPED, not passed. The case that was
 * invisible is the ordinary one. Change an image in `public/` and anything else at the same
 * time, the other thing renders, the run exits 0, and the routes whose only change was the
 * image are skipped. A pass from a run that rendered one route of twelve then looked exactly
 * like a pass from one that rendered all twelve.
 *
 * So the run records its own coverage. It does NOT fail a partial sweep: a partial sweep is
 * the whole point of the incremental path and blocking on it would delete the optimisation.
 * It makes the coverage LEGIBLE, so gate-done can say which it was rather than imply the
 * larger one.
 *
 * `full` is the derived answer to "did this cover the site", not the flag: --full over a
 * --changed blast radius, or over a site capped by --max-routes, is not a full sweep and
 * saying it was would be the same silence one layer down.
 */
const sweep = {
  full: FULL && !narrowedBy && overCap === 0,
  requested_full: FULL,
  narrowed: narrowedBy,
  selected: routes.length,
  rendered: rendering.length,
  skipped: skipped.length,
  over_cap: overCap,
  at: new Date().toISOString(),
};
if (!rendering.length) {
  console.error(
    'verify-rendered: every selected route was unchanged since its last passing render, so NO route was ' +
    'rendered this run. The home-route and 404 probes below still ran. Pass --full for a complete sweep.',
  );
}
// The rendered text of each route at desktop, for the record's renderedHash.
const renderedText = new Map();

const VIEWPORTS = {
  mobile:  { width: 390,  height: 844  },
  tablet:  { width: 834,  height: 1112 },
  desktop: { width: 1440, height: 900  },
};
// The values the form round trip types in. Deliberately readable as a test if one ever does
// escape to a real inbox, and example.com because it is the reserved domain for exactly this.
const SAMPLE_FORM = {
  name: 'Palate verify',
  email: 'verify@example.com',
  message: 'Automated round-trip check from the Palate site verifier. Nothing to action.',
  tel: '0400000000',
  url: 'https://example.com',
  date: '2030-01-01',
};
// Console / request noise that is not the build's fault (third-party, favicon).
const IGNORE = [/turnstile/i, /challenges\.cloudflare/i, /humblytics/i, /plausible/i, /google-analytics/i, /googletagmanager/i, /favicon/i];
const ignored = (s) => IGNORE.some((re) => re.test(s || ''));

/**
 * ROUTES WHOSE OWN HTTP STATUS IS NOT 200 BY DESIGN, and the one console error that follows.
 *
 * A 404 page answers 404. That is the whole point of it, and the browser logs the document's
 * own load as a console error, which the console rule filed as a High at all three viewports.
 * On the shipped template every plain run and every certify sweep therefore exited 1 on a
 * finding no operator can fix, which makes the sweep's exit code useless: the one number the
 * hand-over rests on could not distinguish a clean site from a broken one.
 *
 * SCOPED AS NARROWLY AS IT CAN BE. It is dropped only when all four hold: the route is one
 * whose status is expected to be non-200, the navigation actually returned THAT status, the
 * error is a console entry whose location is the navigation URL itself (a subresource that
 * 404s on the same page has its own URL and still fires), and its text is the resource-load
 * failure carrying that status. A real script error on /404 has the same location and
 * different text, so it is still a High. Verified both directions in the suite.
 */
const EXPECTED_STATUS = new Map([['/404', 404], ['/500', 500]]);
function expectedStatusNoise(route, status, e) {
  const want = EXPECTED_STATUS.get(route);
  if (!want || status !== want) return false;
  if (!e || e.kind !== 'console' || e.loc !== base + route) return false;
  return /failed to load resource/i.test(e.raw || '') && new RegExp(`status of ${want}\\b`).test(e.raw || '');
}

const findings = [];
const add = (sev, route, vp, msg) => findings.push({ sev, route, vp, msg });
const RANK = { High: 3, Medium: 2, Cosmetic: 1 };
// OBJECTIVE, low-false-positive interaction failures for the enforce-on-evidence hook
// (hooks/palate-stop.mjs reads <proj>/.palate-shots/interaction.json and blocks on a
// non-empty list). Only the checks that rest on an explicit signal go here (a focusable
// visible control with no focus ring; an aria-expanded nav that never opens / won't dismiss);
// softer interaction signals stay advisory in findings[] for the verifier to judge.
const interactionFailures = [];
// Computed-style design facts, keyed by viewport. Collected on the home route only: the
// palette, the type scale and the mobile control sizes are properties of the design system,
// not of a route, and measuring every route would multiply the cost for the same answer.
const designFacts = {};
// Routes that carry a contact form, found at desktop and submitted once each after the loop.
// Collected rather than probed in place, because a submit belongs in its own context: the
// smoke header goes on every request a page makes, and the audit pass must not carry it.
const formRoutes = [];
// Routes carrying a VISIBLE form the probe could not classify, and routes whose only contact
// form is hidden at desktop. Both are reported rather than filed as findings: neither is a
// fault in the site, and a build blocked by one is a build whose whole interaction pass gets
// switched off.
const unrecognisedForms = [];
const hiddenOnlyFormRoutes = [];
// One nav is usually one shared header, so the same fault would otherwise be filed once per
// route. Keyed on the check and the control's label, and the route named is the first it was
// seen on.
const navSeen = new Set();
// Spelled out rather than composed, so every check name this gate can emit is greppable. The
// docs guard and hooks/palate-stop.mjs both key on these strings, and a name assembled at
// runtime is a name no static check can find.
//
// THE TWO SEVERITIES ARE THE WHOLE JUDGEMENT HERE.
//
//   open           HIGH, and it blocks. A burger or a dialog trigger that opens nothing is a
//                  dead control. There is no design in which that is deliberate.
//   escape-dismiss MEDIUM, and it does NOT block. A nav that closes only from its own button
//                  is a real accessibility fault and a common, deliberate implementation; the
//                  disclosure pattern does not require Escape, only the dialog and menu-button
//                  patterns do. Blocking a client's build on it would get the whole
//                  interaction pass switched off, which costs more than the finding is worth.
//                  It is reported, and the operator decides.
const DISCLOSURE_CHECKS = {
  dialog: {
    open: { check: 'dialog-open', sev: 'High' },
    'escape-dismiss': { check: 'dialog-escape-dismiss', sev: 'Medium' },
  },
  'mobile nav': {
    open: { check: 'mobile-nav-open', sev: 'High' },
    'escape-dismiss': { check: 'mobile-nav-escape-dismiss', sev: 'Medium' },
  },
};

// ------------------------------------------------------------------ axe ----
// The accessibility checks the GRADER scores, run locally against the same
// rendered page. The rule list is explicit rather than axe's default set for two
// reasons: the results stay deterministic across axe versions, and every rule here
// maps to a check the grader actually weights, so a build that clears this gate
// cannot lose those points on a re-grade.
//
// WHY THIS RUNS AT EVERY VIEWPORT. Our own contrast sweep ran only at 412px, where
// the nav collapses to a burger, so the desktop nav CTA (white on persimmon, 3.74:1,
// on every page) was never rendered and never tested. A hover-only control and a
// closed mobile sheet hid two more. An accessibility pass only ever tests what is on
// screen when it runs, so it runs at all three.
//
// Only `violations` count. Axe reports text over imagery and gradients as
// `incomplete`, which is a request for a human look, not a failure.
const AXE_RULES = {
  // grader: text_contrast (3.08 overall pts). The grader reads this as a BINARY off
  // Lighthouse's axe audit: ONE failing node anywhere zeroes 22 of the 100
  // accessibility points. There is no partial credit, so there is no soft version.
  'color-contrast':        { check: 'text_contrast' },
  // grader: control_accessible_names (2.80)
  'button-name':           { check: 'control_accessible_names' },
  'link-name':             { check: 'control_accessible_names' },
  'input-button-name':     { check: 'control_accessible_names' },
  'select-name':           { check: 'control_accessible_names' },
  // grader: forms_and_errors (1.40). Catches the programmatic label association that
  // the placeholder-as-label and input-missing-name lints cannot see at runtime.
  'label':                 { check: 'forms_and_errors' },
  'form-field-multiple-labels': { check: 'forms_and_errors' },
  // grader: structure_and_landmarks (1.96) + quotable_chunk_structure (1.96)
  'html-has-lang':         { check: 'structure_and_landmarks' },
  'document-title':        { check: 'structure_and_landmarks' },
  'image-alt':             { check: 'structure_and_landmarks' },
  'landmark-one-main':     { check: 'structure_and_landmarks' },
  'heading-order':         { check: 'quotable_chunk_structure' },
};

// Resolve axe-core once. A MISSING DEPENDENCY IS A BLOCKED GATE, NOT A PASS: every
// silent-skip in this product's history (the taste head gated on a capture verdict, the
// design ladder waiting on a token nobody set, the motion probe reading only declared
// CSS) reported a clean result while measuring nothing, and each one cost more to find
// than it would have to fail loudly on day one.
let axeSource = null, axeLoadError = null;
try {
  axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
} catch (e) {
  axeLoadError = e && e.message ? e.message : String(e);
}

async function runAxe(page, route, vpName) {
  if (!axeSource) return;
  let res;
  try {
    await page.addScriptTag({ content: axeSource });
    res = await page.evaluate(
      (rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }),
      Object.keys(AXE_RULES),
    );
  } catch (e) {
    // A page that cannot be scanned has not passed. Say so.
    add('High', route, vpName, 'accessibility scan could not run on this route (' + (e && e.message ? e.message : e) + '). This is UNMEASURED, not clean.');
    return;
  }
  for (const v of res.violations || []) {
    const meta = AXE_RULES[v.id];
    if (!meta) continue;
    const n = v.nodes.length;
    // The first offending selector is what makes this actionable rather than a count.
    const where = v.nodes[0] && v.nodes[0].target ? String(v.nodes[0].target[0]).slice(0, 120) : 'unknown element';
    const extra = v.nodes[0] && v.nodes[0].failureSummary
      ? ' ' + v.nodes[0].failureSummary.replace(/\s+/g, ' ').replace(/^Fix any of the following:\s*/i, '').slice(0, 200)
      : '';
    const msg = 'a11y ' + v.id + ' [grader: ' + meta.check + ']: ' + n + ' node' + (n === 1 ? '' : 's') + ', first at `' + where + '`.' + extra;
    add('High', route, vpName, msg);
    // `msg` is the field the stop hook samples when it blocks. Without it the hook
    // prints [object Object], which blocks the build while telling the agent nothing
    // it can act on, and an unfixable block just gets the gate switched off.
    interactionFailures.push({ msg: route + ' @' + vpName + ': ' + msg, route, viewport: vpName, rule: v.id, check: meta.check, nodes: n, target: where });
  }
}

// --------------------------------------------------------------- launch ----
// GPU off is the FAST default. --disable-software-rasterizer also kills CPU
// WebGL, so a WebGL hero would render blank; the pre-detect below switches the
// audit to software WebGL only when the home route actually mounts a <canvas>.
const GPU_OFF_ARGS = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'];
// Software WebGL (ANGLE + SwiftShader). --use-angle=swiftshader-webgl AND
// --enable-unsafe-swiftshader are both required on current (post-Chrome-139)
// Chromium, where the automatic SwiftShader WebGL fallback was removed.
const WEBGL_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];

// One cheap pre-detect launch: does the home route mount a substantial <canvas>?
// If so the whole audit runs under software WebGL so its screenshots are truthful
// (the per-route assertions are GPU-agnostic). Detecting first keeps the slow
// software path off the many non-WebGL builds and the multi-route audit.
async function detectWebGL() {
  let b;
  try {
    b = await chromium.launch({ headless: true, channel: 'chromium', args: GPU_OFF_ARGS });
    const page = await (await b.newContext({ viewport: VIEWPORTS.desktop })).newPage();
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));
    return await page.evaluate(() => {
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.width > 200 && r.height > 160) return true;
      }
      return false;
    });
  } catch { return false; }
  finally { try { if (b) await b.close(); } catch {} }
}

let browser;
try {
  const webgl = await detectWebGL();
  if (webgl) console.error('verify-rendered: WebGL/canvas hero detected; running the audit under software WebGL (SwiftShader).');
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: webgl ? WEBGL_ARGS : GPU_OFF_ARGS,
  });
} catch (e) {
  console.error('verify-rendered: could not launch a browser (' + (e && e.message ? e.message : e) + ').');
  console.error('verify-rendered: run scripts/reference-capture/setup.sh, or run this gate where a browser is available. This is BLOCKED, not a pass.');
  process.exit(3);
}

// Announced once, before the audit, so it cannot be mistaken for a clean accessibility
// result buried in a long report.
if (!axeSource) {
  console.error('verify-rendered: axe-core is not installed (' + axeLoadError + '); accessibility is UNMEASURED.');
  console.error('verify-rendered: run scripts/reference-capture/setup.sh. These checks are worth 9.2 of the 100 points the grader scores, and contrast alone zeroes 22 of the accessibility dimension on a single failing node.');
  add('High', '-', 'all', 'accessibility was NOT measured: axe-core is not installed (' + axeLoadError + '). Run scripts/reference-capture/setup.sh. Treat this build as unverified for contrast, control names, form labels and landmarks.');
}

// --------------------------------------------------------------- audit -----
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport: vp });
  for (const route of rendering) {
    const page = await context.newPage();
    // Kept as { text, loc, kind } rather than a formatted string, because whether the
    // document's own load error is a finding depends on the status the navigation returned,
    // and that is not known until goto resolves. See expectedStatusNoise below.
    const errors = [];
    const webglChunkError = { hit: false };
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // "Failed to load resource" errors carry the URL in location(), not the text,
      // so check both before deciding it is the build's fault.
      const loc = (m.location && m.location().url) || '';
      if (ignored(m.text()) || ignored(loc)) return;
      errors.push({ kind: 'console', loc, text: 'console error: ' + m.text(), raw: m.text() });
    });
    page.on('pageerror', (e) => errors.push({ kind: 'page', loc: '', text: 'page error: ' + (e && e.message ? e.message : e) }));
    page.on('requestfailed', (r) => {
      if (ignored(r.url())) return;
      errors.push({ kind: 'request', loc: r.url(), text: 'request failed: ' + r.url() });
      if (/three|webgl|r3f|fiber|drei/i.test(r.url())) webglChunkError.hit = true;
    });

    let status = 0;
    try {
      const resp = await page.goto(base + route, { waitUntil: 'load', timeout: 20000 });
      status = resp ? resp.status() : 0;
    } catch (e) {
      add('High', route, vpName, 'navigation failed: ' + (e && e.message ? e.message : e));
      await page.close();
      continue;
    }
    if (status >= 500) add('High', route, vpName, 'server returned ' + status);

    // Bug-class (b): a REAL wheel scroll down the page (JS on, motion on), then settle,
    // so reveal animations actually fire on the DEFAULT path - reduced-motion / scrollTo
    // both MASK a reveal stuck at opacity:0 (references/rendered-bug-classes.md).
    // On the home route at mobile + desktop, capture an ordered scroll-through filmstrip
    // from this SAME pass (no second run) so the verifier can judge motion CHOREOGRAPHY in
    // order, not from a single still (the motionJudge gap; see the header).
    let filmstrip = null;
    if (outDir && route === '/' && (vpName === 'mobile' || vpName === 'desktop')) {
      const fdir = outDir + '/filmstrip';
      mkdirSync(fdir, { recursive: true });
      filmstrip = { dir: fdir, prefix: vpName, max: 6 };
    }
    await realWheelScroll(page, filmstrip);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) add('High', route, vpName, 'horizontal scroll: content is ' + overflow + 'px wider than the viewport');

    /**
     * ASYMMETRIC DEAD SPACE. A band whose content is pinned to one side while the other side
     * is a vast void is an unfinished layout, and it reads as one.
     *
     * WHY A GATE AND NOT A JUDGEMENT. On a real client build, variant 1 left 892px of a 1440px
     * screen empty on 12 of 19 bands, with content running 148px to 548px. Two independent
     * judges flagged it before the client saw it, and no gate caught it, so it shipped into the
     * preview anyway. It is the rung a client reads first.
     *
     * THE DISTINCTION THAT MAKES THIS SAFE IS SYMMETRY, NOT WIDTH. A deliberately narrow
     * measure is good typography: a 640px column centred in 1440px leaves 400px on each side
     * and is correct. The same 640px pinned left, leaving 800px on the right, is not a
     * decision, it is a layout that was never finished. So this measures the BALANCE of the
     * gaps, never how much of the screen is used, and a centred band can be as narrow as it
     * likes without ever tripping it.
     *
     * Desktop only: there is no void to leave at 390px. Full-bleed backgrounds are irrelevant
     * because only the CONTENT box is measured, and a section with almost nothing in it is
     * skipped rather than guessed at.
     */
    if (vpName === 'desktop') {
      const voids = await page.evaluate(() => {
        const root = document.querySelector('main') || document.body;
        if (!root) return [];
        const out = [];
        const bands = [...root.children].filter((el) => el.nodeType === 1);
        for (const band of bands) {
          const br = band.getBoundingClientRect();
          if (br.width < 600 || br.height < 120) continue; // not a full-width band
          // The content box is the union of what is actually DRAWN: text runs and media. A
          // wrapper div with a background is not content, which is the whole reason this reads
          // leaves rather than containers.
          let min = Infinity, max = -Infinity, seen = 0;
          const walk = document.createTreeWalker(band, NodeFilter.SHOW_ELEMENT);
          for (let el = walk.nextNode(); el; el = walk.nextNode()) {
            const kids = [...el.children];
            const isLeafText = kids.length === 0 && (el.textContent || '').trim().length > 1;
            const isMedia = /^(IMG|SVG|VIDEO|CANVAS|PICTURE)$/.test(el.tagName);
            if (!isLeafText && !isMedia) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            min = Math.min(min, r.left); max = Math.max(max, r.right); seen++;
          }
          if (seen < 2 || !isFinite(min)) continue; // nothing measurable: say nothing
          const left = Math.round(min - br.left);
          const right = Math.round(br.right - max);
          const used = Math.round(max - min);
          // Both conditions must hold: the band is mostly empty AND the emptiness is lopsided.
          const mostlyEmpty = used < br.width * 0.6;
          const lopsided = Math.abs(left - right) > br.width * 0.25;
          if (mostlyEmpty && lopsided) {
            out.push({ used, left, right, w: Math.round(br.width), tag: band.tagName.toLowerCase(), id: band.id || null });
          }
        }
        return out;
      });
      if (voids.length >= 2) {
        const worst = voids.slice().sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right))[0];
        const side = worst.right > worst.left ? 'right' : 'left';
        add('Medium', route, vpName,
          voids.length + ' band(s) leave a one-sided void: content uses ' + worst.used + 'px of ' +
          worst.w + 'px with ' + Math.max(worst.left, worst.right) + 'px empty on the ' + side +
          '. Either bring something alongside it (a figure, a second column, a pull-quote), widen the measure, or centre the band so the emptiness is symmetrical and reads as a choice.');
      }
    }

    /**
     * REPEATED SILHOUETTES. Two consecutive sections drawn as the same shape.
     *
     * WHY THIS IS A GATE. A real client build shipped service pages carrying two identical
     * five-card grids back to back, one for the products and one for the reasons to choose
     * them. Every gate passed: the markup was correct, the copy was correct, the contrast was
     * correct. What was wrong was the rhythm, and rhythm is the one thing nothing measured, so
     * it reached the client as a page that reads as one long grid with a heading in the middle.
     *
     * ALL FOUR CRITERIA MUST HOLD, and that is what keeps it quiet. Two sections match only
     * when the main repeating container has the SAME NUMBER of children, laid out over the SAME
     * NUMBER of columns, in a section of the SAME ASPECT within ten per cent, on the SAME
     * GROUND. A card grid followed by a three-column grid does not fire; the same grid twice
     * does. Only CONSECUTIVE sections compare, because a shape repeated with a different band
     * between them is a returning motif rather than a stutter.
     *
     * THE REPEATING CONTAINER NEEDS AT LEAST THREE CHILDREN. Below that the four criteria are
     * too weak to tell a repeated shape from two ordinary bands that happen to sit on the same
     * ground, and a check that fires on those gets switched off, which is worse than not having
     * it. Desktop only, for the same reason the dead-space check is: at 390px every grid
     * collapses to one column and every section is the same silhouette by definition.
     *
     * `data-palate-repeat="deliberate"` is the escape hatch, and it is reported rather than
     * silent: a repeat somebody chose is a design decision, and the note says who claimed it.
     */
    if (vpName === 'desktop') {
      const sil = await page.evaluate(() => {
        const marked = [...document.querySelectorAll('[data-section-id]')]
          .filter((el) => !(el.parentElement && el.parentElement.closest('[data-section-id]')));
        let sections = marked;
        if (!sections.length) {
          const root = document.querySelector('main') || document.body;
          sections = root ? [...root.children].filter((el) => /^(SECTION|HEADER|FOOTER)$/.test(el.tagName)) : [];
        }
        const name = (el, i) => el.getAttribute('data-section-id')
          || (el.id ? el.tagName.toLowerCase() + '#' + el.id : el.tagName.toLowerCase() + '[' + i + ']');

        const shapes = sections.map((el, i) => {
          const r = el.getBoundingClientRect();
          const label = name(el, i);
          const deliberate = el.getAttribute('data-palate-repeat') === 'deliberate';
          if (r.width < 300 || r.height < 80) return { label, deliberate, shape: null };
          // The main repeating container: the element inside the section with the most direct
          // children of ONE tag. That is the card grid, the list, the column set - whatever the
          // section actually repeats - without needing to know a class name.
          let best = null;
          const all = [el, ...el.querySelectorAll('*')];
          for (const node of all) {
            const byTag = new Map();
            for (const kid of node.children) byTag.set(kid.tagName, (byTag.get(kid.tagName) || 0) + 1);
            for (const [tag, n] of byTag) {
              if (n >= 3 && (!best || n > best.n)) best = { node, tag, n };
            }
          }
          if (!best) return { label, deliberate, shape: null };
          const kids = [...best.node.children].filter((k) => k.tagName === best.tag);
          const track = getComputedStyle(best.node).gridTemplateColumns;
          let columns;
          if (track && track !== 'none' && track.trim()) {
            columns = track.trim().split(/\s+/).length;
          } else {
            // Not a grid: the first visual row IS the column count.
            const top = kids[0].getBoundingClientRect().top;
            columns = kids.filter((k) => Math.abs(k.getBoundingClientRect().top - top) <= 4).length;
          }
          return {
            label, deliberate,
            shape: {
              children: best.n,
              columns,
              aspect: r.width / r.height,
              ground: getComputedStyle(el).backgroundColor,
            },
          };
        });

        const hits = [], notes = [];
        for (let i = 0; i + 1 < shapes.length; i++) {
          const a = shapes[i], b = shapes[i + 1];
          if (!a.shape || !b.shape) continue;
          if (a.shape.children !== b.shape.children) continue;
          if (a.shape.columns !== b.shape.columns) continue;
          const hi = Math.max(a.shape.aspect, b.shape.aspect);
          if (!(hi > 0) || Math.abs(a.shape.aspect - b.shape.aspect) / hi > 0.10) continue;
          if (a.shape.ground !== b.shape.ground) continue;
          const claimed = a.deliberate ? a.label : (b.deliberate ? b.label : null);
          if (claimed) notes.push({ a: a.label, b: b.label, claimed });
          else hits.push({ a: a.label, b: b.label, children: a.shape.children, columns: a.shape.columns });
        }
        return { hits, notes };
      });
      for (const h of sil.hits) {
        const why = 'same child count (' + h.children + '), same columns (' + h.columns +
          '), aspect within 10%, same ground';
        const msg = 'repeated silhouette: sections ' + h.a + ' and ' + h.b +
          ' are drawn as the same shape (' + why + '). Two consecutive sections with one ' +
          'silhouette read as one long grid with a heading in the middle. Change the second: ' +
          'a different column count, a list or a single wide statement, media on one side, or ' +
          'another ground. If the repeat is the point, mark the section data-palate-repeat="deliberate".';
        add('High', route, vpName, msg);
        interactionFailures.push({
          msg: route + ' @' + vpName + ': ' + msg,
          route, viewport: vpName, rule: 'repeated-silhouette',
          page: route, sections: [h.a, h.b], why,
        });
      }
      for (const n of sil.notes) {
        add('Cosmetic', route, vpName,
          'repeated silhouette: sections ' + n.a + ' and ' + n.b + ' share a silhouette, and ' +
          n.claimed + ' is marked data-palate-repeat="deliberate", so it is not a finding.');
      }
    }

    /**
     * THE FIRST SCREEN. Does this page show anything it is FOR, before you scroll?
     *
     * A collection page shipped with a 653px masthead that pushed the first product image to
     * 917px, so at a 900px viewport it opened with zero products visible. On a collection page.
     * Every text gate passed it, because the markup was fine: the bug was entirely geometric.
     *
     * WHAT COUNTS AS CONTENT IS THE WHOLE DIFFICULTY. That masthead contained a heading, a
     * paragraph AND a nav list of sibling collections, so anything that counts headings, text or
     * list items would have called it content-rich and passed. What it did not contain was a
     * single thing the page exists to show. So: media and real controls, never anything inside a
     * header or a nav, and headings never count, because a masthead IS headings.
     *
     * Positions are document-relative, so this is unaffected by the scroll above.
     */
    const firstScreen = await page.evaluate(() => {
      const vh = window.innerHeight;
      const root = document.querySelector('main') || document.body;
      if (!root) return null;
      const sel = 'img, picture, video, canvas, [style*="background-image"], ' +
                  'a[href]:not([href^="#"]), button, input, select, textarea';
      const inChrome = (el) => !!el.closest('nav, header, [role="navigation"], [role="banner"]');
      let firstY = null, total = 0;
      for (const el of root.querySelectorAll(sel)) {
        if (inChrome(el)) continue;
        const r = el.getBoundingClientRect();
        // Ignore what is not actually painted: zero-size nodes, and tracking pixels.
        if (r.width < 24 || r.height < 24) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        const y = Math.round(r.top + window.scrollY);
        total++;
        if (firstY === null || y < firstY) firstY = y;
      }
      return { firstY, total, vh };
    });
    /**
     * IMAGES: SHOWN LARGER THAN THEY EXIST, OR NOT SHOWN AT ALL.
     *
     * A photo stretched past its own pixels reads as "cheap" long before anyone can say why,
     * and it is invisible in source: the markup is correct, the CSS is correct, and only the
     * relationship between the file and the box it landed in is wrong. Nothing in the plugin
     * measured it (`naturalWidth` appeared nowhere), so a 800px photo in a 1440px full-bleed
     * shipped looking soft with every gate green.
     *
     * A broken image is caught here too, because `complete && naturalWidth === 0` is the only
     * reliable signal and it needs a real browser: a 404ed <img> still parses fine.
     */
    const imgs = await page.evaluate(() => {
      const out = { upscaled: [], broken: [], cropped: [] };
      for (const im of document.querySelectorAll("img")) {
        const r = im.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) continue;
        const style = getComputedStyle(im);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const src = (im.currentSrc || im.src || "").split("/").pop().slice(0, 48);
        if (im.complete && im.naturalWidth === 0) { out.broken.push(src); continue; }
        if (!im.naturalWidth) continue;                       // still loading: not a finding

        // CROPPED BY HAND, WITHOUT object-fit. A real build cropped a photo with
        // `position:absolute; width:408.51%; left:-187.23%; top:-30.44%` inside an
        // overflow:hidden box and used NO object-fit at all, so the cover-crop maths below is
        // structurally blind to it. Those magic percentages are the tell: they are an agent
        // working around a photograph that does not fit the slot it already committed to.
        //
        // Measuring the geometry instead of the technique catches both. Compare the image's own
        // box against the nearest ancestor that actually clips, so whatever is outside it is
        // simply not on screen, however that was achieved.
        let clipper = im.parentElement;
        while (clipper && clipper !== document.body) {
          const cs = getComputedStyle(clipper);
          if (cs.overflow === "hidden" || cs.overflow === "clip" ||
              cs.overflowX === "hidden" || cs.overflowY === "hidden") break;
          clipper = clipper.parentElement;
        }
        if (clipper && clipper !== document.body) {
          const cr = clipper.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left));
          const h = Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top));
          const area = r.width * r.height;
          const shown = area > 0 ? (w * h) / area : 1;
          // 0.7 matches the cover threshold. Only when the image is meaningfully bigger than
          // its clip, so an ordinary rounded card trimming a few pixels is not a finding.
          if (shown < 0.7 && area > cr.width * cr.height * 1.1) {
            out.cropped.push({
              src, visible: shown, byHand: true,
              natural: `${im.naturalWidth}x${im.naturalHeight}`,
              box: `${Math.round(r.width)}x${Math.round(r.height)} inside ${Math.round(cr.width)}x${Math.round(cr.height)}`,
              pos: style.objectFit === "cover" ? (style.objectPosition || "50% 50%").trim() : `${style.position}, no object-fit`,
              centred: false,
            });
            continue;                       // one crop finding per image, the specific one
          }
        }

        // Crop loss under object-fit: cover. `contain` letterboxes rather than cutting, and
        // `fill` distorts, which are different faults with different fixes.
        if (style.objectFit === "cover" && im.naturalHeight > 0 && r.height > 0) {
          const srcRatio = im.naturalWidth / im.naturalHeight;
          const boxRatio = r.width / r.height;
          const visible = Math.min(srcRatio, boxRatio) / Math.max(srcRatio, boxRatio);
          if (visible < 0.7) {
            const pos = (style.objectPosition || "50% 50%").trim();
            out.cropped.push({
              src, visible,
              natural: `${im.naturalWidth}x${im.naturalHeight}`,
              box: `${Math.round(r.width)}x${Math.round(r.height)}`,
              pos,
              centred: pos === "50% 50%" || pos === "center" || pos === "center center",
            });
          }
        }
        // Only genuine upscaling. Falling short of a 2x retina ideal is common and is a
        // different, softer conversation; being shown bigger than you exist is a defect.
        if (im.naturalWidth < Math.round(r.width)) {
          out.upscaled.push({ src, natural: im.naturalWidth, shown: Math.round(r.width) });
        }
      }
      return out;
    });
    for (const b of imgs.broken.slice(0, 3)) {
      add("High", route, vpName, `broken image: "${b}" is in the page and loaded nothing (naturalWidth 0)`);
    }
    /**
     * CROP LOSS: the one image property no gate measured, and the one the doctrine calls
     * destructive. `references/assets.md` is built around a 2:3 portrait forced through a 3:1
     * letterbox showing 22% of the frame, and a real build then repeated it at 25% on the very
     * next site. palate-assets.mjs computes this for LOCAL files before a slot is chosen; nothing
     * checked the slot a photo ACTUALLY landed in, so the rule was advisory the moment a build
     * ignored it. Two independent builds also implemented the sharpness guard and not this one,
     * which is the same asymmetry.
     *
     * A cover-crop shows min(source, box) / max(source, box) of the frame. Under 50% is
     * destructive, under 70% risky. Reported per viewport, because a photo that survives the
     * desktop crop is routinely destroyed by the mobile one.
     */
    for (const c of imgs.cropped.slice(0, 4)) {
      const pct = Math.round(c.visible * 100);
      const sev = c.visible < 0.5 ? "High" : "Medium";
      if (c.byHand) {
        add(sev, route, vpName,
          `crop by hand: "${c.src}" (${c.natural}) renders at ${c.box}, so only ${pct}% of it is on screen, ` +
          `and it is positioned rather than fitted (${c.pos}). object-fit reimplemented with offsets is a sign the ` +
          `photograph does not fit the slot it was given: change the slot, or use a photograph that suits it.`);
      } else {
        add(sev, route, vpName,
          `crop: "${c.src}" is ${c.natural} and its slot is ${c.box}, so only ${pct}% of the frame is shown` +
          (c.centred ? ` with object-position left at the default 50% 50%` : ` (object-position ${c.pos})`) +
          `. ${c.visible < 0.5 ? "That is destructive: pick a slot the photograph supports." : "Check what is being cut before shipping it."}`);
      }
    }

    for (const u of imgs.upscaled.slice(0, 3)) {
      add("High", route, vpName,
        `image upscaled: "${u.src}" is ${u.natural}px wide and is being shown at ${u.shown}px ` +
        `(${(u.shown / u.natural).toFixed(1)}x). It will look soft. Use a smaller slot, or source a larger file.`);
    }

    /**
     * THE EYEBROW / KICKER, CAUGHT AS A PATTERN RATHER THAN A STYLING.
     *
     * `anti-patterns.md` is absolute: "Do not place a small label above a section heading at
     * all ... it is a generic-AI tell REGARDLESS OF STYLING - it is the PATTERN". The ux-lint
     * rule cannot enforce that, because it reads CSS blocks and BOTH its branches require a mono
     * font, so the commonest form of all - `<p class="text-sm uppercase tracking-widest">What we
     * do</p>` in the brand sans, styled entirely by utility classes with no CSS block to parse -
     * matches nothing. Measured: that markup, and a mono eyebrow in the same folder, both produce
     * zero findings while an em dash in the same folder fires Critical.
     *
     * The relationship "a small label immediately above a heading" is structural, so it is found
     * here, where the DOM and the computed styles both exist, instead of guessed from a regex.
     */
    const eyebrows = await page.evaluate(() => {
      const root = document.querySelector('main') || document.body;
      if (!root) return [];
      const out = [];
      for (const h of root.querySelectorAll('h1, h2, h3')) {
        const prev = h.previousElementSibling;
        if (!prev) continue;
        if (prev.closest('nav, header, [role="navigation"], [role="banner"]')) continue;
        // A link or a control above a heading is a breadcrumb or an action, not a kicker.
        if (prev.matches('a, button, nav, ul, ol, img, picture, video, svg, figure, hr')) continue;
        const text = (prev.textContent || '').trim();
        if (!text || text.length > 40) continue;          // a real paragraph is not a kicker
        if (/[.!?]$/.test(text)) continue;                 // a sentence is not a label
        const ps = getComputedStyle(prev), hs = getComputedStyle(h);
        if (ps.display === 'none' || ps.visibility === 'hidden') continue;
        const pSize = parseFloat(ps.fontSize) || 0, hSize = parseFloat(hs.fontSize) || 0;
        if (!(pSize < hSize)) continue;                    // it has to be SMALLER than the heading
        const pr = prev.getBoundingClientRect(), hr = h.getBoundingClientRect();
        if (hr.top - pr.bottom > 48) continue;             // far apart is not "above the heading"
        out.push({
          label: text.slice(0, 32),
          heading: (h.textContent || '').trim().slice(0, 32),
          upper: ps.textTransform === 'uppercase' || text === text.toUpperCase(),
        });
      }
      return out.slice(0, 4);
    });
    for (const e of eyebrows) {
      add('High', route, vpName,
        `eyebrow/kicker: the small label "${e.label}" sits immediately above the heading "${e.heading}"` +
        (e.upper ? ' (uppercase)' : '') +
        '. The kicker PATTERN is the AI tell regardless of styling. Default fix: DELETE the label and let the heading carry the section.');
    }

    if (firstScreen && firstScreen.total > 0 && firstScreen.firstY !== null && firstScreen.firstY >= firstScreen.vh) {
      // Only a finding when the page HAS content and buried it. A page with nothing to show is a
      // different fault and is already caught by the thin-content check below.
      add('High', route, vpName,
        'nothing this page is for is visible before scrolling: the first image or control sits at ' +
        firstScreen.firstY + 'px, below the ' + firstScreen.vh + 'px fold (' + firstScreen.total +
        ' further down). Whatever is above it is taller than the screen.');
    }

    const textLen = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0));
    if (textLen < 1) add('High', route, vpName, 'page renders blank (no text content)');

    // Accessibility, on the settled post-scroll state so reveals have finished and
    // contrast is read on what a visitor actually sees. Skipped on a blank page, where
    // the blank IS the finding and axe would only add noise to it.
    if (textLen > 0) await runAxe(page, route, vpName);

    // Design measurement, from the SAME module the public grader runs (hash-pinned in both
    // repos). This is what stops a build passing here and scoring badly there.
    if (textLen > 0 && route === '/' && (vpName === 'desktop' || vpName === 'mobile')) {
      try { designFacts[vpName] = await measurePage(page); }
      catch (e) { add('Medium', route, vpName, 'design measurement failed: ' + (e && e.message ? e.message : e)); }
    }

    // (b) MOTION-ON reveal reaches the finished state: count substantial elements still
    // fully transparent or hidden after the real wheel scroll. >0 = a reveal that never
    // fires for normal visitors (the 55-79%-hidden bug). Tested with JS ON + motion ON.
    const stuckHidden = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('section, main > *, [data-reveal], [data-animate], [class*="reveal"], article'));
      let stuck = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40) continue;            // ignore tiny nodes
        if ((el.innerText || '').trim().length < 8) continue;   // must carry content
        const s = getComputedStyle(el);
        const transparent = parseFloat(s.opacity || '1') < 0.02;
        const hidden = s.visibility === 'hidden';
        if (transparent || hidden) stuck++;
      }
      return stuck;
    });
    if (stuckHidden > 0) {
      add('High', route, vpName, 'motion-on reveal stuck: ' + stuckHidden + ' content section(s) remain at opacity:0 / visibility:hidden after a real wheel scroll (JS on, motion on). Reveal elements must REST at opacity:1 and animate FROM a transient state (references/rendered-bug-classes.md (b)).');
    }

    // (c) PINNED scene RELEASE: after scrolling to the bottom, no fixed/pinned element
    // that originated in the hero still covers the footer / last section.
    const overprint = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const vh = window.innerHeight, vw = window.innerWidth;
      // The footer / last content block, now in view at the bottom of the scroll.
      const last = document.querySelector('footer') || document.body.lastElementChild;
      const lr = last ? last.getBoundingClientRect() : null;
      if (!lr || lr.top >= vh || lr.bottom <= 0) return '';  // last block not in view => fine
      // rect-overlap test: is a fixed hero-scale element painting over the footer's box?
      const overlaps = (a, b) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      let culprit = '';
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed') continue;
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.02) continue;
        const r = el.getBoundingClientRect();
        if (r.height < vh * 0.25 || r.width < vw * 0.4) continue;     // must be hero-scale
        if ((el.innerText || '').trim().length < 8) continue;        // must carry content
        if (el.contains(last) || (last && last.contains(el))) continue; // not the footer itself
        if (overlaps(r, lr)) {
          culprit = (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          break;
        }
      }
      return culprit;
    });
    if (overprint) {
      add('High', route, vpName, 'pinned scene never releases: a fixed hero-scale element (' + overprint + ') overprints the footer / last section at the bottom of the page. A pinned ScrollTrigger must have a finite end + pinSpacing, or use position:sticky in a bounded container (references/rendered-bug-classes.md (c)).');
    }

    // (f) HEAVY WebGL must degrade on mobile: a <canvas> in the above-the-fold hero at
    // 390 means the lazy-split did not serve the poster on touch/low-end.
    if (vpName === 'mobile') {
      await page.evaluate(() => window.scrollTo(0, 0));
      const aboveFoldCanvas = await page.evaluate(() => {
        const vh = window.innerHeight;
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          if (r.top < vh && r.bottom > 0 && r.width > 64 && r.height > 64) return true;
        }
        return false;
      });
      if (aboveFoldCanvas) {
        add('High', route, vpName, 'heavy WebGL on mobile: an above-the-fold <canvas> renders at 390px. Gate the canvas to desktop + fine-pointer + motion and serve the static poster on touch/low-end (motion-and-3d.md Recipe 1b; references/rendered-bug-classes.md (f)).');
      }
      if (webglChunkError.hit) {
        add('High', route, vpName, 'a three.js / WebGL chunk failed to load on mobile - the heavy 3D bundle should not download on the mobile path at all.');
      }
    }

    for (const e of errors) {
      if (expectedStatusNoise(route, status, e)) continue;
      add('High', route, vpName, e.text);
    }

    // Focus ring: one real keyboard Tab should land on an element with a visible
    // outline (globals.css ships :focus-visible). Desktop only, heuristic -> Medium.
    if (vpName === 'desktop') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { focused: false };
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return { focused: true, visible };
      });
      if (ring.focused && !ring.visible) add('Medium', route, vpName, 'first tab-focused element has no visible focus ring');
    }

    /**
     * DOES THIS PAGE CARRY THE CONTACT FORM? Found here, submitted after the loop.
     *
     * THREE ARMS, AND EVERY ONE OF THEM EXISTS BECAUSE THE PREVIOUS ONE MISSED A REAL SITE.
     *
     *   the action      `form[action="/api/contact"]`, which the brief asked for and which the
     *                   shipped ContactForm.astro does not set: it is `<form id="contact-form"
     *                   novalidate>` with a bundled script that fetches the endpoint. Keyed on
     *                   this alone the probe would never once fire on its own template.
     *   the field names name + email + message, which is the template's shape and nothing else.
     *                   A form the agent wrote with `full-name`, `your-name` or `enquiry` was
     *                   invisible, and the run said "no contact form": the same
     *                   exists-but-never-fires defect, moved rather than closed.
     *   the field SHAPE an email-ish control and a textarea in the same form. That is what a
     *                   contact form IS, whatever its fields are called.
     *
     * AND ANYTHING VISIBLE THAT MATCHES NONE OF THEM IS STILL REPORTED. "No contact form" is a
     * statement about the site; "a form I did not recognise" is a statement about the probe, and
     * only the second one is ever honest when a form is sitting there on the page.
     */
    if (vpName === 'desktop') {
      const forms = await page.evaluate(() => {
        const vis = (n) => {
          if (!n) return false;
          const r = n.getBoundingClientRect(), st = getComputedStyle(n);
          return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const out = { contact: 0, visibleContact: 0, unrecognised: [] };
        for (const f of document.querySelectorAll('form')) {
          const action = f.getAttribute('action') || '';
          let byAction = false;
          try { byAction = new URL(action, location.href).pathname === '/api/contact'; } catch { /* not a URL */ }
          const has = (n) => !!f.querySelector('[name="' + n + '"]');
          const byName = has('name') && has('email') && has('message');
          const emailish = f.querySelector('input[type="email"]') ||
            [...f.querySelectorAll('input,textarea')].some((el) =>
              /e-?mail/i.test((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '')));
          const byShape = !!emailish && !!f.querySelector('textarea');
          if (byAction || byName || byShape) {
            out.contact++;
            if (vis(f)) out.visibleContact++;
            continue;
          }
          // A search box or a newsletter signup is not a miss, so only a form with more than one
          // real field is worth naming: the point is to catch a CONTACT form we failed to read.
          const fields = [...f.querySelectorAll('input,textarea,select')].filter((el) => {
            const t = (el.getAttribute('type') || el.tagName).toLowerCase();
            return !['hidden', 'submit', 'button', 'image', 'reset'].includes(t);
          });
          if (vis(f) && fields.length > 1) {
            out.unrecognised.push(
              (f.id ? '#' + f.id : f.getAttribute('name') ? '[name=' + f.getAttribute('name') + ']' : '<form>') +
              ' with ' + fields.length + ' fields (' +
              fields.slice(0, 4).map((el) => el.getAttribute('name') || el.id || (el.getAttribute('type') || el.tagName.toLowerCase())).join(', ') + ')');
          }
        }
        return out;
      }).catch(() => ({ contact: 0, visibleContact: 0, unrecognised: [] }));

      if (forms.contact) formRoutes.push(route);
      // NAMED, NOT COUNTED. A route with a visible form the probe could not classify is the one
      // case where silence would be a lie about the site rather than about the probe.
      if (forms.unrecognised.length) {
        unrecognisedForms.push(route + ': ' + forms.unrecognised.join('; '));
      }
      if (forms.contact && !forms.visibleContact) hiddenOnlyFormRoutes.push(route);
    }

    /**
     * THE MOBILE NAV AND ANY DIALOG, opened and closed for real.
     *
     * Every other check in this file reads a settled page. A burger that opens nothing, or a
     * full-screen overlay a keyboard user cannot dismiss, looks identical to a working one in
     * a screenshot and in the DOM, and is only found by pressing it. See disclosureProbe for
     * what is in scope and what it cannot see.
     */
    if (vpName === 'mobile' || vpName === 'desktop') {
      await disclosureProbe(page, route, vpName);
    }

    // The rendered DOM text, for the route record. Desktop only: one reading per route is
    // what the record holds, and the desktop pass is the one every route gets.
    if (vpName === 'desktop') {
      try { renderedText.set(route, await page.evaluate(() => (document.body && document.body.innerText) || '')); }
      catch { /* a page that will not yield its text simply earns no record and renders again */ }
    }

    if (outDir) {
      const name = vpName + (route === '/' ? '_home' : route.replace(/[^a-z0-9]+/gi, '_')) + '.png';
      await page.screenshot({ path: outDir + '/' + name, fullPage: true }).catch(() => {});
    }
    await page.close();
  }
  await context.close();
}

// ------------------------------------------------- form round trip -----
/**
 * FILL THE CONTACT FORM AND PRESS SEND.
 *
 * `references/testing.md` described this test for months and nothing ran it, so a submit
 * handler that never bound, an endpoint returning 500 and a wrong Turnstile key all shipped
 * looking exactly like a working form. Reading the markup cannot tell them apart. Pressing
 * the button can.
 *
 * THE SMOKE HEADER IS WHAT MAKES IT SAFE TO RUN. `x-palate-smoke: 1` on every request this
 * page makes tells `src/pages/api/contact.ts` to validate the body and answer
 * `{ ok: true, smoke: true }` having sent nothing. In production the endpoint ignores the
 * header unless `x-palate-smoke-secret` matches `PALATE_SMOKE_SECRET`, so this is passed
 * through from the environment when it is set.
 *
 * A 200 WITHOUT THE FLAG IS A FAILURE, NOT A PASS. It means the header was ignored and the
 * submission took the real path, which against a deployed site is a fake enquiry in the
 * client's inbox. That is the one outcome worth shouting about.
 *
 * ITS OWN CONTEXT. `setExtraHTTPHeaders` applies to every request the page makes, and the
 * audit pass above must not carry a header that changes what the site does.
 */
// A skipped route is not inspected, so a form on one of them was not submitted either. Said
// in the same breath as "nothing submitted", because the two together are the difference
// between a site with no form and a site whose form nobody looked at this run.
const formSkipNote = skipped.length
  ? ` ${skipped.length} unchanged route(s) were skipped, so a contact form on one of those was NOT submitted this run; --full covers them.`
  : '';
if (!rendering.length) {
  console.error('verify-rendered: form round trip: no route was rendered this run, so nothing was submitted.' + formSkipNote);
} else if (!formRoutes.length) {
  console.error(`verify-rendered: form round trip: no contact form on ${rendering.length} route(s), nothing submitted.` + formSkipNote);
  if (unrecognisedForms.length) {
    console.error(
      `verify-rendered: form round trip: but ${unrecognisedForms.length} route(s) DO carry a visible form this probe did not ` +
      `recognise as a contact form, so "no contact form" is about the probe and not about the site: ` +
      unrecognisedForms.join(' | ') + '. A contact form is recognised by action="/api/contact", by name/email/message ' +
      'fields, or by an email field beside a textarea.',
    );
  }
} else {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'x-palate-smoke': '1' });
  const smokeSecret = process.env.PALATE_SMOKE_SECRET || '';
  if (!smokeSecret) console.error('verify-rendered: form round trip: PALATE_SMOKE_SECRET is not set, which is right for a preview and will make a PRODUCTION deployment take the real path.');
  const siteOrigin = new URL(base).origin;

  /**
   * WHAT THIS ROUTE HANDLER STOPS, and the one that was measured rather than reasoned about.
   *
   * THE SECRET GOES ON EXACTLY ONE REQUEST. setExtraHTTPHeaders is per PAGE, not per origin, so
   * a header set there rides Google Fonts, the analytics beacon, Turnstile and any CDN the
   * client's site uses. `x-palate-smoke: 1` is a flag and harmless there; the SECRET is a
   * production credential. Narrowing it to same-origin was not enough either: ANY same-origin
   * path that redirects to a CDN or an image host handed it over, because a request produced by
   * a redirect never reaches this handler and the browser carries the injected header across.
   * Measured on two real servers: a same-origin GET that 302s and a same-origin POST that 307s
   * both delivered `x-palate-smoke-secret` to the second origin, and the POST delivered its body
   * as well. So the secret is attached to the ONE request that needs it, the POST to
   * /api/contact, and to nothing else.
   *
   * AND THIS HANDLER FOLLOWS THAT REQUEST ITSELF. `route.fetch({ maxRedirects: 0 })` means a
   * cross-origin `Location` is refused here rather than followed by the browser, which is the
   * only place the decision can be made: once the browser follows it, the request is invisible
   * to us and the secret and the body have already gone.
   *
   * A CROSS-ORIGIN POST IS ABORTED AT THE WIRE. A form wired to Formspree, HubSpot or a client
   * CRM is not our endpoint and the smoke header means nothing to it, so submitting one puts a
   * fake enquiry in the client's actual inbox, once per verify run. The attempt still fires
   * `requestfailed`, so the probe still sees where the form went and still files the Medium
   * naming the destination: the report does not change, only the delivery.
   *
   * WHAT IT CANNOT STOP, said plainly rather than fixed: a same-origin path that proxies onward
   * server-side receives the secret legitimately and could forward it. Narrowing to the contact
   * endpoint shrinks that to one route, and the secret only ever authorises a no-op smoke answer
   * on that one site.
   */
  let refusedRedirect = '';
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url = null;
    try { url = new URL(req.url()); } catch { /* an opaque URL is not our origin */ }
    const sameOrigin = !!url && url.origin === siteOrigin;

    if (!sameOrigin) {
      if (req.method() === 'POST') { await route.abort('blockedbyclient'); return; }
      await route.continue();
      return;
    }
    // EVERY same-origin POST is followed here, not just the contact endpoint, because the
    // delivery this stops is the redirect and a form can post to any path. Only the contact
    // endpoint gets the secret.
    if (req.method() !== 'POST') { await route.continue(); return; }
    const isEndpoint = url.pathname === '/api/contact';

    let res;
    try {
      res = await route.fetch({
        maxRedirects: 0,
        headers: (smokeSecret && isEndpoint) ? { ...req.headers(), 'x-palate-smoke-secret': smokeSecret } : req.headers(),
      });
    } catch (e) {
      await route.abort('failed');
      return;
    }
    const status = res.status();
    const loc = res.headers().location;
    if (status >= 300 && status < 400 && loc) {
      let target = null;
      try { target = new URL(loc, req.url()); } catch { /* an unparseable Location is not ours */ }
      if (!target || target.origin !== siteOrigin) {
        refusedRedirect = target ? target.origin : String(loc);
        await route.fulfill({
          status: 599,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'cross-origin redirect refused', to: refusedRedirect }),
        });
        return;
      }
    }
    await route.fulfill({ response: res });
  });

  // Every POST the page makes, in order, ANSWERED OR NOT. A predicate on waitForResponse
  // would race an analytics beacon and lose on any site that has one, and a POST to a host
  // that does not resolve never produces a response at all: without requestfailed here, a
  // form wired to a dead third party looks identical to a form that never submitted.
  let posts = [];
  page.on('response', (r) => { if (r.request().method() === 'POST') posts.push({ url: r.url(), resp: r }); });
  page.on('requestfailed', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), resp: null }); });

  // CAPPED, like the disclosure probe's candidates. An Explore build carries a contact section
  // in every variant, so an uncapped probe submits once per rung: the same form, the same
  // endpoint, the same answer, at a page load and up to eight seconds of polling each. Three is
  // enough to catch a route where the form differs; the rest are named as not submitted, never
  // silently dropped.
  if (hiddenOnlyFormRoutes.length) {
    console.error(
      `verify-rendered: form round trip: ${hiddenOnlyFormRoutes.length} route(s) carry a contact form with nothing ` +
      `visible to submit at desktop (${hiddenOnlyFormRoutes.join(', ')}), which is ordinary for a modal or a ` +
      'breakpoint duplicate. Those routes are UNMEASURED, not clean.',
    );
  }
  const FORM_ROUTE_CAP = 3;
  const probing = formRoutes.slice(0, FORM_ROUTE_CAP);
  if (formRoutes.length > probing.length) {
    console.error(
      `verify-rendered: form round trip: ${formRoutes.length} route(s) carry a contact form; submitting the first ` +
      `${probing.length} (${probing.join(', ')}) and NOT ${formRoutes.slice(probing.length).join(', ')}. ` +
      'They post to the same endpoint, so the extra submissions buy the same answer.',
    );
  }
  if (unrecognisedForms.length) {
    console.error(
      `verify-rendered: form round trip: ${unrecognisedForms.length} route(s) carry a visible form this probe did not ` +
      `recognise as a contact form and did not submit: ` + unrecognisedForms.join(' | ') + '.',
    );
  }
  for (const route of probing) {
    posts = [];
    refusedRedirect = '';
    try {
      await page.goto(base + route, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    } catch (e) {
      add('High', route, 'desktop', 'form round trip: the page carrying the contact form would not load (' + (e && e.message ? e.message : e) + ').');
      continue;
    }

    const filled = await page.evaluate((sample) => {
      const vis = (n) => {
        const r = n.getBoundingClientRect(), s = getComputedStyle(n);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      // THE FIRST form whose SUBMIT CONTROL IS VISIBLE, not the first in DOM order. A
      // `display: none` duplicate kept for a breakpoint, or a form inside a dialog this run's
      // own disclosure probe just opened and closed, both sat first in the document and both
      // ended the probe on a five-second `page.click` timeout reported as a High about a
      // pointer, on a site with nothing wrong with it.
      let form = null;
      let candidates = 0;
      for (const f of document.querySelectorAll('form')) {
        const action = f.getAttribute('action') || '';
        let byAction = false;
        try { byAction = new URL(action, location.href).pathname === '/api/contact'; } catch { /* not a URL */ }
        const has = (n) => !!f.querySelector('[name="' + n + '"]');
        const byName = has('name') && has('email') && has('message');
        const emailish = f.querySelector('input[type="email"]') ||
          [...f.querySelectorAll('input,textarea')].some((el) =>
            /e-?mail/i.test((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '')));
        const byShape = !!emailish && !!f.querySelector('textarea');
        if (!(byAction || byName || byShape)) continue;
        candidates++;
        const sub = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])') || f.querySelector('button');
        if (!sub) continue;
        const r = sub.getBoundingClientRect(), st = getComputedStyle(sub);
        if (r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden') { form = f; break; }
      }
      if (!form) {
        return candidates
          ? { ok: false, hidden: true, why: candidates + ' contact form(s) on this route have no submit control visible at desktop' }
          : { ok: false, why: 'the form found at desktop was not on the page this pass' };
      }
      form.setAttribute('data-palate-form', '1');

      // VISIBLE fields only. A hidden input is either machinery or a honeypot, and filling a
      // honeypot is how an automated submission gets classified as spam by the thing it is
      // meant to be testing.
      const names = [];
      const groups = new Set();
      for (const el of form.querySelectorAll('input, textarea, select')) {
        const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'file' || type === 'reset') continue;
        if (el.disabled || el.readOnly || !vis(el)) continue;
        const key = ((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
        const set = (v) => {
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (type === 'checkbox' || type === 'radio') {
          if (!el.required && type === 'checkbox') continue;
          if (type === 'radio') { if (groups.has(el.name)) continue; groups.add(el.name); }
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.tagName.toLowerCase() === 'select') {
          const pick = Array.from(el.options).find((o) => o.value);
          if (!pick) continue;
          el.value = pick.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (type === 'email' || /email/.test(key)) set(sample.email);
        else if (el.tagName.toLowerCase() === 'textarea' || /message|comment|enquir|inquir|detail/.test(key)) set(sample.message);
        else if (type === 'tel' || /phone|mobile|tel/.test(key)) set(sample.tel);
        else if (type === 'url') set(sample.url);
        else if (type === 'number' || type === 'range') set('1');
        else if (type === 'date') set(sample.date);
        else if (type === 'time') set('09:00');
        else set(sample.name);
        names.push(el.getAttribute('name') || el.id || type);
      }
      const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
        || form.querySelector('button');
      if (!submit) return { ok: false, why: 'the contact form has no submit control, so it cannot be sent at all' };
      form.setAttribute('data-palate-form', '1');
      submit.setAttribute('data-palate-submit', '1');
      return { ok: true, fields: names };
    }, SAMPLE_FORM).catch((e) => ({ ok: false, why: 'the form could not be filled (' + (e && e.message ? e.message : e) + ')' }));

    if (!filled.ok && filled.hidden) {
      // NOT a finding. A form behind a modal or duplicated for a breakpoint is ordinary work,
      // and the gate that certified the dialog a moment ago must not then fail the form in it.
      console.error('verify-rendered: form round trip: ' + route + ' SKIPPED, ' + filled.why +
        '. Nothing was submitted for this route, so its form is UNMEASURED rather than clean.');
      continue;
    }
    if (!filled.ok) { add('High', route, 'desktop', 'form round trip: ' + filled.why + '.'); continue; }

    try {
      await page.click('[data-palate-submit="1"]', { timeout: 5000 });
    } catch (e) {
      add('High', route, 'desktop', 'form round trip: the submit control could not be clicked (' +
        (e && e.message ? String(e.message).split(String.fromCharCode(10))[0] : e) + ').');
      continue;
    }

    // Poll rather than wait on a predicate: the endpoint answer is the one we want and it may
    // not be the first POST the page makes.
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) {
      hit = posts.find((p) => { try { const u = new URL(p.url); return u.origin === new URL(base).origin && u.pathname === '/api/contact'; } catch { return false; } });
      if (!hit) await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    }

    if (!hit) {
      const elsewhere = posts[0];
      if (elsewhere) {
        add('Medium', route, 'desktop', 'form round trip: the contact form posted to ' + elsewhere.url +
          ' rather than /api/contact, so the round trip is UNMEASURED, not clean. Point the form at the ' +
          'template endpoint, or accept that no gate here proves the enquiry arrives.');
        continue;
      }
      const complaint = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('[role="alert"],[aria-invalid="true"]'))
          .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map((n) => (n.textContent || n.getAttribute('name') || n.id || '').trim()).filter(Boolean);
        return a.slice(0, 3).join('; ');
      }).catch(() => '');
      add('High', route, 'desktop', 'form round trip: pressing send made no request at all, so nothing was submitted. ' +
        (complaint
          ? 'The form rejected the sample values: "' + complaint + '". Valid values were entered in every visible field, so the validation is refusing something it should accept.'
          : 'The submit handler never bound, or it swallows the submit. Fields filled: ' + filled.fields.join(', ') + '.'));
      continue;
    }

    if (!hit.resp) {
      add('High', route, 'desktop', 'form round trip: the submission to /api/contact never got a response ' +
        '(the request failed at the network level). The endpoint is not being served at that path.');
      continue;
    }
    const status = hit.resp.status();
    let body = null;
    try { body = JSON.parse(await hit.resp.text()); } catch { /* a non-JSON answer is itself the finding */ }
    if (refusedRedirect) {
      add('High', route, 'desktop', 'form round trip: /api/contact redirected the submission to ' + refusedRedirect +
        ', a different origin, and the redirect was REFUSED rather than followed. Nothing was delivered there and the ' +
        'smoke secret did not leave this site. A contact endpoint that hands the submission to another host is not the ' +
        'endpoint this gate can measure: point the form at the vendor directly, or keep the handoff server-side.');
    } else if (status === 404 || status === 405) {
      add('High', route, 'desktop', 'form round trip: /api/contact answered ' + status + ', so the endpoint is not being ' +
        'served at that path. Either the route is missing from the build, or this preview is a plain static server ' +
        'and not `npm run preview`, which runs the adapter and serves the endpoint. Nothing about the form is proven either way.');
    } else if (status < 200 || status >= 300) {
      // A 400 or 403 is what the endpoint's OWN validation answers once the smoke header has
      // been refused, and on a local preview the commonest cause by a distance is a build that
      // never had PUBLIC_SITE_ENV set: an unknown environment requires the secret, so the
      // header is ignored and the real path runs. `serve-preview.sh` bakes it in both modes,
      // but its built mode REUSES an existing dist/, so a dist left behind by a bare
      // `npm run build` is served unbaked and refuses. Without naming that, this message sends
      // the reader off to debug Turnstile on a form with nothing wrong with it.
      const refused = status === 400 || status === 403;
      add('High', route, 'desktop', 'form round trip: /api/contact answered ' + status +
        (body && body.error ? ' (' + body.error + ')' : '') + '. The form reaches the endpoint and the endpoint refuses it.' +
        (refused ? ' On a local preview, check PUBLIC_SITE_ENV was set at BUILD time first: an unbaked build requires ' +
          'PALATE_SMOKE_SECRET, so the smoke header is ignored and the real validation runs. serve-preview.sh sets it, ' +
          'a bare `npm run build` does not, and serve-preview.sh reuses an existing dist/ rather than rebuilding it.' : ''));
    } else if (!body || body.smoke !== true) {
      add('High', route, 'desktop', 'form round trip: /api/contact answered ' + status + ' without `smoke: true`, so the ' +
        'smoke header was ignored and the submission took the real path. Against a deployed site that is a fake enquiry ' +
        'in the inbox and, with a CMS wired, a document in the client\'s content. Either the endpoint predates the smoke ' +
        'contract, or PUBLIC_SITE_ENV says production and PALATE_SMOKE_SECRET is unset or does not match.');
    } else {
      console.error('verify-rendered: form round trip: ' + route + ' answered ' + status + ' with smoke: true (' +
        filled.fields.length + ' field(s) filled, nothing sent).');
    }
  }
  await context.close();
}

// (g) VIEW-TRANSITION navigation re-inits motion: client-side navigate by CLICKING an
// in-app link (Astro ClientRouter does a VT swap, not a fresh load), then assert the
// destination's scroll reveals fire. A not-VT-aware motion module (one that guards behind
// a boot-once flag) animates only the first page, so reveals on the swapped-in page stay
// stuck at opacity:0 - the "only the cinematic page animates" bug. Only fires when there
// is a second internal route to click; a site without client routing reloads and passes.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    const target = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href]')) {
        let u; try { u = new URL(a.href, location.href); } catch { continue; }
        if (u.origin === location.origin && u.pathname !== location.pathname && u.pathname !== '/' && !a.hash && !a.target) {
          a.setAttribute('data-vt-probe', '1'); // tag it so we click the right one regardless of href shape (relative / root-absolute / full)
          return u.pathname;
        }
      }
      return null;
    });
    if (target) {
      await page.click('a[data-vt-probe="1"]', { timeout: 5000 }).catch(() => {});
      await page.waitForFunction((p) => location.pathname === p, target, { timeout: 8000 }).catch(() => {});
      const navigated = await page.evaluate((p) => location.pathname === p, target);
      if (navigated) {
        await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
        await realWheelScroll(page);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
        const stuck = await page.evaluate(() => {
          let n = 0;
          for (const el of document.querySelectorAll('section, main > *, [data-reveal], [data-animate], [class*="reveal"], article')) {
            const r = el.getBoundingClientRect();
            if (r.width < 80 || r.height < 40) continue;
            if ((el.innerText || '').trim().length < 8) continue;
            const s = getComputedStyle(el);
            if (parseFloat(s.opacity || '1') < 0.02 || s.visibility === 'hidden') n++;
          }
          return n;
        });
        if (stuck > 0) add('High', target + ' (via client-nav)', 'desktop', stuck + ' reveal(s) stuck at opacity:0 / hidden after a View-Transition navigation (clicked an in-app link to ' + target + ', not a fresh load). Motion did not re-init on the swapped-in page: the motion module must re-arm its per-page recipes on astro:page-load, never guard behind a boot-once flag (src/lib/motion.ts setupPage; references/rendered-bug-classes.md).');
      }
    }
  } catch (e) {
    add('Medium', '(client-nav)', 'desktop', 'could not test View-Transition navigation: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

// (a) NO-JS / LCP-is-never-a-canvas: load the home route with JavaScript DISABLED and
// assert the hero shows a FINISHED static state - text is present, no fixed full-viewport
// overlay covers it (a JS-dismissed preloader), and the largest above-the-fold element is
// not a bare <canvas> with no sibling poster <img>. Desktop viewport.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    const nojs = await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const out = { text: 0, overlay: false, canvasHero: false, poster: false };
      out.text = (document.body && document.body.innerText ? document.body.innerText.trim().length : 0);
      // A fixed/absolute element covering most of the viewport with no JS to dismiss it
      // is a preloader stuck over the hero.
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.02) continue;
        if (s.position !== 'fixed' && s.position !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.width > vw * 0.9 && r.height > vh * 0.9 && r.top <= 1 && r.left <= 1) {
          // an opaque-ish full-screen cover near the top of the stack
          const bg = s.backgroundColor || '';
          const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
          if (opaque || parseFloat(s.opacity || '1') > 0.5) { out.overlay = true; break; }
        }
      }
      // A substantial above-the-fold <canvas> with no static poster <img> beside it:
      // with JS off the canvas is blank, so the hero LCP is blank unless a poster backs it.
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0 && r.width > 200 && r.height > 160) { out.canvasHero = true; break; }
      }
      if (out.canvasHero) {
        for (const img of document.querySelectorAll('img, picture img')) {
          const r = img.getBoundingClientRect();
          if (r.top < vh && r.bottom > 0 && r.width > 120 && r.height > 80) { out.poster = true; break; }
        }
      }
      return out;
    });
    if (nojs.text < 1) add('High', '/', 'no-js', 'with JavaScript disabled the page renders blank - the hero / LCP must be a finished static state (text + a static image/poster), never JS-dependent (references/rendered-bug-classes.md (a)).');
    if (nojs.overlay) add('High', '/', 'no-js', 'a full-viewport overlay (a preloader) covers the hero with JS disabled - preloaders must default HIDDEN and be SHOWN by JS (or guarded by html:not(.js)), never default-visible + JS-dismissed (references/rendered-bug-classes.md (a)).');
    if (nojs.canvasHero && !nojs.poster) add('High', '/', 'no-js', 'the hero LCP is a <canvas> with no static poster <img> - every WebGL hero ships a static poster behind the canvas as the LCP / no-JS / reduced-motion state (references/motion-and-3d.md; rendered-bug-classes.md (a)).');
  } catch (e) {
    add('Medium', '/', 'no-js', 'could not load the page with JS disabled: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

// 404: an unknown route must serve the branded 404 (a real state), not a 200 and not a
// blank host default.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  let status = 0, textLen = 0;
  try {
    const resp = await page.goto(base + '/__verify_rendered_nonexistent', { waitUntil: 'load', timeout: 20000 });
    status = resp ? resp.status() : 0;
    textLen = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0));
  } catch { /* navigation issue is reported as the wrong-status finding below */ }
  if (status !== 404) add('High', '(unknown route)', 'desktop', 'unknown routes return ' + status + ', not 404 - add a custom src/pages/404.astro');
  else if (textLen < 20) add('Medium', '/404', 'desktop', '404 page is near-empty; give it on-brand copy and a link home');
  await context.close();
}

// INTERACTION states (home route, desktop): the rest of this gate reads a scroll + a settled
// still; this DRIVES a real pointer + keyboard the way a human triggers a state, so a deleted
// focus ring or a hover/expand nav that never opens is caught, not just described in the
// rubric. Two OBJECTIVE checks enforce (they rest on an explicit signal, so false positives
// are low): keyboard focus-visible traversal (WCAG 2.4.7) and an aria-expanded hover/expand
// nav (WCAG 1.4.13 open + Dismissible). Hover feedback stays ADVISORY (a hover can legitimately
// change a child element or only the cursor, so it cannot safely block).
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));

    // (1) Keyboard focus-visible. Snapshot each interactive element's RESTING style, Tab to it
    // with a REAL key (programmatic .focus() does not reliably match :focus-visible), and
    // assert the focused style DIFFERS from resting. ANY change counts as an indicator, so a
    // site that shows focus with a border or a background shift is NOT false-flagged; only an
    // element whose focused style is identical to resting has no indicator at all. A systematic
    // miss (>=2) is a deleted focus ring (WCAG 2.4.7), so it enforces.
    const SK = 'outlineStyle,outlineWidth,outlineColor,boxShadow,borderTopColor,borderTopWidth,borderBottomColor,backgroundColor,color,textDecorationLine';
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(2, 2); // park the pointer so hover does not contaminate the resting snapshot
    await page.evaluate((keysCsv) => {
      const keys = keysCsv.split(',');
      const els = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex],[role="button"]')).filter((el) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.01;
      }).slice(0, 40);
      window.__ixBase = {};
      els.forEach((el, i) => { el.setAttribute('data-ixf', String(i)); const s = getComputedStyle(el); window.__ixBase[i] = keys.map((k) => s[k]).join('|'); });
    }, SK);
    let noRing = 0, checked = 0; const noRingEg = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate((keysCsv) => {
        const keys = keysCsv.split(',');
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement || !el.getAttribute) return null;
        const id = el.getAttribute('data-ixf');
        if (id == null || !(window.__ixBase && id in window.__ixBase)) return { known: false };
        const s = getComputedStyle(el);
        const changed = keys.map((k) => s[k]).join('|') !== window.__ixBase[id];
        const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/)[0] : '';
        return { known: true, changed, label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls) };
      }, SK);
      if (!r || !r.known) continue;
      checked++;
      if (!r.changed) { noRing++; if (noRingEg.length < 3) noRingEg.push(r.label); }
    }
    if (noRing >= 2) {
      const msg = noRing + ' of ' + checked + ' keyboard-focusable elements show no visible change on focus (no outline, ring, border or background shift on :focus-visible), e.g. ' + noRingEg.join(', ') + '. Give focus a visible indicator (WCAG 2.4.7).';
      add('High', '/', 'desktop', 'focus indicator missing on keyboard traversal: ' + msg);
      interactionFailures.push({ route: '/', vp: 'desktop', check: 'focus-visible', msg });
    }

    // (2) Hover/expand nav dismissibility (WCAG 1.4.13). An aria-expanded control can be
    // click-triggered (the common case), so a hover that does not open it proves nothing and
    // is NOT flagged. We act only once hover has CONFIRMED opened it (aria-expanded flips
    // true): then it must be dismissible with Escape, without moving the pointer (1.4.13
    // Dismissible). A hover-opened disclosure Escape cannot close -> enforce. Low false
    // positive: it fires only on a genuinely hover-opened, non-dismissible menu.
    const navTrigger = await page.evaluate(() => {
      const t = document.querySelector('nav [aria-expanded="false"], header [aria-expanded="false"], [aria-haspopup="true"][aria-expanded="false"]');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      t.setAttribute('data-ix-nav', '1');
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (navTrigger) {
      await page.mouse.move(navTrigger.x, navTrigger.y, { steps: 12 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
      const openedOnHover = await page.evaluate(() => {
        const t = document.querySelector('[data-ix-nav="1"]');
        return !!t && t.getAttribute('aria-expanded') === 'true';
      });
      if (openedOnHover) {
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
        const dismissed = await page.evaluate(() => {
          const t = document.querySelector('[data-ix-nav="1"]');
          return !t || t.getAttribute('aria-expanded') !== 'true';
        });
        if (!dismissed) {
          const msg = 'a nav disclosure that opens on hover cannot be dismissed with Escape (WCAG 1.4.13 Dismissible: content shown on hover or focus must be dismissible without moving the pointer).';
          add('High', '/', 'desktop', 'hover nav not dismissible: ' + msg);
          interactionFailures.push({ route: '/', vp: 'desktop', check: 'nav-escape-dismiss', msg });
        }
      }
    }

    // (3) ADVISORY hover feedback: sample primary buttons / links, drive a REAL pointer to
    // each (CSS :hover only fires for a real pointer, not a synthetic event), and see if the
    // computed style shifts. Only flag when the WHOLE sample is dead - hover feedback via a
    // child element or the cursor is legitimate and not caught here, so this never enforces.
    const sample = await page.evaluate(() => {
      const pick = Array.from(document.querySelectorAll('button, a[href]')).filter((el) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 40 && r.height > 20 && r.top >= 0 && r.top < window.innerHeight && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.5 && (el.innerText || '').trim().length > 0;
      }).slice(0, 6);
      pick.forEach((el, i) => el.setAttribute('data-ix-h', String(i)));
      return pick.map((el) => { const r = el.getBoundingClientRect(); return { i: el.getAttribute('data-ix-h'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    });
    const snap = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null; const c = getComputedStyle(el);
      return [c.color, c.backgroundColor, c.borderColor, c.boxShadow, c.opacity, c.textDecorationLine, c.transform, c.filter, c.scale].join('|');
    }, sel);
    let deadHover = 0, hoverChecked = 0;
    for (const el of sample) {
      const sel = '[data-ix-h="' + el.i + '"]';
      await page.mouse.move(4, 4); // park the pointer off the element
      const before = await snap(sel);
      if (before == null) continue;
      await page.mouse.move(el.x, el.y, { steps: 8 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
      const after = await snap(sel);
      hoverChecked++;
      if (after === before) deadHover++;
    }
    if (hoverChecked >= 4 && deadHover === hoverChecked) {
      add('Medium', '/', 'desktop', 'no hover feedback: none of ' + hoverChecked + ' sampled buttons/links changed under a real hover (colour, shadow, transform). Give interactive elements hover feedback (advisory: feedback via a child element or the cursor is not detected here).');
    }
  } catch (e) {
    add('Medium', '(interaction)', 'desktop', 'interaction pass could not complete: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

// Core Web Vitals, on a FRESH page under slow-4G + 4x CPU emulation. It needs its own page
// because the observers must be installed before navigation, and its own throttled context
// because throttling the audit pass would distort every other measurement in this file.
// Skipped with --no-vitals for a fast inner loop; the gate says so rather than going quiet.
let vitalsScored = null, vitals = null;
if (args['no-vitals'] !== 'true') {
  try {
    const vctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    const vpage = await vctx.newPage();
    vitals = await measureVitals(vpage, base + '/');
    await vctx.close();
    vitalsScored = scoreVitals(vitals);
    if (!vitals.applicable) {
      add('Medium', '/', 'mobile', 'performance was not measured: ' + vitals.reason);
    } else {
      // LCP and CLS block; TBT and payload advise. The split is about how directly the build
      // controls the number: a slow hero and a shifting layout are the build's, while blocking
      // time under 4x CPU emulation moves with what third parties the site carries.
      const by = (id) => vitalsScored.find((c) => c.id === id);
      for (const id of ['lcp', 'cls']) {
        const c = by(id);
        if (c && c.raw !== null && c.raw < 0.5) {
          add('High', '/', 'mobile', 'performance: ' + c.detail);
          interactionFailures.push({ msg: '/ @mobile: performance ' + id + ': ' + c.detail, route: '/', viewport: 'mobile', rule: 'vitals-' + id, check: id });
        }
      }
      for (const id of ['responsiveness', 'js_execution_and_payload']) {
        const c = by(id);
        if (c && c.raw !== null && c.raw < 0.5) add('Medium', '/', 'mobile', 'performance: ' + c.detail);
      }
    }
  } catch (e) {
    add('Medium', '/', 'mobile', 'performance measurement failed: ' + (e && e.message ? e.message : e));
  }
} else {
  console.error('verify-rendered: --no-vitals set; performance is UNMEASURED (17 of the grader\'s 100 points).');
}


await browser.close();

// Write the objective interaction failures for the enforce-on-evidence hook (palate-stop.mjs
// reads <proj>/.palate-shots/interaction.json). Only with --out; best-effort - the findings
// and the exit code below still stand without the artefact.
// ------------------------------------------------------- design measurement ----
// Score the facts with the grader's own module, then split the result in two.
//
// BLOCKING is reserved for the three findings that are objective and conformance-anchored,
// in keeping with this file's enforce-on-evidence rule: a framework-default accent (deltaE
// under 8 from the lead accent, which is THE tell and is not a matter of taste), a control
// under WCAG 2.5.8's 24px, and body text under 16px on a phone. Each is a fact about the
// rendered page that a reasonable person cannot dispute.
//
// EVERYTHING ELSE IS EVIDENCE, not a verdict. Spacing rhythm and the component vocabulary
// go to the verifier and the report. That line was drawn by measurement, not preference:
// scoring the count of hues and radii ranked Linear and Stripe below a page with no palette
// at all, because counting measures how rich a design system is and rich is not worse.
let designScored = null;
if (designFacts.desktop || designFacts.mobile) {
  designScored = scoreDesignFacts(designFacts);
  const by = (id) => designScored.find((c) => c.id === id);

  const colour = by('colour_accent_discipline');
  if (colour && colour.raw !== null && colour.raw <= 0.3) {
    add('High', '/', 'desktop', 'design: ' + colour.detail);
    interactionFailures.push({ msg: '/ @desktop: design colour_accent_discipline: ' + colour.detail, route: '/', viewport: 'desktop', rule: 'framework-default-accent', check: 'colour_accent_discipline' });
  }

  const resp = by('responsive_integrity');
  const rm = resp && resp.measured;
  if (rm && rm.failAA > 0) {
    add('High', '/', 'mobile', 'design: ' + rm.failAA + ' of ' + rm.controls + ' controls are under 24px on a phone, missing WCAG 2.5.8 AA.');
    interactionFailures.push({ msg: '/ @mobile: design responsive_integrity: ' + rm.failAA + ' of ' + rm.controls + ' controls under 24px (WCAG 2.5.8 AA)', route: '/', viewport: 'mobile', rule: 'tap-target-under-24px', check: 'responsive_integrity', nodes: rm.failAA });
  }
  if (rm && rm.mobileBody != null && rm.mobileBody < 16) {
    add('High', '/', 'mobile', 'design: body text sets at ' + rm.mobileBody + 'px on a phone, below the 16px floor.');
    interactionFailures.push({ msg: '/ @mobile: design responsive_integrity: body text at ' + rm.mobileBody + 'px, below the 16px mobile floor', route: '/', viewport: 'mobile', rule: 'mobile-body-under-16px', check: 'responsive_integrity' });
  }

  for (const c of designScored) {
    if (c.raw !== null && c.raw < 0.6 && !['colour_accent_discipline', 'responsive_integrity'].includes(c.id)) {
      add('Medium', '/', 'desktop', 'design ' + c.id + ': ' + c.detail);
    }
  }
}

// THE BUILD HYGIENE SCORE. It runs the grader's OWN rubric arithmetic (rubric.mjs, vendored
// and diffed byte-for-byte in palate-product's lint) over the checks that can be measured on a
// rendered page here, so "the plugin approved this build" carries a number rather than a promise.
//
// IT WAS CALLED A PROJECTED GRADE AND THAT NAME WAS A FALSE CLAIM. Across 23 fresh re-grades it
// correlated with the public grade at r = -0.074 like for like, mean absolute gap 18.0 points. No
// predictive power, and the cause is now evidenced rather than guessed: a local number that DOES
// carry the vision half (local-grade's tier 2, SigLIP head plus pairwise ladder) tracks the same
// reference at r = +0.83. Vision is what the grade rests on, and this number has none in it by
// construction. See hygiene-loop.mjs for the sample sizes, the pre-deploy caveat on both figures,
// and the prediction the re-measure should falsify. Either way this measures HYGIENE and must not
// be reported as a grade. `measuredWeight` reports how much of the 100 the number rests on, and
// the message says the rest out loud, because an agent that reads 80 as "will score 80" stops
// working exactly where the real gap is.
//
// The gate stays. These are real faults and fixing them is real work. Only the claim was wrong.
// See hygiene-loop.mjs. The design half is grade-local.mjs (free, on this machine); the shareable
// number comes from palatemcp.com/grade.
let projected = null;
// The self-heal trend for this run, written into design.json so the verifier and the human
// see the same convergence story the agent was given.
let hygieneLoop = null;
if (designScored || vitalsScored) {
  try {
    const m = new Map();
    for (const c of [...(designScored ?? []), ...(vitalsScored ?? [])]) {
      if (c.raw === null || c.applicable === false) continue;
      m.set(c.id, { id: c.id, raw: c.raw, detail: c.detail, lowConfidence: !!c.lowConfidence });
    }
    // Every axe rule the grader treats as a binary. One failing contrast node zeroes 22 of the
    // accessibility dimension there, so it must zero it here or the hygiene score flatters.
    const axeHit = (check) => interactionFailures.some((f) => f.check === check);
    for (const id of ['text_contrast', 'control_accessible_names', 'forms_and_errors', 'structure_and_landmarks']) {
      if (axeHit(id)) m.set(id, { id, raw: 0, detail: 'An axe violation was found on the rendered page.', lowConfidence: false });
    }
    if (m.size) projected = scoreRubric(m);
  } catch (e) {
    add('Medium', '/', 'all', 'the build hygiene score could not be computed: ' + (e && e.message ? e.message : e));
  }
}
/**
 * THE HYGIENE FLOOR GATES, IT SAYS WHY, AND IT SAYS WHETHER THE LAST FIX HELPED.
 *
 * Printing a number and moving on is what made the plugin and the grader two disconnected
 * systems in the first place. A build below the floor blocks, and the block names the specific
 * checks holding it down, ranked by how many points each is worth, with the fix for each. That
 * is what turns "you scored 57" into work an agent can actually do.
 *
 * Blocking is still not HEALING. An agent that is told it failed, fixes something, and re-runs
 * has no way to tell a real gain from the +/-2 the instrument moves on its own, so it thrashes.
 * hygiene-loop.mjs persists each run next to the build and turns the next one into a comparison:
 * up, down, or unchanged, per gap as well as overall, and a stall once two iterations pass with
 * no material gain. See that file for why the noise band is 2, why a run measured on a different
 * set of checks reports NO COMPARISON instead of a delta, and why a stall escalates rather than
 * releasing the gate.
 *
 * THE FLOOR IS 80, AND IT IS A HYGIENE FLOOR, NOT A PREDICTED GRADE. Measured: a Palate demo
 * scores 97 here and an ordinary plumber site 52, so 80 separates them cleanly on hygiene. That
 * separation is real and is all it claims. It does NOT transfer to the public grade (r = -0.074
 * over 23 re-grades), so nothing here may be reported as a grade the build will get.
 *
 * PALATE_MIN_HYGIENE=0 turns it off for a deliberate exception; it is not silent when it does.
 */
// A garbage value must not disable the gate. `Number('eighty')` is NaN, and NaN fails BOTH
// `> 0` and `<= 0`, so a typo used to skip the block and print nothing about it - the exact
// silent-skip shape this file exists to prevent. Fall back to the default and SAY SO.
//
// `legacy` is the pre-rename name. It is still READ, because the alternative is worse than the
// churn: someone who sets PALATE_MIN_GRADE=0 expecting the gate off would otherwise be blocked
// at 80 by a variable that was silently ignored, which is the same silent-skip class again. It
// is honoured once, loudly, and named as deprecated.
const numEnv = (name, fallback, legacy = null) => {
  let raw = process.env[name], used = name;
  const legacySet = legacy && process.env[legacy] !== undefined && process.env[legacy] !== '';
  if ((raw === undefined || raw === '') && legacySet) {
    raw = process.env[legacy]; used = legacy;
    console.error(`verify-rendered: ${legacy} is DEPRECATED and was renamed ${name} (the number is a build hygiene score, not a projected grade). Honouring it this run.`);
  } else if (legacySet) {
    // Both set. The new name wins, but dropping the old one without a word is the same silent
    // skip in miniature: someone would be left wondering why their =0 did nothing.
    console.error(`verify-rendered: both ${name} and the deprecated ${legacy} are set. Using ${name}="${raw}" and IGNORING ${legacy}="${process.env[legacy]}".`);
  }
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`verify-rendered: ${used}="${raw}" is not a number; using the default ${fallback}. The gate is NOT off.`);
    return fallback;
  }
  return n;
};
const MIN_HYGIENE = numEnv('PALATE_MIN_HYGIENE', 80, 'PALATE_MIN_GRADE');
const STALL_ITERS = Math.max(1, Math.round(numEnv('PALATE_HYGIENE_STALL_ITERS', DEFAULT_STALL_ITERS, 'PALATE_GRADE_STALL_ITERS')) || DEFAULT_STALL_ITERS);
// The exact command to re-run, reconstructed from this invocation so the agent can copy it
// rather than reconstruct it. A "re-run the gate" instruction with no command is an instruction
// to guess.
const RERUN = ['node', process.argv[1], '--url', base, '--routes', (rendering.length ? rendering : routes).join(','),
  ...(outDir ? ['--out', outDir] : []), ...(args['no-vitals'] === 'true' ? ['--no-vitals'] : [])].join(' ');

if (projected) {
  const historyFile = outDir ? `${outDir}/${HISTORY_FILE}` : '';
  // Bookkeeping problems are REPORTED, never swallowed and never fatal: losing the trend is
  // exactly the silent skip this loop exists to prevent, but it must not fail a good build.
  const notes = [];
  let hist = { entries: [], error: null };
  if (!historyFile) {
    notes.push('NOTE: this run had no --out, so no hygiene history was kept and no trend can be reported. Pass --out <dir> to make the loop measurable.');
  } else {
    hist = readHistory(historyFile);
    if (hist.error) notes.push(`NOTE: the hygiene history at ${historyFile} ${hist.error}, so this run is treated as a first measurement. The trend is LOST, not clean.`);
  }

  // The measurement CONFIGURATION, not the outcome: see basisOf() for why keying it on the
  // scored checks made a successful fix read as NO COMPARISON.
  // The routes actually RENDERED, never the ones selected: a run that skipped half the site
  // measured a different set, and hygiene-loop.mjs refuses to compare across a changed basis.
  const measuredWith = { routes: rendering, vitals: args['no-vitals'] !== 'true', axe: !!axeSource };
  const basis = basisOf(measuredWith);
  const tailBefore = comparableTail(hist.entries, basis);
  const entry = entryFor(projected, {
    ...measuredWith, url: base, minScore: MIN_HYGIENE,
    blocked: MIN_HYGIENE > 0 && projected.overall < MIN_HYGIENE,
  });
  const cmp = compare(entry, hist.entries[hist.entries.length - 1] ?? null);
  const stall = detectStall([...tailBefore, entry], STALL_ITERS);

  if (historyFile) {
    const w = writeHistory(historyFile, hist.entries, entry);
    if (w.error) notes.push(`NOTE: the hygiene history at ${historyFile} ${w.error}, so the NEXT run will not see this one and cannot report a trend.`);
  }

  if (MIN_HYGIENE > 0 && projected.overall < MIN_HYGIENE) {
    const msg = blockMessage({ scored: projected, cmp, stall, minScore: MIN_HYGIENE, rerun: RERUN, notes });
    add('High', '/', 'all', msg);
    // FIRST, not appended: palate-stop.mjs samples the head of this list, and behind five axe
    // entries the whole self-heal message would never reach the agent that has to act on it.
    interactionFailures.unshift({
      msg, route: '/', viewport: 'all', rule: 'hygiene-below-floor', check: 'build_hygiene',
      score: projected.overall, floor: MIN_HYGIENE, trend: cmp.verdict, delta: cmp.delta,
      iteration: stall.iterations, stalled: stall.stalled, rerun: RERUN,
    });
    console.error('verify-rendered: BLOCKED.\n' + msg);
  } else if (MIN_HYGIENE <= 0) {
    console.error('verify-rendered: PALATE_MIN_HYGIENE=0, the build-hygiene gate is OFF for this build.');
  }
  // Printed on every run, pass or fail: an agent that has just cleared the floor still needs to
  // know whether it cleared it by 1 point on a rising trend or by luck on a flat one.
  console.error(summaryLine({ scored: projected, cmp, stall, minScore: MIN_HYGIENE }));
  for (const n of notes) console.error('verify-rendered: ' + n);
  hygieneLoop = { basis, trend: cmp.verdict, delta: cmp.delta, previous: cmp.previous?.overall ?? null,
    iteration: stall.iterations, stalled: stall.stalled, blockers: stall.blockers, rerun: RERUN, notes };
} else {
  // A RUN WITH NO SCORE SAYS SO. The design checks and the vitals are both measured on the home
  // route, so `--changed --no-vitals` over a blast radius that excludes `/` computes neither and
  // the whole block above is skipped: three of the loop's own runs printed no hygiene line and
  // no trend line at all, while the doctrine told the agent to read the trend on every one of
  // them. A plain run at least said the home route was skipped; these said nothing, which reads
  // as a run with nothing to report rather than a run that measured nothing.
  const why = rendering.includes('/')
    ? 'the home route rendered but yielded no design or vitals measurement'
    : 'the home route was not rendered this run, and both the design checks and the vitals are measured on it';
  console.error(
    `verify-rendered: build hygiene was NOT measured (${why}), so there is no score and no trend ` +
    'for this run. The sweep before hand-over (--full, vitals on) measures it.',
  );
}

if (outDir) {
  // NEVER FATAL IS RIGHT. SILENT IS NOT, AND THIS ONE WAS THE WORST CASE IN THE FILE.
  //
  // hooks/palate-stop.mjs BLOCKS on a present, non-empty interaction.json and treats an ABSENT
  // file as "could not verify", which is the correct fail-open rule for a pass that never ran.
  // But a failed WRITE is indistinguishable from a pass that never ran: a full disk, a
  // read-only mount or a deleted --out directory would take a build with real blocking failures
  // and turn it into one the Stop hook waves through, saying nothing. The findings and the exit
  // code still stand for anyone reading them, and the hook reads neither.
  //
  // So it stays non-fatal and becomes loud, and the message names the consequence rather than
  // the operation, because "could not write interaction.json" does not tell the reader their
  // gate just stopped working.
  try {
    writeFileSync(`${outDir}/interaction.json`, JSON.stringify({ interaction_failures: interactionFailures }, null, 2));
  } catch (e) {
    const n = interactionFailures.length;
    console.error(
      `verify-rendered: FAILED to write ${outDir}/interaction.json (${e?.message ?? e}). ` +
      (n
        ? `${n} blocking failure(s) were found and the Stop hook will NOT see them, so this build can finish as though it passed. Treat it as FAILED and fix the write path.`
        : 'No failures were found, so nothing is being hidden, but the gate artefact is missing.'),
    );
  }
  // The full scored set, for the verifier and for the human. `hygiene` is deliberately NOT
  // named `projected`: the field is read by people, and a field called `projected` invites the
  // reading the measurement retired.
  try {
    writeFileSync(`${outDir}/design.json`, JSON.stringify({
      version: DESIGN_MEASURE_VERSION, sha: DESIGN_MEASURE_SHA, vitalsSha: VITALS_SHA,
      scored: designScored, facts: designFacts,
      vitals, vitalsScored,
      hygiene: projected, hygieneLoop,
    }, null, 2));
  } catch (e) {
    // Nothing gates on design.json, so this one only costs the evidence and the trend, not the
    // block. Still said out loud: a missing artefact should never be discovered by its absence.
    console.error(`verify-rendered: FAILED to write ${outDir}/design.json (${e?.message ?? e}). The scored evidence and the hygiene trend are LOST for this run.`);
  }

  // THE PER-ROUTE RECORD, and why it is written here rather than inside the route loop.
  //
  // A route earns a record only when it rendered THIS run and nothing at or above High was
  // filed against it, and the hygiene block above can file a High against `/` long after the
  // loop finished. Banking a pass inside the loop would have recorded a verdict the gate had
  // not yet reached.
  //
  // MERGED into the shots manifest, never written over it: screenshot-build.mjs owns status,
  // shots and the console-error count in the same file, and this gate owns `routes`.
  try {
    // THE CLIENT-NAV PROBE FILES AGAINST "<path> (via client-nav)", not against the path, so a
    // naive set never matched the route it was about.
    const highRoutes = new Set(findings
      .filter((f) => (RANK[f.sev] || 0) >= RANK.High)
      .map((f) => String(f.route).replace(/ \(via client-nav\)$/, '')));
    let m = {};
    try { m = JSON.parse(readFileSync(shotsManifest, 'utf8')); } catch { m = {}; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
    const out = (m.routes && typeof m.routes === 'object' && !Array.isArray(m.routes)) ? { ...m.routes } : {};
    for (const p of rendering) {
      const sh = sourcesHashes.get(p);
      const text = renderedText.get(p);
      // A route this run could not HASH keeps whatever record it had. Deleting it threw away a
      // real record every time a run-site command passed --routes, and every no-index fallback,
      // so a /post between two build-loop passes emptied the loop's memory. A route that FAILED
      // is a different case and is dropped below, whether it rendered or was skipped.
      if (!sh || text === undefined) continue;
      if (highRoutes.has(p)) { delete out[keyOf(p)]; continue; }
      out[keyOf(p)] = { sourcesHash: sh, renderedHash: textHash(text), passed_at: new Date().toISOString() };
    }
    // A SKIPPED ROUTE IS NOT EXEMPT. The no-JS, focus, hover-nav, vitals and design probes all
    // file against `/` and run whatever the selection is, so a skipped home route with a failing
    // probe used to keep its passing record and be skipped again next run. The doc says a record
    // is dropped the moment a route fails; this is what makes that true rather than nearly true.
    for (const p of highRoutes) delete out[keyOf(p)];
    m.routes = out;
    m.globalInputs = globalInputs.hash;
    m.sweep = sweep;
    writeFileSync(shotsManifest, JSON.stringify(m, null, 2) + '\n');
  } catch (e) {
    console.error(
      `verify-rendered: FAILED to write the per-route record to ${shotsManifest} (${e?.message ?? e}). ` +
      'The next run will render every route, which is slow and never wrong.',
    );
  }

  // THE SHOTS MANIFEST IS THE AUTHORITY AND THIS IS THE CONVENIENCE COPY, in that order.
  // verify-report.json is written by the palate-verifier AGENT, so a copy of the sweep there
  // is one an LLM can overwrite; gate-done reads the tool-written manifest first and only
  // falls back to this. Merged into an existing report and never created, because creating
  // one would turn "no renderable preview, skip" into a gate that runs on a stub.
  try {
    const reportPath = join(dirname(resolve(outDir)), 'verify-report.json');
    if (existsSync(reportPath)) {
      const rep = JSON.parse(readFileSync(reportPath, 'utf8'));
      if (rep && typeof rep === 'object' && !Array.isArray(rep)) {
        rep.sweep = sweep;
        writeFileSync(reportPath, JSON.stringify(rep, null, 2) + '\n');
      }
    }
  } catch { /* the manifest already carries it; a bad report is the verifier's own problem */ }
}

// ------------------------------------------------- disclosure probe -----
/**
 * Open the mobile nav and any dialog, assert the target appeared, press Escape, assert it went.
 *
 * WHY ESCAPE IS THE ASSERTION AND NOT A NICETY. A mobile nav is usually a full-screen overlay
 * over the page it covers, and a dialog is one by definition. A visitor driving the keyboard
 * who opens either and finds no Escape has to tab through the whole sheet to reach a close
 * control, if there is one; the dialog and menu-button patterns both make Escape the way out.
 * It is also the cheapest possible signal that the open state is actually managed rather than
 * a class toggled on and forgotten. A native <dialog> gets this free, which is exactly why a
 * hand-rolled one that does not is worth catching.
 *
 * SCOPED SO IT CANNOT FIRE ON A DESIGN CHOICE. The control must be a button (or role button),
 * visible, currently CLOSED, outside a form so a click cannot submit something, and its target
 * must be findable and currently hidden. A nav that is simply visible at 390 has nothing to
 * open and is left alone.
 *
 * WHAT IT CANNOT SEE, said plainly: a <dialog> opened by a button whose handler is bound in a
 * module, with no aria-controls, no commandfor and no data-dialog-target, is not discoverable
 * from the DOM. Wire the trigger to the dialog with one of those and it is covered.
 *
 * At mobile both kinds are probed. At desktop only dialogs are, because a nav at desktop is
 * normally already open and a third pass would cost a click per route for nothing.
 *
 * Findings are deduplicated on the check plus the control's label, because one nav or one
 * dialog is normally one shared component and the alternative is the same fault filed
 * fourteen times.
 */
async function disclosureProbe(page, route, vpName) {
  let found = await detectDisclosures(page);
  if (!found || !found.length) return;

  /**
   * ONE FAILURE LEAVES THE PAGE DIRTY, AND THE NEXT CANDIDATE PAYS FOR IT.
   *
   * A dialog that will not close on Escape is still open, in the top layer, over everything.
   * The nav button underneath is then unclickable, and the run reported the nav as "did not
   * open anything" when the nav was fine and the dialog was the fault. Two findings, one of
   * them wrong, on a page with one real defect. So after anything that leaves state behind,
   * the page is reloaded and the candidates re-detected before the next one is touched.
   *
   * Only when dirty. A page whose disclosures all opened and closed correctly costs no extra
   * navigation, which is the common case and the one that must stay cheap.
   */
  let dirty = false;
  for (let i = 0; i < found.length; i++) {
    if (dirty) {
      try {
        await page.goto(base + route, { waitUntil: 'load', timeout: 20000 });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
        const again = await detectDisclosures(page);
        if (!again || again.length <= i) break;
        found = again;
      } catch { break; }
      dirty = false;
    }
    const c = found[i];
    // A nav at desktop is normally already open; only dialogs earn a second pass.
    if (vpName !== 'mobile' && c.kind !== 'dialog') continue;
    const where = c.kind === 'dialog' ? '' : ' at 390';
    const file = (suffix, msg) => {
      const { check, sev } = DISCLOSURE_CHECKS[c.kind][suffix];
      const key = check + ' ' + c.label;
      if (navSeen.has(key)) return;
      navSeen.add(key);
      add(sev, route, vpName, c.kind + ': ' + msg);
      // Only a High reaches interaction.json, which is the file hooks/palate-stop.mjs blocks
      // on. A Medium that blocked would make "Medium" mean nothing.
      if (sev === 'High') {
        interactionFailures.push({ msg: route + ' @' + vpName + ': ' + c.kind + ': ' + msg, route, viewport: vpName, rule: check, check });
      }
    };

    const state = () => page.evaluate((n) => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect(), st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.05;
      };
      const el = document.querySelector('[data-ix-dis="' + n + '"]');
      const t = document.querySelector('[data-ix-dis-t="' + n + '"]');
      return { expanded: !!el && el.getAttribute('aria-expanded') === 'true', targetVisible: vis(t) };
    }, c.i);

    try {
      await page.click('[data-ix-dis="' + c.i + '"]', { timeout: 4000 });
    } catch (e) {
      const why = e && e.message ? String(e.message).split(String.fromCharCode(10))[0] : String(e);
      file('open', 'the control "' + c.label + '" could not be clicked' + where + ' (' + why +
        '). A control a pointer cannot reach is one nobody can open.');
      dirty = true;
      continue;
    }
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    const open = await state();
    if (!open.expanded && !open.targetVisible) {
      file('open', 'the control "' + c.label + '" did not open anything when clicked' + where + ': ' +
        'aria-expanded stayed false and ' + (c.hasTarget ? 'the element it controls stayed hidden' : 'no panel appeared') +
        (c.kind === 'dialog' ? '. A dialog nobody can open is a dead end in the flow it belongs to.'
          : '. The burger is the only way into the navigation on a phone.'));
      dirty = true;
      continue;
    }

    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
    const shut = await state();
    if (shut.expanded || shut.targetVisible) {
      file('escape-dismiss', 'what "' + c.label + '" opened cannot be dismissed with Escape' + where + '. ' +
        'An overlay a keyboard visitor cannot close leaves them tabbing through the whole sheet to get out. ' +
        'Close it on Escape as well as on the button (a native <dialog> does this for free unless the cancel ' +
        'event is prevented). Advisory: this does not block the build.');
      dirty = true;
      continue;
    }
    console.error('verify-rendered: ' + c.kind + ': ' + route + ' @' + vpName + ' opened and dismissed "' + c.label + '" with Escape.');
  }
}

/** The candidates on the page as it stands, marked so they can be found again after a click. */
async function detectDisclosures(page) {
  try {
    return await page.evaluate(() => {
      const vis = (n) => {
        if (!n) return false;
        const r = n.getBoundingClientRect(), s = getComputedStyle(n);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
      };
      const isDialog = (trigger, target) =>
        trigger.getAttribute('aria-haspopup') === 'dialog' ||
        (!!target && (target.tagName === 'DIALOG' || target.getAttribute('role') === 'dialog' || target.getAttribute('aria-modal') === 'true'));
      const label = (el) => {
        const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/)[0] : '';
        return (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.id || cls || 'the control').slice(0, 40);
      };
      const out = [];
      const taken = new Set();
      const consider = (el, target) => {
        if (out.length >= 3 || taken.has(el)) return;
        if (!vis(el) || el.closest('form')) return;                // a click here could submit
        if (el.getAttribute('aria-expanded') === 'true') return;   // already open
        if (vis(target)) return;                                   // nothing to open
        // With neither a target to watch nor an aria-expanded to read there is nothing to
        // assert, so it is left alone rather than judged on a guess.
        if (!target && !el.hasAttribute('aria-expanded')) return;
        taken.add(el);
        const i = String(out.length);
        el.setAttribute('data-ix-dis', i);
        if (target) target.setAttribute('data-ix-dis-t', i);
        out.push({ i, label: label(el), hasTarget: !!target, kind: isDialog(el, target) ? 'dialog' : 'mobile nav' });
      };
      const sel = 'button[aria-expanded],[role="button"][aria-expanded],button[aria-controls],' +
        '[role="button"][aria-controls],button[aria-haspopup="dialog"],[role="button"][aria-haspopup="dialog"]';
      for (const el of document.querySelectorAll(sel)) {
        const id = el.getAttribute('aria-controls');
        consider(el, id ? document.getElementById(id) : null);
      }
      // A native <dialog> whose trigger names it some other way. Without this arm the commonest
      // shape of all, `<button commandfor="dlg">` beside `<dialog id="dlg">`, is invisible here.
      for (const d of document.querySelectorAll('dialog')) {
        if (d.open || !d.id) continue;
        const esc = (window.CSS && CSS.escape) ? CSS.escape(d.id) : d.id;
        const t = document.querySelector(`[commandfor="${esc}"],[data-dialog-target="${esc}"],[aria-controls="${esc}"]`);
        if (t) consider(t, d);
      }
      return out;
    });
  } catch { return null; }
}

// ------------------------------------------------------------- helpers -----
// A REAL wheel scroll to the bottom of the page (NOT scrollTo): this is what fires
// scroll-reveal / ScrollTrigger on the default motion path. scrollTo and reduced-motion
// both bypass the very code path the reveal bug lives in. When `capture` is set it also
// shoots an ordered viewport filmstrip across the scroll (up to capture.max frames, evenly
// spaced and including the top), so the SAME pass yields the motion-choreography evidence.
async function realWheelScroll(page, capture = null) {
  try {
    const total = await page.evaluate(() => document.body.scrollHeight);
    const vh = await page.evaluate(() => window.innerHeight);
    const steps = Math.max(4, Math.ceil(total / Math.max(200, vh * 0.7)));
    const stops = capture ? frameStops(steps, capture.max) : null; // scroll positions 0..steps to shoot
    let fi = 0;
    if (stops && stops.has(0)) await snapFrame(page, capture, fi++); // the top, before any scroll
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, Math.max(200, vh * 0.7));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 80)));
      if (stops && stops.has(i + 1)) await snapFrame(page, capture, fi++);
    }
  } catch { /* a page with no scroll is fine */ }
}

// Up to `max` evenly-spaced scroll positions in [0, steps] (inclusive of the top), so a
// long page is sampled across its whole descent and a short one just gets fewer distinct
// frames. Returns a Set of position indices.
function frameStops(steps, max) {
  const n = Math.min(max, steps + 1);
  const set = new Set();
  for (let i = 0; i < n; i++) set.add(Math.round((i * steps) / Math.max(1, n - 1)));
  return set;
}
// One ordered viewport frame (<prefix>-00.png, -01.png, ...). Viewport, NOT full-page: a
// filmstrip is what is ON SCREEN as you scroll, so the judge reads the choreography in order.
async function snapFrame(page, cap, i) {
  try { await page.screenshot({ path: `${cap.dir}/${cap.prefix}-${String(i).padStart(2, '0')}.png` }); }
  catch { /* a dropped frame is not fatal */ }
}

// --------------------------------------------------------------- report ----
findings.sort((a, b) => (RANK[b.sev] || 0) - (RANK[a.sev] || 0));
for (const f of findings) console.log(`${f.route} @${f.vp}  [${f.sev}]  ${f.msg}`);
const highest = findings.reduce((m, f) => Math.max(m, RANK[f.sev] || 0), 0);
console.error(
  `verify-rendered: ${findings.length} finding(s) across ${rendering.length} rendered route(s)` +
  (skipped.length ? ` (${skipped.length} unchanged, skipped)` : '') +
  ' x 3 viewports + the no-JS + 404 probes',
);
// A FAILURE STILL WINS. Only once nothing is wrong does "nothing was inspected" become the
// verdict: a run that rendered no route did not pass, it was SKIPPED, and exit 0 is the one
// answer that reads as a clean site. The house rule is that a gate never exits 0 having
// inspected nothing, and the unchanged-route skip is the one path in this file that can.
if (highest >= RANK.High) process.exit(1);
if (!rendering.length) {
  console.error(
    'verify-rendered: SKIPPED, not passed (exit 2). No route was rendered: every selected route was ' +
    'unchanged since its last passing render, so this run establishes nothing about them. The ' +
    'home-route and 404 probes did run. Pass --full to render every route.',
  );
  process.exit(2);
}
process.exit(0);
