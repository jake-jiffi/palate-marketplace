/**
 * gate-headless: every check must fire on its own, and none may fire on a correct build.
 *
 * THIS FILE IS THE DOCUMENTATION for the headless contract. Each case below states one thing a
 * headless Shopify storefront must get right, then breaks exactly that thing and proves the gate
 * catches it. A check with no failing case here is a check nobody has proven fires, and this repo
 * has spent a year finding gates that existed and never fired.
 *
 * The structure is deliberate:
 *   1. A CORRECT storefront is SILENT. Tested first, because a gate that cries wolf gets
 *      switched off and a switched-off gate protects nobody.
 *   2. Each check gets ONE mutation of that same correct fixture, so a finding can only be
 *      caused by the thing the case is named after.
 *   3. A non-commerce project is untouched and exits 2.
 *
 * CLI checks are exercised separately with --no-cli, because a test suite that shells out to
 * npx on every case is a test suite people stop running.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "gate-headless.mjs");

/** Read the fixture catalogue a case is about to mutate. */
const cat$ = (d) => JSON.parse(readFileSync(join(d, ".palate/catalogue.json"), "utf8"));

const w = (dir, rel, body) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};

/** A storefront that gets everything right. Every mutation below starts from this. */
function correct() {
  const dir = mkdtempSync(join(tmpdir(), "headless-"));

  w(dir, ".palate/catalogue.json", JSON.stringify({
    ok: true, surveyedAt: new Date().toISOString(), store: "https://x.myshopify.com",
    shop: { name: "X", currency: "AUD" },
    counts: { products: 2, collections: 1, routes: 4 },
    routes: ["/", "/collections/all", "/products/alpha", "/products/beta"],
    collections: [{ handle: "all", title: "All" }],
    products: [
      { handle: "alpha", title: "Alpha", image: { url: "https://cdn.shopify.com/a.jpg", width: 800, height: 1000 } },
      { handle: "beta", title: "Beta", image: { url: "https://cdn.shopify.com/b.jpg", width: 800, height: 1000 } },
    ],
  }));

  w(dir, "astro.config.mjs", `export default { output: "static", adapter: vercel() };`);
  w(dir, ".gitignore", "node_modules\n.env\n");
  w(dir, ".env", "SHOPIFY_STORE_DOMAIN=x.myshopify.com\nSHOPIFY_API_VERSION=2026-07\nSHOPIFY_STOREFRONT_TOKEN=t\n");

  w(dir, "src/pages/products/[handle].astro",
    `---
import LivePrice from '../../components/LivePrice.astro';
export async function getStaticPaths(){ return [{params:{handle:'alpha'}}]; }
---
<LivePrice server:defer handle="alpha">
  <p slot="fallback" data-price-fallback>A$10.00</p>
</LivePrice>
<script is:inline>
  setTimeout(function(){
    document.querySelectorAll('[data-price-fallback]').forEach(function(el){
      if (!el.isConnected) return;
      el.textContent = 'Check price in cart';
    });
  }, 2500);
</script>
`);

  w(dir, "src/components/LivePrice.astro",
    `---
const v = import.meta.env.SHOPIFY_API_VERSION;
let failed = false;
try { const r = await fetch(\`https://\${import.meta.env.SHOPIFY_STORE_DOMAIN}/api/\${v}/graphql.json\`); }
catch { failed = true; }
---
{failed ? <p>Check price in cart</p> : <p>price</p>}
`);

  w(dir, "src/pages/api/cart/add.ts",
    `export const prerender = false;
export const POST = async ({ cookies }) => {
  const before = await sf('{ cart { totalQuantity } }');
  const r = await sf('mutation { cartLinesAdd { cart { id totalQuantity } userErrors { message } } }');
  if (r.totalQuantity <= before.totalQuantity) return new Response('not added', { status: 409 });
  cookies.set('plt_cart', r.id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  return new Response('ok');
};
`);

  // A hand-authored home page: content that is NOT in Shopify (a video hero) pointing AT a
  // Shopify item. This is the mixed case the J checks exist for.
  w(dir, "src/pages/index.astro",
    `---
---
<video src="/hero.mp4" poster="/hero.jpg" muted playsinline></video>
<h1>New season</h1>
<a href="/products/alpha">Shop the Alpha</a>
<a href="/collections/all">All products</a>
`);

  w(dir, "src/pages/agents.md.ts", `export const GET = () => new Response('# Agent instructions');`);
  w(dir, "src/pages/llms.txt.ts", `export const GET = () => new Response('# llms');`);

  const page = (h) => `<html><head><link rel="canonical" href="https://x.test/products/${h}"></head><body><p data-price-fallback>A$10.00</p></body></html>`;
  w(dir, "dist/client/products/alpha/index.html", page("alpha"));
  w(dir, "dist/client/products/beta/index.html", page("beta"));
  return dir;
}

