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
import { spawnSync, spawn } from "node:child_process";

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
/** A webhook handler built the way the runbook now says to build one. */
const WEBHOOK_OK =
`export const prerender = false;
import { createHmac, timingSafeEqual } from "node:crypto";
export const POST = async ({ request }) => {
  const raw = await request.text();                       // RAW bytes, before any parse
  const sent = Buffer.from(request.headers.get("x-shopify-hmac-sha256") ?? "", "base64");
  const mine = createHmac("sha256", import.meta.env.SHOPIFY_WEBHOOK_SECRET).update(raw).digest();
  if (sent.length !== mine.length || !timingSafeEqual(sent, mine)) return new Response("no", { status: 401 });
  const id = request.headers.get("x-shopify-webhook-id");  // at-least-once delivery
  // reconcile runs on a schedule too: delivery is not guaranteed
  // coalesced; returns immediately
  await enqueue(id, raw);
  return new Response("ok");
};`;

function correct() {
  const dir = mkdtempSync(join(tmpdir(), "headless-"));

  w(dir, ".palate/catalogue.json", JSON.stringify({
    ok: true, surveyedAt: new Date().toISOString(), store: "https://x.myshopify.com",
    shop: { name: "X", currency: "AUD" },
    counts: { products: 2, collections: 1, routes: 4 },
    routes: ["/", "/collections/all", "/products/alpha", "/products/beta"],
    redirects: [{ from: "/old-coffee", to: "/collections/all" }],
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
try {
  const r = await fetch(\`https://\${import.meta.env.SHOPIFY_STORE_DOMAIN}/api/\${v}/graphql.json\`);
  const j = await r.json();
  // A GraphQL error arrives inside a 200. Without this the island renders a blank price
  // instead of failing closed.
  if (!r.ok || j.errors) throw new Error("storefront");
} catch { failed = true; }
---
{failed ? <p>Check price in cart</p> : <p>price</p>}
`);

  w(dir, "src/pages/api/cart/add.ts",
    `export const prerender = false;
export const POST = async ({ cookies, request }) => {
  // The buyer's IP, not the server's: without it Shopify sees one client for every buyer.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const h = ip ? { 'Shopify-Storefront-Buyer-IP': ip } : {};
  const before = await sf('{ cart { totalQuantity } }', {}, h);
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

  // Redirects are merchant data the survey captures and the middleware applies.
  w(dir, "src/middleware.ts",
    `import { defineMiddleware } from 'astro:middleware';
import { catalogue } from './lib/shopify/catalogue';
const map = new Map((catalogue().redirects ?? []).map((r) => [r.from, r.to]));
export const onRequest = defineMiddleware((ctx, next) => {
  const t = map.get(ctx.url.pathname);
  return t ? ctx.redirect(t, 301) : next();
});`);

  w(dir, "src/pages/api/webhooks/products.ts", WEBHOOK_OK);
  w(dir, "src/lib/webhooks/topics.ts",
    `export const TOPICS = ["PRODUCTS_UPDATE", "PRODUCT_LISTINGS_ADD", "PRODUCT_LISTINGS_REMOVE"];`);
  writeFileSync(join(dir, "vercel.json"),
    JSON.stringify({ crons: [{ path: "/api/cron/reconcile", schedule: "0 * * * *" }] }));

  w(dir, "src/pages/agents.md.ts", `export const GET = () => new Response('# Agent instructions');`);
  w(dir, "src/pages/llms.txt.ts", `export const GET = () => new Response('# llms');`);

  const page = (h) => `<html><head><link rel="canonical" href="https://x.test/products/${h}"></head><body><p data-price-fallback>A$10.00</p></body></html>`;
  w(dir, "dist/client/products/alpha/index.html", page("alpha"));
  w(dir, "dist/client/products/beta/index.html", page("beta"));
  return dir;
}

/**
 * Run the gate WITH the CLI checks, against a stubbed `npx` on PATH.
 *
 * `mode` decides what the stub pretends: "absent" removes npx entirely, "no-session" makes it
 * report a version but no authenticated store. Without this the two CLI checks could only ever
 * be skipped, and a check that is only ever skipped is a check nobody has proven fires.
 */
function runWithCli(dir, mode) {
  // The stub always shadows npx and node stays reachable, because emptying PATH hides the node
  // that runs the gate and the test then proves nothing about the CLI check.
  const bin = mkdtempSync(join(tmpdir(), "bin-"));
  const stub = join(bin, "npx");
  writeFileSync(stub, mode === "absent"
    ? `#!/bin/sh\nexit 127\n`
    : `#!/bin/sh\ncase "$*" in\n  *"store auth list"*) echo '{"sessions": []}' ;;\n  *version*) echo "4.7.0" ;;\n  *) echo "{}" ;;\nesac\n`);
  spawnSync("chmod", ["+x", stub]);
  const r = spawnSync("node", [GATE, dir, "--json"], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  rmSync(bin, { recursive: true, force: true });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-json */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, json: parsed };
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

  // --- X. the Storefront API contract, four ways to be wrong with no error -
  ["X1-cart-context-missing", "@inContext is IGNORED by the cart, so the page and the charge disagree", (d) =>
    w(d, "src/lib/ctx.ts",
      `const q = 'query @inContext(country: AU) { products(first:1){ nodes { handle } } }';\n` +
      `const m = 'mutation { cartCreate(input:{}) { cart { id } } }';\n` +
      `const a = 'mutation { cartLinesAdd { cart { id } } }';`)],

  ["X2-discount-applicable-unchecked", "a discount code that does not apply returns SUCCESS with empty userErrors", (d) =>
    w(d, "src/lib/discount.ts",
      `const q = 'mutation($id:ID!,$c:[String!]!){ cartDiscountCodesUpdate(cartId:$id, discountCodes:$c){ cart { id } userErrors { message } } }';`)],

  ["X3-handrolled-filters", "filters are the merchant's merchandising, not ours to reconstruct", (d) =>
    w(d, "src/lib/filters.ts",
      `const f = { filters: [{ productType: "Coffee" }, { variantOption: { name: "Size", value: "250g" } }] };`)],

  // The failure is NO HANDLING, not an empty list: a merchant with zero redirects and a build
  // that would apply them is correct. Removing the middleware is the real defect.
  ["X4-redirects-dropped", "every redirect the merchant configured 404s the moment the apex moves", (d) =>
    rmSync(join(d, "src/middleware.ts"))],

  ["X5-policy-hardcoded", "policy text the merchant edits in admin goes stale silently", (d) =>
    w(d, "src/pages/policies/refund-policy.astro", `---\nconst body = "Our refund policy is 30 days.";\n---\n<p>{body}</p>`)],

  // --- Y. the measurement layer -------------------------------------------
  ["Y1-buyer-ip-missing", "every buyer's cart call looks like one client, and they reach checkout signed out", (d) =>
    w(d, "src/pages/api/cart/add.ts",
      `export const prerender = false;\n` +
      `const r = await fetch(\`https://x.myshopify.com/api/2026-07/graphql.json\`, {\n` +
      `  method: "POST", headers: { "content-type": "application/json" },\n` +
      `  body: JSON.stringify({ query: "mutation { cartLinesAdd { cart { id } } }" }) });`)],

  ["Y2-duplicate-wire-client", "a required header lands on one path and is forgotten on the other", (d) =>
    w(d, "src/lib/other-client.ts",
      `const V = "2026-07";\n` +
      `export const q = (b) => fetch(\`https://x.myshopify.com/api/\${V}/graphql.json\`, { method: "POST", body: b });`)],

  ["Y3-consent-not-headless", "consent never reaches checkout, so pixels are gated on a state the buyer never gave", (d) =>
    w(d, "src/lib/consent.ts",
      `window.Shopify.customerPrivacy.setTrackingConsent({ analytics: true, marketing: true }, () => {});`)],

  ["Y4-retired-shopify-cookies", "Shopify stopped setting these, so the identity join silently degrades", (d) =>
    w(d, "src/lib/ids.ts",
      `const uid = document.cookie.match(/_shopify_y=([^;]+)/)?.[1];\nexport default uid;`)],

  // --- O. operations, the month-three failures on a store that is succeeding
  ["O1-webhook-hmac", "an unverified webhook endpoint is a public unauthenticated trigger", (d) =>
    w(d, "src/pages/api/webhooks/products.ts",
      `export const prerender = false;\n` +
      `export const POST = async ({ request }) => {\n` +
      `  const body = await request.json();\n` +
      `  await rebuild(body);\n  return new Response("ok");\n};`)],

  ["O2-webhook-timing-unsafe", "response timing leaks the signature one byte at a time", (d) =>
    w(d, "src/pages/api/webhooks/products.ts",
      `export const prerender = false;\n` +
      `import { createHmac } from "node:crypto";\n` +
      `export const POST = async ({ request }) => {\n` +
      `  const raw = await request.text();\n` +
      `  const hmac = createHmac("sha256", import.meta.env.SHOPIFY_WEBHOOK_SECRET).update(raw).digest("base64");\n` +
      `  if (hmac !== request.headers.get("x-shopify-hmac-sha256")) return new Response("no", { status: 401 });\n` +
      `  const id = request.headers.get("x-shopify-webhook-id");\n` +
      `  await enqueue(id, raw);\n  return new Response("ok");\n};`)],

  ["O3-webhook-no-dedup", "a legitimate retry re-runs the work every time", (d) =>
    w(d, "src/pages/api/webhooks/products.ts", WEBHOOK_OK.replace(/const id = .*\n/, "").replace(/enqueue\(id, raw\)/, "enqueue(raw)"))],

  ["O4-deploy-hook-uncoalesced", "60 orders an hour and the site silently stops updating", (d) =>
    w(d, "src/pages/api/webhooks/products.ts",
      WEBHOOK_OK.replace("await enqueue(id, raw);",
        `await fetch(import.meta.env.DEPLOY_HOOK_URL, { method: "POST" });`))],

  ["O5-no-listing-topics", "the storefront keeps serving products the merchant took down", (d) =>
    w(d, "src/lib/webhooks/topics.ts", `export const TOPICS = ["PRODUCTS_UPDATE", "PRODUCTS_DELETE"];`)],

  ["O6-no-reconcile", "webhook-only is non-conformant by Shopify's own guidance", (d) => {
    rmSync(join(d, "vercel.json"), { force: true });
    w(d, "src/pages/api/webhooks/products.ts", WEBHOOK_OK.replace(/\/\/ reconcile.*\n/, ""));
  }],

  ["O7-graphql-errors-ignored", "a failed query renders as a successful empty page", (d) =>
    w(d, "src/lib/shopify/client.ts",
      `export async function sf(q) {\n` +
      `  const r = await fetch(\`https://x.myshopify.com/api/2026-07/graphql.json\`, {\n` +
      `    method: "POST", headers: { "Shopify-Storefront-Buyer-IP": ip }, body: JSON.stringify({ query: q }) });\n` +
      `  if (!r.ok) throw new Error("http " + r.status);\n` +
      `  const j = await r.json();\n  return j.data;\n}`)],

  ["O8-complexity-error-unhandled", "retrying a query that can never succeed", (d) =>
    w(d, "src/lib/shopify/retry.ts",
      `export const shouldRetry = (e) => e?.extensions?.code === "THROTTLED";`)],

  ["O9-version-literal-repeated", "one call site upgrades and the rest do not", (d) =>
    w(d, "src/lib/shopify/other.ts",
      `export const u = "https://x.myshopify.com/api/2026-07/graphql.json";\n` +
      `export const v = "https://x.myshopify.com/api/2025-01/graphql.json";`)],

  ["O10-api-version-near-expiry", "Shopify falls forward to a version you never tested, silently", (d) =>
    w(d, "src/lib/shopify/version.ts", `export const API_VERSION = "2019-04";`)],

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

/* ================================================== the CLI, and the island's own catch */

test("A1-cli-present: without the Shopify CLI there is no path to the Admin API", () => {
  const dir = correct();
  try {
    const found = (runWithCli(dir, "absent").json?.findings ?? []).map((f) => f.id);
    assert.ok(found.includes("A1-cli-present"),
      `a missing CLI must be a finding, got: ${found.join(", ") || "(nothing)"}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("A2-cli-authenticated: a CLI with no store session is reported UNKNOWN, never as a pass", () => {
  const dir = correct();
  try {
    const r = runWithCli(dir, "no-session");
    const unknownIds = (r.json?.unknowns ?? []).map((u) => u.id);
    const passIds = (r.json?.passes ?? []);
    assert.ok(unknownIds.includes("A2-cli-authenticated"),
      `no session must be UNKNOWN, got unknowns: ${unknownIds.join(", ") || "(none)"}`);
    assert.ok(!passIds.includes("A2-cli-authenticated"),
      "an unauthenticated CLI must never be recorded as a pass");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("E4-island-catches: an island that does not catch cannot return a 200 on failure", () => {
  const dir = correct();
  try {
    // The island fetches and renders a price with no try/catch and no neutral state, so a slow
    // or throttling Shopify produces a 500 from the island, which Astro answers by leaving the
    // STALE build price on screen.
    w(dir, "src/components/LivePrice.astro",
      `---\nconst r = await fetch('https://x.myshopify.com/api/v/graphql.json');\nconst j = await r.json();\n---\n<p>{j.price}</p>\n`);
    const found = ids(run(dir));
    assert.ok(found.includes("E4-island-catches"),
      `an island with no error path must be a finding, got: ${found.join(", ") || "(nothing)"}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every check in the gate has a case in this file", () => {
  const dir = correct();
  try {
    const all = run(dir);
    // NO EXEMPTION LIST. This test previously carried one, and it contained exactly the three
    // checks nobody had watched fire, which makes the completeness test complicit in the thing it
    // exists to prevent. Every id below is now covered by a case above that breaks it.
    const CLI_AND_ISLAND = ["A1-cli-present", "A2-cli-authenticated", "E4-island-catches"];
    const known = new Set([...CASES.map(([id]) => id), ...CLI_AND_ISLAND]);
    const missing = (all.json.passes ?? []).filter((id) => !known.has(id));
    assert.deepEqual(missing, [],
      `these checks pass but nothing here proves they can FAIL, which is how a dead gate is born: ${missing.join(", ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ==================================================
 * RUNTIME MODE. Static analysis of a storefront is a proxy: it reads that `httpOnly: true`
 * appears in a file, not that the cookie reaching a browser carries it. Flags set in one file
 * and cookies.set() called in another satisfy a regex and fail a buyer. These cases serve a
 * storefront and ASK it.
 * ================================================== */


/**
 * A served storefront, IN A SEPARATE PROCESS.
 *
 * This must not be an in-process http server. The gate is invoked with spawnSync, which BLOCKS
 * the event loop, so a server living in this process can never accept the connection: every
 * runtime check then reports "nothing answered" and every case fails after a 20-second stall
 * that looks exactly like a network timeout. It cost an hour to see.
 */
function storefront({ cookie, leakId = false, price = true, agents = true }) {
  const dir = mkdtempSync(join(tmpdir(), "srv-"));
  const file = join(dir, "server.mjs");
  writeFileSync(file, `
import { createServer } from 'node:http';
const cookie = ${JSON.stringify(cookie ?? null)};
const leakId = ${leakId}, price = ${price}, agents = ${agents};
const srv = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/cart/add') {
    const h = { location: '/products/alpha?added=1' };
    if (cookie) h['set-cookie'] = cookie;
    res.writeHead(303, h); return res.end('ok');
  }
  if (u === '/agents.md' || u === '/llms.txt') {
    if (!agents) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'text/markdown' });
    return res.end('# Agent instructions\\nPlenty of real content here for a reader to use.');
  }
  if (u.startsWith('/products/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    const leak = leakId ? '<script>window.cartId="gid://shopify/Cart/ABC?key=secret1"</script>' : '';
    const p = price ? '<p data-price-fallback>A$10.00</p>' : '<p>no price</p>';
    return res.end('<html><head><link rel="canonical" href="http://x' + u + '"></head><body>' + leak + p + '</body></html>');
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body>home</body></html>');
});
srv.listen(0, '127.0.0.1', () => console.log(srv.address().port));
`);
  const child = spawn("node", [file], { stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve) => {
    child.stdout.once("data", (d) => {
      resolve({
        base: `http://127.0.0.1:${String(d).trim()}`,
        srv: { close: () => { try { child.kill(); } catch {} rmSync(dir, { recursive: true, force: true }); } },
      });
    });
  });
}

const runRuntime = (dir, base) => {
  const r = spawnSync("node", [GATE, dir, "--no-cli", "--json", "--runtime", base], { encoding: "utf8" });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* */ }
  return { json, out: `${r.stdout}${r.stderr}`, ids: (json?.findings ?? []).map((f) => f.id) };
};

