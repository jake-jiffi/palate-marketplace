#!/usr/bin/env node
/**
 * gate-seo.mjs - is the site actually discoverable, and is it advertising the right URLs?
 *
 * ======================== THE BUILDS THAT WROTE THIS FILE ========================
 *
 * The rubric scores answer-engine reach and technical SEO. Nothing in the build enforced
 * either, so both real client builds shipped the same four faults, and every one of them
 * survived a green build, a clean lint and a screenshot that looked right:
 *
 *   1. EIGHT REJECTED CONCEPT HOMEPAGES ADVERTISED TO CRAWLERS. /v1../v8 were live, listed
 *      in sitemap-0.xml, and explicitly Allow: / to GPTBot and ClaudeBot. Work the client
 *      turned down, handed to the answer engines as if it were the site.
 *   2. DYNAMIC ROUTES MISSING FROM THE SITEMAP ENTIRELY. @astrojs/sitemap lists what the
 *      build knows about, and an SSR route with no getStaticPaths is nothing at build time.
 *      On a site whose whole SEO argument was part-number discoverability, not one part
 *      number was in the sitemap. This is the trap, and it is why expected URLs are
 *      enumerated from the content graph and never from the file system.
 *   3. ROBOTS.TXT UNCONDITIONALLY Allow: /. A preview deployment is a real, publicly
 *      fetchable origin, so the scaffold invited indexing of the client's content at a
 *      domain the client does not own.
 *   4. LLMS.TXT LINKS THAT 301 ELSEWHERE. A redirect chain costs nothing to a browser and
 *      is a dropped citation to an answer engine that does not follow it.
 *
 * ============================ WHAT IT REFUSES TO GUESS ============================
 *
 * There is no "probably fine". A build with no output, no sitemap, or a dynamic route whose
 * collection cannot be resolved exits 2 and says which. The reason half the faults above
 * existed is that something reported clean while measuring nothing.
 *
 * Usage:
 *   node gate-seo.mjs [project-dir]                      # disk only: built output + index
 *   node gate-seo.mjs [project-dir] --base http://host   # also fetch, so redirects are real
 *
 * The disk pass answers coverage and canonical for anything prerendered. It cannot answer
 * redirects for a server-rendered route, which is most of them, so a sweep of a deployed
 * origin should always pass --base. What --base cannot reach is reported, not assumed.
 *
 * Exit: 0 clean, 1 findings, 2 cannot check (never a pass).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import { buildIndex } from "./palate-index.mjs";

// ------------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const dir = resolve(argv[0] && !argv[0].startsWith("-") ? argv[0] : ".");
const baseAt = argv.indexOf("--base");
const baseArg = baseAt !== -1 ? argv[baseAt + 1] : null;
const base = baseArg && !baseArg.startsWith("--") ? baseArg.replace(/\/+$/, "") : null;
if (baseAt !== -1 && !base) {
  console.error("gate-seo: --base needs an origin (e.g. --base http://localhost:4321). Nothing checked. NOT a pass.");
  process.exit(2);
}

const findings = [];
const blocked = [];
const add = (what, detail) => findings.push({ what, detail });
const cannot = (what, detail) => blocked.push({ what, detail });

// -------------------------------------------------------------------- helpers
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

function walk(d, out = []) {
  let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (x.name === "node_modules" || x.name === ".git") continue;
    const p = join(d, x.name);
    if (x.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * One path spelling, so a comparison is about coverage and never about a trailing slash.
 * Query and fragment go too: a sitemap entry is a document, not a link.
 */
function norm(p) {
  let s = String(p || "");
  try { s = decodeURI(s); } catch { /* keep the raw form rather than dropping the URL */ }
  s = s.split("#")[0].split("?")[0];
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/{2,}/g, "/");
  return s.length > 1 ? s.replace(/\/+$/, "") : "/";
}

const pathOf = (loc) => { try { return norm(new URL(loc).pathname); } catch { return norm(loc); } };

