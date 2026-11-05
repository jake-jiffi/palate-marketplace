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
 *   node gate-seo.mjs [project-dir] --site https://host  # the origin canonicals must name
 *   node gate-seo.mjs [project-dir] --base ... --no-hsts # an origin that terminates TLS elsewhere
 *
 * The disk pass answers coverage and canonical for anything prerendered. It cannot answer
 * redirects for a server-rendered route, which is most of them, so a sweep of a deployed
 * origin should always pass --base. What --base cannot reach is reported, not assumed.
 *
 * Exit: 0 clean, 1 findings, 2 cannot check (never a pass).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import { buildIndex, resolveBuildFormat, OUT_CANDIDATES, findOutputRoot, NEVER_INDEXED } from "./palate-index.mjs";

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
const siteAt = argv.indexOf("--site");
const siteArg = siteAt !== -1 ? argv[siteAt + 1] : null;
const siteOverride = siteArg && !siteArg.startsWith("--") ? siteArg.replace(/\/+$/, "") : null;
if (siteAt !== -1 && !siteOverride) {
  console.error("gate-seo: --site needs an origin (e.g. --site https://example.com). Nothing checked. NOT a pass.");
  process.exit(2);
}
// `example.com` is not a URL, so it would have been discarded and the comparison would have run
// against the config or the sitemap instead: the operator asks for one origin and silently gets
// another. Refused rather than dropped.
if (siteOverride && !/^[a-z][a-z0-9+.-]*:\/\//i.test(siteOverride)) {
  console.error(
    `gate-seo: --site must include a scheme (got "${siteOverride}", try https://${siteOverride}). ` +
    "Nothing checked. NOT a pass.",
  );
  process.exit(2);
}

// Which URL spelling this build produces. Read once, because `norm` runs on every sitemap
// entry, every route and every canonical. THE BUILT OUTPUT IS THE TRUTH: @astrojs/vercel
// overrides build.format, so the config is what the project asked for and not what it ships.
const { format: BUILD_FORMAT, source: FORMAT_FROM, warning: FORMAT_WARNING } = resolveBuildFormat(dir);
if (FORMAT_WARNING) console.error(`gate-seo: ${FORMAT_WARNING}\n`);

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
  // Under build.format: "file" the site's own URLs END .html, so the extension is part of the
  // spelling and not part of the identity. Only under that format: elsewhere /about.html is a
  // different URL from /about, and normalising it away would report a crawl trap as clean.
  if (BUILD_FORMAT === "file" && /\.html$/i.test(s)) s = s.replace(/(\/index)?\.html$/i, "") || "/";
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

/** The origin of an absolute URL, or null when the string is not one. */
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u); } };

/**
 * A few routes out of a list, for a finding that would otherwise be the same sentence on every
 * page of the site. Deduplicated: with --base a page is read twice, once off disk and once off
 * the origin, and the same route listed twice reads as two broken pages.
 */
const someRoutes = (raw) => {
  const rs = [...new Set(raw)];
  return `${rs.slice(0, 6).join(", ")}${rs.length > 6 ? `, +${rs.length - 6} more` : ""}`;
};
const countRoutes = (raw) => new Set(raw).size;

/**
 * The site's own origin as the Astro config declares it. A STRING LITERAL ONLY.
 *
 * The shipped scaffold writes `site: siteUrl`, built from an env var the gate cannot see, so
 * this returns null there and the sitemap answers instead. Resolving the expression would mean
 * comparing every canonical against `https://{{DOMAIN}}`, which is a placeholder wearing the
 * costume of a measurement.
 *
 * Comment LINES are dropped first: a commented-out `site:` from the domain the client used to
 * be on would otherwise win over the live sitemap and report every correct canonical as wrong.
 * Whole lines only, because stripping `//` anywhere cuts `https://example.com` in half.
 */
