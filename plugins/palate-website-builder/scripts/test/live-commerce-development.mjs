// Opt-in development-store compatibility probe. Never prints tokens, cart capabilities or checkout URLs.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Storefront } from '../../templates/shopify-overlay/src/lib/shopify/storefront.mjs';
import { SessionStore } from '../../templates/shopify-overlay/src/lib/shopify/session.mjs';
import { Commerce, variantQuote, cartQuote } from '../../templates/shopify-overlay/src/lib/shopify/commerce.mjs';

if (!process.argv.includes('--allow-development-cart-mutations')) throw new Error('This probe requires explicit development cart mutation authorisation.');
const file = process.env.SHOPIFY_TEST_ENV_FILE;
if (!file) throw new Error('Set SHOPIFY_TEST_ENV_FILE to a private file containing Storefront and Admin credentials.');
const env = {};
for (const line of (await fs.readFile(file, 'utf8')).split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
assert.match(env.SHOPIFY_STORE_DOMAIN, /^[a-z0-9-]+\.myshopify\.com$/);
const response = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN }, body: JSON.stringify({ query: '{shop{myshopifyDomain plan{partnerDevelopment}}}' }) });
const admin = await response.json(); assert.equal(response.status, 200); assert.equal(admin.data?.shop?.myshopifyDomain, env.SHOPIFY_STORE_DOMAIN); assert.equal(admin.data?.shop?.plan?.partnerDevelopment, true, 'Refusing cart writes without current development-store proof');
const api = new Storefront({ domain: env.SHOPIFY_STORE_DOMAIN, token: env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN || env.SHOPIFY_STOREFRONT_TOKEN, country: 'AU' });
const module = process.env.PALATE_TEST_REDIS_MODULE || 'redis'; const { createClient } = await import(module.startsWith('/') ? pathToFileURL(module).href : module);
const client = createClient({ url: process.env.PALATE_TEST_REDIS_URL || 'redis://127.0.0.1:16379' }); client.on('error', () => {}); await client.connect();
const namespace = `palate-live-test:${randomUUID()}`; const store = new SessionStore(client, { namespace });
const commerce = new Commerce(store, api); const { sid } = await store.create('AU', 'AUD');
const form = async (kind, quote) => store.form(sid, await store.read(sid), kind, quote);
try {
  const collection = await api.collection('coffee', { first: 2 }); assert.equal(collection.products.nodes.length, 2); assert.equal(collection.products.pageInfo.hasNextPage, true);
  const next = await api.collection('coffee', { first: 2, cursor: collection.products.pageInfo.endCursor }); assert.ok(next.products.nodes.length); assert.ok(next.products.nodes.every(p => !collection.products.nodes.some(prior => prior.id === p.id)));
  const search = await api.search('gift', { first: 2 }); assert.ok(search.nodes.some(p => p.handle === 'gift-card'));
  const gift = (await api.product('gift-card', { variantId: '44819749273773' })).selectedVariant; assert.equal(Number(gift.price.amount), 25); assert.equal(gift.price.currencyCode, 'AUD');
  const zero = (await api.product('filter-papers-sample', { variantId: '47389098049709' })).selectedVariant; assert.equal(Number(zero.price.amount), 0); assert.equal(zero.availableForSale, true);
  const soldOut = (await api.product('the-out-of-stock-snowboard')).selectedVariant; assert.equal(soldOut.availableForSale, false);
  let f = await form('add', variantQuote(soldOut, 'AU')); assert.equal((await commerce.execute(sid, f.token, { quantity: '1' })).code, 'unavailable');
  f = await form('add', variantQuote(gift, 'AU')); const add = await commerce.execute(sid, f.token, { quantity: '1' }); assert.equal(add.status, 200, `Gift add failed: ${add.code}`); assert.deepEqual(await commerce.execute(sid, f.token, { quantity: '1' }), add);
  let state = await store.read(sid); let cart = await api.cart(state.cartId); assert.equal(cart.totalQuantity, 1);
  f = await form('update', { lineId: cart.lines.nodes[0].id, price: gift.price }); assert.equal((await commerce.execute(sid, f.token, { quantity: '2' })).status, 200);
  f = await form('add', variantQuote(zero, 'AU')); assert.equal((await commerce.execute(sid, f.token, { quantity: '1' })).status, 200);
  state = await store.read(sid); cart = await api.cart(state.cartId); assert.equal(cart.totalQuantity, 3); assert.equal(Number(cart.cost.subtotalAmount.amount), 50);
  f = await form('remove', { lineId: cart.lines.nodes.find(l => l.merchandise.id === zero.id).id }); assert.equal((await commerce.execute(sid, f.token)).status, 200);
  f = await form('discount'); const discount = await commerce.execute(sid, f.token, { codes: 'PALATE-INVALID-TEST' }); assert.equal(discount.status, 409); assert.match(discount.message, /not applied/);
  f = await form('discount'); assert.equal((await commerce.execute(sid, f.token, { codes: '' })).status, 200);
  state = await store.read(sid); cart = await api.cart(state.cartId); assert.equal(cart.totalQuantity, 2); assert.equal(Number(cart.cost.subtotalAmount.amount), 50);
  f = await form('checkout', cartQuote(cart)); const checkout = await commerce.execute(sid, f.token); assert.equal(checkout.status, 303, `Checkout failed: ${checkout.code}`);
  const handoff = await fetch(checkout.location, { redirect: 'follow', signal: AbortSignal.timeout(15000) }); await handoff.arrayBuffer();
  console.log(JSON.stringify({ developmentStore: true, apiVersion: '2026-07', membershipPagination: true, exactVariant: true, unavailableBlocked: true, zeroPrice: true, addReplayUpdateRemoveDiscount: true, persistedQuantity: 2, subtotal: '50.00 AUD', checkoutRedirect: 303, checkoutPageStatus: handoff.status, checkoutHost: new URL(handoff.url).hostname, paymentAttempted: false }));
} finally {
  // Only test namespace keys are removed. Shopify guest carts expire naturally; no Admin writes.
  for await (const keys of client.scanIterator({ MATCH: `${namespace}:*`, COUNT: 100 })) if (keys.length) await client.del(keys);
  await client.close();
}