function run(dir) {
  const r = spawnSync("node", [GATE, dir, "--no-cli", "--json"], { encoding: "utf8" });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-json path */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, json: parsed };
}
const ids = (r) => (r.json?.findings ?? []).map((f) => f.id);

/* ================================================== 1. a correct storefront is silent */

test("a correctly constructed storefront produces NO findings", () => {
  const dir = correct();
  try {
    const r = run(dir);
    assert.deepEqual(ids(r), [], `a clean build must be silent, got:\n${r.out}`);
    assert.equal(r.code, 0);
    assert.ok((r.json.passes ?? []).length >= 20, `expected a broad check surface, got ${r.json.passes?.length}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a project with no catalogue is NOT a headless storefront and is left alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "brochure-"));
  try {
    w(dir, "src/pages/index.astro", "---\n---\n<h1>Brochure</h1>\n");
    const r = run(dir);
    assert.equal(r.code, 2, "a brochure site must not be judged against a commerce contract");
    assert.match(r.out, /not a headless Shopify storefront/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ==================================================
 * 2. one case per check. Each breaks ONE thing.
 * The table below IS the headless contract.
 * ================================================== */

const CASES = [
  // --- B. the survey ------------------------------------------------------
  ["B1-survey-failed", "a failed survey is not a foundation to build on", (d) =>
    w(d, ".palate/catalogue.json", JSON.stringify({ ok: false, reason: "channel-locked" }))],

  ["B2-empty-catalogue", "zero products is a build failure, never an empty state", (d) =>
    w(d, ".palate/catalogue.json", JSON.stringify({ ok: true, surveyedAt: new Date().toISOString(), products: [], routes: [] }))],

  ["B3-stale-survey", "a survey older than a fortnight has stale prices and handles in it", (d) => {
    const c = cat$(d); c.surveyedAt = new Date(Date.now() - 40 * 86400000).toISOString();
    w(d, ".palate/catalogue.json", JSON.stringify(c));
  }],

  ["B4-no-image-dimensions", "without dimensions nothing can measure crop loss", (d) => {
    const c = cat$(d); c.products.forEach((p) => { p.image = { url: p.image.url }; });
    w(d, ".palate/catalogue.json", JSON.stringify(c));
  }],

  // --- C. configuration ---------------------------------------------------
  ["C1-public-prefixed-token", "PUBLIC_ inlines at build, so rotating the token needs a full rebuild", (d) =>
    w(d, "src/lib/shop.ts", `const t = import.meta.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;`)],

  ["C2-hardcoded-api-version", "a version hardcoded across files is a version nobody can bump", (d) =>
    w(d, "src/lib/shop.ts", `fetch('https://x.myshopify.com/api/2026-07/graphql.json');`)],

  ["C3-env-not-ignored", "a Storefront token in git history is a rotation, not a revert", (d) =>
    w(d, ".gitignore", "node_modules\n")],

  // --- D. render strategy -------------------------------------------------
  ["D1-output-server", "a server build produces zero html, so site search indexes nothing", (d) =>
    w(d, "astro.config.mjs", `export default { output: "server" };`)],

  ["D2-prerender-true", "prerender = true pins a page against a later config flip", (d) =>
    w(d, "src/pages/about.astro", `---\nexport const prerender = true;\n---\n<h1>About</h1>`)],

  ["D3-catalogue-on-demand", "product pages are where SEO and Core Web Vitals live", (d) =>
    w(d, "src/pages/products/[handle].astro",
      `---\nexport const prerender = false;\nexport async function getStaticPaths(){ return []; }\n---\n<p>x</p>`)],

  ["D4-product-route", "without getStaticPaths every product page renders on demand", (d) =>
    w(d, "src/pages/products/[handle].astro", `---\nconst x = 1;\n---\n<p>no static paths</p>`)],

  // --- E. the price rule --------------------------------------------------
  ["E1-price-island", "a baked price on a store with promotions is a wrong price on a live page", (d) =>
    w(d, "src/pages/products/[handle].astro",
      `---\nexport async function getStaticPaths(){ return []; }\n---\n<p>A$10.00</p>`)],

  ["E2-island-fallback", "without a fallback the page paints empty and a crawler sees no price", (d) =>
    w(d, "src/pages/products/[handle].astro",
      `---\nimport LivePrice from '../../components/LivePrice.astro';\nexport async function getStaticPaths(){ return []; }\n---\n<LivePrice server:defer />`)],

  ["E3-failclosed-watchdog", "Astro leaves the STALE build price on screen on any island failure", (d) =>
    w(d, "src/pages/products/[handle].astro",
      `---\nimport LivePrice from '../../components/LivePrice.astro';\nexport async function getStaticPaths(){ return []; }\n---\n<LivePrice server:defer><p slot="fallback">A$10.00</p></LivePrice>`)],

  // --- F. cart security ---------------------------------------------------
  ["F1-cart-in-localstorage", "the cart id is a capability secret and a cart carries buyer PII", (d) =>
    w(d, "src/lib/cart.ts", `localStorage.setItem('cart', cartId);`)],

  ["F2-cart-cookie-flags", "Hydrogen's own cart example sets none of these", (d) =>
    w(d, "src/pages/api/cart/add.ts",
      `export const prerender = false;
export const POST = async ({ cookies }) => {
  const r = await sf('mutation { cartLinesAdd { cart { id totalQuantity } } }');
  cookies.set('plt_cart', r.id, { path: '/' });
};`)],

  ["F3-samesite-strict", "Strict is not sent returning from Shopify's checkout domain", (d) =>
    w(d, "src/pages/api/cart/add.ts",
      `export const prerender = false;
export const POST = async ({ cookies }) => {
  const before = await sf('{ cart { totalQuantity } }');
  const r = await sf('mutation { cartLinesAdd { cart { id totalQuantity } } }');
  cookies.set('plt_cart', r.id, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
};`)],

  ["F4-quantity-unverified", "an empty userErrors array is not proof the item was added", (d) =>
    w(d, "src/pages/api/cart/add.ts",
      `export const prerender = false;
export const POST = async ({ cookies }) => {
  const r = await sf('mutation { cartLinesAdd { cart { id } userErrors { message } } }');
  cookies.set('plt_cart', r.id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
};`)],

  ["F5-cart-not-server", "a client-side cart hands the capability secret to any XSS", (d) =>
    w(d, "src/pages/api/cart/add.ts",
      `export const POST = async ({ cookies }) => {
  const before = await sf('{ cart { totalQuantity } }');
  const r = await sf('mutation { cartLinesAdd { cart { id totalQuantity } } }');
  cookies.set('plt_cart', r.id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
};`)],

  // --- G. the Shopify contract -------------------------------------------
  ["G1-deprecated-cart-fields", "totalTaxAmount has been deprecated since 2025-01", (d) =>
    w(d, "src/lib/cost.ts", `const q = '{ cart { cost { totalTaxAmount { amount } } } }';`)],

  ["G2-inventory-without-scope", "quantityAvailable is denied unless the scope was ticked", (d) =>
    w(d, "src/lib/stock.ts", `const q = '{ product { variants { nodes { quantityAvailable } } } }';`)],

  ["G3-custom-checkout", "no plan buys a self-hosted checkout, including Plus", (d) =>
    w(d, "src/lib/checkout.ts", `const q = 'mutation { checkoutCreate { checkout { id } } }';`)],

  // --- H. the agent surface ----------------------------------------------
  ["H1-agents-md", "going headless DELETES the agents.md Shopify writes for every merchant", (d) =>
    rmSync(join(d, "src/pages/agents.md.ts"))],

  ["H2-llms-txt", "llms.txt is rendered by the Liquid layer and vanishes with it", (d) =>
    rmSync(join(d, "src/pages/llms.txt.ts"))],

  // --- I. SEO -------------------------------------------------------------
  ["I1-product-canonical", "Shopify emits ?variant= deep links, so duplicates compete", (d) =>
    w(d, "dist/client/products/alpha/index.html", `<html><head></head><body><p data-price-fallback>A$10</p></body></html>`)],

  // --- J. content pointing INTO the catalogue -----------------------------
  ["J1-dangling-product-ref", "a video hero pointing at a product that does not exist", (d) =>
    w(d, "src/pages/index.astro",
      `---\n---\n<video src="/hero.mp4"></video>\n<a href="/products/never-created">Shop it</a>\n`)],

  ["J2-dangling-collection-ref", "a campaign pointing at a collection nobody made", (d) =>
    w(d, "src/pages/index.astro", `---\n---\n<a href="/collections/summer-drop">Summer</a>\n`)],

  ["J3-featured-unavailable", "a hero featuring an item the visitor cannot buy", (d) => {
    const c = cat$(d); c.products[0].availableForSale = false;
    w(d, ".palate/catalogue.json", JSON.stringify(c));
  }],

  ["J4-hardcoded-price", "a price typed into content can never be corrected by the island", (d) =>
    w(d, "src/pages/index.astro", `---\n---\n<p>Alpha, just A$10.00 this week</p>\n`)],

  ["J5-unrouted-products", "a store that silently ships part of its catalogue looks fine in review", (d) =>
    rmSync(join(d, "dist/client/products/beta"), { recursive: true, force: true })],

  // --- K. the write path --------------------------------------------------
  ["K1-write-guard", "a write script pointable at a real merchant by a typo eventually is", (d) =>
    w(d, "scripts/seed.mjs", `const r = await gql('mutation { productCreate(product:{title:"x"}){ product { id } } }');`)],

  ["I2-price-not-in-html", "the fallback is what curl and LLM scrapers read", (d) =>
    w(d, "dist/client/products/alpha/index.html",
      `<html><head><link rel="canonical" href="https://x.test/products/alpha"></head><body><div id="p"></div></body></html>`)],
];

for (const [id, why, breakIt] of CASES) {
  test(`${id}: ${why}`, () => {
    const dir = correct();
    try {
      breakIt(dir);
      const found = ids(run(dir));
      assert.ok(found.includes(id),
        `breaking this must raise ${id}. Raised instead: ${found.join(", ") || "(nothing)"}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("every check in the gate has a case in this file", () => {
  const dir = correct();
  try {
    const all = run(dir);
    const known = new Set([...CASES.map(([id]) => id), "A1-cli-present", "A2-cli-authenticated", "E4-island-catches"]);
    const missing = (all.json.passes ?? []).filter((id) => !known.has(id));
    assert.deepEqual(missing, [],
      `these checks pass but nothing here proves they can FAIL, which is how a dead gate is born: ${missing.join(", ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