function readSiteFromConfig(projectDir) {
  for (const name of ["astro.config.mjs", "astro.config.ts", "astro.config.js"]) {
    const src = read(join(projectDir, name));
    if (!src) continue;
    const body = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const m = body.match(/(?:^|[\s,{])site\s*:\s*["']([^"']+)["']/m);
    if (m && !m[1].includes("{{") && originOf(m[1])) return m[1];
  }
  return null;
}

/**
 * Does this canonical name THIS page on THIS site?
 *
 * Comparing the pathname alone passed a canonical on somebody else's domain: /about matched
 * /about and the page handed its ranking to a host nobody here owns. Origin first, because a
 * foreign origin makes the path irrelevant. `site` null means the origin half is unmeasured,
 * which is reported once at the end rather than guessed at per page.
 */
function canonicalMismatch(href, route, site) {
  const want = site ? originOf(site) : null;
  const got = originOf(href);
  if (want && got && got !== want) return { kind: "origin", expected: hostOf(want), actual: hostOf(got) };
  const p = pathOf(href);
  if (p !== route) return { kind: "path", expected: route, actual: p };
  return null;
}

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
const outRoot = findOutputRoot(dir);
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

// ------------------------------------------------------- 1b. the site's own origin
// Three sources, most explicit first. The sitemap is last and is a real measurement rather than
// a guess: @astrojs/sitemap writes absolute URLs from `site`, so a build that advertises one
// origin and renders canonicals on another is the fault this is here to catch. Several origins
// in one sitemap answer nothing, so that reads as unknown.
const configSite = readSiteFromConfig(dir);
const sitemapOrigins = [...new Set(sitemapLocs.map((l) => originOf(l.loc)).filter(Boolean))];
const siteOrigin =
  (siteOverride && originOf(siteOverride)) ||
  (configSite && originOf(configSite)) ||
  (sitemapOrigins.length === 1 ? sitemapOrigins[0] : null);
const siteFrom = siteOverride && originOf(siteOverride)
  ? "--site"
  : configSite && originOf(configSite)
    ? "astro.config"
    : siteOrigin ? "the sitemap" : null;

// -------------------------------------------------- 2. what SHOULD be in the sitemap
// Enumerated from the content graph. Reading the file system instead is precisely how the
// dynamic routes went missing: on disk `[slug].astro` is one file, and the sitemap it is
// absent from needs one URL per entry.
// Explore variants are never DEMANDED in the sitemap. Whether they belong on the domain at all
// depends on the client having picked, which gate-shipready knows and this gate does not; the
// one thing that is certain either way is that no gate should tell a build to go and advertise
// eight rejected concept homepages to GPTBot.
// `/boards/bN` is the current shape and `/vN` / `/lpN` the older one. Both are Explore
// scaffolding: deleted at Compose, and never something a gate should tell a build to advertise.
const IS_VARIANT = (p) => /^\/(v|lp)\d+$/.test(p) || /^\/boards\//.test(p);
const expected = [];        // { path, why }
const knownRoutes = new Set(); // everything a request could legitimately reach
const noindexPaths = new Set();
// Entry URLs of the collection the BLOG route renders, so a post can be asked for an Article
// node and nothing else is.
//
// Keyed on the collection, never on "is this a dynamic route". Every collection entry used to
// count as a post, so a build with services, team, locations or case-studies behind a [slug]
// route was told its structured data had the wrong type on every one of those pages, and a
// correct site was refused at hand-over. The scaffold could not show it: it ships one collection.
const POST_COLLECTIONS = new Set(["posts", "post", "blog", "news", "articles"]);
const postPaths = new Set();
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
    if (POST_COLLECTIONS.has(collection.toLowerCase())) postPaths.add(p);
    expected.push({ path: p, why: `${r.source} -> ${e.file}` });
  }
}

