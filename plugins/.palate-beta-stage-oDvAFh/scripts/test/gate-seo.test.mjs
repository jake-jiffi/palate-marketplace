/**
 * gate-seo: the crawl surface, and the four faults that shipped on real client builds.
 *
 * The directions that matter, because a gate that only ever fires gets switched off and a gate
 * that never fires was never a gate:
 *
 *   1. A CLEAN BUILT SITE IS SILENT and exits 0.
 *   2. EACH FAULT FIRES ON ITS OWN, so the finding names the actual cause.
 *   3. ANYTHING UNCHECKABLE EXITS 2, never 0. Half the faults below existed because something
 *      reported clean while measuring nothing.
 *   4. THE LIVE PASS IS NOT DEAD CODE. It is exercised against a real server that really
 *      redirects, because a redirect is the one thing disk cannot prove.
 *
 * Run: node --test scripts/test/gate-seo.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "gate-seo.mjs");
const TEMPLATE = join(HERE, "..", "..", "templates", "astro-project");

const roots = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "gate-seo-"));
  roots.push(d);
  return d;
}
process.on("exit", () => { for (const d of roots) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };

/** A built, delivered site with nothing wrong with it. Every case below starts here. */
function scaffold() {
  const p = tmp();
  write(join(p, "src/pages/index.astro"), "---\n---\n<h1>Home</h1>\n");
  write(join(p, "src/pages/blog/index.astro"), "---\n---\n<h1>Blog</h1>\n");
  write(
    join(p, "src/pages/blog/[slug].astro"),
    '---\nimport { getEntry } from "astro:content";\nconst post = await getEntry("posts", Astro.params.slug);\n---\n<h1>post</h1>\n',
  );
  write(join(p, "src/content/posts/welcome.md"), "---\ntitle: Welcome\ndraft: false\n---\nhi\n");
  // The shipped scaffold endpoint, so the environment-awareness check is measured against the
  // real file rather than against a stand-in that could drift from it.
  write(join(p, "src/pages/robots.txt.ts"), readFileSync(join(TEMPLATE, "src/pages/robots.txt.ts"), "utf8"));

  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/"]);
  page(p, "index.html", "/");
  page(p, "blog/index.html", "/blog");
  page(p, "blog/welcome/index.html", "/blog/welcome", [ORG, POST("/blog/welcome")]);
  write(join(p, "dist/llms.txt"), "# Example\n\n## Recent writing\n- [Welcome](/blog/welcome): hi\n");
  write(join(p, "dist/robots.txt"), "User-agent: *\nAllow: /\n");
  return p;
}

const sitemap = (p, locs) =>
  write(
    join(p, "dist/sitemap-0.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>\n`,
  );

// The structured data the scaffold's own BaseLayout emits on every page, and the BlogPosting
// its post template adds. Written out here so a fixture is a real page rather than a shape.
const ORG = { "@context": "https://schema.org", "@type": "Organization", name: "Example", url: "https://ex.com" };
const POST = (path) => ({ "@context": "https://schema.org", "@type": "BlogPosting", headline: "Welcome", url: `https://ex.com${path}` });
const ldScript = (n) => `<script type="application/ld+json">${typeof n === "string" ? n : JSON.stringify(n)}</script>`;

/**
 * One built page. `canonical` is a path on the fixture's own host, or a whole absolute URL when
 * a test needs the canonical to point somewhere else, or null for a page carrying none. `ld` is
 * the structured data: nodes, raw strings for a page whose JSON is broken, or null for none.
 */
const page = (p, file, canonical, ld = [ORG]) =>
  write(
    join(p, "dist", file),
    `<!doctype html><html><head><title>x</title>` +
    `${canonical === null ? "" : `<link rel="canonical" href="${/^https?:/.test(canonical) ? canonical : `https://ex.com${canonical}`}">`}` +
    `${ld === null ? "" : ld.map(ldScript).join("")}</head><body>x</body></html>`,
  );

function run(p, ...args) {
  const r = spawnSync(process.execPath, [GATE, p, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * The live pass has to run ASYNCHRONOUSLY. spawnSync blocks this process's event loop, so the
 * fixture server below never gets to accept the connection and the gate times out against a
 * server that is listening. That looked exactly like a broken live pass, and was not.
 */
function runAsync(p, ...args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [GATE, p, ...args], { encoding: "utf8" });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => res({ code, out }));
  });
}

