/**
 * gate-seo must enumerate a storefront's product routes, and must not change without a catalogue.
 *
 * THE BUG THIS PINS, found by building a real 356-page storefront and running the gate at it.
 * `collectionOf` reads a literal getCollection("...") call, which is how a blog names its posts.
 * A storefront has no markdown: /products/[handle] gets its handles from Shopify inside
 * getStaticPaths. So the gate reported "dynamic route not enumerable", filed the coverage of 350
 * of 356 URLs as UNKNOWN, and measured 3 expected URLs against a sitemap advertising 355.
 *
 * A gate that cannot see 98% of a site is not measuring the thing it claims to measure, and it
 * said so honestly rather than passing, which is the only reason it was cheap to find.
 *
 * After: 353 expected URLs on the same build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "gate-seo.mjs");

/** A minimal Astro project with a dynamic product route and a built sitemap. */
function project({ catalogue }) {
  const dir = mkdtempSync(join(tmpdir(), "seo-commerce-"));
  mkdirSync(join(dir, "src", "pages", "products"), { recursive: true });
  mkdirSync(join(dir, "dist", "client"), { recursive: true });
  writeFileSync(join(dir, "src", "pages", "index.astro"), "---\n---\n<h1>Home</h1>\n");
  // getStaticPaths driven by a catalogue module, exactly like a real storefront: there is no
  // literal getCollection() here for the parser to read.
  writeFileSync(
    join(dir, "src", "pages", "products", "[handle].astro"),
    "---\nimport { products } from '../../lib/shopify/catalogue';\n" +
      "export async function getStaticPaths(){ return products().map(p=>({params:{handle:p.handle}})); }\n---\n<h1>P</h1>\n",
  );
  const urls = ["/", "/products/alpha", "/products/beta"];
  writeFileSync(
    join(dir, "dist", "client", "sitemap-0.xml"),
    `<urlset>${urls.map((u) => `<url><loc>https://x.test${u}</loc></url>`).join("")}</urlset>`,
  );
  for (const u of urls) {
    const d = join(dir, "dist", "client", u === "/" ? "" : u);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.html"), `<html><head><link rel="canonical" href="https://x.test${u}"><title>t</title></head><body><h1>h</h1></body></html>`);
  }
  if (catalogue) {
    mkdirSync(join(dir, ".palate"), { recursive: true });
    writeFileSync(join(dir, ".palate", "catalogue.json"), JSON.stringify(catalogue));
  }
  return dir;
}

const run = (dir) => {
  const r = spawnSync("node", [GATE, dir], { encoding: "utf8" });
  return `${r.stdout}${r.stderr}`;
};

const OK_CAT = { ok: true, routes: ["/", "/products/alpha", "/products/beta"] };

test("a storefront's product routes are enumerated from the catalogue", () => {
  const dir = project({ catalogue: OK_CAT });
  try {
    const out = run(dir);
    assert.doesNotMatch(out, /dynamic route not enumerable/,
      "the handles come from Shopify, not from a content collection, and that is not a defect");
    assert.match(out, /3 expected URL\(s\)/, `expected all three URLs to be counted:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("WITHOUT a catalogue the gate is unchanged and still says it cannot check", () => {
  const dir = project({ catalogue: null });
  try {
    const out = run(dir);
    assert.match(out, /dynamic route not enumerable/,
      "a non-commerce project must keep the original honest refusal");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a FAILED survey is not an enumeration", () => {
  const dir = project({ catalogue: { ok: false, reason: "channel-locked" } });
  try {
    assert.match(run(dir), /dynamic route not enumerable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unreadable catalogue is not an enumeration", () => {
  const dir = project({ catalogue: null });
  try {
    mkdirSync(join(dir, ".palate"), { recursive: true });
    writeFileSync(join(dir, ".palate", "catalogue.json"), "not json");
    assert.match(run(dir), /dynamic route not enumerable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a catalogue with no routes under this prefix does not silently claim coverage", () => {
  const dir = project({ catalogue: { ok: true, routes: ["/", "/collections/tops"] } });
  try {
    assert.match(run(dir), /dynamic route not enumerable/,
      "no /products/ routes in the catalogue means product coverage is still UNKNOWN, not clean");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