/**
 * The path EXACTLY as advertised, trailing slash and all.
 *
 * Redirect matching has to use this and never the normalised form. Vercel's generated config
 * carries a trailing-slash normalisation rule (`^/(.*)/$` -> 308), so a sitemap that advertises
 * `/blog/` really is advertising a redirect, and one that advertises `/blog` really is not.
 * Normalising first loses the only bit of information the question turns on.
 */
const rawPathOf = (loc) => {
  try { return new URL(loc).pathname; } catch { return String(loc).split("#")[0].split("?")[0]; }
};

// ------------------------------------------------------- 0. can this be checked at all
if (!existsSync(join(dir, "src", "pages"))) {
  console.error(`gate-seo: no ${join(dir, "src/pages")}. Not an Astro project; nothing checked. NOT a pass.`);
  process.exit(2);
}

const index = buildIndex(dir);
if (!index) {
  console.error("gate-seo: could not build a content index, so expected URLs are unknown. NOT a pass.");
  process.exit(2);
}

// The build output, in the order the adapters produce it. `dist/client` first because the
// Vercel adapter leaves a bare `dist/` behind on some versions and picking it would walk
// server bundles looking for HTML.
const OUT_CANDIDATES = [".vercel/output/static", "dist/client", "dist", "build"];
const outRoot = OUT_CANDIDATES.map((c) => join(dir, c)).find(existsSync) || null;
if (!outRoot) {
  console.error(
    `gate-seo: no build output in ${OUT_CANDIDATES.join(", ")}. The sitemap is a BUILD artefact, ` +
    "so there is nothing to check until the site is built. Run the build first. NOT a pass.",
  );
  process.exit(2);
}

// ---------------------------------------------------------------- 1. the sitemap
// Walked once. Every later section reads this list rather than re-walking, because a delivered
// static site can be thousands of files and five passes over it turns a gate into a wait.
const outFiles = walk(outRoot);

// Sitemaps live at the output root (sitemap-index.xml + sitemap-0.xml). Scanned one level
// deep as well, because a hand-rolled endpoint can prerender to /sitemap/index.xml.
const sitemapFiles = outFiles
  .filter((f) => /sitemap[^/]*\.xml$/i.test(basename(f)))
  .filter((f) => relative(outRoot, f).split(/[\\/]/).length <= 2);

if (!sitemapFiles.length) {
  console.error(
    `gate-seo: no sitemap*.xml in ${relative(dir, outRoot) || outRoot}. Coverage is UNKNOWN, not clean: ` +
    "nothing can say which routes a crawler is being told about. NOT a pass.",
  );
  process.exit(2);
}

const sitemapLocs = [];
for (const f of sitemapFiles) {
  const xml = read(f) || "";
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    // A sitemap index points at other sitemaps; those are files we already read.
    if (/sitemap[^/]*\.xml$/i.test(m[1])) continue;
    sitemapLocs.push({ loc: m[1], path: pathOf(m[1]), raw: rawPathOf(m[1]), from: relative(dir, f) });
  }
}
const sitemapPaths = new Set(sitemapLocs.map((l) => l.path));

// -------------------------------------------------- 2. what SHOULD be in the sitemap
// Enumerated from the content graph. Reading the file system instead is precisely how the
// dynamic routes went missing: on disk `[slug].astro` is one file, and the sitemap it is
// absent from needs one URL per entry.
const NEVER_INDEXED = new Set(["/404", "/500"]);
// Explore variants are never DEMANDED in the sitemap. Whether they belong on the domain at all
// depends on the client having picked, which gate-shipready knows and this gate does not; the
// one thing that is certain either way is that no gate should tell a build to go and advertise
// eight rejected concept homepages to GPTBot.
const IS_VARIANT = (p) => /^\/(v|lp)\d+$/.test(p);
const expected = [];        // { path, why }
const knownRoutes = new Set(); // everything a request could legitimately reach
const noindexPaths = new Set();
const skipped = { variant: 0, noindex: 0 };
// Prefixes of dynamic routes whose URLs could NOT be enumerated. Anything the sitemap advertises
// underneath one of them is unjudgeable, not phantom: the route plainly serves that shape, this
// gate just cannot list which values are real. Calling those 404s would be inventing findings,
// and the honest report is already carrying a "cannot check" for the route itself.
const unresolvedPrefixes = [];
const unresolvable = (r) => unresolvedPrefixes.push(norm(r.path.replace(/\/?\[[^\]]*\].*$/, "")) || "/");