// ------------------------------------------------------------------ 1. silence

test("a clean built site passes and says what it measured", () => {
  const r = run(scaffold());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /clean/);
  assert.match(r.out, /3 expected URL\(s\), 3 advertised/);
});

// ------------------------------------------------- 2. the faults, one at a time

test("collection entries missing from the sitemap fire, and the finding names the trap", () => {
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/"]); // the dynamic route dropped
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /route missing from the sitemap/);
  assert.match(r.out, /\/blog\/welcome/);
  assert.match(r.out, /getStaticPaths/, "the finding must explain why the build could not see it");
});

test("a dynamic route is enumerated from the content graph, not the file system", () => {
  // The bug this exists for: on disk `[slug].astro` is ONE file, so any file-system-derived
  // expectation is satisfied by a sitemap containing zero posts.
  const p = scaffold();
  write(join(p, "src/content/posts/second.md"), "---\ntitle: Second\ndraft: false\n---\nhi\n");
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\/blog\/second/);
});

test("a draft entry is not expected in the sitemap", () => {
  const p = scaffold();
  write(join(p, "src/content/posts/wip.md"), "---\ntitle: WIP\ndraft: true\n---\nhi\n");
  assert.equal(run(p).code, 0);
});

test("a sitemap URL no route serves fires", () => {
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/", "https://ex.com/v7/"]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a URL no route serves/);
  assert.match(r.out, /\/v7/);
});

test("a stale entry URL left in the sitemap is caught under a RESOLVED dynamic route", () => {
  // The post was deleted, the sitemap still advertises it. This is the case the phantom check
  // is for, and it has to keep working after the exemption added below.
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/", "https://ex.com/blog/deleted/"]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a URL no route serves/);
  assert.match(r.out, /\/blog\/deleted/);
});

test("URLs under an UNENUMERABLE dynamic route are not called phantoms", () => {
  // They were. The route plainly serves that shape and the gate simply cannot list which values
  // are real, so reporting each one as a 404 is inventing findings. The route already carries
  // its own "cannot check", which is the honest half.
  const p = scaffold();
  write(join(p, "src/pages/blog/[slug].astro"), "---\nconst c = COLLECTION;\nconst post = await getEntry(c, Astro.params.slug);\n---\n<h1>x</h1>\n");
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/whatever-this-is/"]);
  write(join(p, "dist/llms.txt"), "# Example\n");
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /no route serves/);
});

test("a canonical pointing somewhere else fires", () => {
  const p = scaffold();
  page(p, "blog/welcome/index.html", "/blog", [ORG, POST("/blog/welcome")]); // copied between templates, the usual cause
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /canonical is not self-referential/);
  assert.match(r.out, /\/blog\/welcome declares its canonical as \/blog/);
});

test("a canonical on ANOTHER HOST fires and names both hosts", () => {
  // Comparing the pathname alone passed this: /blog/welcome matched /blog/welcome, and the page
  // was handing its ranking to a domain nobody here owns. The origin is the half that mattered.
  const p = scaffold();
  page(p, "blog/welcome/index.html", "https://evil.example/blog/welcome", [ORG, POST("/blog/welcome")]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /canonical points at evil\.example \(site is ex\.com\)/);
});

test("astro.config's site is what the canonical origin is compared against", () => {
  // The site moved domain, the config followed and the canonicals did not. Nothing on disk
  // except the config knows the new home, so the config has to be read.
  const p = scaffold();
  write(join(p, "astro.config.mjs"), 'export default { site: "https://good.example" };\n');
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /canonical points at ex\.com \(site is good\.example\)/);
});

test("a commented-out site: in the config is prose, not a setting", () => {
  // This repo has been bitten by exactly this once already, when a test matched output: "server"
  // inside the comment explaining why it is no longer server. An old domain left in a comment
  // would report every correct canonical on the site as pointing at the wrong host.
  const p = scaffold();
  write(join(p, "astro.config.mjs"), '// site: "https://we-moved-off-this.example",\nexport default { output: "static" };\n');
  const r = run(p);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /site ex\.com/);
});

test("--site overrides the config, so a deploy on another origin can be checked", () => {
  const p = scaffold();
  write(join(p, "astro.config.mjs"), 'export default { site: "https://good.example" };\n');
  const r = run(p, "--site", "https://ex.com");
  assert.equal(r.code, 0, r.out);
});

