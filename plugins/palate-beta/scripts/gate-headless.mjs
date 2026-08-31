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
const RUNTIME = (() => { const i = argv.indexOf("--runtime"); return i > -1 ? argv[i + 1] : null; })();

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

/* ============================================================ X. the Storefront API contract
 *
 * Four ways to call this API correctly-looking and be wrong, none of which raises an error.
 * Every one was found by auditing the API surface against a build that already passed 50 checks.
 */

// X1: @inContext DOES NOT REACH THE CART. Cart context comes only from cartCreate or
// cartBuyerIdentityUpdate with buyerIdentity.countryCode. A build that sets country on its
// product queries and not on its cart shows one currency and charges another, silently.
if (/@inContext\s*\(\s*[^)]*country/i.test(allText)) {
  const mutatesCart = /cartCreate|cartLinesAdd/.test(allText);
  const setsBuyer = /cartBuyerIdentityUpdate|buyerIdentity/.test(allText) && /countryCode/.test(allText);
  if (mutatesCart && !setsBuyer) {
    add("X1-cart-context-missing",
      "Queries use @inContext(country:) but no cart call passes buyerIdentity.countryCode.",
      "@inContext is IGNORED by cart queries and mutations. Cart context comes only from cartCreate or cartBuyerIdentityUpdate. The page shows one currency and the buyer is charged another, with no error anywhere. Pass buyerIdentity { countryCode } when the cart is created.");
  } else ok("X1-cart-context-missing");
} else ok("X1-cart-context-missing");

// X2: cartDiscountCodesUpdate RETURNS SUCCESS FOR A CODE THAT DOES NOT APPLY, with empty
// userErrors and applicable:false. A call that never selects `applicable` cannot be handling it.
if (/cartDiscountCodesUpdate/.test(allText)) {
  const checksApplicable = srcText.some(({ t }) => /cartDiscountCodesUpdate/.test(t) && /applicable/.test(t));
  if (!checksApplicable) {
    add("X2-discount-applicable-unchecked",
      "cartDiscountCodesUpdate is called without selecting `applicable`.",
      "The mutation succeeds with EMPTY userErrors for a code that does not apply, and returns applicable:false instead. A call site that does not read it cannot show the buyer that their code was rejected, so they discover it at the payment step. Select discountCodes { code applicable } and render the failure.");
  } else ok("X2-discount-applicable-unchecked");
} else ok("X2-discount-applicable-unchecked");

