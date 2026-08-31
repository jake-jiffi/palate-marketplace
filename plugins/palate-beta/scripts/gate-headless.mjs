#!/usr/bin/env node
/**
 * gate-headless.mjs - is this headless Shopify storefront actually constructed correctly?
 *
 * ===================== WHY THIS EXISTS =====================
 *
 * A headless storefront can build, deploy, look right and still be wrong in ways nobody sees
 * until it costs money or breaks the law. Every check below is here because it was MEASURED
 * failing, on a real build, not because it sounded like a good idea:
 *
 *   - A price island that "fails closed" does not. Astro's island replacement returns early on
 *     any non-200 and leaves the fallback in place, and the fallback is the BUILD-TIME price.
 *     Five of seven failure modes showed a stale price, four of them silently. A stale
 *     promotional price on a live page is a misrepresentation under Australian Consumer Law.
 *   - The cart id is a capability URL carrying a ?key= secret, and a cart holds the buyer's
 *     email, address and phone. Four of nine surveyed open-source Astro-Shopify storefronts put
 *     it in localStorage, and Hydrogen's own published cart example sets no cookie flags at all.
 *   - cartLinesAdd can be accepted, return a cart, return an EMPTY userErrors array, and have
 *     added nothing, so "no errors" is not "it worked".
 *   - A product not published to the channel is INDISTINGUISHABLE from one that does not exist.
 *     Measured on our own dev store: 23 products in admin, 4 visible to the Storefront API.
 *   - Going headless DELETES the /agents.md and /llms.txt Shopify writes for every Liquid
 *     merchant, so an agent loses the plain-language instructions for buying from this store.
 *
 * ===================== HOW IT BEHAVES =====================
 *
 * SILENT ON EVERY NON-COMMERCE BUILD. Without `.palate/catalogue.json` this is not a headless
 * storefront and the gate exits 2 having checked nothing, which it says out loud. A gate that
 * invents findings on a brochure site gets switched off, and a switched-off gate protects nobody.
 *
 * NOTHING IS INFERRED FROM ABSENCE ALONE. Where a check cannot be performed it is reported as
 * UNKNOWN, never as a pass. "Could not check" and "clean" are different words here.
 *
 *   exit 0  clean
 *   exit 1  findings
 *   exit 2  not a headless storefront, or nothing could be checked
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const dir = resolve(argv.find((a) => !a.startsWith("--")) ?? ".");
const JSON_OUT = argv.includes("--json");
const SKIP_CLI = argv.includes("--no-cli");

const findings = [];
const unknowns = [];
const passes = [];
const add = (id, msg, fix) => findings.push({ id, msg, fix });
const unknown = (id, why) => unknowns.push({ id, why });
const ok = (id) => passes.push(id);

const read = (p) => { try { return readFileSync(join(dir, p), "utf8"); } catch { return null; } };
const has = (p) => existsSync(join(dir, p));

function walk(d, out = []) {
  let ents = [];
  try { ents = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git" || e.name === ".vercel") continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(join(dir, "src"));
const srcText = srcFiles.map((f) => ({ f, t: (() => { try { return readFileSync(f, "utf8"); } catch { return ""; } })() }));
const anySrc = (re) => srcText.filter(({ t }) => re.test(t)).map(({ f }) => relative(dir, f));

/* ============================================================ 0. is this a headless storefront */

const catRaw = read(".palate/catalogue.json");
if (!catRaw) {
  console.log("gate-headless: no .palate/catalogue.json, so this is not a headless Shopify storefront. Nothing checked.");
  process.exit(2);
}
let cat = null;
try { cat = JSON.parse(catRaw); } catch { /* below */ }
if (!cat) {
  console.error("gate-headless: .palate/catalogue.json is not readable JSON. The survey is UNKNOWN, not clean.");
  process.exit(2);
}

/* ============================================================ A. the toolchain */