test("--site without a scheme blocks rather than being silently dropped", () => {
  // It passed the empty-value guard, then failed to parse as a URL, so the override was
  // discarded and the comparison ran against the config or the sitemap instead. The operator
  // asked for one origin and got another, with nothing said.
  const r = run(scaffold(), "--site", "example.com");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /site must include a scheme/);
});

test("--site with no value blocks rather than silently skipping the origin check", () => {
  const r = run(scaffold(), "--site");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /--site needs an origin/);
});

test("with no site anywhere the origin comparison is reported unmeasured, never passed", () => {
  // A relative sitemap gives the gate paths and no origin. Reporting clean here would mean a
  // canonical on a stranger's domain reads as correct, which is the fault this task is about.
  const p = scaffold();
  sitemap(p, ["/", "/blog/", "/blog/welcome/"]);
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /canonical origin not compared/);
  assert.match(r.out, /--site/);
});

test("a page with no canonical at all fires", () => {
  const p = scaffold();
  page(p, "blog/index.html", null);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no canonical/);
});

test("under build.format \"file\" the site's .html URLs are its real URLs", () => {
  // Every URL on a file-format build ends .html, and the gate compared them against routes that
  // do not, so a correct sitemap read as one phantom plus one missing route per page and every
  // canonical read as pointing somewhere else.
  const p = scaffold();
  write(join(p, "astro.config.mjs"), 'export default { site: "https://ex.com", build: { format: "file" } };\n');
  rmSync(join(p, "dist/blog/index.html"));
  rmSync(join(p, "dist/blog/welcome/index.html"), { recursive: true });
  sitemap(p, ["https://ex.com/", "https://ex.com/blog.html", "https://ex.com/blog/welcome.html"]);
  page(p, "blog.html", "/blog.html");
  page(p, "blog/welcome.html", "/blog/welcome.html", [ORG, POST("/blog/welcome.html")]);
  const r = run(p);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /3 expected URL\(s\), 3 advertised/);
});

test("the Vercel adapter overrides the config, so the gate reads the build and warns", () => {
  // @astrojs/vercel forces build.format to "directory". Reading the config, the gate stripped
  // .html from every href and canonical and reported a site whose .html URLs 404 as clean:
  // a check saying the opposite of the truth, on the scaffold's default adapter.
  const p = scaffold();
  write(
    join(p, "astro.config.mjs"),
    'import vercel from "@astrojs/vercel";\nexport default { site: "https://ex.com", adapter: vercel(), build: { format: "file" } };\n',
  );
  sitemap(p, ["https://ex.com/", "https://ex.com/blog.html", "https://ex.com/blog/welcome/"]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /overrides it to "directory"/);
  assert.match(r.out, /sitemap advertises a URL no route serves/);
  assert.match(r.out, /\/blog\.html/);
  assert.match(r.out, /directory URLs \(from/);
});

test("without that format a .html URL in the sitemap is still a phantom", () => {
  // The strip is keyed on the format for a reason: on a directory-format host /blog.html is a
  // 404, and a gate that normalised it away would report a crawl trap as clean.
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog.html", "https://ex.com/blog/welcome/"]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a URL no route serves/);
  assert.match(r.out, /\/blog\.html/);
});

test("a sitemap URL that matches a declared redirect fires", () => {
  const p = scaffold();
  write(join(p, "vercel.json"), JSON.stringify({ redirects: [{ source: "/blog/:slug", destination: "/writing/:slug", permanent: true }] }));
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a redirect/);
  assert.match(r.out, /\/blog\/welcome/);
});

test("a vercel.json (.*) redirect is actually detected", () => {
  // It was not. Escaping the source before un-escaping the wildcards produced `\(\.*\)`, which
  // matches nothing, so a declared catch-all redirect went undetected and the gate said clean.
  const p = scaffold();
  write(join(p, "vercel.json"), JSON.stringify({ redirects: [{ source: "/blog/(.*)", destination: "/writing/$1", permanent: true }] }));
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a redirect/);
});