// X3: FILTERS ARE THE MERCHANT'S MERCHANDISING, NOT OURS. Only `available` and `price` exist by
// default; everything else depends on their Search & Discovery config, and FilterValue.input is
// meant to be echoed back rather than reconstructed by hand.
const handRolledFilter = srcText.some(({ t }) =>
  /filters\s*:\s*[[{]/.test(t) && /(productType|variantOption|productMetafield)\s*:/.test(t) && !/values\s*{[^}]*input/.test(t));
if (handRolledFilter) {
  add("X3-handrolled-filters",
    "A ProductFilter is constructed by hand without round-tripping `filters { values { input } }`.",
    "Only available and price filters exist by default; the rest come from the merchant's Search & Discovery configuration. FilterValue.input is designed to be echoed back. Hand-writing the shape mis-serialises price ranges and ignores the merchandising they configured.");
} else ok("X3-handrolled-filters");

// X4: REDIRECTS ARE MERCHANT DATA AND DROPPING THEM COSTS RANKINGS AT LAUNCH. A migration is
// exactly when old URLs are still being linked and indexed.
// Two correct shapes: query urlRedirects directly, or consume the redirects the SURVEY captured.
// Requiring the literal query string would false-fail a build that reads them from the catalogue,
// which is the shape this repo actually recommends.
const handlesRedirects =
  /urlRedirects/.test(allText) ||
  (/redirects/.test(allText) && /(ctx|Astro)\.redirect|defineMiddleware|Response\.redirect/.test(allText)) ||
  (Array.isArray(cat.redirects) && /redirects/.test(allText));
if (!handlesRedirects) {
  add("X4-redirects-dropped",
    "Nothing in this build reads urlRedirects.",
    "Every redirect the merchant has ever configured is live data in Shopify, and a headless build that ignores it 404s the URLs those redirects existed to save, at exactly the moment the domain cuts over. Read urlRedirects at build time and emit them, or handle them in middleware.");
} else ok("X4-redirects-dropped");

// X5: POLICIES ARE LEGAL TEXT THE MERCHANT MAINTAINS. A local copy goes stale the first time
// they edit it in admin, and nobody notices because the page still renders.
const policyRoute = srcText.filter(({ f }) => /polic|terms|refund|shipping/i.test(f) && /\/pages\//.test(f));
if (policyRoute.length) {
  const queried = policyRoute.some(({ t }) => /(privacyPolicy|refundPolicy|shippingPolicy|termsOfService|shop\s*{)/i.test(t));
  if (!queried) {
    add("X5-policy-hardcoded",
      `A policy page renders local content rather than querying the shop: ${policyRoute.map((x) => relative(dir, x.f))[0]}.`,
      "Policies are legal text the merchant edits in admin. A local copy is stale from their next edit onward and the page still renders perfectly, so nobody finds out. Query Shop.privacyPolicy and its siblings.");
  } else ok("X5-policy-hardcoded");
} else ok("X5-policy-hardcoded");

/* ============================================================ Y. the measurement layer
 *
 * GOING HEADLESS SPLITS A MERCHANT'S ANALYTICS IN HALF, and only one half reports the loss.
 * Checkout stays on Shopify, so checkout_started / checkout_completed keep firing and the
 * revenue dashboard looks normal. The storefront no longer does, and a headless front end is
 * not even on the list of surfaces permitted to publish standard events, so page_viewed,
 * product_viewed and product_added_to_cart simply stop. The merchant keeps their conversions
 * and loses their funnel, with nothing anywhere reporting a fault.
 */

// Y1. The buyer's IP on server-side calls. Shopify: without it "Shopify can't differentiate
// requests from different buyers", costing throttling headroom, bot protection, and
// "the buyer's logged-in checkout experience" (they land on checkout signed out).
// Keyed on the CART MUTATIONS, not on where the endpoint URL is written. Keying it on the URL
// would switch this check off for exactly the builds that took Y2's advice and consolidated
// onto one client, since the URL then lives in a lib file that is neither /api/ nor on-demand.
const serverSideCalls = srcText.filter(({ t }) =>
  /cartCreate|cartLinesAdd|cartLinesUpdate|cartLinesRemove|cartBuyerIdentityUpdate/.test(t));
if (serverSideCalls.length) {
  if (!/Shopify-Storefront-Buyer-IP/i.test(allText)) {
    add("Y1-buyer-ip-missing",
      `Server-side Storefront calls send no Shopify-Storefront-Buyer-IP header (${serverSideCalls.map((x) => relative(dir, x.f))[0]}).`,
      "Every cart call runs on your server, so Shopify sees ONE client making every buyer's requests. Shopify's own words: this 'can result in throttled API requests, limited bot protection, and unauthenticated flows at checkout'. Send the buyer's IP (the first entry of x-forwarded-for) on buyer-driven calls, and nothing at build time.");
  } else ok("Y1-buyer-ip-missing");
} else ok("Y1-buyer-ip-missing");

// Y2. TWO copies of the wire client. This is not tidiness: it is the shape that let Y1 be
// correct on one path and absent on another in our own storefront.
const clients = srcText.filter(({ t }) => /\/api\/\$\{[^}]*\}\/graphql\.json|\/api\/[\d-]+\/graphql\.json/.test(t));
if (clients.length > 1) {
  add("Y2-duplicate-wire-client",
    `${clients.length} files build the Storefront endpoint URL themselves: ${clients.map((x) => relative(dir, x.f)).join(", ")}.`,
    "A required header added to one copy and forgotten in the other fails silently, which is exactly how the buyer-IP header went missing here. One client, imported everywhere.");
} else ok("Y2-duplicate-wire-client");

// Y3. Consent that cannot reach checkout. The four headless parameters are not optional.
if (/setTrackingConsent/.test(allText)) {
  const missing = ["headlessStorefront", "checkoutRootDomain", "storefrontRootDomain", "storefrontAccessToken"]
    .filter((k) => !new RegExp(k).test(allText));
  if (missing.length) {
    add("Y3-consent-not-headless",
      `setTrackingConsent is called without the headless parameters: ${missing.join(", ")}.`,
      "On a custom storefront the consent call must carry all four, and checkout must sit on the SAME ROOT DOMAIN as the storefront or it cannot read the cookies your banner set. Consent then silently fails to travel and checkout-side pixels are gated by a consent state the buyer never gave.");
  } else ok("Y3-consent-not-headless");
} else ok("Y3-consent-not-headless");

// Y4. Cookies Shopify stopped setting.
if (/_shopify_[ys]\b/.test(allText)) {
  add("Y4-retired-shopify-cookies",
    "Source reads the _shopify_y / _shopify_s cookies.",
    "Shopify stopped setting these on merchant storefronts (changelog says from 1 January 2026; the Hydrogen migration guide says 30 April 2026 — plan for the earlier). Reading them yields undefined and every downstream identity join quietly degrades. clientId on a Web Pixels event replaces _y; _s has no replacement, so mint your own session value.");
} else ok("Y4-retired-shopify-cookies");

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

/* ============================================================ R. RUNTIME
 *
 * EVERYTHING ABOVE IS STATIC ANALYSIS, and static analysis of a storefront is a proxy. It reads
 * that `httpOnly: true` appears in a file; it cannot tell you the cookie that actually reaches a
 * browser carries it. Cookie flags set in one file and cookies.set() called in another pass a
 * regex and fail a buyer.
 *
 * With --runtime <base-url> the gate stops reading and starts asking. Every check below is a real
 * request against a served storefront, and each one is the runtime twin of a static check above.
 * Skipped entirely without the flag, so nothing here slows an ordinary build.
 */

if (RUNTIME) {
  const base = RUNTIME.replace(/\/+$/, "");
  /**
   * GET follows redirects; POST does not, because the cart's Set-Cookie is on the 303 itself and
   * following it would discard the header this gate exists to inspect.
   *
   * AN AUTH WALL IS NOT A MISSING ROUTE. A preview deployment behind Vercel's deployment
   * protection answers 302 to an SSO page for every path, and reporting that as "this product has
   * no page" is a false failure on a storefront that is fine. It is reported as UNKNOWN instead,
   * once, with the reason.
   */
  let authWalled = false;
  const get = async (path, opts = {}) => {
    const isPost = (opts.method ?? "GET").toUpperCase() === "POST";
    try {
      const r = await fetch(base + path, {
        redirect: isPost ? "manual" : "follow",
        signal: AbortSignal.timeout(20000),
        ...opts,
      });
      const body = await r.text().catch(() => "");
      if (!isPost && /vercel\.com\/sso|_vercel\/sso|Authentication Required|sso-api/i.test(`${r.url}\n${body.slice(0, 2000)}`)) {
        authWalled = true;
      }
      return { status: r.status, headers: r.headers, body, url: r.url };
    } catch (e) { return { status: 0, headers: new Headers(), body: "", err: String(e?.name ?? e) }; }
  };

  const firstProduct = products[0]?.handle;
  const pdpPath = firstProduct ? `/products/${firstProduct}` : null;

  // R1: the storefront answers at all.
  const home = await get("/");
  if (authWalled) {
    unknown("R0-reachable",
      `${base} is behind deployment protection (an SSO wall answers every path), so no runtime check could run. Disable protection for this deployment, or point --runtime at a local server.`);
  } else if (home.status === 0) {
    unknown("R0-reachable", `nothing answered at ${base} (${home.err}). No runtime check could run.`);
  } else {
    ok("R0-reachable");

    // R1: a product page serves, and carries a price a non-JS consumer can read.
    if (!pdpPath) unknown("R1-pdp-serves", "the catalogue has no product to request");
    else {
      const pdp = await get(pdpPath);
      if (pdp.status !== 200) {
        add("R1-pdp-serves", `${pdpPath} answered ${pdp.status}.`,
          "A catalogue route that does not serve is a product with no page. Check getStaticPaths and channel publication.");
      } else if (!/(A?\$|£|€)\s?\d|data-price-fallback|"price"/.test(pdp.body)) {
        add("R1-pdp-serves", `${pdpPath} serves but its HTML carries no price.`,
          "The served HTML is what curl, LLM scrapers and the first-pass crawl read. A price only present after JavaScript is a price those consumers never see.");
      } else ok("R1-pdp-serves");

      // R2: canonical, on the wire rather than on disk.
      const pdp2 = await get(pdpPath);
      if (/<link[^>]+rel=["']canonical["']/i.test(pdp2.body)) ok("R2-canonical-served");
      else add("R2-canonical-served", `${pdpPath} serves no canonical link.`,
        "Shopify emits ?variant= deep links for agents and ads, so every product URL has duplicate spellings competing with it.");
    }

    // R3: THE CART COOKIE, READ OFF THE WIRE. This is the check static analysis cannot make.
    // Send Origin and Referer, because a real browser form post does and Astro's CSRF check
    // rejects a POST without them with a 403. Without this the check reports "no cookie" on a
    // storefront whose cart is working perfectly, which is a false alarm on the one check that
    // exists to catch a real security defect.
    const addRes = await get("/api/cart/add", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: base,
        referer: `${base}${pdpPath ?? "/"}`,
      },
      body: `handle=${encodeURIComponent(firstProduct ?? "")}`,
    });
    const setCookie = addRes.headers.getSetCookie?.() ?? [addRes.headers.get("set-cookie")].filter(Boolean);
    const cartCookie = setCookie.find((c) => /cart/i.test(c));
    if (addRes.status === 0) {
      unknown("R3-cart-cookie", "the cart endpoint did not answer");
    } else if (!cartCookie) {
      // A 4xx/5xx with no cookie is a legitimate refusal (out of stock, unconfigured), not a
      // security failure. Report it as unknown rather than inventing a finding.
      unknown("R3-cart-cookie", `no cart cookie was set (endpoint answered ${addRes.status}); the cookie could not be inspected`);
    } else {
      const miss = [];
      if (!/;\s*HttpOnly/i.test(cartCookie)) miss.push("HttpOnly");
      if (!/;\s*Secure/i.test(cartCookie)) miss.push("Secure");
      if (!/;\s*SameSite=Lax/i.test(cartCookie)) miss.push("SameSite=Lax");
      if (miss.length) {
        add("R3-cart-cookie", `The cart cookie ACTUALLY SENT is missing ${miss.join(", ")}.`,
          "This is the wire, not the source. The cart id is a capability secret and the cart carries buyer email, address and phone. SameSite must be Lax specifically: Strict is not sent when the buyer returns from Shopify's checkout domain.");
      } else ok("R3-cart-cookie");

      // R4: the capability secret must never reach the client.
      //
      // Look in a PAGE, not in the redirect body. A 303's body is not exposed by fetch and is not
      // where a leak would appear anyway: the realistic vector is the id rendered into HTML or
      // inlined into client JavaScript so a drawer can read it.
      const pages = [addRes.body];
      for (const path of [pdpPath, "/"].filter(Boolean)) {
        const pg = await get(path, { headers: { cookie: cartCookie.split(";")[0] } });
        pages.push(pg.body);
      }
      const idInBody = pages.some((b) => /gid:\/\/shopify\/Cart\/|[?&]key=[A-Za-z0-9]/.test(b || ""));
      if (idInBody) {
        add("R4-cart-id-leaked", "The cart id or its ?key= secret appears in the response body.",
          "Anyone who reads it can read and modify that cart. It belongs only in the HttpOnly cookie.");
      } else ok("R4-cart-id-leaked");
    }

    /* W. WALK THE FUNNEL.
     *
     * THIS SECTION EXISTS BECAUSE THE GATE PASSED 43 CHECKS ON A STORE NOBODY COULD SHOP.
     * The survey was clean, the routes were static, the cart cookie was correct, the price island
     * failed closed, the checkout URL was Shopify's. And a visitor landing on the home page had
     * no navigation, no footer, no link to a bag, no /cart page at all, and a product page with
     * ZERO outbound links. Every part passed; the journey was impossible.
     *
     * Checking parts is not checking the path. These checks walk it.
     */
    const walkPages = [["home", "/"], ["product", pdpPath]].filter(([, p]) => p);

    // W1: a visitor must be able to leave any page they land on.
    for (const [label, path] of walkPages) {
      const pg = await get(path);
      const links = [...(pg.body.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi))].map((m) => m[1]);
      const internal = links.filter((h) => h.startsWith("/") || h.includes(base));
      if (internal.length < 3) {
        add(`W1-${label}-is-a-dead-end`,
          `The ${label} page offers ${internal.length} internal link(s).`,
          "A page a visitor cannot leave is a dead end. A product page in particular needs the bag, the collection it belongs to, and a way home.");
      } else ok(`W1-${label}-is-a-dead-end`);
    }

    // W2: the bag must be reachable from every page, or adding to it is a trap.
    for (const [label, path] of walkPages) {
      const pg = await get(path);
      if (/href=["'][^"']*\/cart/i.test(pg.body)) ok(`W2-${label}-bag-reachable`);
      else add(`W2-${label}-bag-reachable`,
        `The ${label} page has no link to the bag.`,
        "A storefront that can add to a cart and never show it is a funnel with no exit. Put the bag in the header, on every page.");
    }

    // W3: the cart page itself must exist and offer a way to pay.
    const cartPage = await get("/cart");
    if (cartPage.status !== 200) {
      add("W3-cart-page", `/cart answered ${cartPage.status}.`,
        "The cart page is the second half of every add-to-cart. Without it the buyer has nowhere to go.");
    } else if (!/checkout/i.test(cartPage.body)) {
      add("W3-cart-page", "/cart serves but offers no route to checkout.",
        "Even an empty bag should say what to do next; a full one must link to the cart's own checkoutUrl.");
    } else ok("W3-cart-page");

    // W4: a header and a footer on every page. Absent from all of them once, which is how the
    // bag link, the collections nav and the contact route all went missing at the same time.
    for (const [label, path] of walkPages) {
      const pg = await get(path);
      const hasChrome = /<header[\s>]|<nav[\s>]/i.test(pg.body) && /<footer[\s>]/i.test(pg.body);
      if (hasChrome) ok(`W4-${label}-chrome`);
      else add(`W4-${label}-chrome`,
        `The ${label} page has no header/nav and footer.`,
        "Site chrome is where navigation, the bag and the legal footer live. A page without it reads as unfinished and strands the visitor.");
    }

    // R9: UNRESOLVED SCAFFOLD TOKENS ON A SERVED PAGE.
    //
    // THIS CHECK EXISTS BECAUSE THE GATE REPORTED 42 CHECKS CLEAN ON A HOME PAGE THAT RENDERED
    // "{{HEADING}}" IN 60px TYPE. Every other check passed: the catalogue was surveyed, the
    // product routes were static, the cart cookie was correct, the price island failed closed.
    // None of them looks at the one thing a visitor sees first. gate-shipready catches tokens in
    // SOURCE, but nothing was reading the SERVED page, and a storefront can be perfectly
    // constructed and still be obviously unfinished.
    const HOME_AND_PDP = ["/", pdpPath].filter(Boolean);
    const tokenHits = [];
    for (const path of HOME_AND_PDP) {
      const pg = await get(path);
      const toks = [...new Set((pg.body.match(/\{\{[A-Z0-9_]{2,}\}\}/g) ?? []))];
      if (toks.length) tokenHits.push(`${path}: ${toks.slice(0, 5).join(" ")}`);
    }
    if (tokenHits.length) {
      add("R9-unresolved-tokens",
        `Scaffold placeholders are being SERVED to visitors: ${tokenHits.join("; ")}.`,
        "A page rendering {{HEADING}} is not a storefront, whatever else passes. Resolve every scaffold token before this reaches anyone. This is the first thing a visitor sees and the last thing a check suite notices.");
    } else ok("R9-unresolved-tokens");

    // R8: THE CHECKOUT HANDOFF MUST BE SHOPIFY'S. No plan buys a self-hosted checkout; it is a
    // terms-of-service boundary requiring written authorisation, including on Plus. This resolves
    // the cart that was just created and reads where it actually sends the buyer.
    const cartId = cartCookie ? decodeURIComponent((cartCookie.split(";")[0] || "").split("=").slice(1).join("=")) : null;
    if (!cartId || !/^gid:\/\/shopify\/Cart\//.test(cartId)) {
      unknown("R8-checkout-handoff", "no cart id was available to resolve a checkout URL");
    } else {
      const domain = cat.store?.replace(/^https?:\/\//, "");
      const ver = cat.apiVersion ?? "2026-07";
      let url = null;
      try {
        const q = { query: "query($id:ID!){ cart(id:$id){ checkoutUrl totalQuantity } }", variables: { id: cartId } };
        const r = await fetch(`https://${domain}/api/${ver}/graphql.json`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(process.env.SHOPIFY_STOREFRONT_TOKEN ? { "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_STOREFRONT_TOKEN } : {}) },
          body: JSON.stringify(q), signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        url = j?.data?.cart?.checkoutUrl ?? null;
      } catch { /* reported below */ }
      // Name the commonest cause. An unknown that does not say WHY sends the next person
      // hunting the storefront for a fault that is in their shell.
      if (!url) unknown("R8-checkout-handoff",
        process.env.SHOPIFY_STOREFRONT_TOKEN
          ? "the cart could not be resolved to a checkout URL"
          : "no SHOPIFY_STOREFRONT_TOKEN in the environment, so the cart could not be read back (this is a harness gap, not a storefront fault)");
      else if (!/(^https:\/\/[^/]*\.myshopify\.com\/|shopify\.com\/)/.test(url)) {
        add("R8-checkout-handoff", `The cart's checkoutUrl is not Shopify-hosted: ${url.slice(0, 80)}`,
          "The API Terms forbid an alternative to Shopify Checkout for checkout or payment processing, and no plan lifts that, including Plus. Hand off via the cart's own checkoutUrl.");
      } else ok("R8-checkout-handoff");
    }

    // R5: the agent surface headless deletes, served rather than merely present in src.
    for (const [id, path] of [["R5-agents-md", "/agents.md"], ["R6-llms-txt", "/llms.txt"]]) {
      const r = await get(path);
      if (r.status === 200 && r.body.trim().length > 20) ok(id);
      else add(id, `${path} answered ${r.status || "nothing"}.`,
        "Shopify writes this for every Liquid merchant and going headless deletes it. If it is not served here, an agent has no plain-language instructions for buying from this store.");
    }

    // R7: no self-hosted checkout. The handoff must be Shopify's.
    const sitemapish = await get("/sitemap-index.xml");
    if (sitemapish.status === 200) ok("R7-sitemap-served");
    else unknown("R7-sitemap-served", `no sitemap served (${sitemapish.status})`);
  }
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