/** Which collection a dynamic route renders, read from its own code rather than its path. */
/**
 * COMMERCE ROUTES ARE ENUMERATED FROM THE CATALOGUE, NOT THE CONTENT GRAPH.
 *
 * `collectionOf` reads a literal getCollection("...") call, which is how a blog names its posts.
 * A storefront has no markdown: /products/[handle] gets its handles from Shopify via
 * getStaticPaths, so this gate reported it "not enumerable" and its sitemap coverage as UNKNOWN
 * on a build whose sitemap was in fact complete. A gate that cannot see 350 of 356 URLs is not
 * measuring the thing it claims to measure.
 *
 * `.palate/catalogue.json` (scripts/palate-shopify.mjs) carries the real routes. ABSENT OR
 * FAILED, THIS RETURNS NULL AND NOTHING CHANGES, so every content-collection build behaves
 * exactly as before.
 */
function commerceUrlsFor(route, dir) {
  let cat = null;
  try { cat = JSON.parse(readFileSync(join(dir, ".palate", "catalogue.json"), "utf8")); } catch { return null; }
  if (!cat || cat.ok !== true || !Array.isArray(cat.routes)) return null;
  // "/products/[handle]" -> every catalogue route under "/products/"
  const prefix = route.path.slice(0, route.path.indexOf("["));
  if (!prefix || prefix === "/") return null;
  const hits = cat.routes.filter((u) => typeof u === "string" && u.startsWith(prefix) && !u.includes("["));
  return hits.length ? hits : null;
}