test("a trailing-slash normalisation rule does NOT flag every URL in the sitemap", () => {
  // Vercel's generated config normalises trailing slashes with ^/(.*)/$ -> 308. Probing the
  // trailing-slash variant of every path made that rule match all of them, so a real build
  // produced one false finding per URL, which is how a gate gets switched off.
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog", "https://ex.com/blog/welcome"]);
  write(join(p, ".vercel/output/config.json"), JSON.stringify({
    routes: [{ src: "^/(.*)/$", headers: { Location: "/$1" }, status: 308 }],
  }));
  const r = run(p);
  assert.equal(r.code, 0, r.out);
});

test("but a sitemap that advertises the slashed form IS flagged by that same rule", () => {
  // The other side of the same coin, and the reason the raw advertised path is what gets matched.
  const p = scaffold();
  write(join(p, ".vercel/output/config.json"), JSON.stringify({
    routes: [{ src: "^/(.*)/$", headers: { Location: "/$1" }, status: 308 }],
  }));
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sitemap advertises a redirect/);
  assert.match(r.out, /2 of 3 sitemap URL\(s\)/, "it must report ONE grouped finding, not one per URL");
});

test("Explore variants are never demanded in the sitemap, and the exclusion is stated", () => {
  // The gate must not tell a build to go and advertise eight rejected concept homepages.
  // Whether they belong on the domain at all is gate-shipready's question, not this one's.
  const p = scaffold();
  write(join(p, "src/pages/v1.astro"), "---\n---\n<h1>v1</h1>\n");
  write(join(p, "src/pages/v2.astro"), "---\n---\n<h1>v2</h1>\n");
  const r = run(p);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 Explore variant\(s\) excluded/);
});

test("a dynamic route with two parameters blocks rather than predicting wrong URLs", () => {
  const p = scaffold();
  write(
    join(p, "src/pages/[lang]/[slug].astro"),
    '---\nimport { getEntry } from "astro:content";\nconst post = await getEntry("posts", Astro.params.slug);\n---\n<h1>x</h1>\n',
  );
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /more than one parameter/);
});

test("an llms.txt link that redirects fires against the answer-engine surface", () => {
  const p = scaffold();
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/"]);
  write(join(p, "src/content/posts/welcome.md"), "---\ntitle: Welcome\ndraft: true\n---\nhi\n"); // keep coverage clean
  write(join(p, "dist/llms.txt"), "# Example\n\n- [Welcome](/blog/welcome): hi\n");
  write(join(p, "astro.config.mjs"), 'export default { redirects: { "/blog/welcome": "/writing/welcome" } };\n');
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /llms\.txt link redirects/);
});

test("an llms.txt link to a route nothing serves fires", () => {
  const p = scaffold();
  write(join(p, "dist/llms.txt"), "# Example\n\n- [Gone](/services/plumbing): hi\n");
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /llms\.txt link goes nowhere/);
  assert.match(r.out, /\/services\/plumbing/);
});

test("a noindex page advertised in the sitemap fires", () => {
  const p = scaffold();
  write(join(p, "src/pages/thanks.astro"), '---\n---\n<BaseLayout noindex={true}><h1>Thanks</h1></BaseLayout>\n');
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/", "https://ex.com/thanks/"]);
  page(p, "thanks/index.html", "/thanks");
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /noindex page is in the sitemap/);
});

// ---------------------------------------------------------- 2b. structured data

test("a page with no structured data fires", () => {
  const p = scaffold();
  page(p, "blog/index.html", "/blog", null);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /renders no structured data/);
  assert.match(r.out, /\/blog\b/);
});

test("structured data that does not parse fires, and is not read as missing", () => {
  // A trailing comma is invisible in the page and invisible to a grep for ld+json. Google
  // drops the whole block, so the page has the markup and none of the meaning.
  const p = scaffold();
  page(p, "blog/index.html", "/blog", ['{"@context":"https://schema.org","@type":"Organization",}']);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /structured data does not parse/);
});

test("a home page with no Organisation node fires", () => {
  const p = scaffold();
  page(p, "index.html", "/", [{ "@context": "https://schema.org", "@type": "WebSite", name: "Example" }]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /wrong type of structured data/);
  assert.match(r.out, /Organization or LocalBusiness/);
});

