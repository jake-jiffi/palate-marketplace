#!/usr/bin/env node
/**
 * palate-shopify.mjs - read a live Shopify store's real catalogue with NO credential at all.
 *
 * ========================= WHAT THIS IS FOR =========================
 *
 * Two jobs, and the second is the one that pays for the file twice over.
 *
 *   THE PITCH. At brief time a prospect is still on their Liquid storefront, and Shopify serves
 *   the full Storefront GraphQL API on that host TOKENLESS. So Explore variants can be built
 *   against the client's OWN products, prices and photography before anyone has been asked for a
 *   credential, an account, or five minutes in an admin screen.
 *
 *   THE ROUTE MODEL. Three gates false-fail a correct commerce site, and two of them break for
 *   the SAME reason: nothing in this repo could enumerate a catalogue, so `verify-rendered.mjs`
 *   navigated to the literal string `/products/[handle]`, got a 404 and exited 1, and
 *   `gate-seo.mjs` exited on unenumerable product routes. `.palate/catalogue.json` is that
 *   missing route model. The survey is not a nice-to-have for those gates, it is the input they
 *   were always missing.
 *
 * ===================== TOKENLESS, AND ITS HARD EDGES =====================
 *
 * Measured 2026-08-30, first-party, on allbirds.com, adanola.com, glossier.com, aligne.co and
 * peakdesign.com. `POST {store}/api/{version}/graphql.json` with NO auth header returns 200 and
 * `access-control-allow-origin: *`, including from a deliberately hostile Origin. Shopify
 * documents this as "tokenless" access alongside public and private, covering products,
 * collections, selling plans, search, pages, blogs, articles and cart read/write.
 *
 * FOUR EDGES, each of which has bitten someone already:
 *
 *   1. IT ONLY WORKS ON A HOST SHOPIFY ITSELF SERVES. maap.cc and mejuri.com are already headless
 *      and return their own 404 and 302 from /api/. So this works BEFORE a cutover and stops
 *      working on the apex the moment the domain points at Vercel. That is why this file refuses
 *      to be treated as a runtime data source: see PRODUCTION_WARNING below.
 *   2. DEV STORES ARE LOCKED. A dev store answers 400 "Online Store channel is locked", which is
 *      why our own jiffidev cannot exercise this path. Test against a live store.
 *   3. NO METAOBJECTS, NO EXACT INVENTORY. `metaobjects` and `quantityAvailable` both return
 *      ACCESS_DENIED without scopes. `availableForSale` and price DO work, so in-stock/sold-out
 *      and pricing render fine with no credential. Structured content is the first thing that
 *      forces a token.
 *   4. COMPLEXITY IS CAPPED AT 1,000 and there is no documented per-buyer allowance. The page
 *      size here adapts downward on a complexity or throttle error rather than failing the run.
 *
 * ============================ HONEST WHEN BLOCKED ============================
 *
 * The dangerous output of a survey is not an error, it is a small number: "3 products" reads
 * exactly like a small catalogue. So a locked channel, an already-headless apex and a
 * not-Shopify host are each reported as their own outcome with their own exit code, never as a
 * successful survey of a thin store.
 *
 *   exit 0  surveyed
 *   exit 2  not applicable (not a Shopify host)
 *   exit 3  blocked (channel locked, already headless, or password-walled)
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DEFAULT_VERSION = '2026-07';
const MAX_PRODUCTS = 250;
const PAGE_SIZES = [100, 50, 25, 10];   // adaptive: complexity cap is 1,000 and undocumented per-buyer
const TIMEOUT_MS = 25_000;

/**
 * Stamped into every file this writes, because the file OUTLIVES the knowledge of how it was made.
 * Someone will find catalogue.json in six months, see live prices in it, and wire it to a page.
 */
const TOKEN_NOTE =
  'Surveyed with a Storefront access token, so this is the production read path and it keeps ' +
  'working after a domain cutover. Still a BUILD-TIME artefact: read prices from the API at ' +
  'request time, never from this file.';

const PRODUCTION_WARNING =
  'BUILD-TIME ONLY. Read tokenless from a Shopify-served host. This stops working on the apex the ' +
  'moment the domain cuts over to another host, and it carries no per-buyer rate allowance. Never ' +
  'read this file at runtime and never ship it as a price source: query the Storefront API with a ' +
  'token instead.';

const norm = (u) => {
  const s = String(u || '').trim();
  if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).origin; } catch { return null; }
};

async function post(url, body, extraHeaders = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA, ...extraHeaders },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: an HTML 404 from a headless apex */ }
    return { status: res.status, json, text };
  } finally { clearTimeout(timer); }
}

const PRODUCT_FIELDS = `
      handle
      title
      description(truncateAt: 400)
      availableForSale
      productType
      tags
      featuredImage { url altText width height }
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount } }
      options { name values }`;

const query = (n, cursor) => `{
  shop { name primaryDomain { url } paymentSettings { currencyCode countryCode } }
  products(first: ${n}${cursor ? `, after: "${cursor}"` : ''}) {
    pageInfo { hasNextPage endCursor }
    nodes {${PRODUCT_FIELDS}
    }
  }
}`;

