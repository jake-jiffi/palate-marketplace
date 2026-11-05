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
import { invokedDirectly } from "./lib/invoked-directly.mjs";

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

/**
 * The config with its comment LINES removed, so a setting is read and prose is not.
 *
 * This repo has already been bitten once: a test grepped the whole Astro config and matched
 * `output: "server"` inside the comment explaining why it is no longer server, and reported the
 * opposite of the truth. A commented-out `format: "file"` or an old `site:` would do the same
 * here, and both change what every URL in the build is compared against.
 *
 * Whole lines only. Stripping `//` anywhere would cut `site: "https://example.com"` in half,
 * which is the sort of fix that creates the bug it was written to prevent.
 */
const withoutComments = (src) =>
  src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/**
 * The built output, in the order the adapters produce it. `dist/client` before `dist` because
 * the Vercel adapter leaves a bare `dist/` behind on some versions and picking it would walk
 * server bundles looking for HTML.
 */
/**
 * EXPLORE SCAFFOLDING IS NOT A PAGE OF THE SITE, in any direction.
 *
 * `/explore`, the `/boards/bN` direction boards and the older `/vN` and `/lpN` variants all
 * exist for one conversation and are archived at Compose. Three reports would otherwise be
 * wrong about them, and `/publish` reads the first two as not done:
 *
 *   NOT A DEAD LINK. A page that still links a board after Compose has archived it is a real
 *   href to a route that has gone, and the page carrying it is on its way out too. The built
 *   page knows that; a source read cannot.
 *
 *   NOT AN ORPHAN. This is the half the rename exposed and it was measured on the merged
 *   tree: a scaffold with two boards and no dist reported orphans ["/404", "/blog",
 *   "/boards/b1", "/boards/b2", "/contact"]. `/explore` and the switcher reach the boards
 *   through `href={v.href}`, an expression rather than a literal, so a source read cannot see
 *   the link at all; `/explore` itself escaped only because the switcher happens to carry a
 *   literal href to it, which is luck rather than a rule. A board is not meant to be linked
 *   from the site: it is meant to be handed over once and then deleted.
 *
 *   NOT A CLAIM ABOUT THE BUSINESS. Rungs differ in their copy on purpose, so `gate-facts`
 *   read a board's number as the site contradicting itself, during the one stage whose whole
 *   job is to show a range. It was exported for that caller rather than copied.
 *
 * gate-seo excludes the same shapes from its sitemap expectation (`IS_VARIANT`), and
 * gate-shipready fails a hand-over that still carries `src/pages/boards/`.
 */
export const EXPLORE_ROUTE = (h) => h === '/explore' || /^\/(v|lp)\d+$/.test(h) || /^\/boards\//.test(h);

/**
 * Routes that exist to be SERVED ON A MISS. They are nobody's claim about the business and
 * nothing is meant to link to them, so a stale number on a 404 page is not the site
 * disagreeing with itself and an unlinked 404 is not a page somebody forgot to link.
 *
 * Exported because gate-seo and gate-facts each kept their own copy of this set, and the
 * orphan report here had none, so `/404` was reported as an orphan on every build the
 * scaffold has ever produced.
 */
export const NEVER_INDEXED = new Set(['/404', '/500']);

export const OUT_CANDIDATES = ['.vercel/output/static', 'dist/client', 'dist', 'build'];
export const findOutputRoot = (projectDir) =>
  OUT_CANDIDATES.map((c) => join(projectDir, c)).find(existsSync) || null;