test("a LocalBusiness satisfies the home page, so a trades site is not told it is broken", () => {
  const p = scaffold();
  page(p, "index.html", "/", [{ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Example", url: "https://ex.com" }]);
  assert.equal(run(p).code, 0);
});

test("a post with no Article node fires", () => {
  const p = scaffold();
  page(p, "blog/welcome/index.html", "/blog/welcome", [ORG]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /wrong type of structured data/);
  assert.match(r.out, /Article, BlogPosting or NewsArticle/);
});

test("a NON-BLOG collection is not asked for an Article", () => {
  // Every collection entry was classified as a post, so a build with services, team, locations
  // or case-studies behind a [slug] route was told its structured data had the wrong type on
  // every one of those pages. A correct site refused at hand-over, and the scaffold could not
  // show it because it ships one collection.
  const p = scaffold();
  write(
    join(p, "src/pages/services/[slug].astro"),
    '---\nimport { getEntry } from "astro:content";\nconst s = await getEntry("services", Astro.params.slug);\n---\n<h1>s</h1>\n',
  );
  write(join(p, "src/content/services/roofing.md"), "---\ntitle: Roofing\ndraft: false\n---\nhi\n");
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/", "https://ex.com/services/roofing/"]);
  page(p, "services/roofing/index.html", "/services/roofing");
  const r = run(p);
  assert.equal(r.code, 0, r.out);
});

test("a news collection still counts as a post, and NewsArticle satisfies it", () => {
  const p = scaffold();
  write(
    join(p, "src/pages/news/[slug].astro"),
    '---\nimport { getEntry } from "astro:content";\nconst n = await getEntry("news", Astro.params.slug);\n---\n<h1>n</h1>\n',
  );
  write(join(p, "src/content/news/opened.md"), "---\ntitle: Opened\ndraft: false\n---\nhi\n");
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/", "https://ex.com/news/opened/"]);
  page(p, "news/opened/index.html", "/news/opened", [ORG]);
  const bare = run(p);
  assert.equal(bare.code, 1, bare.out);
  assert.match(bare.out, /wrong type of structured data/);

  page(p, "news/opened/index.html", "/news/opened", [
    ORG,
    { "@context": "https://schema.org", "@type": "NewsArticle", headline: "Opened", url: "https://ex.com/news/opened" },
  ]);
  assert.equal(run(p).code, 0);
});

test("a listing page is not required to be an Article", () => {
  // /blog renders a list, not a post. Demanding an Article there would fire on every site.
  assert.equal(run(scaffold()).code, 0);
});

test("structured data whose url is on another origin fires", () => {
  // Copied from the reference the build was grounded on, and it hands the entity to them.
  const p = scaffold();
  page(p, "index.html", "/", [{ "@context": "https://schema.org", "@type": "Organization", name: "Example", url: "https://someone-else.example" }]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /structured data names another origin/);
});

test("two different organisations across the site fire once, not per page", () => {
  const p = scaffold();
  page(p, "blog/index.html", "/blog", [{ "@context": "https://schema.org", "@type": "Organization", name: "Somebody Else", url: "https://ex.com" }]);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /more than one organisation/);
  assert.match(r.out, /Example/);
  assert.match(r.out, /Somebody Else/);
  assert.equal((r.out.match(/more than one organisation/g) || []).length, 1);
});

test("the same organisation on every page is what the scaffold does, and is silent", () => {
  assert.equal(run(scaffold()).code, 0);
});

test("an @graph document is read, not treated as one untyped node", () => {
  const p = scaffold();
  page(p, "index.html", "/", [{
    "@context": "https://schema.org",
    "@graph": [{ "@type": "WebSite", name: "Example" }, { "@type": "Organization", name: "Example", url: "https://ex.com" }],
  }]);
  assert.equal(run(p).code, 0);
});

// ------------------------------------------------------------------- 3. robots

test("an unconditional Allow: / robots endpoint fires", () => {
  const p = scaffold();
  write(
    join(p, "src/pages/robots.txt.ts"),
    'import type { APIRoute } from "astro";\nexport const GET: APIRoute = ({ site }) => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${site}sitemap-index.xml\n`);\n',
  );
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /robots\.txt is not environment aware/);
  assert.match(r.out, /preview deployment is a public origin/);
});

test("the SHIPPED scaffold robots endpoint satisfies the check", () => {
  // If this ever fails, the scaffold has regressed to inviting indexing of every preview.
  const src = readFileSync(join(TEMPLATE, "src/pages/robots.txt.ts"), "utf8");
  assert.match(src, /PUBLIC_SITE_ENV|VERCEL_ENV/);
  assert.match(src, /Disallow:\s*\//);
  assert.equal(run(scaffold()).code, 0);
});

test("a static public/robots.txt shadowing the SSR route fires", () => {
  // The static file is copied into the build verbatim and served first, so the environment-aware
  // route never runs and the fixed policy is what every deployment gets. Both files exist, both
  // look right on their own, and nothing in the build says which one is answering.
  const p = scaffold();
  write(join(p, "public/robots.txt"), "User-agent: *\nAllow: /\n");
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /static robots\.txt shadows the SSR route/);
});

test("a fixed robots.txt with no route at all is not environment aware, and says so", () => {
  const p = scaffold();
  rmSync(join(p, "src/pages/robots.txt.ts"));
  write(join(p, "public/robots.txt"), "User-agent: *\nAllow: /\n");
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /robots\.txt is not environment aware/);
});