const COLLECTIONS_QUERY = `{ collections(first: 100) { nodes { handle title } } }`;

/** A complexity or throttle refusal, which we answer by asking for less rather than giving up. */
const isBackoff = (json, status) =>
  status === 429 ||
  JSON.stringify(json?.errors ?? '').match(/complexity|throttl|exceeded|too large/i) != null ||
  (json?.extensions?.cost && json?.errors);

/**
 * Is this host one Shopify serves, and does tokenless work on it?
 * Returns { ok, reason, endpoint, version } and never throws.
 */
export async function probe(origin, version = DEFAULT_VERSION, token = null) {
  const endpoint = `${origin}/api/${version}/graphql.json`;
  const auth = token ? { 'X-Shopify-Storefront-Access-Token': token } : {};
  let r;
  try {
    r = await post(endpoint, { query: '{ shop { name } }' }, auth);
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e?.name || e).slice(0, 80), endpoint, version };
  }
  if (r.json?.data?.shop?.name) return { ok: true, endpoint, version, shopName: r.json.data.shop.name };

  const body = (r.text || '').slice(0, 400);
  if (/Online Store channel is locked/i.test(body)) {
    return { ok: false, reason: 'channel-locked', endpoint, version,
      detail: 'The Online Store channel is locked. Dev stores and password-walled stores answer this way.' };
  }
  if (r.status === 404 || r.status === 302 || r.status === 301 || /<!DOCTYPE|<html/i.test(body)) {
    return { ok: false, reason: 'not-shopify-served', endpoint, version,
      detail: `This host answered ${r.status} with its own page, so it is either not Shopify or ALREADY headless.` };
  }
  return { ok: false, reason: 'refused', endpoint, version, detail: body.slice(0, 200) };
}