// NOTHING TO COMPARE IS NOT A CLEAN CRAWL SURFACE. With no expected URL the coverage check,
// the phantom check and the canonical pass all run over an empty list and report nothing,
// so the gate used to hand back a verdict about a site whose routes it had never seen.
if (!expected.length) {
  console.error(
    `gate-seo: skipped (nothing to inspect: the content index lists no route under ` +
    `${relative(dir, join(dir, "src/pages"))}, so coverage, canonicals and redirects have nothing to measure). NOT a pass.`,
  );
  process.exit(2);
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

// ----------------------------------------------------------- 3b. structured data
// The rubric scores structured data and nothing measured it, so a build could ship a page with
// no entity at all, a block Google silently drops because of a trailing comma, or an entity
// copied from the reference the build was grounded on and still pointing at their domain.
const ORG_TYPES = new Set(["Organization", "LocalBusiness"]);
const ARTICLE_TYPES = new Set(["Article", "BlogPosting", "NewsArticle"]);
const LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Every TYPED node in one JSON-LD document: the document itself, an array of documents, or a
 * @graph. Nested properties are deliberately not walked: a post's `publisher` and an
 * organisation's `address` are parts of their parent, not separate entities, and counting them
 * would make a correct page look like it declares three.
 */
function ldNodes(v, out = []) {
  if (Array.isArray(v)) { for (const x of v) ldNodes(x, out); return out; }
  if (!v || typeof v !== "object") return out;
  if (Array.isArray(v["@graph"])) ldNodes(v["@graph"], out);
  if (v["@type"]) out.push(v);
  return out;
}
const ldTypes = (n) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).map(String);
const isOrgNode = (n) => ldTypes(n).some((t) => ORG_TYPES.has(t));

/**
 * The structured data on one page. `kind` is "home", "post" or "page".
 *
 * Returns `{ findings, orgs }`: findings as tokens so the caller can group them into one line
 * per fault rather than one line per page, and the organisation identities so the sitewide
 * "which business is this" question can be answered across the whole build.
 */
function checkJsonLd(html, kind, site) {
  const out = { findings: [], orgs: [] };
  const blocks = [...html.matchAll(LD_RE)].map((m) => m[1].trim()).filter(Boolean);
  if (!blocks.length) { out.findings.push("missing"); return out; }

  const nodes = [];
  for (const b of blocks) {
    let doc = null;
    try { doc = JSON.parse(b); } catch { out.findings.push("unparsable"); continue; }
    ldNodes(doc, nodes);
  }
  if (!nodes.length && !out.findings.length) out.findings.push("missing");

  if (kind === "home" && !nodes.some(isOrgNode)) out.findings.push("type");
  if (kind === "post" && !nodes.some((n) => ldTypes(n).some((t) => ARTICLE_TYPES.has(t)))) out.findings.push("type");

  if (site) {
    const want = originOf(site);
    for (const n of nodes) {
      const u = typeof n.url === "string" ? originOf(n.url) : null;
      if (u && u !== want) { out.findings.push("origin"); break; }
    }
  }
  for (const n of nodes.filter(isOrgNode)) out.orgs.push(String(n.name ?? n["@id"] ?? n.url ?? "an unnamed organisation"));
  return out;
}