function collectionOf(route) {
  const src = read(join(dir, route.source)) || "";
  const m = src.match(/\bget(?:Collection|Entry|EntryBySlug)\s*\(\s*["'`]([\w-]+)["'`]/);
  return m ? m[1] : null;
}

for (const r of index.routes) {
  if (r.kind === "endpoint") { knownRoutes.add(r.path); continue; }
  if (NEVER_INDEXED.has(r.path)) { knownRoutes.add(r.path); continue; }

  if (r.kind === "static") {
    knownRoutes.add(norm(r.path));
    if (IS_VARIANT(norm(r.path))) { skipped.variant += 1; continue; }
    // A page that asks the layout for noindex is deliberately out of the index. It is not
    // expected in the sitemap, and its presence there is a contradiction worth naming.
    if (/\bnoindex\b/.test(read(join(dir, r.source)) || "")) {
      noindexPaths.add(norm(r.path)); skipped.noindex += 1; continue;
    }
    expected.push({ path: norm(r.path), why: r.source });
    continue;
  }

  // dynamic
  // More than one bracket segment and the entry id fills only one of them, so every URL this
  // would predict is wrong. Say so rather than emit a page of confident nonsense.
  if ((r.path.match(/\[/g) || []).length > 1) {
    cannot(
      "dynamic route has more than one parameter",
      `${r.path} (${r.source}) takes several parameters and a content entry supplies one, so its real ` +
      "URLs cannot be derived from the content graph. Its sitemap coverage is UNKNOWN.",
    );
    unresolvable(r);
    continue;
  }
  const commerceUrls = commerceUrlsFor(r, dir);
  if (commerceUrls) {
    for (const u of commerceUrls) expected.push({ path: norm(u), why: `${r.source} -> catalogue` });
    continue;
  }
  const collection = collectionOf(r);
  if (!collection) {
    cannot(
      "dynamic route not enumerable",
      `${r.path} (${r.source}) does not name a collection this parser can read, so its real URLs are ` +
      "unknown and its sitemap coverage cannot be judged. Name the collection in a literal " +
      "getCollection(\"...\") / getEntry(\"...\") call, or list its URLs another way.",
    );
    unresolvable(r);
    continue;
  }
  const items = index.entries.filter((e) => e.collection === collection && !e.draft);
  if (!items.length) {
    cannot(
      "dynamic route has no entries",
      `${r.path} renders the "${collection}" collection and the index found no publishable entries in it. ` +
      "Either the collection is empty or the index cannot see it; sitemap coverage for this route is UNKNOWN.",
    );
    unresolvable(r);
    continue;
  }
  for (const e of items) {
    const p = norm(r.path.replace(/\[\.{0,3}[^\]]+\]/, e.id));
    knownRoutes.add(p);
    expected.push({ path: p, why: `${r.source} -> ${e.file}` });
  }
}

// coverage, both directions
const missing = expected.filter((e) => !sitemapPaths.has(e.path));
if (missing.length) {
  const dyn = missing.filter((m) => m.why.includes("->"));
  add(
    "route missing from the sitemap",
    `${missing.length} route(s) the site serves are not advertised: ` +
    `${missing.slice(0, 6).map((m) => m.path).join(", ")}${missing.length > 6 ? `, +${missing.length - 6} more` : ""}. ` +
    (dyn.length
      ? `${dyn.length} of them are collection entries behind a dynamic route. @astrojs/sitemap only lists what ` +
        "the BUILD knows, and an SSR route with no getStaticPaths is nothing at build time, so these are " +
        "invisible to every crawler. Feed them to the integration with sitemap({ customPages: [...] }) or " +
        "prerender the route."
      : "A page nothing advertises is a page nothing ranks."),
  );
}

const expectedSet = new Set(expected.map((e) => e.path));
const underUnresolved = (p) => unresolvedPrefixes.some((pre) => p === pre || p.startsWith((pre === "/" ? "" : pre) + "/"));
const phantom = sitemapLocs.filter((l) => !knownRoutes.has(l.path) && !expectedSet.has(l.path) && !underUnresolved(l.path));
if (phantom.length) {
  add(
    "sitemap advertises a URL no route serves",
    `${phantom.length}: ${phantom.slice(0, 6).map((p) => p.path).join(", ")}` +
    `${phantom.length > 6 ? `, +${phantom.length - 6} more` : ""} (from ${phantom[0].from}). ` +
    "A crawler spends budget on it and gets a 404, and the 404 is what gets recorded about the site.",
  );
}

const noindexAdvertised = [...noindexPaths].filter((p) => sitemapPaths.has(p));
if (noindexAdvertised.length) {
  add(
    "noindex page is in the sitemap",
    `${noindexAdvertised.join(", ")}. The sitemap asks for indexing and the page refuses it. ` +
    "Search Console reports this as an error, not as a preference.",
  );
}

// ------------------------------------------------------------------ 3. redirects
// A redirect inside the sitemap or inside llms.txt is not a browser inconvenience: an answer
// engine that does not follow it records nothing, and the citation is simply lost.
/**
 * A Vercel `source` pattern as a RegExp.
 *
 * Scanned token by token rather than escaped-then-unescaped. The escape-first version looked
 * fine and was silently broken: `*` is not in the escape class, so `(.*)` came out as `\(\.*\)`,
 * the un-escaping pass never matched it, and a declared `/old/(.*)` redirect was simply never
 * detected. A redirect check that quietly finds nothing is the exact failure this gate exists
 * to stop, so the compiler is written the boring way.
 */
function vercelSourceToRegex(source) {
  let out = "^";
  for (let i = 0; i < source.length; ) {
    const rest = source.slice(i);
    let m;
    if ((m = rest.match(/^\(\.\*\)/))) { out += "(?:.*)"; i += m[0].length; continue; }
    if ((m = rest.match(/^:\w+\*/)))   { out += "(?:.*)"; i += m[0].length; continue; }
    if ((m = rest.match(/^:\w+/)))     { out += "[^/]+";  i += m[0].length; continue; }
    if (rest[0] === "*")               { out += "(?:.*)"; i += 1; continue; }
    out += source[i].replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    i += 1;
  }
  return new RegExp(out + "/?$");
}

function collectRedirects(projectDir) {
  const out = [];

  // The built Vercel config is the truth for a Vercel deploy: it is what the edge runs.
  const vc = read(join(projectDir, ".vercel/output/config.json"));
  if (vc) {
    let cfg = null; try { cfg = JSON.parse(vc); } catch { /* reported below */ }
    if (!cfg) cannot("redirect table unreadable", ".vercel/output/config.json is not valid JSON, so declared redirects are UNKNOWN.");
    for (const r of cfg?.routes || []) {
      if (!r || typeof r.src !== "string") continue;
      const status = r.status ?? r.statusCode;
      if (!(status >= 300 && status < 400)) continue;
      try { out.push({ re: new RegExp(r.src), where: ".vercel/output/config.json", to: r.headers?.Location ?? r.dest ?? "?" }); }
      catch { /* a src this engine cannot compile is not a finding, it is one fewer check */ }
    }
  }

  // vercel.json redirects: authored source patterns, so :param and (.*) have to be translated.
  const vj = read(join(projectDir, "vercel.json"));
  if (vj) {
    let cfg = null; try { cfg = JSON.parse(vj); } catch { /* reported below */ }
    if (!cfg) cannot("redirect table unreadable", "vercel.json is not valid JSON, so declared redirects are UNKNOWN.");
    for (const r of cfg?.redirects || []) {
      if (!r || typeof r.source !== "string") continue;
      try { out.push({ re: vercelSourceToRegex(r.source), where: "vercel.json", to: r.destination ?? "?" }); }
      catch { /* a pattern this engine cannot compile is one fewer check, not a finding */ }
    }
  }

  // astro.config redirects, read syntactically. No bundler, no install.
  for (const name of ["astro.config.mjs", "astro.config.ts", "astro.config.js"]) {
    const src = read(join(projectDir, name));
    if (!src) continue;
    const block = src.match(/redirects\s*:\s*\{([\s\S]*?)\}/);
    if (!block) continue;
    for (const m of block[1].matchAll(/["'`](\/[^"'`]*)["'`]\s*:/g)) {
      const from = norm(m[1]).replace(/\[[^\]]+\]/g, "[^/]+");
      try { out.push({ re: new RegExp(`^${from}/?$`), where: name, to: "?" }); } catch { /* skip */ }
    }
  }
  return out;
}

const redirects = collectRedirects(dir);
// Matched on the path AS ADVERTISED. Probing the trailing-slash variant as well seemed harmless
// and was not: Vercel's generated config normalises trailing slashes with `^/(.*)/$` -> 308, so
// every route in the sitemap matched it and the gate produced one false finding per URL. A gate
// that fires on everything gets switched off, which costs more than the check was worth.
const redirectHit = (p) => redirects.find((r) => { try { return r.re.test(p); } catch { return false; } });

// One finding, not one per URL. On a site where the sitemap advertises trailing slashes and the
// host strips them, that is three hundred lines of the same sentence.
const sitemapRedirects = sitemapLocs.map((l) => ({ l, hit: redirectHit(l.raw) })).filter((x) => x.hit);
if (sitemapRedirects.length) {
  const { l, hit } = sitemapRedirects[0];
  add(
    "sitemap advertises a redirect",
    `${sitemapRedirects.length} of ${sitemapLocs.length} sitemap URL(s) match a declared redirect, e.g. ` +
    `${l.raw} via ${hit.where} (-> ${hit.to})` +
    `${sitemapRedirects.length > 1 ? `; also ${sitemapRedirects.slice(1, 4).map((x) => x.l.raw).join(", ")}` : ""}. ` +
    "Crawlers are being pointed at URLs that are not the destination, and an answer engine that does " +
    "not follow the hop records nothing.",
  );
}

// llms.txt / agents.md, if the build produced them. These are the answer-engine surfaces, so a
// dead link in one costs a citation rather than a click.
const AGENT_FILES = ["llms.txt", "llms-full.txt", "agents.md", "agent.md"];
const agentSurfaces = [];
for (const name of AGENT_FILES) {
  const f = outFiles.find((p) => basename(p).toLowerCase() === name);
  if (f) agentSurfaces.push({ name, body: read(f) || "", where: relative(dir, f) });
}
for (const s of agentSurfaces) {
  const links = new Set([
    ...[...s.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]),
    ...[...s.body.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0]),
  ]);
  for (const raw of links) {
    const p = pathOf(raw);
    const hit = redirectHit(rawPathOf(raw));
    if (hit) add("llms.txt link redirects", `${s.where} links ${rawPathOf(raw)}, which matches a ${hit.where} redirect (-> ${hit.to}).`);
    else if (/^https?:/.test(raw) === false && !knownRoutes.has(p) && !expectedSet.has(p) && !sitemapPaths.has(p)) {
      add("llms.txt link goes nowhere", `${s.where} links ${p}, which no route in the index serves.`);
    }
  }
}
if (!agentSurfaces.length) {
  cannot(
    "answer-engine surfaces not in the build output",
    `none of ${AGENT_FILES.join(", ")} was prerendered, so their links were not checked. They are ` +
    "server-rendered endpoints on this scaffold; pass --base <origin> against a running site to check them.",
  );
}

// ------------------------------------------------------------------ 4. canonical
// Self-referential means the page names ITSELF. A canonical copied between templates is the
// commonest way a whole section collapses onto one URL in an index, and it looks correct.
const htmlFiles = outFiles.filter((f) => f.endsWith(".html"));
function routeOfHtml(f) {
  let r = relative(outRoot, f).replace(/\\/g, "/").replace(/\.html$/, "");
  if (r.endsWith("/index")) r = r.slice(0, -"/index".length);
  if (r === "index") r = "";
  return norm("/" + r);
}
let canonicalChecked = 0;
for (const f of htmlFiles) {
  const route = routeOfHtml(f);
  if (NEVER_INDEXED.has(route)) continue;
  const html = read(f) || "";
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  if (!m) {
    add("no canonical", `${relative(dir, f)} (${route}) renders no <link rel="canonical">. Every duplicate spelling of this URL competes with it.`);
    continue;
  }
  const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) { add("empty canonical", `${relative(dir, f)} (${route}) has a canonical tag with no href.`); continue; }
  canonicalChecked += 1;
  if (pathOf(href) !== route) {
    add("canonical is not self-referential", `${route} declares its canonical as ${pathOf(href)}. The page is telling crawlers to index a different URL.`);
  }
}
if (!htmlFiles.length) {
  cannot(
    "no prerendered HTML in the build output",
    `${relative(dir, outRoot) || outRoot} contains no .html, so canonical tags could not be read. This build is ` +
    "server-rendered; pass --base <origin> against a running site to check canonicals.",
  );
}

// --------------------------------------------------------- 5. robots is environment aware
// The scaffold used to emit Allow: / on every deployment. A preview is a real public origin,
// so that invited indexing of a client's content at a domain the client does not own.
const robotsSrc = ["src/pages/robots.txt.ts", "src/pages/robots.txt.js", "src/pages/robots.txt.astro"]
  .map((p) => ({ p, body: read(join(dir, p)) }))
  .find((x) => x.body);
const robotsBuilt = outFiles.find((f) => basename(f) === "robots.txt");

if (!robotsSrc && !robotsBuilt && !read(join(dir, "public/robots.txt"))) {
  add("no robots.txt", "the site serves no robots.txt at all, so there is no Sitemap: line and no crawler policy.");
} else if (robotsSrc) {
  const envAware = /VERCEL_ENV|PUBLIC_SITE_ENV|SITE_ENV|import\.meta\.env\.(DEV|PROD)/.test(robotsSrc.body);
  const canBlock = /Disallow:\s*\//.test(robotsSrc.body);
  if (!envAware || !canBlock) {
    add(
      "robots.txt is not environment aware",
      `${robotsSrc.p} emits the same policy everywhere (` +
      `${envAware ? "reads an env var but never emits Disallow: /" : "no environment or host condition"}` +
      "). Every preview deployment is a public origin inviting indexing of the client's content at a " +
      "domain they do not own, which is duplicate content they cannot see and cannot take down.",
    );
  }
}

// ------------------------------------------------------------------- 6. live pass
// Only a request answers "does this redirect". Everything above is what disk can prove.
if (base) {
  const MAX = 200;
  const targets = [...new Set([
    ...sitemapLocs.map((l) => l.path),
    ...expected.map((e) => e.path),
    ...agentSurfaces.flatMap((s) => [...s.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => norm(m[1]))),
    ...(robotsSrc || robotsBuilt ? ["/robots.txt"] : []),
    ...AGENT_FILES.map((n) => "/" + n),
  ])];
  const checkList = targets.slice(0, MAX);
  if (targets.length > MAX) {
    cannot("live pass truncated", `${targets.length} URLs to fetch, checked the first ${MAX}. The rest are UNCHECKED, not clean.`);
  }

  let reachable = 0;
  for (const p of checkList) {
    const url = base + (p === "/" ? "/" : p);
    let res;
    // Bounded, because an origin behind a firewall that black-holes the connection will
    // otherwise hold the gate open for the OS connect timeout and the run reads as hung
    // rather than as blocked.
    try { res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "palate-gate-seo" } }); }
    catch (err) {
      cannot("origin unreachable", `${url} could not be fetched (${err.message}). Everything behind it is UNCHECKED.`);
      break;
    }
    reachable += 1;

    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location") || "?";
      const advertised = sitemapPaths.has(p);
      // A 404-file or an unrelated probe redirecting is noise; an ADVERTISED URL redirecting
      // is the fault. Expected routes are advertised by the site's own structure.
      if (advertised || expected.some((e) => e.path === p)) {
        add(
          "advertised URL redirects",
          `${p} returns ${res.status} -> ${to}. ${advertised ? "It is in the sitemap" : "It is a route the site serves"}, ` +
          "so crawlers and answer engines are being sent to a URL that is not the one being advertised.",
        );
      }
      continue;
    }

    if (res.status === 404 && sitemapPaths.has(p)) {
      add("advertised URL 404s", `${p} is in the sitemap and returns 404.`);
      continue;
    }
    if (res.status >= 400) continue; // llms.txt absent on a site that has none is not a finding here

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) continue;
    const body = await res.text();
    const tag = body.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
    if (!tag) { add("no canonical", `${p} renders no <link rel="canonical"> (fetched from ${base}).`); continue; }
    const href = tag[0].match(/href=["']([^"']+)["']/i)?.[1];
    canonicalChecked += 1;
    if (!href) add("empty canonical", `${p} has a canonical tag with no href.`);
    else if (pathOf(href) !== p) add("canonical is not self-referential", `${p} declares its canonical as ${pathOf(href)} (fetched from ${base}).`);
  }
  if (!reachable) {
    console.error(`gate-seo: nothing at ${base} answered. The live pass measured nothing. NOT a pass.`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------- report
// The exclusions are named out loud. A route quietly dropped from `expected` is a route whose
// absence from the sitemap can never be reported, so the count has to be visible in the one
// line a person actually reads.
const scope =
  `${expected.length} expected URL(s), ${sitemapPaths.size} advertised, ` +
  `${canonicalChecked} canonical(s) read` +
  (skipped.noindex ? `, ${skipped.noindex} noindex page(s) excluded` : "") +
  (skipped.variant ? `, ${skipped.variant} Explore variant(s) excluded` : "") +
  `${base ? `, live against ${base}` : ", disk only"}`;

if (blocked.length) {
  console.error(`gate-seo: ${blocked.length} thing(s) could NOT be checked. These are unknown, not clean.\n`);
  for (const b of blocked) console.error(`  [${b.what}] ${b.detail}`);
  if (findings.length) console.error("");
}

if (findings.length) {
  console.error(`gate-seo: ${findings.length} finding(s) over ${scope}.\n`);
  for (const f of findings) console.error(`  [${f.what}] ${f.detail}`);
  process.exit(1);
}

if (blocked.length) process.exit(2);

console.log(`gate-seo: clean (${scope}); sitemap covers every route, no advertised redirect, canonicals self-referential, robots is environment aware.`);
process.exit(0);
