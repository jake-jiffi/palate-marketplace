/**
 * palate-shopify: the tokenless catalogue survey, and the safety property the gates depend on.
 *
 * THE PROPERTY THAT MATTERS MOST IS THE NEGATIVE ONE. This survey exists to give three gates a
 * route model they never had, which means those gates now read a file that will be ABSENT on
 * every brochure build Palate has ever made. If `routesFrom` returns anything other than an empty
 * list when there is no survey, a marketing site starts being measured against product routes it
 * does not have, and a working gate becomes a false failure. That direction is tested first and
 * hardest.
 *
 * The rest is failure classification. The dangerous output of a survey is not an error, it is a
 * small number: "3 products" reads exactly like a small catalogue. A locked channel, an
 * already-headless apex and a non-Shopify host must each be their own outcome.
 *
 * Network paths run against a local server, never a real store, so this suite is offline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { survey, probe, routesFrom } from "../palate-shopify.mjs";

/** A stand-in Shopify host. `mode` decides which real-world refusal it reproduces. */
function serve(mode, products = 3) {
  const server = createServer((req, res) => {
    if (mode === "headless-apex") {          // maap.cc: their own 404, not Shopify's
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<!DOCTYPE html><html><body>Not found</body></html>");
    }
    if (mode === "locked") {                 // a dev store, or a password-walled store
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ errors: "Online Store channel is locked." }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const q = (JSON.parse(body || "{}").query) || "";
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      if (q.includes("collections(first")) {
        return res.end(JSON.stringify({ data: { collections: { nodes: [
          { handle: "leggings", title: "Leggings" }, { handle: "tops", title: "Tops" }] } } }));
      }
      if (q.includes("products(first")) {
        if (mode === "throttle-once" && !server.__backedOff) {
          server.__backedOff = true;         // refuse the big page exactly once
          return res.end(JSON.stringify({ errors: [{ message: "Query has complexity of 1204, which exceeds the max of 1000" }] }));
        }
        const nodes = Array.from({ length: products }, (_, i) => ({
          handle: `p-${i}`, title: `Product ${i}`, description: "d", availableForSale: i % 2 === 0,
          productType: "Thing", tags: ["a"],
          featuredImage: { url: `https://cdn.shopify.com/${i}.jpg`, altText: "", width: 100, height: 200 },
          priceRange: { minVariantPrice: { amount: "10.0", currencyCode: "GBP" }, maxVariantPrice: { amount: "20.0" } },
          options: [{ name: "Size", values: ["S", "M"] }],
        }));
        return res.end(JSON.stringify({ data: {
          shop: { name: "Test Shop", primaryDomain: { url: "https://test.example" }, paymentSettings: { currencyCode: "GBP", countryCode: "GB" } },
          products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } }));
      }
      return res.end(JSON.stringify({ data: { shop: {
        name: "Test Shop", primaryDomain: { url: "https://test.example" },
        paymentSettings: { currencyCode: "GBP", countryCode: "GB" } } } }));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------- the safety property

test("NO survey means NO routes, so every existing build is unaffected", () => {
  for (const absent of [null, undefined, {}, { ok: false }, { ok: false, routes: ["/products/x"] }, "not an object"]) {
    assert.deepEqual(routesFrom(absent), [],
      `routesFrom(${JSON.stringify(absent)}) must be empty: a brochure build has no catalogue and ` +
      `must not start being measured against product routes`);
  }
});

test("a failed survey never yields routes, even when it carries a routes key", () => {
  assert.deepEqual(routesFrom({ ok: false, routes: ["/products/a", "/products/b"] }), []);
});

// ---------------------------------------------------------------- the happy path

test("a real catalogue yields real, bounded routes", async () => {
  const { server, origin } = await serve("ok", 12);
  try {
    const r = await survey(origin);
    assert.equal(r.ok, true);
    assert.equal(r.counts.products, 12);
    assert.equal(r.counts.collections, 2);
    const routes = routesFrom(r);
    assert.ok(routes.includes("/"), "the home route is always present");
    assert.ok(routes.some((x) => x.startsWith("/products/")), "product routes must be real handles");
    assert.ok(routes.some((x) => x.startsWith("/collections/")));
    assert.ok(routes.length <= 6, `routesFrom must stay small for a gate to navigate, got ${routes.length}`);
    assert.ok(!routes.some((x) => x.includes("[") || x.includes("]")),
      "a literal [handle] is the exact bug this replaces");
  } finally { server.close(); }
});

test("every survey is stamped as unsafe for production, because the file outlives the context", async () => {
  const { server, origin } = await serve("ok");
  try {
    const r = await survey(origin);
    assert.equal(r.productionSafe, false);
    assert.match(r.warning, /BUILD-TIME ONLY/);
    assert.match(r.warning, /never ship it as a price source/i);
    assert.equal(r.source, "tokenless-storefront-api");
  } finally { server.close(); }
});

test("products carry what a build actually needs", async () => {
  const { server, origin } = await serve("ok", 2);
  try {
    const r = await survey(origin);
    const p = r.products[0];
    for (const k of ["handle", "title", "price", "currency", "image", "options", "tags", "availableForSale"]) {
      assert.ok(k in p, `product is missing ${k}`);
    }
    assert.equal(p.image.width, 100, "image dimensions matter: palate-assets measures crop loss from them");
    assert.equal(typeof p.availableForSale, "boolean");
  } finally { server.close(); }
});

// ---------------------------------------------------------------- failure classification

test("an already-headless apex is NOT reported as a small catalogue", async () => {
  const { server, origin } = await serve("headless-apex");
  try {
    const r = await survey(origin);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not-shopify-served");
    assert.match(r.detail, /ALREADY headless/);
  } finally { server.close(); }
});

test("a locked Online Store channel is its own outcome", async () => {
  const { server, origin } = await serve("locked");
  try {
    const r = await survey(origin);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "channel-locked");
  } finally { server.close(); }
});

test("a bad URL fails cleanly rather than throwing", async () => {
  const r = await survey("   ");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-url");
});

test("probe never throws on an unreachable host", async () => {
  const r = await probe("http://127.0.0.1:1");   // nothing listens here
  assert.equal(r.ok, false);
  assert.ok(["network", "refused"].includes(r.reason), `unexpected reason ${r.reason}`);
});

// ---------------------------------------------------------------- resilience

test("a complexity refusal backs off to a smaller page instead of failing the run", async () => {
  const { server, origin } = await serve("throttle-once", 5);
  try {
    const r = await survey(origin);
    assert.equal(r.ok, true, "the tokenless complexity cap is 1,000 and must not end the survey");
    assert.equal(r.counts.products, 5);
  } finally { server.close(); }
});

// ---------------------------------------------------------------- the gate repair

import { resolveDynamic } from "../palate-shopify.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const withCatalogue = (obj) => {
  const dir = mkdtempSync(join(tmpdir(), "pshop-"));
  const f = join(dir, "catalogue.json");
  writeFileSync(f, JSON.stringify(obj));
  return { f, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

test("NO catalogue file leaves every route exactly as it was", () => {
  const paths = ["/", "/about", "/products/[handle]", "/blog/[slug]"];
  const r = resolveDynamic(paths, "/nonexistent/path/catalogue.json");
  assert.deepEqual(r.paths, paths, "a brochure build must be byte-identical to before this existed");
  assert.equal(r.resolved, 0);
  assert.equal(r.had, false);
});

test("a malformed or failed catalogue is treated as absent, never as empty routes", () => {
  const paths = ["/products/[handle]"];
  for (const bad of ["not json at all", JSON.stringify({ ok: false }), JSON.stringify({ ok: true, routes: [] }), JSON.stringify({})]) {
    const dir = mkdtempSync(join(tmpdir(), "pshop-"));
    const f = join(dir, "c.json");
    writeFileSync(f, bad);
    const r = resolveDynamic(paths, f);
    assert.deepEqual(r.paths, paths, `a ${bad.slice(0, 24)}... catalogue must not change routes`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a real catalogue turns the literal [handle] into a page that exists", () => {
  const { f, cleanup } = withCatalogue({ ok: true, routes: ["/", "/collections/tops", "/products/wool-runner"] });
  try {
    const r = resolveDynamic(["/", "/products/[handle]", "/collections/[handle]"], f);
    assert.deepEqual(r.paths, ["/", "/products/wool-runner", "/collections/tops"]);
    assert.equal(r.resolved, 2);
  } finally { cleanup(); }
});

test("an unresolvable dynamic route is LEFT ALONE, never silently dropped", () => {
  const { f, cleanup } = withCatalogue({ ok: true, routes: ["/", "/products/wool-runner"] });
  try {
    const r = resolveDynamic(["/products/[handle]", "/lookbook/[slug]"], f);
    assert.equal(r.paths.length, 2, "dropping it would be the gate narrowing its own coverage");
    assert.equal(r.paths[1], "/lookbook/[slug]", "a 404 here is a real finding about the build");
    assert.equal(r.resolved, 1);
  } finally { cleanup(); }
});

test("static routes are never touched", () => {
  const { f, cleanup } = withCatalogue({ ok: true, routes: ["/", "/products/x"] });
  try {
    const r = resolveDynamic(["/", "/about", "/contact"], f);
    assert.deepEqual(r.paths, ["/", "/about", "/contact"]);
    assert.equal(r.resolved, 0);
  } finally { cleanup(); }
});
