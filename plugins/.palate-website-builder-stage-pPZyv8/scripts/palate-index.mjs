#!/usr/bin/env node
/**
 * palate-index.mjs - the content graph. This is what makes a repo of markdown
 * behave like a CMS instead of a folder with good manners.
 *
 * ============================== WHY IT EXISTS ==============================
 *
 * Three jobs, and each one is impossible without it:
 *
 *   PROPAGATION   "change the phone number once and every surface follows".
 *                 Only true if something knows which surfaces read it. Without
 *                 the graph an agent greps, and a grep misses the footer that
 *                 built the number out of two variables.
 *
 *   BLAST RADIUS  which routes a change actually affects. This is the whole
 *                 latency budget: a typo fix must check two routes in seconds,
 *                 a layout change must check everything. Guess high and the
 *                 gate is too slow to keep; guess low and it misses the
 *                 regression it exists to catch.
 *
 *   CONTINUITY    every route's baseline, so drift is measured against THIS
 *                 site's own history rather than an absolute standard. A site
 *                 inherited at 44 must still be able to merge a typo fix.
 *
 * ========================= DERIVED, NEVER AUTHORED =========================
 *
 * The index is rebuildable from the repo in full, so it is gitignored and never
 * hand-edited. Baselines are the opposite: they are measurements that cannot be
 * recomputed from source (what this site looked like last Tuesday) so they are
 * committed. See `.palate/baselines/`.
 *
 * BASELINES STORE NUMBERS, NOT PIXELS. Per route: throttled vitals, the 768-d
 * appearance embedding, axe counts, a structure hash. All JSON, all diffable,
 * a few KB each. Storing screenshots instead would repeat the mistake that left
 * github/docs a 574MiB checkout inside a 2.23GiB repository, because every
 * superseded image is permanent and history cannot be un-fattened without a
 * rewrite. Stills are regenerated on demand for the before/after review; they
 * are an output, not a record.
 *
 * Usage:
 *   node palate-index.mjs <project-dir> [--out .palate/index.json]
 *   node palate-index.mjs <project-dir> --blast <file> [<file>...]
 *   node palate-index.mjs <project-dir> --reads <symbol>
 *
 * Exit: 0 ok, 2 bad args or not a site.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXT = new Set(['.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.svelte', '.vue']);
const CONTENT_EXT = new Set(['.md', '.mdx']);

// ---------------------------------------------------------------- fs helpers

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ------------------------------------------------------------------- imports

/**
 * Static import edges for one source file, resolved to real paths.
 *
 * Deliberately syntactic rather than a real module graph: no bundler, no
 * TypeScript program, no install required, and it runs in milliseconds on a
 * repo of any size. The cost is that a dynamic `import(variable)` is invisible,
 * which is why `blastRadius` falls back to EVERY route when it cannot resolve a
 * changed file (see below). Being wrong in the expensive direction is the only
 * safe way to be wrong here.
 */
function importsOf(file, projectDir) {
  const src = read(file);
  const specs = [
    ...src.matchAll(/^\s*import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/gm),
    ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g),
  ].map((m) => m[1]);

  const out = new Set();
  for (const spec of specs) {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue; // package or virtual module
    const raw = spec.startsWith('@/')
      ? join(projectDir, 'src', spec.slice(2))
      : resolve(dirname(file), spec);
    for (const cand of [raw, ...[...SOURCE_EXT].map((e) => raw + e), join(raw, 'index.ts')]) {
      if (existsSync(cand) && statSync(cand).isFile()) { out.add(relative(projectDir, cand)); break; }
    }
  }
  return [...out];
}

/** Transitive closure of the import graph, so a shared layout reaches every page that uses it. */
function closure(start, graph) {
  const seen = new Set();
  const stack = [...(graph[start] || [])];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const next of graph[n] || []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

// -------------------------------------------------------------------- routes

/**
 * A page file's public path. Dynamic segments stay as their bracket token
 * (`/blog/[slug]`) because the route is what has a baseline; the individual
 * entries are indexed separately and joined to it by `entryRoute`.
 */
function routePath(pageFile, pagesDir) {
  let r = relative(pagesDir, pageFile).replace(/\\/g, '/');
  r = r.replace(/\.(astro|md|mdx|ts|js)$/, '');
  // The scaffold ships dynamic routes bracket-free so the skill zip uploads
  // cleanly; treat the .tpl form as the route it becomes once renamed.
  r = r.replace(/\.astro\.tpl$/, '').replace(/(^|\/)slug$/, '$1[slug]');
  if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
  if (r === 'index') r = '';
  return '/' + r;
}

const isEndpoint = (f) => /\.(ts|js)$/.test(f) && !/\.astro$/.test(f);

// ------------------------------------------------------------------ content

/** Frontmatter, parsed only as far as the index needs. No YAML dependency. */
function frontmatter(file) {
  const src = read(file);
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, '');
    if (v === 'true') out[kv[1]] = true;
    else if (v === 'false') out[kv[1]] = false;
    else if (v !== '') out[kv[1]] = v;
  }
  return out;
}