const ldFindings = { missing: [], unparsable: [], type: [], origin: [] };
const ldOrgs = new Set();
const ldKind = (route) => (route === "/" ? "home" : postPaths.has(route) ? "post" : "page");
function readJsonLd(html, route) {
  const r = checkJsonLd(html, ldKind(route), siteOrigin);
  for (const f of r.findings) ldFindings[f].push(route);
  for (const o of r.orgs) ldOrgs.add(o);
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
  readJsonLd(html, route);
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  if (!m) {
    add("no canonical", `${relative(dir, f)} (${route}) renders no <link rel="canonical">. Every duplicate spelling of this URL competes with it.`);
    continue;
  }
  const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) { add("empty canonical", `${relative(dir, f)} (${route}) has a canonical tag with no href.`); continue; }
  canonicalChecked += 1;
  const wrong = canonicalMismatch(href, route, siteOrigin);
  if (wrong?.kind === "origin") {
    add(
      "canonical points at another origin",
      `${route} canonical points at ${wrong.actual} (site is ${wrong.expected}): ${href}. The page is handing ` +
      "its ranking to a host this site does not control, and the path matching is why it looked correct.",
    );
  } else if (wrong) {
    add("canonical is not self-referential", `${route} declares its canonical as ${wrong.actual}. The page is telling crawlers to index a different URL.`);
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
const robotsBuiltFile = outFiles.find((f) => basename(f) === "robots.txt");
const robotsBuilt = robotsBuiltFile ? read(robotsBuiltFile) : null;
const robotsPublic = read(join(dir, "public/robots.txt"));

if (!robotsSrc && !robotsBuiltFile && !robotsPublic) {
  add("no robots.txt", "the site serves no robots.txt at all, so there is no Sitemap: line and no crawler policy.");
} else if (robotsSrc && robotsPublic) {
  // Both exist, both look right on their own, and nothing in the build says which one answers.
  // The static file is copied into the output verbatim and served ahead of the route, so the
  // environment-aware endpoint is dead code and the fixed policy is what every deployment gets.
  add(
    "static robots.txt shadows the SSR route",
    `public/robots.txt is copied into the build verbatim and served ahead of ${robotsSrc.p}, so the ` +
    "environment-aware route never runs. Whatever the route would have said on a preview, the fixed " +
    "file is the policy on every deployment. Delete one of them.",
  );
} else if (robotsSrc || robotsPublic || robotsBuiltFile) {
  // The source when there is one, otherwise whatever the build actually serves. A fixed file
  // cannot read an environment, so this is where a hand-written robots.txt is caught.
  const where = robotsSrc ? robotsSrc.p : robotsPublic ? "public/robots.txt" : relative(dir, robotsBuiltFile);
  const body = robotsSrc ? robotsSrc.body : robotsPublic || robotsBuilt || "";
  const envAware = /VERCEL_ENV|PUBLIC_SITE_ENV|SITE_ENV|import\.meta\.env\.(DEV|PROD)/.test(body);
  const canBlock = /Disallow:\s*\//.test(body);
  if (!envAware || !canBlock) {
    add(
      "robots.txt is not environment aware",
      `${where} emits the same policy everywhere (` +
      `${envAware ? "reads an env var but never emits Disallow: /" : "no environment or host condition"}` +
      "). Every preview deployment is a public origin inviting indexing of the client's content at a " +
      "domain they do not own, which is duplicate content they cannot see and cannot take down.",
    );
  }
}

// ------------------------------------------------------------------- 6. live pass
// Only a request answers "does this redirect", and only a request answers "what headers does
// the edge actually send". A template can ship four security headers in vercel.json and the
// deployed origin send none of them, and nothing here looked.
const SECURITY_HEADERS = [
  ["content-security-policy", "Content-Security-Policy",
   "nothing constrains what the page may load or execute, so one injected script has the whole origin."],
  ["x-content-type-options", "X-Content-Type-Options",
   "a browser may sniff a response into a type it was not served as."],
  ["x-frame-options", "X-Frame-Options",
   "the page can be framed by anyone, which is what clickjacking needs."],
  ["referrer-policy", "Referrer-Policy",
   "the full URL of the page travels to every third party the page loads."],
  ["permissions-policy", "Permissions-Policy",
   "camera, microphone and geolocation stay available to any frame the page embeds."],
];
const HSTS = ["strict-transport-security", "Strict-Transport-Security",
  "a first visit over http is interceptable and the browser has no instruction to stay on https."];
const noHsts = argv.includes("--no-hsts");
// A browser IGNORES HSTS over http and the edge only sends it on https, so demanding it on a
// localhost sweep would fire on every correct build. Not silent about it: the reason is printed.
const hstsReason = noHsts ? "--no-hsts" : base && !base.startsWith("https:") ? "the origin is http" : null;
const headersChecked = [...SECURITY_HEADERS, ...(hstsReason ? [] : [HSTS])];
const headersMissing = Object.fromEntries(headersChecked.map(([h]) => [h, []]));
let headerPages = 0;

/**
 * Is the origin being swept the site's OWN origin, rather than a preview or a localhost?
 *
 * This is what makes a noindex meaning-bearing. A preview is supposed to carry noindex, and
 * firing there would train everyone to ignore the finding; on the real domain the same tag
 * removes the whole site from search with nothing failing anywhere.
 */
const sweepingProduction = Boolean(base && siteOrigin && originOf(base) === siteOrigin);

/**
 * Does the `*` group close the whole site?
 *
 * Parsed as GROUPS rather than grepped, because the two ways to get this wrong both matter.
 * `Disallow: /admin` is not a closed site and every site has one of those, so a substring test
 * would fire on nearly all of them. And an EMPTY `User-agent:` value names no agent at all, so
 * a group that follows it is not the `*` group: reading it as one would report a preview as
 * correctly closed while every crawler walked in.
 */
function disallowsEverything(body) {
  const lines = String(body || "").split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  let agents = [];
  let collecting = false;
  let starGroup = false;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // Consecutive User-agent lines name one group. A rule ends the run, so the next
      // User-agent after it starts a NEW group rather than joining the old one: without the
      // reset a `*` group anywhere in the file would make every later group count as `*`, and
      // `Disallow: /` under `User-agent: GPTBot` would read as the whole site being closed.
      if (!collecting) { agents = []; collecting = true; }
      // Matched exactly, so `User-agent:` with an empty value names no agent and the group that
      // follows it is not the `*` group.
      agents.push(value.toLowerCase());
      starGroup = agents.includes("*");
      continue;
    }
    collecting = false;
    if (starGroup && key === "disallow" && value === "/") return true;
  }
  return false;
}
let liveRobots = null;
const productionNoindex = [];
const META_ROBOTS = /<meta\b[^>]*>/gi;
const saysNoindex = (html, headerValue) =>
  /noindex/i.test(headerValue || "") ||
  [...html.matchAll(META_ROBOTS)].some(
    (m) => /name=["']robots["']/i.test(m[0]) && /content=["'][^"']*noindex/i.test(m[0]),
  );

if (base) {
  const MAX = 200;
  const targets = [...new Set([
    ...sitemapLocs.map((l) => l.path),
    ...expected.map((e) => e.path),
    ...agentSurfaces.flatMap((s) => [...s.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => norm(m[1]))),
    ...(robotsSrc || robotsBuiltFile || robotsPublic ? ["/robots.txt"] : []),
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

    // The served robots.txt is the only place a deployment's ACTUAL policy can be observed. The
    // disk pass reads the route's source and can say it is CAPABLE of closing; only a request
    // says whether it did. Read before the content-type gate, which is what skipped it.
    if (p === "/robots.txt") { liveRobots = await res.text(); continue; }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) continue;
    // Documents only. X-Frame-Options on robots.txt protects nothing and would turn one
    // missing header into a finding per asset.
    headerPages += 1;
    for (const [h] of headersChecked) if (!res.headers.get(h)) headersMissing[h].push(p);
    const body = await res.text();
    if (sweepingProduction && saysNoindex(body, res.headers.get("x-robots-tag"))) productionNoindex.push(p);
    readJsonLd(body, p);
    const tag = body.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
    if (!tag) { add("no canonical", `${p} renders no <link rel="canonical"> (fetched from ${base}).`); continue; }
    const href = tag[0].match(/href=["']([^"']+)["']/i)?.[1];
    canonicalChecked += 1;
    if (!href) { add("empty canonical", `${p} has a canonical tag with no href.`); continue; }
    const wrong = canonicalMismatch(href, p, siteOrigin);
    if (wrong?.kind === "origin") {
      add(
        "canonical points at another origin",
        `${p} canonical points at ${wrong.actual} (site is ${wrong.expected}): ${href} (fetched from ${base}).`,
      );
    } else if (wrong) {
      add("canonical is not self-referential", `${p} declares its canonical as ${wrong.actual} (fetched from ${base}).`);
    }
  }
  if (!reachable) {
    console.error(`gate-seo: nothing at ${base} answered. The live pass measured nothing. NOT a pass.`);
    process.exit(2);
  }
}

// What the origin's robots.txt actually says, which is a different question from whether the
// route COULD say it. Both directions are faults and they are opposite ones.
if (base && liveRobots !== null) {
  const closed = disallowsEverything(liveRobots);
  if (sweepingProduction && closed) {
    add(
      "production robots.txt disallows everything",
      `${base}/robots.txt disallows / for every crawler, and this IS the site's own origin. ` +
      "The live site is closed to search and nothing else reports a fault.",
    );
  } else if (!sweepingProduction && !closed) {
    add(
      "preview robots.txt does not disallow",
      `${base}/robots.txt does not disallow / for every crawler. This origin is not the site's own, ` +
      "so it is a public copy of a client's content on a domain they do not own, and it is inviting " +
      "indexing. Check the environment the deployment was built with.",
    );
  }
} else if (base && (robotsSrc || robotsBuiltFile || robotsPublic)) {
  cannot(
    "served robots.txt not read",
    `${base}/robots.txt returned nothing readable, so the policy this deployment actually serves is ` +
    "UNKNOWN. The source on disk was judged; what the origin answers was not.",
  );
}

// The site's own origin telling crawlers to forget it. This is the failure the noindex default
// trades against: a build that cannot prove it is production noindexes itself, and every page
// leaves the index with nothing failing anywhere. It is only a finding on the real origin.
if (productionNoindex.length) {
  add(
    "production renders noindex",
    `production renders noindex on ${someRoutes(productionNoindex)} ` +
    `(${countRoutes(productionNoindex)} of ${headerPages} page(s) fetched from ${base}, which IS this site's ` +
    "own origin). Either the deployment cannot tell it is production, or something is setting the tag " +
    "deliberately. Set PUBLIC_SITE_ENV=production on the build, or remove the tag.",
  );
}

// One finding per header, naming the pages that lack it. A deployment sends the same headers
// to every route, so a per-page finding would be the same sentence two hundred times.
for (const [h, name, why] of headersChecked) {
  const miss = headersMissing[h];
  if (!miss.length) continue;
  add(
    `no ${name}`,
    `${miss.length} of ${headerPages} page(s) fetched from ${base} send no ${name}, e.g. ` +
    `${miss.slice(0, 3).join(", ")}. ${why}`,
  );
}

// Structured data, grouped. One line per fault naming up to six routes, because a site whose
// layout emits none has the same sentence on every page and three hundred of them is how a
// gate stops being read.
if (ldFindings.missing.length) {
  add(
    "page renders no structured data",
    `${countRoutes(ldFindings.missing)} page(s): ${someRoutes(ldFindings.missing)}. Nothing tells an answer engine ` +
    "what this page is about, and the rubric scores structured data whether or not anything emits it.",
  );
}
if (ldFindings.unparsable.length) {
  add(
    "structured data does not parse",
    `${countRoutes(ldFindings.unparsable)} page(s): ${someRoutes(ldFindings.unparsable)}. A parser drops the whole ` +
    "block, so the page carries the markup and none of the meaning, and it looks correct in the source.",
  );
}
if (ldFindings.type.length) {
  add(
    "wrong type of structured data for the page",
    `${countRoutes(ldFindings.type)} page(s): ${someRoutes(ldFindings.type)}. A home page needs an ` +
    "Organization or LocalBusiness node, and a post needs an Article, BlogPosting or NewsArticle " +
    "node. Only the collection the blog route renders is asked for one: a services or team page " +
    "is not. The wrong type is not a near miss, it makes the page ineligible for the result it " +
    "was written for.",
  );
}
if (ldFindings.origin.length) {
  add(
    "structured data names another origin",
    `${countRoutes(ldFindings.origin)} page(s): ${someRoutes(ldFindings.origin)} carry a node whose url is not on ` +
    `${siteOrigin ? hostOf(siteOrigin) : "this site"}. An entity copied from the reference a build was ` +
    "grounded on keeps pointing at their domain, and the structured data then describes them.",
  );
}
if (ldOrgs.size > 1) {
  add(
    "the site describes more than one organisation",
    `${[...ldOrgs].join(", ")}. Structured data across the build names several businesses, so nothing can ` +
    "say which one this site is about. One entity, defined once, on every page.",
  );
}

// A canonical whose PATH was read and whose ORIGIN was not is half checked, and the unchecked
// half is the one that hands a page to another domain. Said once, after both passes.
if (canonicalChecked && !siteOrigin) {
  cannot(
    "canonical origin not compared",
    `${canonicalChecked} canonical(s) had their path checked and their origin NOT checked, because nothing ` +
    "here declares the site's own origin: no --site, no literal site: in astro.config.*, and no single " +
    "absolute origin in the sitemap. A canonical on somebody else's domain would read as correct. " +
    "Pass --site <origin>.",
  );
}

// ---------------------------------------------------------------------- report
// The exclusions are named out loud. A route quietly dropped from `expected` is a route whose
// absence from the sitemap can never be reported, so the count has to be visible in the one
// line a person actually reads.
const scope =
  `${expected.length} expected URL(s), ${sitemapPaths.size} advertised, ` +
  `${canonicalChecked} canonical(s) read` +
  (siteOrigin ? `, site ${hostOf(siteOrigin)} (from ${siteFrom})` : ", site origin unknown") +
  `, ${BUILD_FORMAT} URLs (from ${FORMAT_FROM})` +
  (skipped.noindex ? `, ${skipped.noindex} noindex page(s) excluded` : "") +
  (skipped.variant ? `, ${skipped.variant} Explore variant(s) excluded` : "") +
  `${base ? `, live against ${base}` : ", disk only"}` +
  (base ? `, ${headerPages} page(s) read for security headers` : "") +
  (base && hstsReason ? `, HSTS not checked (${hstsReason})` : "");

if (blocked.length) {
  console.error(`gate-seo: ${blocked.length} thing(s) could NOT be checked. These are unknown, not clean.\n`);
  for (const b of blocked) console.error(`  [${b.what}] ${b.detail}`);
  if (findings.length) console.error("");
}

if (findings.length) {
  console.error(`gate-seo: ${findings.length} finding(s) over ${scope} (inspected ${expected.length} route(s)).\n`);
  for (const f of findings) console.error(`  [${f.what}] ${f.detail}`);
  process.exit(1);
}

// A GATE THAT READ THE SITE IS NOT A GATE THAT DID NOT RUN.
//
// Reaching this line means every finding-producing check came back clean and at least one
// thing above could not be judged. The scaffold ships one blog post and it is a draft, so
// `/blog/[slug]` has no publishable entry and this fires on EVERY Palate site until the client
// publishes something: three routes inspected, canonicals read, sitemap coverage confirmed,
// robots environment-aware, and one unknown. The caller could only read exit 2 as "did not
// run", so the operator's summary said `seo=skipped` about a gate that had read the site.
//
// The exit code does NOT move. Cannot-check is never a pass, that rule is load-bearing and
// every earlier rung here (no src/pages, no index, no build output, no sitemap, no route to
// compare) exits 2 having genuinely read nothing. What changes is that this path now SAYS how
// much it read, so the caller can tell the two apart and report `seo=partial (3 route(s)
// checked, 1 unknown)`. The unknowns themselves are already printed above.
if (blocked.length) {
  console.error(
    `gate-seo: partial (${expected.length} route(s) checked, ${blocked.length} unknown); everything ` +
    `checked was clean and the unknown(s) above are unknown, not clean (${scope}). NOT a full pass.`,
  );
  process.exit(2);
}

console.log(`gate-seo: clean (${scope}); sitemap covers every route, no advertised redirect, canonicals self-referential, robots is environment aware (inspected ${expected.length} route(s)).`);
process.exit(0);