/** Every built page under an output root, with the route each one serves. */
export function builtPages(outRoot) {
  const out = [];
  for (const f of walk(outRoot)) {
    if (!f.endsWith('.html')) continue;
    let r = relative(outRoot, f).replace(/\\/g, '/').replace(/\.html$/, '');
    // Build artefacts, not pages. `_astro` and `pagefind` are Astro's and pagefind's own.
    if (/(^|\/)(_astro|pagefind)\//.test(r)) continue;
    if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
    if (r === 'index') r = '';
    out.push({ file: f, route: ('/' + r).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') });
  }
  return out;
}

/**
 * Which spelling the OUTPUT uses, or null when there is not enough of it to tell.
 *
 * A page written as `about.html` beside `index.html` is file format; one written as
 * `about/index.html` is directory. `index.html`, `404.html` and `500.html` sit at the root in
 * both, so they answer nothing and are skipped.
 */
export function formatOfOutput(outRoot) {
  let sawPage = false;
  for (const { file } of builtPages(outRoot)) {
    const rel = relative(outRoot, file).replace(/\\/g, '/');
    if (/^(index|404|500)\.html$/.test(rel)) continue;
    if (!rel.endsWith('/index.html')) return 'file';
    sawPage = true;
  }
  return sawPage ? 'directory' : null;
}

/** Is @astrojs/vercel wired into the config? It rewrites build.format whatever the config says. */
function usesVercelAdapter(projectDir) {
  for (const name of ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']) {
    const src = read(join(projectDir, name));
    if (src && /@astrojs\/vercel/.test(withoutComments(src))) return true;
  }
  return false;
}

/**
 * Which URL spelling this build produces. THE BUILT OUTPUT IS THE TRUTH when there is one.
 *
 * `@astrojs/vercel` calls `updateConfig({ build: { format: "directory" } })` unconditionally in
 * astro:config:setup, so a project declaring "file" and using the default adapter SHIPS
 * directory. Reading the config alone made both tools strip `.html` from forty-one hrefs that
 * really do 404 on that host, and report a clean site: a check that says the opposite of the
 * truth, which is the class this repo exists to hunt.
 *
 * With no output to read, the adapter still decides: declared "file" plus the Vercel adapter is
 * directory, and it warns, because that disagreement is a defect in the project rather than a
 * detail of this gate.
 */
export function resolveBuildFormat(projectDir) {
  const declared = readBuildFormat(projectDir);
  const vercel = usesVercelAdapter(projectDir);
  const outRoot = findOutputRoot(projectDir);
  const observed = outRoot ? formatOfOutput(outRoot) : null;

  let format = declared;
  let source = 'astro.config';
  if (observed) { format = observed; source = relative(projectDir, outRoot) || 'the build output'; }
  else if (declared === 'file' && vercel) { format = 'directory'; source = 'the @astrojs/vercel adapter'; }

  const warning = declared === 'file' && format !== 'file' && vercel
    ? `astro.config declares build.format "file" and @astrojs/vercel overrides it to "directory" ` +
      `at build time, so this build serves /about/ and NOT /about.html. Reading ${source}. ` +
      'Remove the format from the config, or change host.'
    : null;
  return { format, source, warning };
}

/**
 * `build.format` from the Astro config, read syntactically. No bundler, no install.
 *
 * "file" writes /about.html, "directory" writes /about/index.html, "preserve" mirrors the
 * source tree. Prefer `resolveBuildFormat`: this is what the project ASKED for, which is not
 * always what it ships.
 *
 * Unreadable or absent is "directory", which is Astro's own default.
 */
export function readBuildFormat(projectDir) {
  for (const name of ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']) {
    const src = read(join(projectDir, name));
    if (!src) continue;
    const block = withoutComments(src).match(/build\s*:\s*\{([\s\S]*?)\}/);
    const m = block && block[1].match(/format\s*:\s*["'`](file|directory|preserve)["'`]/);
    if (m) return m[1];
  }
  return 'directory';
}

/**
 * One spelling for a path the site serves. Under "file" the `.html` is part of the URL's
 * spelling and not part of its identity; under any other format /about.html really is a
 * different URL from /about, and stripping it there would hide a real 404.
 */
export function normalisePath(href, format) {
  let s = String(href || '').replace(/\/$/, '') || '/';
  if (format === 'file' && /\.html$/i.test(s)) s = s.replace(/(\/index)?\.html$/i, '') || '/';
  return s || '/';
}

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

/**
 * A route, or an asset?
 *
 * BaseLayout carries `<link rel="icon" href="/favicon.svg">`, and once the closure is read
 * that href lands on every route in the site and then reports as a broken page. A last
 * segment with an extension is a file the site serves, not a route it renders. `.html` is the
 * exception both ways: under build.format "file" it IS the route, and under any other format
 * it is a link that really does 404, which is the case the format keying exists for.
 */
const isRouteHref = (h) => {
  const last = h.split('/').pop() || '';
  return !last.includes('.') || /\.html?$/i.test(last);
};

/** Internal route hrefs one file emits, in this build's own URL spelling. */
function hrefsIn(file, format) {
  const src = read(file);
  return [...src.matchAll(/href=["'](\/[^"'#?]*)/g)]
    .map((m) => normalisePath(m[1], format))
    .filter(isRouteHref);
}

/**
 * Every internal href a ROUTE emits: its own page file plus every file in its `dependsOn`
 * closure, so a nav that lives in a Header component counts as links from the pages that
 * render it. Reading the page file alone produced an EMPTY link graph on the shipped
 * template, which made every page in the nav an orphan and every orphan report meaningless.
 *
 * The second argument is a per-file href reader rather than the index: this runs while the
 * index is being built, so there is no index to hand it yet.
 */
function internalLinks(route, hrefsOf) {
  const out = new Set();
  for (const f of [route.source, ...route.dependsOn]) for (const h of hrefsOf(f)) out.add(h);
  return [...out];
}

// -------------------------------------------------------------------- build

export function buildIndex(projectDir) {
  const srcDir = join(projectDir, 'src');
  const pagesDir = join(srcDir, 'pages');
  if (!existsSync(pagesDir)) return null;
  const { format } = resolveBuildFormat(projectDir);

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
      links: [],
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));

  // Links. THE BUILT PAGE IS THE TRUTH when there is one.
  //
  // Reading the source closure was right in one way and wrong in another: it found the nav that
  // lives in a Header component, and it also found hrefs that never render. The shared layout
  // mounts ExploreSwitcher, whose `href="/explore"` is inside a `{show && ...}` that is false
  // once the variant registry is cleared, so every finished Palate site reported a dead link to
  // a page Compose had deleted, and `/publish` reads a dead link as not done.
  //
  // A built page cannot lie about what it emitted. The closure walk stays as the fallback for a
  // repo that has not been built, where a link graph from source is better than none.
  //
  // TRUSTED PER ROUTE, AND ONLY WHILE IT IS NEWER THAN THE SOURCE. The index runs before any
  // build in /check's caps lane and /edit never re-indexes after building, so trusting a stale
  // build meant a dead href added in source was invisible until after the deploy, which is
  // exactly when the cap /check documents was supposed to have fired.
  const outRoot = findOutputRoot(projectDir);
  const pages = outRoot ? builtPages(outRoot) : [];
  const mtimeOf = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  // When the build ran. A route with NO built page is only trusted as "rendered nothing" if the
  // build is newer than it: a draft-only [slug] route, an endpoint and an on-demand page all
  // legitimately produce no HTML, and falling back for those would put the switcher's
  // unrendered href="/explore" straight back into every composed site.
  const buildTime = pages.length ? Math.max(...pages.map((p) => mtimeOf(p.file))) : 0;

  const byRoute = new Map(routes.map((r) => [r.path, r]));
  const dynamic = routes.filter((r) => r.kind === 'dynamic');
  const built = new Map();
  for (const { file, route } of pages) {
    // A built entry page belongs to the dynamic route that rendered it: /blog/welcome is the
    // output of /blog/[slug], and the route is what carries a link list.
    const owner = byRoute.get(route)
      || dynamic.find((r) => route.startsWith(r.path.replace(/\/\[[^\]]+\]$/, '') + '/'));
    if (!owner) continue;
    if (!built.has(owner.path)) built.set(owner.path, []);
    built.get(owner.path).push(file);
  }

  const hrefCache = new Map();
  const hrefsOf = (abs) => {
    if (!hrefCache.has(abs)) hrefCache.set(abs, hrefsIn(abs, format));
    return hrefCache.get(abs);
  };
  let linksParsed = 0;
  let staleRoutes = 0;
  const linkFiles = new Set();

  for (const r of routes) {
    const files = built.get(r.path) || [];
    const sourceFiles = [r.source, ...r.dependsOn].map((f) => join(projectDir, f));
    const newestSource = Math.max(0, ...sourceFiles.map(mtimeOf));
    const trusted = files.length ? Math.min(...files.map(mtimeOf)) >= newestSource : buildTime >= newestSource;
    if (pages.length && !trusted) staleRoutes += 1;
    const hrefs = new Set();
    for (const f of (trusted ? files : sourceFiles)) {
      const found = hrefsOf(f);
      if (!linkFiles.has(f)) { linkFiles.add(f); linksParsed += found.length; }
      for (const h of found) hrefs.add(h);
    }
    r.links = [...hrefs];
  }

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
  //
  // COMPUTED ONLY WHEN A LINK WAS ACTUALLY PARSED. Zero links parsed is the signature of a
  // parser that saw nothing, and "every page is an orphan" is then a fact about this script
  // rather than about the site. That is precisely the report the empty graph used to produce.
  const linked = new Set(routes.flatMap((r) => r.links));
  const orphans = linksParsed === 0 ? [] : routes
    .filter((r) => r.kind === 'static' && r.path !== '/' && !linked.has(r.path)
      && !EXPLORE_ROUTE(r.path) && !NEVER_INDEXED.has(r.path))
    .map((r) => r.path);

  // Dead internal links: an href to a path no route serves. Dynamic routes are
  // matched by prefix, since /blog/[slug] serves /blog/anything.
  const dynamicPrefixes = routes.filter((r) => r.kind === 'dynamic').map((r) => r.path.replace(/\/\[[^\]]+\]$/, ''));
  const served = new Set(routes.map((r) => r.path));
  const dead = [...new Set(routes.flatMap((r) => r.links))]
    .filter((h) => !served.has(h) && !EXPLORE_ROUTE(h) && !dynamicPrefixes.some((p) => h.startsWith(p + '/')));

  return {
    version: 1,
    // Recorded so blastRadius can read a route's source without being told where the project is.
    projectDir,
    routes, entries, facts,
    links: { orphans, dead, parsed: linksParsed, files: linkFiles.size, stale: staleRoutes },
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
/**
 * Does this route read the content layer at all?
 *
 * Read from the source rather than inferred from the path, because a project can name its content
 * routes anything. The closure is included so a route that reads content through a shared loader
 * still counts. Unreadable files answer TRUE, which keeps the fail-wide posture: over-checking is
 * slow, under-checking passes the change that broke the site.
 */
const CONTENT_READ = /astro:content|getCollection\s*\(|getEntry\s*\(|loadPage\s*\(|content\.config/;
const contentReadCache = new Map();
function routeReadsContent(index, route) {
  if (contentReadCache.has(route.source)) return contentReadCache.get(route.source);
  const root = index.projectDir || process.cwd();
  let answer = false;
  for (const rel of [route.source, ...route.dependsOn]) {
    try {
      if (CONTENT_READ.test(readFileSync(join(root, rel), 'utf8'))) { answer = true; break; }
    } catch {
      answer = true; // Cannot read it, so cannot rule it out.
      break;
    }
  }
  contentReadCache.set(route.source, answer);
  return answer;
}

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
      //
      // A DYNAMIC ROUTE IS ONLY A CONTENT ROUTE IF IT READS CONTENT. The first version
      // substituted the entry's id into EVERY dynamic route, which was harmless while the only
      // dynamic routes were the blog's, and stopped being harmless the moment the template grew
      // section-demo routes: a one-line blog edit then planned /kit/[piece]/welcome and
      // /kit-frame/[piece]/[variation]/welcome, neither of which any post can change, and the
      // scope it reported climbed from narrow to moderate for no reason. Routes that read the
      // content layer say so, in their own source or somewhere in their import closure.
      for (const r of index.routes) {
        const readsContent = r.kind === 'endpoint' ? false : routeReadsContent(index, r);
        if (r.kind === 'dynamic' && r.path.includes('[')) {
          if (readsContent) hit.add(r.path.replace(/\[[^\]]+\]$/, entry.id));
        } else if (r.kind === 'static' && r.dependsOn.some((d) => d.endsWith('content.config.ts'))) hit.add(r.path);
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

  // /publish reads the INDEX, not the gate, so an operator seeing forty-five dead links had no
  // cause to read. The two tools now say the same thing about the same defect.
  const { warning } = resolveBuildFormat(projectDir);
  if (warning) console.error(`palate-index: ${warning}`);

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
  // The link counts are printed because the orphan and dead-link numbers are only worth
  // reading once something has been parsed. "0 parsed across 41 files" says the graph is
  // empty; "0 orphans" on its own said the site was fine.
  console.log(
    `palate-index: ${index.counts.routes} routes, ${index.counts.entries} entries ` +
    `(${index.counts.drafts} draft), links: ${index.links.parsed} parsed across ${index.links.files} files, ` +
    (index.links.parsed === 0
      ? 'orphans not computed'
      : `${index.links.orphans.length} orphan(s)`) +
    `, ${index.links.dead.length} dead link(s) -> ${relative(projectDir, out)}`,
  );
  // Said out loud, because the answer came from a different place than usual and the difference
  // is the whole point: a route whose source moved since the build is read from source.
  if (index.links.stale) {
    console.log(
      `palate-index: built output older than source for ${index.links.stale} route(s), ` +
      'links read from source. Rebuild to read what the site actually ships.',
    );
  }
}

if (invokedDirectly(import.meta.url)) main();