test("a site with no robots.txt anywhere fires", () => {
  const p = scaffold();
  rmSync(join(p, "src/pages/robots.txt.ts"));
  rmSync(join(p, "dist/robots.txt"));
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no robots\.txt/);
});

// -------------------------------------------------- 4. cannot check is never a pass

test("no src/pages blocks rather than passing", () => {
  assert.equal(run(tmp()).code, 2);
});

test("an unbuilt project blocks rather than passing", () => {
  const p = scaffold();
  rmSync(join(p, "dist"), { recursive: true });
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /no build output/);
  assert.match(r.out, /NOT a pass/);
});

test("a build with no sitemap blocks rather than passing", () => {
  const p = scaffold();
  rmSync(join(p, "dist/sitemap-0.xml"));
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Coverage is UNKNOWN/);
});

test("a server-rendered build with no HTML on disk blocks rather than passing", () => {
  const p = scaffold();
  for (const f of ["index.html", "blog/index.html", "blog/welcome/index.html"]) rmSync(join(p, "dist", f));
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/", "https://ex.com/blog/welcome/"]);
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /no prerendered HTML/);
  assert.match(r.out, /--base/, "it must say how to check what it could not");
});

test("a dynamic route whose collection cannot be read blocks rather than passing", () => {
  const p = scaffold();
  write(join(p, "src/pages/blog/[slug].astro"), "---\nconst c = COLLECTION;\nconst post = await getEntry(c, Astro.params.slug);\n---\n<h1>x</h1>\n");
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/"]);
  write(join(p, "dist/llms.txt"), "# Example\n"); // isolate: an unresolvable route makes its links unjudgeable too
  const r = run(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /dynamic route not enumerable/);
});

test("findings win over blocks, so a real fault is never hidden behind an unknown", () => {
  const p = scaffold();
  rmSync(join(p, "dist/llms.txt")); // produces a block
  sitemap(p, ["https://ex.com/", "https://ex.com/blog/"]); // and a finding
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /could NOT be checked/);
  assert.match(r.out, /route missing from the sitemap/);
});

// ------------------------------------------------------------- 5. the live pass

