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
  page(p, "blog/welcome/index.html", "/blog/welcome");
  write(join(p, "dist/llms.txt"), "# Example\n\n## Recent writing\n- [Welcome](/blog/welcome): hi\n");
  write(join(p, "dist/robots.txt"), "User-agent: *\nAllow: /\n");
  return p;
}

const sitemap = (p, locs) =>
  write(
    join(p, "dist/sitemap-0.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>\n`,
  );

const page = (p, file, canonical) =>
  write(
    join(p, "dist", file),
    `<!doctype html><html><head><title>x</title>${canonical === null ? "" : `<link rel="canonical" href="https://ex.com${canonical}">`}</head><body>x</body></html>`,
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
  page(p, "blog/welcome/index.html", "/blog"); // copied between templates, the usual cause
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /canonical is not self-referential/);
  assert.match(r.out, /\/blog\/welcome declares its canonical as \/blog/);
});

test("a page with no canonical at all fires", () => {
  const p = scaffold();
  page(p, "blog/index.html", null);
  const r = run(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no canonical/);
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