const GOOD_COOKIE = "plt_cart=gid://shopify/Cart/A?key=k; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax";

test("R3: a correct cart cookie on the wire passes", async () => {
  const dir = correct(); const { srv, base } = await storefront({ cookie: GOOD_COOKIE });
  try { assert.ok(!runRuntime(dir, base).ids.includes("R3-cart-cookie")); }
  finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R3: flags present in SOURCE but absent on the WIRE are caught", async () => {
  // The fixture's source sets httpOnly/secure/sameSite correctly, so every static check passes.
  // Only the runtime check can see that the cookie actually sent carries none of them.
  const dir = correct();
  const { srv, base } = await storefront({ cookie: "plt_cart=gid://shopify/Cart/A?key=k; Path=/" });
  try {
    const r = runRuntime(dir, base);
    assert.ok(r.ids.includes("R3-cart-cookie"), `expected R3, got: ${r.ids.join(", ")}`);
    const f = r.json.findings.find((x) => x.id === "R3-cart-cookie");
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax"]) assert.match(f.msg, new RegExp(flag));
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R3: SameSite=Strict is caught on the wire", async () => {
  const dir = correct();
  const { srv, base } = await storefront({ cookie: "plt_cart=x; Path=/; HttpOnly; Secure; SameSite=Strict" });
  try { assert.ok(runRuntime(dir, base).ids.includes("R3-cart-cookie")); }
  finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R4: the capability secret must never reach the client", async () => {
  const dir = correct();
  const { srv, base } = await storefront({ cookie: GOOD_COOKIE, leakId: true });
  try { assert.ok(runRuntime(dir, base).ids.includes("R4-cart-id-leaked")); }
  finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R1: a served product page with no price in its HTML is caught", async () => {
  const dir = correct();
  const { srv, base } = await storefront({ cookie: GOOD_COOKIE, price: false });
  try { assert.ok(runRuntime(dir, base).ids.includes("R1-pdp-serves")); }
  finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("R5/R6: an agent surface that is in src but does not SERVE is caught", async () => {
  const dir = correct();   // src has agents.md.ts and llms.txt.ts, so the static checks pass
  const { srv, base } = await storefront({ cookie: GOOD_COOKIE, agents: false });
  try {
    const ids = runRuntime(dir, base).ids;
    assert.ok(ids.includes("R5-agents-md") && ids.includes("R6-llms-txt"),
      `serving is what matters, not presence in src. got: ${ids.join(", ")}`);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("an unreachable base reports UNKNOWN and invents nothing", async () => {
  const dir = correct();
  try {
    const r = runRuntime(dir, "http://127.0.0.1:1");
    assert.ok((r.json.unknowns ?? []).some((u) => u.id === "R0-reachable"));
    assert.ok(!r.ids.some((id) => id.startsWith("R")), `no runtime finding may be invented: ${r.ids.join(", ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