test("the live pass catches a redirect disk cannot see", async () => {
  const p = scaffold();
  // Disk is clean: the sitemap covers every route and no redirect is declared anywhere. Only a
  // request reveals that the origin 301s an advertised URL, which is the whole reason --base exists.
  assert.equal(run(p).code, 0, "the fixture must be disk-clean, or this proves nothing");

  const server = createServer((req, res) => {
    const path = req.url.replace(/\/$/, "") || "/";
    if (path === "/blog/welcome") { res.writeHead(301, { location: "/writing/welcome" }); return res.end(); }
    if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nAllow: /\n"); }
    if (path === "/llms.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("# Example\n"); }
    if (path.endsWith(".md") || path === "/llms-full.txt" || path === "/agent.md") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><link rel="canonical" href="https://ex.com${path}"></head><body>x</body></html>`);
  });
  await new Promise((r) => server.listen(8863, "127.0.0.1", r));
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8863");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /advertised URL redirects/);
    assert.match(r.out, /\/blog\/welcome returns 301/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/**
 * The live-pass fixture again, parameterised by the headers it answers with and by which paths
 * it serves without structured data.
 */
// What a correct PREVIEW origin serves: it is a public origin on a domain the client does not
// own, so it closes. Tests that sweep a production origin pass an open one.
const ROBOTS_CLOSED = "User-agent: *\nDisallow: /\n";
const ROBOTS_OPEN = "User-agent: *\nAllow: /\nSitemap: https://ex.com/sitemap-index.xml\n";

function headerServer(port, headers, { noLd = [], head = "", robots = ROBOTS_CLOSED } = {}) {
  const server = createServer((req, res) => {
    const path = req.url.replace(/\/$/, "") || "/";
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(robots);
    }
    if (path === "/llms.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("# x\n");
    }
    if (path.endsWith(".md") || path === "/llms-full.txt") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html", ...headers });
    const ld = noLd.includes(path) ? "" : ldScript(ORG) + ldScript(POST(path));
    res.end(`<!doctype html><html><head><link rel="canonical" href="https://ex.com${path}">${ld}${head}</head><body>x</body></html>`);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

const ALL_HEADERS = {
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=()",
};

test("the live pass names every missing security header, one finding each", async () => {
  // Nothing checked headers on a deployed origin, so a template shipping four of them and a
  // Cloudflare overlay sending none both read as clean.
  const p = scaffold();
  const server = await headerServer(8865, {});
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8865");
    assert.equal(r.code, 1, r.out);
    for (const h of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
      assert.match(r.out, new RegExp(`no ${h}`), `${h} was not reported missing`);
    }
  } finally { await new Promise((r) => server.close(r)); }
});

test("a page read off disk AND off the origin is one page, not two", async () => {
  // With --base every page is read twice. Counting both made one page with no structured data
  // report as "2 page(s)", which is a defect in the report rather than in the site.
  const p = scaffold();
  page(p, "blog/index.html", "/blog", null);
  const server = await headerServer(8869, ALL_HEADERS, { noLd: ["/blog"] });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8869");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 page\(s\): \/blog\./);
  } finally { await new Promise((r) => server.close(r)); }
});

test("a deployment that sends them all is silent about headers", async () => {
  const p = scaffold();
  const server = await headerServer(8866, ALL_HEADERS);
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8866");
    assert.equal(r.code, 0, r.out);
  } finally { await new Promise((r) => server.close(r)); }
});

test("HSTS is not demanded over http, and the report says why", async () => {
  // A browser ignores Strict-Transport-Security over http and the edge only sends it on https,
  // so demanding it on a localhost sweep would fire on every correct build.
  const p = scaffold();
  const server = await headerServer(8867, ALL_HEADERS);
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8867");
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /no Strict-Transport-Security/);
    assert.match(r.out, /HSTS not checked \(the origin is http\)/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("--no-hsts says so in the report rather than going quiet", async () => {
  const p = scaffold();
  const server = await headerServer(8868, ALL_HEADERS);
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8868", "--no-hsts");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /HSTS not checked \(--no-hsts\)/);
  } finally { await new Promise((r) => server.close(r)); }
});

// A build that cannot tell it is production noindexes itself, and every page of it disappears
// from search with nothing failing anywhere. This is the check that makes the safe default safe.

test("a production origin that renders noindex fires, and names the route", async () => {
  const p = scaffold();
  const server = await headerServer(8870, ALL_HEADERS, { head: '<meta name="robots" content="noindex">', robots: ROBOTS_OPEN });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8870", "--site", "http://127.0.0.1:8870");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /production renders noindex on \//);
  } finally { await new Promise((r) => server.close(r)); }
});

test("an X-Robots-Tag noindex header fires the same way", async () => {
  // The meta is one of two ways to say it, and a host header is the one nothing in the repo
  // can see by reading the source.
  const p = scaffold();
  const server = await headerServer(8871, { ...ALL_HEADERS, "x-robots-tag": "noindex, nofollow" }, { robots: ROBOTS_OPEN });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8871", "--site", "http://127.0.0.1:8871");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /production renders noindex on \//);
  } finally { await new Promise((r) => server.close(r)); }
});

test("the same noindex on a PREVIEW origin is silent, because that is correct there", async () => {
  // The check only applies when the origin being swept IS the site's own. A preview is
  // supposed to be noindexed, and firing there would train everyone to ignore the finding.
  const p = scaffold();
  const server = await headerServer(8872, ALL_HEADERS, { head: '<meta name="robots" content="noindex">' });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8872");
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /production renders noindex/);
  } finally { await new Promise((r) => server.close(r)); }
});

// The served robots.txt is the only place a preview's ACTUAL policy can be observed. The disk
// pass reads the route's source and can say it is capable of closing; only a request says
// whether it did.

test("a preview origin whose robots.txt does not disallow fires", async () => {
  const p = scaffold();
  const server = await headerServer(8873, ALL_HEADERS, { robots: ROBOTS_OPEN });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8873");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /preview robots\.txt does not disallow/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("a production origin whose robots.txt disallows everything fires", async () => {
  // The expensive direction. A live site closed to crawlers loses all of its search traffic
  // and nothing else reports a fault.
  const p = scaffold();
  const server = await headerServer(8874, ALL_HEADERS, { robots: ROBOTS_CLOSED });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8874", "--site", "http://127.0.0.1:8874");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /production robots\.txt disallows everything/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("a partial Disallow on production is not a total one", async () => {
  // Every site closes /admin or /cart. Reading that as a closed site would fire on almost all
  // of them. The assertion is on the robots finding alone: sweeping a fixture server as though
  // it were the canonical origin makes the fixture's own canonicals foreign, which is a
  // different finding and not what this test is about.
  const p = scaffold();
  const server = await headerServer(8875, ALL_HEADERS, { robots: "User-agent: *\nDisallow: /admin\nDisallow: /cart\n" });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8875", "--site", "http://127.0.0.1:8875");
    assert.doesNotMatch(r.out, /robots\.txt disallows everything/, r.out);
  } finally { await new Promise((r) => server.close(r)); }
});

test("an EMPTY User-agent value does not capture every crawler", async () => {
  // The trap: `User-agent:` with nothing after it names no agent, so the group that follows is
  // not the * group and its Disallow does not close the site. Read as a * group it would report
  // a preview as correctly closed while every crawler walked in.
  const p = scaffold();
  const server = await headerServer(8876, ALL_HEADERS, { robots: "User-agent:\nDisallow: /\n" });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8876");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /preview robots\.txt does not disallow/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("another agent's total Disallow is not the whole site's", async () => {
  // The groups have to be kept apart. Read as one run of agents, the `*` at the top would still
  // be in scope when GPTBot's `Disallow: /` arrives, and a preview wide open to every crawler
  // but one would report as correctly closed.
  const p = scaffold();
  const server = await headerServer(8878, ALL_HEADERS, {
    robots: "User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n",
  });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8878");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /preview robots\.txt does not disallow/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("a * group written after another agent's group is still read", async () => {
  const p = scaffold();
  const server = await headerServer(8877, ALL_HEADERS, {
    robots: "User-agent: GPTBot\nDisallow: /private\n\nUser-agent: *\nDisallow: /\n",
  });
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8877");
    assert.equal(r.code, 0, r.out);
  } finally { await new Promise((r) => server.close(r)); }
});

test("an origin that serves no robots.txt reports the policy as unknown, not clean", async () => {
  // The disk has a robots route, so the gate judged the source and knows the deployment should
  // be serving something. Reading nothing back is an unknown, and an unknown is not a pass.
  const p = scaffold();
  const server = createServer((req, res) => {
    const path = req.url.replace(/\/$/, "") || "/";
    if (path === "/robots.txt" || path.endsWith(".md") || path === "/llms-full.txt") { res.writeHead(404); return res.end(); }
    if (path === "/llms.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("# x\n"); }
    res.writeHead(200, { "content-type": "text/html", ...ALL_HEADERS });
    res.end(
      `<!doctype html><html><head><link rel="canonical" href="https://ex.com${path}">` +
      `${ldScript(ORG)}${ldScript(POST(path))}</head><body>x</body></html>`,
    );
  });
  await new Promise((r) => server.listen(8879, "127.0.0.1", r));
  try {
    const r = await runAsync(p, "--base", "http://127.0.0.1:8879");
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /served robots\.txt not read/);
  } finally { await new Promise((r) => server.close(r)); }
});

test("an unreachable origin blocks rather than passing", () => {
  const p = scaffold();
  // Nothing is listening here. A live sweep that quietly measured zero URLs and printed clean
  // is exactly the failure the exit-2 rule exists for.
  const r = run(p, "--base", "http://127.0.0.1:8864");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /measured nothing|origin unreachable/);
});

test("--base with no value blocks rather than silently running the disk pass", () => {
  const r = run(scaffold(), "--base");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /needs an origin/);
});