/** Internal hrefs a file emits, so orphans and dead links are answerable. */
function internalLinks(file) {
  const src = read(file);
  return [...new Set(
    [...src.matchAll(/href=["'](\/[^"'#?]*)/g)].map((m) => m[1].replace(/\/$/, '') || '/'),
  )];
}

// -------------------------------------------------------------------- build

export function buildIndex(projectDir) {
  const srcDir = join(projectDir, 'src');
  const pagesDir = join(srcDir, 'pages');
  if (!existsSync(pagesDir)) return null;

  const files = walk(srcDir);
  const graph = {};
  for (const f of files) {
    if (SOURCE_EXT.has(extname(f)) || f.endsWith('.astro.tpl')) {
      graph[relative(projectDir, f)] = importsOf(f, projectDir);
    }
  }

  const routes = [];
  for (const f of files) {
    const inPages = f.startsWith(pagesDir + '/') || f.startsWith(pagesDir + '\\');
    if (!inPages) continue;
    if (!(extname(f) === '.astro' || f.endsWith('.astro.tpl') || isEndpoint(f))) continue;
    const rel = relative(projectDir, f);
    routes.push({
      path: routePath(f, pagesDir),
      source: rel,
      kind: /\[|\bslug\b/.test(basename(f)) ? 'dynamic' : isEndpoint(f) ? 'endpoint' : 'static',
      // Transitive, so editing a layout or a token file resolves to every page
      // that reaches it, not just the ones that name it directly.
      dependsOn: [...closure(rel, graph)].sort(),
      links: internalLinks(f),
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));

  // Collections: one entry per markdown file, joined to the dynamic route that
  // renders it and to every listing route that reaches the same collection.
  const entries = [];
  const contentRoot = join(srcDir, 'content');
  for (const f of walk(contentRoot)) {
    if (!CONTENT_EXT.has(extname(f))) continue;
    const rel = relative(projectDir, f);
    const parts = relative(contentRoot, f).split(/[\\/]/);
    const collection = parts[0];
    const id = parts.slice(1).join('/').replace(/\.(md|mdx)$/, '');
    const fm = frontmatter(f);
    entries.push({
      id, collection, file: rel,
      draft: fm.draft === true,
      publishedAt: fm.publishedAt ?? null,
      title: fm.title ?? null,
      image: fm.image ?? null,
    });
  }
  entries.sort((a, b) => (a.collection + a.id).localeCompare(b.collection + b.id));

  // Facts: the single-source record and every route that reaches it. This is
  // the propagation answer, and it is transitive on purpose — a route that
  // renders the business name through the shared layout is still a surface that
  // changes when the name changes, even though it never imports the record.
  const factsFile = ['src/lib/business.ts', 'src/lib/business.js']
    .find((p) => existsSync(join(projectDir, p))) || null;
  const facts = factsFile
    ? { source: factsFile, readBy: routes.filter((r) => r.dependsOn.includes(factsFile)).map((r) => r.path) }
    : null;

  // Orphans: a published page nothing links to. Not an error (a campaign
  // landing page is legitimately unlinked) which is why it is reported, not
  // failed. Endpoints are excluded: robots.txt is not meant to be linked.
  const linked = new Set(routes.flatMap((r) => r.links));
  const orphans = routes
    .filter((r) => r.kind === 'static' && r.path !== '/' && !linked.has(r.path))
    .map((r) => r.path);

  // Dead internal links: an href to a path no route serves. Dynamic routes are
  // matched by prefix, since /blog/[slug] serves /blog/anything.
  const dynamicPrefixes = routes.filter((r) => r.kind === 'dynamic').map((r) => r.path.replace(/\/\[[^\]]+\]$/, ''));
  const served = new Set(routes.map((r) => r.path));
  const dead = [...new Set(routes.flatMap((r) => r.links))]
    .filter((h) => !served.has(h) && !dynamicPrefixes.some((p) => h.startsWith(p + '/')));

  return {
    version: 1,
    routes, entries, facts,
    links: { orphans, dead },
    counts: { routes: routes.length, entries: entries.length, drafts: entries.filter((e) => e.draft).length },
  };
}

// -------------------------------------------------------------- blast radius

/**
 * Which routes a set of changed files affects.
 *
 * FAILS WIDE ON PURPOSE. An unrecognised change (a config file, a dependency, a
 * dynamic import this parser cannot see) returns every route rather than none.
 * A gate that checks too much is slow; a gate that checks too little is a gate
 * that passed the change which broke the site, and only one of those two
 * failures is recoverable.
 */
export function blastRadius(index, changed) {
  const all = index.routes.map((r) => r.path);
  const hit = new Set();
  for (const raw of changed) {
    const file = raw.replace(/^\.\//, '');
    const route = index.routes.find((r) => r.source === file);
    if (route) { hit.add(route.path); continue; }

    const entry = index.entries.find((e) => e.file === file);
    if (entry) {
      // The entry's own detail route, plus every listing that reaches the
      // collection. A new post changes the post AND the index that lists it.
      for (const r of index.routes) {
        if (r.kind === 'dynamic' && r.path.includes('[')) hit.add(r.path.replace(/\[[^\]]+\]$/, entry.id));
        else if (r.kind === 'static' && r.dependsOn.some((d) => d.endsWith('content.config.ts'))) hit.add(r.path);
        else if (r.path === '/' + entry.collection || r.path === '/blog') hit.add(r.path);
      }
      continue;
    }

    const dependents = index.routes.filter((r) => r.dependsOn.includes(file));
    if (dependents.length) { dependents.forEach((r) => hit.add(r.path)); continue; }

    if (/^src\//.test(file)) { all.forEach((p) => hit.add(p)); continue; } // unknown source file
    if (/^(package\.json|astro\.config|tsconfig|tailwind|.*\.config\.)/.test(file)) {
      all.forEach((p) => hit.add(p)); continue; // config: everything
    }
    // Anything else (README, .github, docs) affects no route.
  }
  return [...hit].sort();
}

// ---------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const projectDir = resolve(argv[0] || '.');
  if (!existsSync(join(projectDir, 'src', 'pages'))) {
    console.error(`palate-index: no src/pages in ${projectDir} (not an Astro site).`);
    process.exit(2);
  }
  const index = buildIndex(projectDir);
  if (!index) { console.error('palate-index: could not build an index.'); process.exit(2); }

  const blastAt = argv.indexOf('--blast');
  if (blastAt !== -1) {
    const changed = argv.slice(blastAt + 1).filter((a) => !a.startsWith('--'));
    const routes = blastRadius(index, changed);
    console.log(JSON.stringify({ changed, routes, count: routes.length }, null, 2));
    return;
  }

  const readsAt = argv.indexOf('--reads');
  if (readsAt !== -1) {
    const sym = argv[readsAt + 1];
    const routes = index.routes.filter((r) => r.dependsOn.some((d) => d.includes(sym))).map((r) => r.path);
    console.log(JSON.stringify({ symbol: sym, routes, count: routes.length }, null, 2));
    return;
  }

  // `--out` with no value is a stack trace unless guarded: resolve() throws
  // ERR_INVALID_ARG_TYPE on undefined. It is the documented flag form, so an
  // agent following the usage line hits it, and a crash reads as "the index is
  // broken" rather than "you left off the path".
  const outAt = argv.indexOf('--out');
  const outArg = outAt !== -1 ? argv[outAt + 1] : null;
  const out = resolve(projectDir, outArg && !outArg.startsWith('--') ? outArg : '.palate/index.json');
  mkdirSync(dirname(out), { recursive: true });
  // `generatedAt` is written here rather than inside buildIndex so the index is
  // a pure function of the repo and two runs over unchanged source are byte
  // identical. A timestamp baked into the data makes every rebuild a diff.
  writeFileSync(out, JSON.stringify({ ...index, generatedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(
    `palate-index: ${index.counts.routes} routes, ${index.counts.entries} entries ` +
    `(${index.counts.drafts} draft), ${index.links.orphans.length} orphan(s), ` +
    `${index.links.dead.length} dead link(s) -> ${relative(projectDir, out)}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