/** Pull the catalogue, adapting page size downward on a complexity or throttle refusal. */
async function fetchProducts(endpoint, auth = {}) {
  const out = [];
  let cursor = null, sizeIdx = 0, guard = 0;
  while (out.length < MAX_PRODUCTS && guard++ < 40) {
    const n = Math.min(PAGE_SIZES[sizeIdx], MAX_PRODUCTS - out.length);
    const r = await post(endpoint, { query: query(n, cursor) }, auth);
    if (isBackoff(r.json, r.status)) {
      if (sizeIdx < PAGE_SIZES.length - 1) { sizeIdx++; continue; }
      break;                                  // already at the smallest page: stop with what we have
    }
    const conn = r.json?.data?.products;
    if (!conn) break;
    out.push(...(conn.nodes ?? []));
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

/**
 * Survey a store. Returns the catalogue object; the caller decides whether to write it.
 * Never throws: a failed survey is a reported outcome, not an exception.
 */
export async function survey(input, { version = DEFAULT_VERSION, token = null } = {}) {
  const origin = norm(input);
  if (!origin) return { ok: false, reason: 'bad-url', detail: `Could not read a URL from ${JSON.stringify(input)}` };

  const p = await probe(origin, version, token);
  if (!p.ok) return { ok: false, ...p, store: origin };

  const auth = token ? { 'X-Shopify-Storefront-Access-Token': token } : {};
  const products = await fetchProducts(p.endpoint, auth);
  const cr = await post(p.endpoint, { query: COLLECTIONS_QUERY }, auth);
  const collections = cr.json?.data?.collections?.nodes ?? [];

  // The shop record comes from the same call as page one, so re-read it cheaply rather than
  // trusting the probe's minimal query.
  const sr = await post(p.endpoint, { query: '{ shop { name primaryDomain { url } paymentSettings { currencyCode countryCode } } }' }, auth);
  const shop = sr.json?.data?.shop ?? { name: p.shopName ?? null };

  const routes = [
    '/',
    ...collections.map((c) => `/collections/${c.handle}`),
    ...products.map((x) => `/products/${x.handle}`),
  ];

  return {
    ok: true,
    warning: token ? TOKEN_NOTE : PRODUCTION_WARNING,
    productionSafe: Boolean(token),
    surveyedAt: new Date().toISOString(),
    store: origin,
    source: token ? 'storefront-api-token' : 'tokenless-storefront-api',
    endpoint: p.endpoint,
    apiVersion: version,
    shop: {
      name: shop?.name ?? null,
      primaryDomain: shop?.primaryDomain?.url ?? null,
      currency: shop?.paymentSettings?.currencyCode ?? null,
      country: shop?.paymentSettings?.countryCode ?? null,
    },
    counts: { products: products.length, collections: collections.length, routes: routes.length },
    truncated: products.length >= MAX_PRODUCTS,
    routes,
    collections: collections.map((c) => ({ handle: c.handle, title: c.title })),
    products: products.map((x) => ({
      handle: x.handle,
      title: x.title,
      description: x.description ?? '',
      productType: x.productType ?? null,
      availableForSale: x.availableForSale === true,
      tags: x.tags ?? [],
      price: x.priceRange?.minVariantPrice?.amount ?? null,
      priceMax: x.priceRange?.maxVariantPrice?.amount ?? null,
      currency: x.priceRange?.minVariantPrice?.currencyCode ?? null,
      image: x.featuredImage
        ? { url: x.featuredImage.url, alt: x.featuredImage.altText ?? '',
            width: x.featuredImage.width ?? null, height: x.featuredImage.height ?? null }
        : null,
      options: (x.options ?? []).map((o) => ({ name: o.name, values: o.values })),
    })),
  };
}

export function write(result, outPath) {
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(result, null, 2) + '\n');
  return abs;
}

/** Routes a gate can navigate to. Empty array when there is no survey, which is the safe default. */
export function routesFrom(catalogue, { products = 3, collections = 2 } = {}) {
  if (!catalogue?.ok || !Array.isArray(catalogue.routes)) return [];
  const p = (catalogue.products ?? []).slice(0, products).map((x) => `/products/${x.handle}`);
  const c = (catalogue.collections ?? []).slice(0, collections).map((x) => `/collections/${x.handle}`);
  return ['/', ...c, ...p];
}

/**
 * RESOLVE A DYNAMIC PATH AGAINST A COMMERCE CATALOGUE, when there is one.
 *
 * `routesFromIndex` picks one representative per dynamic template, and for a content collection
 * the index has already substituted a real id. A COMMERCE route has no markdown behind it: the
 * handles live in Shopify, so `/products/[handle]` survived to here as a literal string, this
 * gate navigated to it, got a 404 and exited 1. That is one of the three gates that false-fail a
 * correct storefront, and it is not a scoring bug, it is a missing input.
 *
 * `.palate/catalogue.json` is that input (`scripts/palate-shopify.mjs`). ABSENT OR UNREADABLE, THIS
 * IS A NO-OP AND EVERY EXISTING BUILD BEHAVES EXACTLY AS BEFORE, which is the whole contract: a
 * brochure site has no catalogue and must never start being measured against product routes.
 *
 * Unresolved paths are LEFT ALONE rather than dropped. A 404 on a route this gate cannot resolve
 * is a real finding about the build, and silently removing it would be the gate narrowing its own
 * coverage, which this file already refuses to do for truncation.
 */
export function resolveDynamic(paths, cataloguePath) {
  let cat = null;
  try { cat = JSON.parse(readFileSync(cataloguePath, 'utf8')); } catch { return { paths, resolved: 0, had: false }; }
  if (!cat || cat.ok !== true || !Array.isArray(cat.routes) || !cat.routes.length) {
    return { paths, resolved: 0, had: false };
  }
  let resolved = 0;
  const out = paths.map((path) => {
    if (!path.includes('[')) return path;
    const prefix = path.slice(0, path.indexOf('['));
    const hit = cat.routes.find((r) => typeof r === 'string' && r.startsWith(prefix) && !r.includes('['));
    if (!hit) return path;
    resolved++;
    return hit;
  });
  return { paths: out, resolved, had: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('-'));
  const outIdx = args.indexOf('--out');
  const out = outIdx > -1 ? args[outIdx + 1] : '.palate/catalogue.json';
  const tIdx = args.indexOf('--token');
  const token = tIdx > -1 ? args[tIdx + 1] : (process.env.SHOPIFY_STOREFRONT_TOKEN ?? null);
  const vIdx = args.indexOf('--api-version');
  const version = vIdx > -1 ? args[vIdx + 1] : DEFAULT_VERSION;
  const quiet = args.includes('--quiet');

  if (!url) {
    console.error('usage: palate-shopify.mjs <store-url> [--out .palate/catalogue.json] [--token <storefront-token>] [--api-version 2026-07]');
    process.exit(64);
  }

  const r = await survey(url, { version, token });

  if (!r.ok) {
    const code = r.reason === 'not-shopify-served' ? 2 : 3;
    console.error(`[palate-shopify] ${r.reason}: ${r.detail ?? ''}`);
    if (r.reason === 'not-shopify-served') {
      console.error('  Either this is not a Shopify store, or it is ALREADY headless. Tokenless reads');
      console.error('  only work on a host Shopify itself serves. Try the myshopify.com host.');
    }
    if (r.reason === 'channel-locked') {
      console.error('  Dev stores answer this way. Survey a LIVE store, or unlock the Online Store channel.');
    }
    process.exit(code);
  }

  const abs = write(r, out);
  if (!quiet) {
    console.log(`[palate-shopify] ${r.shop.name ?? r.store}`);
    console.log(`  products ${r.counts.products}${r.truncated ? ` (capped at ${MAX_PRODUCTS})` : ''}   collections ${r.counts.collections}   routes ${r.counts.routes}`);
    console.log(`  currency ${r.shop.currency ?? '?'}   ${token ? 'via a Storefront token' : 'no credential was used'}`);
    console.log(`  -> ${abs}`);
    console.log(`  NOTE ${r.warning}`);
  }
  process.exit(0);
}