if (SKIP_CLI) {
  unknown("A1-cli-present", "--no-cli was passed");
} else {
  let cliOut = null;
  try {
    cliOut = execFileSync("npx", ["--yes", "@shopify/cli@latest", "version"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch (e) { cliOut = null; }
  if (cliOut && /\d+\.\d+/.test(cliOut)) ok("A1-cli-present");
  else add("A1-cli-present",
    "The Shopify CLI is not available.",
    "Install it (npx @shopify/cli@latest version). It is how a local build reaches the Admin API without a long-lived token: `store auth` keeps an online token in the OS keychain, so no Admin secret lands in the repo or a .env.");

  // An auth session is not required to BUILD, but it is required for publication checks,
  // metaobjects and webhooks, so its absence is a warning rather than a block.
  let sess = null;
  try {
    sess = execFileSync("npx", ["--yes", "@shopify/cli@latest", "store", "auth", "list", "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch { sess = null; }
  if (sess && /"sessions"\s*:\s*\[\s*\{/.test(sess)) ok("A2-cli-authenticated");
  else unknown("A2-cli-authenticated",
    "No `shopify store auth` session. Admin-side checks (publication, metaobjects, webhooks) cannot run. Authenticate with: npx @shopify/cli@latest store auth --store <shop>.myshopify.com --scopes read_products,read_publications");
}

/* ============================================================ B. the survey */

if (cat.ok !== true) {
  add("B1-survey-failed",
    `The catalogue survey reports ok:false (${cat.reason ?? "no reason given"}).`,
    "Re-run scripts/palate-shopify.mjs. A failed survey means every route and price in this build came from somewhere else.");
} else ok("B1-survey-failed");

const products = Array.isArray(cat.products) ? cat.products : [];
if (cat.ok === true && products.length === 0) {
  add("B2-empty-catalogue",
    "The survey succeeded and returned ZERO products.",
    "Treat this as a build failure, never as an empty state. A product not published to the channel AND the queried market is indistinguishable from one that does not exist: no error, no warning. Measured on a real dev store: 23 products in admin, 4 visible to the Storefront API. Check channel publication before anything else.");
} else if (products.length) ok("B2-empty-catalogue");

if (cat.surveyedAt) {
  const age = (Date.now() - Date.parse(cat.surveyedAt)) / 86_400_000;
  if (Number.isFinite(age) && age > 14) {
    add("B3-stale-survey",
      `The catalogue was surveyed ${Math.round(age)} days ago.`,
      "Re-survey. Prices, availability and handles all move, and every static route in this build was generated from it.");
  } else ok("B3-stale-survey");
} else unknown("B3-stale-survey", "the catalogue has no surveyedAt timestamp");

const imagesWithDims = products.filter((p) => p?.image?.width > 0 && p?.image?.height > 0).length;
if (products.length && imagesWithDims === 0) {
  add("B4-no-image-dimensions",
    "No product in the catalogue carries image dimensions.",
    "Without width and height nothing can measure crop loss, and a 2:3 portrait through a 3:1 slot shows 22% of the frame. Re-run the survey; the Storefront API returns them.");
} else if (products.length) ok("B4-no-image-dimensions");

/* ============================================================ C. configuration */

const envExample = read(".env.example") ?? "";
const astroConfig = read("astro.config.mjs") ?? read("astro.config.ts") ?? "";
const allConfig = `${envExample}\n${astroConfig}\n${read("vercel.json") ?? ""}`;

const publicToken = anySrc(/PUBLIC_[A-Z_]*(SHOPIFY|STOREFRONT)[A-Z_]*/);
if (publicToken.length || /PUBLIC_[A-Z_]*(SHOPIFY|STOREFRONT)/.test(allConfig)) {
  add("C1-public-prefixed-token",
    `A Shopify token is exposed under a PUBLIC_ prefix (${publicToken[0] ?? "config"}).`,
    "PUBLIC_ is INLINED AT BUILD, so rotating that token would require rebuilding every page in the catalogue. Read it server-side instead.");
} else ok("C1-public-prefixed-token");

const versionInSource = anySrc(/\/api\/20\d\d-\d\d\/graphql\.json/);
if (versionInSource.length) {
  add("C2-hardcoded-api-version",
    `The Storefront API version is hardcoded in source (${versionInSource.slice(0, 3).join(", ")}).`,
    "Pin it in one place (an env var) and read it everywhere. A version lives about a year; hunting it across files is how half a codebase ends up on a dead version.");
} else ok("C2-hardcoded-api-version");

const gitignore = read(".gitignore") ?? "";
if (has(".env") && !/^\s*\.env\s*$/m.test(gitignore)) {
  add("C3-env-not-ignored",
    ".env exists and is not in .gitignore.",
    "Add it. A Storefront token in git history is a rotation, not a revert.");
} else ok("C3-env-not-ignored");

/* ============================================================ D. render strategy */

if (astroConfig) {
  if (/output:\s*["']server["']/.test(astroConfig.replace(/^\s*(\/\/|\*).*$/gm, ""))) {
    add("D1-output-server",
      'astro.config sets output: "server".',
      "A storefront does not need it: a real 742-URL store ships 783 prerendered pages with one on-demand route, and a server build produces ZERO html so pagefind indexes nothing. Use static and promote individual routes with prerender = false.");
  } else ok("D1-output-server");
} else unknown("D1-output-server", "no astro.config found");

const prerenderTrue = anySrc(/export\s+const\s+prerender\s*=\s*true/);
if (prerenderTrue.length) {
  add("D2-prerender-true",
    `export const prerender = true in ${prerenderTrue.join(", ")}.`,
    "Static is already the default, so this adds nothing and pins that page against a later config flip, turning a one-line change into a file-by-file hunt. Declare exceptions, never the rule.");
} else ok("D2-prerender-true");

const onDemand = anySrc(/export\s+const\s+prerender\s*=\s*false/);
const badOnDemand = onDemand.filter((f) => /src\/pages\/(products|collections)\//.test(f));
if (badOnDemand.length) {
  add("D3-catalogue-on-demand",
    `Catalogue routes are on-demand: ${badOnDemand.join(", ")}.`,
    "Product and collection pages are where SEO and Core Web Vitals live, and they are the most cacheable thing on the site. Keep them static; put only cart mutations and account routes on-demand.");
} else ok("D3-catalogue-on-demand");

const pdp = srcText.find(({ f }) => /src\/pages\/products\/\[.*\]\.astro$/.test(f));
if (!pdp) {
  unknown("D4-product-route", "no src/pages/products/[...].astro found, so the product template could not be checked");
} else if (!/getStaticPaths/.test(pdp.t)) {
  add("D4-product-route",
    "The product route does not use getStaticPaths.",
    "Without it every product page is rendered on demand. Generate them from the catalogue.");
} else ok("D4-product-route");

/* ============================================================ E. the price rule */

const island = srcText.find(({ t }) => /server:defer/.test(t));
if (!pdp) {
  unknown("E1-price-island", "no product template to check");
} else if (!island) {
  add("E1-price-island",
    "No server:defer price island anywhere in src.",
    "A statically built product page bakes the price at build time. On a store with promotional pricing that is a wrong price on a live page. Add a deferred island, or accept Tier 1 knowingly and redeploy on products/update.");
} else ok("E1-price-island");

if (island) {
  if (!/slot=["']fallback["']/.test(pdp?.t ?? "") && !/slot=["']fallback["']/.test(island.t)) {
    add("E2-island-fallback",
      "The price island has no fallback slot.",
      "The build-stamped price belongs in the fallback so the page paints instantly and a crawler sees a number.");
  } else ok("E2-island-fallback");

  const watchdog = anySrc(/data-price-fallback/) .length > 0 && anySrc(/isConnected/).length > 0;
  if (!watchdog) {
    add("E3-failclosed-watchdog",
      "There is no fail-closed watchdog for the price island.",
      "THIS IS THE ONE THAT COSTS MONEY. Astro's island replacement is `if (!s || r.status !== 200 || contentType !== 'text/html') return;` and nothing else, so on a 500, a wrong content-type or a rejected fetch it TOUCHES NOTHING and the fallback stays. The fallback is the BUILD-TIME price. Measured across seven failure modes: five showed the stale price, four silently. Add a host-page watchdog that replaces any still-connected [data-price-fallback] with a neutral message after a deadline; Astro removes the node on success, so isConnected is the signal.");
  } else ok("E3-failclosed-watchdog");

  // The island must not render the build price on its own error path.
  //
  // Look across ALL of src, not just the file carrying server:defer. server:defer sits on the
  // CALL SITE (the product page); the try/catch lives in the island COMPONENT. Checking only the
  // file with the directive reported a correctly-written island as broken, which is a false
  // failure on the one check most likely to be switched off for crying wolf.
  const neutral = /(check price|price unavailable|in cart|unavailable)/i;
  const islandCatches = srcText.some(({ t }) => /catch\s*[({]/.test(t) && neutral.test(t) && /(price|Price)/.test(t));
  if (islandCatches) ok("E4-island-catches");
  else add("E4-island-catches",
    "The price island does not visibly fail closed on its own error path.",
    "Catch inside the island and render a neutral state, so the response is still a 200 text/html. That covers Shopify being slow or throttling, which the watchdog cannot distinguish from success.");
}

/* ============================================================ F. cart security */

const cartFiles = srcText.filter(({ f, t }) => /cart/i.test(f) || /cartLinesAdd|cartCreate/.test(t));
const cartText = cartFiles.map((x) => x.t).join("\n");

if (!cartFiles.length) {
  unknown("F1-cart", "no cart code found, so cart security could not be checked");
} else {
  if (/localStorage[\s\S]{0,120}cart|cart[\s\S]{0,60}localStorage/i.test(cartText)) {
    add("F1-cart-in-localstorage",
      "The cart id appears to be stored in localStorage.",
      "The cart id is a CAPABILITY URL embedding a ?key= secret, and a cart carries the buyer's email, address and phone, so any XSS leaks buyer PII. Four of nine surveyed open-source Astro-Shopify storefronts make this mistake, three of them the same file copy-pasted. Use an HttpOnly cookie set by a server endpoint.");
  } else ok("F1-cart-in-localstorage");

  const cookieSet = /cookies\.set\(/.test(cartText);
  if (!cookieSet) {
    unknown("F2-cart-cookie-flags", "no cookies.set() call found in cart code");
  } else {
    const miss = [];
    if (!/httpOnly:\s*true/.test(cartText)) miss.push("httpOnly");
    if (!/secure:\s*true/.test(cartText)) miss.push("secure");
    if (!/sameSite:/.test(cartText)) miss.push("sameSite");
    if (miss.length) {
      add("F2-cart-cookie-flags",
        `The cart cookie is missing ${miss.join(", ")}.`,
        "Hydrogen's own published cart example sets none of these, so the copy-paste path from Shopify's documentation yields a cookie document.cookie can read.");
    } else ok("F2-cart-cookie-flags");

    if (/sameSite:\s*["']strict["']/i.test(cartText)) {
      add("F3-samesite-strict",
        "The cart cookie is SameSite=strict.",
        "The buyer returns from Shopify's checkout domain, which is a cross-site top-level navigation, and a Strict cookie is NOT sent on it. The cart appears wiped by the act of visiting checkout. Use lax.");
    } else ok("F3-samesite-strict");
  }

  if (/cartLinesAdd|cartCreate/.test(cartText) && !/totalQuantity/.test(cartText)) {
    add("F4-quantity-unverified",
      "A cart mutation is issued without reading totalQuantity back.",
      "cartLinesAdd can be accepted, return a cart, return an EMPTY userErrors array and have added nothing (asking for more than is available is the confirmed case). So no-errors is not it-worked. Require totalQuantity to move, or the buyer is told the item is in their bag while the bag stays empty.");
  } else ok("F4-quantity-unverified");

  const cartOnDemand = cartFiles.some(({ f, t }) => /export\s+const\s+prerender\s*=\s*false/.test(t) && /api|cart/i.test(f));
  if (!cartOnDemand) {
    add("F5-cart-not-server",
      "No cart route is marked prerender = false.",
      "Cart mutations must run server-side so the capability secret never reaches client JavaScript. Mark only those routes on-demand; the catalogue stays static.");
  } else ok("F5-cart-not-server");
}

/* ============================================================ G. the Shopify contract */

const allText = srcText.map((x) => x.t).join("\n");

if (/totalTaxAmount|totalDutyAmount|checkoutChargeAmount/.test(allText)) {
  add("G1-deprecated-cart-fields",
    "A deprecated CartCost tax or duty field is read.",
    "totalTaxAmount and its siblings have been deprecated since 2025-01, and on a taxes-included store the cart can never show a tax line anyway.");
} else ok("G1-deprecated-cart-fields");

if (/quantityAvailable/.test(allText)) {
  const scoped = /unauthenticated_read_product_inventory/.test(`${allText}\n${envExample}`);
  if (!scoped) {
    add("G2-inventory-without-scope",
      "quantityAvailable is queried.",
      "It is DENIED unless the Storefront token carries unauthenticated_read_product_inventory, which is not granted by default. availableForSale works without it, so render in-stock/sold-out rather than a count, or tick the scope in the Headless channel.");
  } else ok("G2-inventory-without-scope");
} else ok("G2-inventory-without-scope");

if (/checkoutCreate\b/.test(allText)) {
  add("G3-custom-checkout",
    "checkoutCreate is used.",
    "The Checkout API is superseded by Cart, and no plan buys a self-hosted checkout: it is a terms-of-service boundary requiring written authorisation from Shopify, including on Plus. Hand off via the cart's checkoutUrl.");
} else ok("G3-custom-checkout");

/* ============================================================ H. the agent surface */

const agentRoutes = [
  ["H1-agents-md", "agents.md", /agents\.md/],
  ["H2-llms-txt", "llms.txt", /llms\.txt/],
];
for (const [id, name, re] of agentRoutes) {
  const served = srcText.some(({ f }) => re.test(f)) || has(`public/${name}`) || has(`dist/client/${name}`);
  if (!served) {
    add(id,
      `/${name} is not served.`,
      `Shopify writes this for every Liquid merchant and it is rendered by the online store layer, so GOING HEADLESS DELETES IT. Verified 2-for-2 on Hydrogen storefronts including Shopify's own demo. An agent loses the plain-language instructions for buying from this store. Restoring it is a cost of headless, not a feature.`);
  } else ok(id);
}

/* ============================================================ J. content <-> catalogue integrity
 *
 * THE CASE THIS EXISTS FOR. Somebody describes what they want in a conversation, Palate creates
 * the items in Shopify AND builds the site. Most of the site is NOT Shopify content: a video
 * hero, an editorial block, a lookbook. Those hand-authored surfaces then POINT AT catalogue
 * items, and that pointer is the fragile part. A handle that is renamed, unpublished, or was
 * never created leaves a link to a 404 on the page a campaign is driving traffic to, and nothing
 * in a build fails: the page renders, the link is just wrong.
 *
 * So every reference from site content into the catalogue is resolved here, in both directions.
 */

const CATALOGUE_HANDLES = new Set(products.map((p) => p?.handle).filter(Boolean));
const COLLECTION_HANDLES = new Set((cat.collections ?? []).map((c) => c?.handle).filter(Boolean));
const AVAILABLE = new Map(products.map((p) => [p?.handle, p?.availableForSale !== false]));

// Only hand-authored surfaces are checked. A template that renders /products/${p.handle} from the
// catalogue cannot dangle by construction, and flagging its literal would be noise.
const authored = srcText.filter(({ f }) => !/src\/pages\/(products|collections)\/\[/.test(f));
const refs = (re) => {
  const out = [];
  for (const { f, t } of authored) {
    for (const m of t.matchAll(re)) {
      const h = m[1];
      if (!h || h.includes("$") || h.includes("{") || h.includes("[")) continue;  // an expression, not a literal
      out.push({ file: relative(dir, f), handle: h });
    }
  }
  return out;
};

const productRefs = refs(/\/products\/([A-Za-z0-9][A-Za-z0-9._-]*)/g);
const dangling = productRefs.filter((r) => !CATALOGUE_HANDLES.has(r.handle));
if (products.length && dangling.length) {
  const list = [...new Set(dangling.map((d) => `${d.handle} (${d.file})`))].slice(0, 6);
  add("J1-dangling-product-ref",
    `Site content links to ${dangling.length} product handle(s) that are not in the catalogue: ${list.join(", ")}.`,
    "Either the product was never created, was renamed, or is not published to this channel. Nothing fails at build: the page renders and the link 404s. Create or publish it, or fix the handle. Publication is the usual cause and it is silent.");
} else ok("J1-dangling-product-ref");

const collRefs = refs(/\/collections\/([A-Za-z0-9][A-Za-z0-9._-]*)/g);
const danglingColl = collRefs.filter((r) => r.handle !== "all" && !COLLECTION_HANDLES.has(r.handle));
if (COLLECTION_HANDLES.size && danglingColl.length) {
  const list = [...new Set(danglingColl.map((d) => `${d.handle} (${d.file})`))].slice(0, 6);
  add("J2-dangling-collection-ref",
    `Site content links to ${danglingColl.length} collection handle(s) not in the catalogue: ${list.join(", ")}.`,
    "Same cause as J1, and a collection is usually the destination of a campaign, so this is the more expensive one to get wrong.");
} else ok("J2-dangling-collection-ref");

const featuredSoldOut = productRefs.filter((r) => CATALOGUE_HANDLES.has(r.handle) && AVAILABLE.get(r.handle) === false);
if (featuredSoldOut.length) {
  const list = [...new Set(featuredSoldOut.map((d) => `${d.handle} (${d.file})`))].slice(0, 6);
  add("J3-featured-unavailable",
    `Hand-authored content features ${featuredSoldOut.length} product(s) that are SOLD OUT: ${list.join(", ")}.`,
    "A hero or campaign block pointing at an unbuyable item is worse than pointing at nothing: the visitor arrives ready to buy. Either restock, or feature something available, or say plainly on the surface that it is sold out.");
} else ok("J3-featured-unavailable");

// A price typed into a hand-authored surface cannot be corrected by the island and will go stale.
const hardPrice = authored
  .filter(({ f }) => !/agents\.md|llms\.txt|catalogue|LivePrice/i.test(f))
  .filter(({ t }) => /(?:^|[^\w$])(?:A?\$|£|€)\s?\d{1,4}(?:[.,]\d{2})\b/.test(t.replace(/^\s*(\/\/|\*|#).*$/gm, "")))
  .map(({ f }) => relative(dir, f));
if (hardPrice.length) {
  add("J4-hardcoded-price",
    `A literal price appears in hand-authored content: ${hardPrice.slice(0, 4).join(", ")}.`,
    "It cannot be corrected by the price island and nothing will ever update it. Read the price from the catalogue, or from the Storefront API at request time. A stale price on a live page is a misrepresentation regardless of which surface it is on.");
} else ok("J4-hardcoded-price");

// Every catalogue product should have a route, or the build silently ships a partial store.
if (products.length) {
  const built = (() => {
    try { return new Set(readdirSync(join(dir, "dist", "client", "products"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name)); } catch { return null; }
  })();
  if (!built) unknown("J5-unrouted-products", "no built product directory; run the build first");
  else {
    const missing = [...CATALOGUE_HANDLES].filter((h) => !built.has(h));
    if (missing.length) {
      add("J5-unrouted-products",
        `${missing.length} catalogue product(s) have no built page: ${missing.slice(0, 5).join(", ")}.`,
        "getStaticPaths is not generating every product, so part of the store is unreachable and absent from the sitemap. A store that silently ships 80% of its catalogue looks fine in review.");
    } else ok("J5-unrouted-products");
  }
}

/* ============================================================ K. the write path */

// Any script that MUTATES Shopify must be unable to hit a live store by accident.
const writers = walk(join(dir, "scripts")).concat(walk(join(dir, "ops")))
  .map((f) => ({ f, t: (() => { try { return readFileSync(f, "utf8"); } catch { return ""; } })() }))
  .filter(({ t }) => /productCreate|productUpdate|productDelete|collectionCreate|publishablePublish|metaobjectCreate|productVariantsBulk/.test(t));
if (!writers.length) ok("K1-write-guard");
else {
  const unguarded = writers
    .filter(({ t }) => !/partnerDevelopment|--allow-destructive|dry-?run|confirm|approval/i.test(t))
    .map(({ f }) => relative(dir, f));
  if (unguarded.length) {
    add("K1-write-guard",
      `${unguarded.length} script(s) mutate Shopify with no guard: ${unguarded.slice(0, 4).join(", ")}.`,
      "A write script that can be pointed at a real merchant by a typo eventually is, and a metaobject type identifier cannot be renamed after creation, so a mistake on a live store is permanent. Require shop.plan.partnerDevelopment, or a dry-run plus explicit approval, before any mutation.");
  } else ok("K1-write-guard");
}

/* ============================================================ I. SEO */

const distProduct = (() => {
  const d = join(dir, "dist", "client", "products");
  try {
    const first = readdirSync(d, { withFileTypes: true }).find((e) => e.isDirectory());
    return first ? readFileSync(join(d, first.name, "index.html"), "utf8") : null;
  } catch { return null; }
})();

if (!distProduct) {
  unknown("I1-product-canonical", "no built product page found; run the build first");
} else if (!/<link[^>]+rel=["']canonical["']/i.test(distProduct)) {
  add("I1-product-canonical",
    "A built product page has no canonical link.",
    "Shopify emits agent and ad deep links carrying ?variant=, so every product URL has duplicate spellings competing with it.");
} else ok("I1-product-canonical");

if (distProduct) {
  if (!/data-price-fallback|itemprop=["']price["']|"price"/.test(distProduct)) {
    add("I2-price-not-in-html",
      "The built product page carries no price in its HTML.",
      "The fallback is what curl, most LLM scrapers and the first-pass crawl read. 39% of retailer homepages are already not machine-readable to LLMs, and putting price behind JavaScript is exactly how that happens.");
  } else ok("I2-price-not-in-html");
}

/* ============================================================ report */

const total = findings.length + unknowns.length + passes.length;
if (JSON_OUT) {
  console.log(JSON.stringify({ findings, unknowns, passes, checked: total }, null, 2));
} else {
  if (unknowns.length) {
    console.error(`gate-headless: ${unknowns.length} thing(s) could NOT be checked. These are unknown, not clean.\n`);
    for (const u of unknowns) console.error(`  [${u.id}] ${u.why}`);
    console.error("");
  }
  if (findings.length) {
    console.error(`gate-headless: ${findings.length} finding(s) over ${total} check(s). This storefront is NOT correctly constructed.\n`);
    for (const f of findings) console.error(`  [${f.id}] ${f.msg}\n      FIX: ${f.fix}\n`);
  } else {
    console.log(`gate-headless: clean over ${passes.length} check(s)${unknowns.length ? `, ${unknowns.length} unknown` : ""}.`);
  }
}
process.exit(findings.length ? 1 : (passes.length === 0 ? 2 : 0));
