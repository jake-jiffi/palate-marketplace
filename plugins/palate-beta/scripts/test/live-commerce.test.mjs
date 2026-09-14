import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installShopifyOverlay } from '../install-shopify-overlay.mjs';
import { sourceFiles } from '../live/project.mjs';
import { SessionStore } from '../../templates/shopify-overlay/src/lib/shopify/session.mjs';
import { Commerce, variantQuote, cartQuote, checkoutLocation } from '../../templates/shopify-overlay/src/lib/shopify/commerce.mjs';
import { Storefront, money } from '../../templates/shopify-overlay/src/lib/shopify/storefront.mjs';

const clientModule = process.env.PALATE_TEST_REDIS_MODULE || 'redis';
const { createClient } = await import(clientModule.startsWith('/') ? pathToFileURL(clientModule).href : clientModule);
const redis = createClient({ url: process.env.PALATE_TEST_REDIS_URL || 'redis://127.0.0.1:16379', socket: { reconnectStrategy: false } });
redis.on('error', () => {}); await redis.connect();
const prefix = `palate-test:${randomUUID()}`;
after(async () => { for await (const keys of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) if (keys.length) await redis.del(keys); await redis.close(); });
const price = { amount: '25.0', currencyCode: 'AUD' };
const variant = { id: 'gid://shopify/ProductVariant/1', title: 'Exact option', availableForSale: true, price, product: { title: 'Test product', handle: 'test', requiresSellingPlan: false } };
function fixture() {
  let cart = null, count = 0;
  const api = { country: 'AU', domain: 'test.myshopify.com', variant: async () => structuredClone(variant), cart: async () => structuredClone(cart),
    mutate: async (kind, id, p) => {
      count++;
      const lines = kind === 'create' ? p.lines.map((l, i) => ({ id: `gid://shopify/CartLine/${i}`, quantity: l.quantity, merchandise: structuredClone(variant), cost: { totalAmount: { ...price, amount: String(l.quantity * 25) } } })) : structuredClone(cart.lines.nodes);
      if (kind === 'add') lines[0].quantity += p.lines[0].quantity;
      if (kind === 'update') lines.find(l => l.id === p.lines[0].id).quantity = p.lines[0].quantity;
      if (kind === 'remove') lines.splice(lines.findIndex(l => l.id === p.ids[0]), 1);
      const total = lines.reduce((sum, l) => sum + l.quantity * Number(l.merchandise.price.amount), 0);
      cart = { id: `gid://shopify/Cart/private-${count}?key=never-render`, checkoutUrl: 'https://test.myshopify.com/checkouts/test', buyerIdentity: { countryCode: 'AU' }, totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0), lines: { nodes: lines }, discountCodes: (p.codes || cart?.discountCodes?.map(d => d.code) || []).map(code => ({ code, applicable: code !== 'BAD' })), cost: { subtotalAmount: { ...price, amount: String(total) }, totalAmount: { ...price, amount: String(total) } } };
      return { cart: structuredClone(cart), userErrors: [], warnings: [] };
    }, get count() { return count; }, setCart(value) { cart = value; } };
  return api;
}
async function setup() {
  let now = 100000;
  const store = new SessionStore(redis, { namespace: `${prefix}:${randomUUID().slice(0, 8)}`, now: () => now, leaseMs: 100 });
  const api = fixture(); const service = new Commerce(store, api); const session = await store.create('AU', 'AUD');
  const form = async (kind, quote) => store.form(session.sid, await store.read(session.sid), kind, quote);
  const add = async () => { const f = await form('add', variantQuote(variant, 'AU')); return service.execute(session.sid, f.token, { quantity: '1' }); };
  return { store, api, service, session, form, add, advance: () => { now += 101; } };
}
test('known receipt replay is exact; changed payload and stale forms cannot mutate', async () => {
  const t = await setup(); const f = await t.form('add', variantQuote(variant, 'AU')); const stale = await t.form('add', variantQuote(variant, 'AU'));
  const a = await t.service.execute(t.session.sid, f.token, { quantity: '1' }); assert.equal(a.status, 200);
  assert.deepEqual(await t.service.execute(t.session.sid, f.token, { quantity: '1' }), a);
  assert.equal((await t.service.execute(t.session.sid, f.token, { quantity: '2' })).code, 'payload-conflict');
  assert.equal((await t.service.execute(t.session.sid, stale.token, { quantity: '1' })).code, 'stale'); assert.equal(t.api.count, 1);
  const state = await t.store.read(t.session.sid); assert.ok(state.cartId.includes('never-render')); assert.ok(!JSON.stringify(state.summary).includes('never-render'));
});
test('lost mutation response remains unknown and never permits checkout or automatic replay', async () => {
  const t = await setup(); await t.add(); const original = t.api.mutate;
  t.api.mutate = async (...args) => { await original(...args); throw new Error('lost response after apply'); };
  const f = await t.form('add', variantQuote(variant, 'AU')); assert.equal((await t.service.execute(t.session.sid, f.token, { quantity: '1' })).code, 'unknown');
  t.advance(); assert.equal((await t.service.execute(t.session.sid, f.token, { quantity: '1' })).code, 'unknown');
  const handoff = await t.form('checkout', cartQuote(await t.api.cart())); assert.equal((await t.service.execute(t.session.sid, handoff.token)).code, 'unknown'); assert.equal(t.api.count, 2);
});
test('explicit recovery retires an active old worker and late completion cannot replace it', async () => {
  const t = await setup(); await t.add(); const original = t.api.mutate; let release;
  const barrier = new Promise(resolve => { release = resolve; }); let entered; const ready = new Promise(resolve => { entered = resolve; });
  t.api.mutate = async (...args) => { const result = await original(...args); entered(); await barrier; return result; };
  const f = await t.form('add', variantQuote(variant, 'AU')); const old = t.service.execute(t.session.sid, f.token, { quantity: '1' }); await ready;
  const before = await t.store.read(t.session.sid); const staleCheckout = await t.form('checkout', cartQuote(await t.api.cart()));
  const quote = await t.service.recoveryQuote(before); const recover = await t.form('recover', quote);
  t.api.mutate = original; assert.equal((await t.service.execute(t.session.sid, recover.token, { confirm: 'yes' })).status, 200);
  release(); assert.equal((await old).code, 'owner-conflict');
  const after = await t.store.read(t.session.sid); assert.equal(after.generation, before.generation + 1); assert.equal(after.retired.length, 1); assert.equal(after.needsAcknowledgement, true);
  assert.equal((await t.service.execute(t.session.sid, staleCheckout.token)).code, 'stale');
});
test('expired old checkout fetch cannot complete under a new mutation owner at the same revision', async () => {
  const t = await setup(); await t.add(); const checkout = await t.form('checkout', {}); const mutation = await t.form('add', variantQuote(variant, 'AU'));
  const old = await t.store.claim(t.session.sid, checkout, { test: 'old read' }); assert.equal(old.code, 'claimed'); t.advance();
  const next = await t.store.claim(t.session.sid, mutation, { test: 'new write' }); assert.equal(next.code, 'claimed');
  assert.equal(old.generation, next.generation); assert.equal(old.revision, next.revision); assert.notEqual(old.owner, next.owner);
  assert.equal((await t.store.complete(t.session.sid, checkout, old, { receipt: { status: 303, location: 'https://test.myshopify.com/checkouts/test' } })).code, 'owner-conflict');
  assert.equal((await t.store.read(t.session.sid)).pending.owner, next.owner);
});
test('interrupted checkout read can be reclaimed; overlapping checkout prevents recovery', async () => {
  const t = await setup(); await t.add(); const f = await t.form('checkout', {});
  const first = await t.store.claim(t.session.sid, f, {}); const recover = await t.form('recover', {});
  assert.equal((await t.store.claim(t.session.sid, recover, {})).code, 'pending');
  t.advance(); const second = await t.store.claim(t.session.sid, f, {}); assert.equal(second.code, 'claimed'); assert.notEqual(second.owner, first.owner);
  assert.equal((await t.store.complete(t.session.sid, f, first, { receipt: { status: 303 } })).code, 'owner-conflict');
});
test('invalid quantities, different tab SID, unavailable variants and changed prices fail before a write', async () => {
  const t = await setup(); const f = await t.form('add', variantQuote(variant, 'AU'));
  for (const value of ['0', '-1', '1.5', '100', 'Infinity']) assert.equal((await t.service.execute(t.session.sid, f.token, { quantity: value })).status, 422);
  const other = await t.store.create('AU', 'AUD'); assert.equal((await t.service.execute(other.sid, f.token, { quantity: '1' })).code, 'context-conflict');
  t.api.variant = async () => ({ ...variant, availableForSale: false }); assert.equal((await t.service.execute(t.session.sid, f.token, { quantity: '1' })).code, 'unavailable');
  const fresh = await t.form('add', variantQuote(variant, 'AU')); t.api.variant = async () => ({ ...variant, price: { ...price, amount: '26' } }); assert.equal((await t.service.execute(t.session.sid, fresh.token, { quantity: '1' })).code, 'price-changed'); assert.equal(t.api.count, 0);
});
test('rejected discounts are visible, survive recovery and require acknowledgement before checkout', async () => {
  const t = await setup(); await t.add(); const d = await t.form('discount');
  const result = await t.service.execute(t.session.sid, d.token, { codes: 'BAD' }); assert.equal(result.status, 409); assert.match(result.message, /not applied/);
  const q = await t.service.recoveryQuote(await t.store.read(t.session.sid)); assert.equal(q.country, 'AU'); assert.equal(q.codes[0].code, 'BAD');
  const recover = await t.form('recover', q); await t.service.execute(t.session.sid, recover.token, { confirm: 'yes' });
  const checkout = await t.form('checkout', cartQuote(await t.api.cart())); assert.equal((await t.service.execute(t.session.sid, checkout.token)).code, 'confirmation-required');
  const ack = await t.form('ack', cartQuote(await t.api.cart())); assert.equal((await t.service.execute(t.session.sid, ack.token, { confirm: 'yes' })).status, 200);
  const final = await t.form('checkout', cartQuote(await t.api.cart())); const handoff = await t.service.execute(t.session.sid, final.token); assert.equal(handoff.status, 303);
  assert.equal((await t.service.execute(t.session.sid, final.token)).status, 303); t.advance(); // below receipt TTL, still valid
  const newer = await t.form('add', variantQuote(variant, 'AU')); await t.service.execute(t.session.sid, newer.token, { quantity: '1' }); assert.equal((await t.service.execute(t.session.sid, final.token)).code, 'stale');
});
test('changed checkout totals demand reconfirmation; checkout address validation is exact', async () => {
  const t = await setup(); await t.add(); const f = await t.form('checkout', cartQuote(await t.api.cart()));
  const cart = await t.api.cart(); cart.cost.totalAmount.amount = '26'; t.api.setCart(cart);
  assert.equal((await t.service.execute(t.session.sid, f.token)).code, 'cart-changed');
  for (const url of ['http://test.myshopify.com/checkouts/x', 'https://test.myshopify.com.evil.test/checkouts/x', 'https://user@test.myshopify.com/checkouts/x', 'https://test.myshopify.com:999/checkouts/x', 'https://test.myshopify.com/products/x']) assert.equal(checkoutLocation(url, t.api.domain), null);
  assert.match(money({ amount: '0.0', currencyCode: 'AUD' }), /0\.00/);
  assert.equal(checkoutLocation('https://test.myshopify.com/cart/c/fixture?key=fixture', t.api.domain), 'https://test.myshopify.com/cart/c/fixture?key=fixture');
});
test('two independent worker processes cannot both claim one session; crashed intent survives reconnect', async () => {
  const t = await setup(); const f = await t.form('add', variantQuote(variant, 'AU'));
  const moduleURL = new URL('../../templates/shopify-overlay/src/lib/shopify/session.mjs', import.meta.url).href;
  const worker = `import {createClient} from ${JSON.stringify(clientModule.startsWith('/') ? pathToFileURL(clientModule).href : clientModule)}; import {SessionStore} from ${JSON.stringify(moduleURL)}; const c=createClient({url:process.env.PALATE_TEST_REDIS_URL||'redis://127.0.0.1:16379'}); c.on('error',()=>{}); await c.connect(); const s=new SessionStore(c,{namespace:process.env.TEST_PREFIX,now:()=>100000,leaseMs:100}); const r=await s.claim(process.env.TEST_SID,JSON.parse(process.env.TEST_FORM),{quantity:1}); process.stdout.write(r.code); await c.close();`;
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { env: { ...process.env, TEST_PREFIX: t.store.prefix, TEST_SID: t.session.sid, TEST_FORM: JSON.stringify(f) }, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', c => { output += c; }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(new Error('worker failed'))); });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ['claimed', 'pending']);
  t.advance(); const independent = new SessionStore(redis, { namespace: t.store.prefix, now: () => 100101, leaseMs: 100 });
  assert.equal((await independent.claim(t.session.sid, f, { quantity: 1 })).code, 'unknown');
});
test('Storefront rejects transport, GraphQL and API drift and preserves exact zero variants', async () => {
  for (const response of [new Response('{}', { status: 429 }), Response.json({ errors: [{ message: 'no' }] }), Response.json({ data: {} }, { headers: { 'x-shopify-api-version': '2026-10' } })]) {
    const api = new Storefront({ domain: 'test.myshopify.com', token: 'fixture', fetcher: async () => response }); await assert.rejects(api.query('{shop{name}}'));
  }
  const api = new Storefront({ domain: 'test.myshopify.com', token: 'fixture', fetcher: async (_url, init) => {
    const request = JSON.parse(init.body); return Response.json({ data: request.query.includes('node(id:') ? { node: { ...variant, product: { handle: 'another-product' }, price: { ...price, amount: '0' } } } : { product: { ...variant.product, options: [{name:'Colour',values:['Red']}], selectedOrFirstAvailableVariant: variant, variantBySelectedOptions: null } } });
  } });
  assert.equal((await api.product('test', { variantId: '1' })).selectedVariant, null);
  assert.equal((await api.product('test', { options: [{ name: 'Colour', value: 'Missing' }] })).selectedVariant, null);
});
test('a prior checkout receipt cannot bypass a newly pending or unknown mutation', async () => {
  const t = await setup(); await t.add(); const f = await t.form('checkout', cartQuote(await t.api.cart()));
  assert.equal((await t.service.execute(t.session.sid, f.token)).status, 303);
  const add = await t.form('add', variantQuote(variant, 'AU')); const claim = await t.store.claim(t.session.sid, add, { quantity: 1 });
  assert.equal((await t.service.execute(t.session.sid, f.token)).code, 'pending');
  await t.store.unknown(t.session.sid, add, claim);
  assert.equal((await t.service.execute(t.session.sid, f.token)).code, 'unknown');
});
test('malformed cart totals, prices and quantities never produce a checkout redirect', async () => {
  for (const corrupt of [c => { c.cost.totalAmount.amount = 'not-a-price'; }, c => { c.cost.totalAmount.amount = '-1'; }, c => { c.lines.nodes[0].merchandise.price.amount = 'Infinity'; }, c => { c.lines.nodes[0].quantity = 1.5; }]) {
    const t = await setup(); await t.add(); const cart = await t.api.cart(); corrupt(cart); t.api.setCart(cart);
    const f = await t.form('checkout', cartQuote(cart)); assert.equal((await t.service.execute(t.session.sid, f.token)).code, 'invalid-cart');
  }
});
test('post-dispatch receipt persistence failure enters unknown handling', async () => {
  const t = await setup(); const original = t.store.complete.bind(t.store); let fail = true;
  t.store.complete = (...args) => { if (fail) { fail = false; return Promise.reject(new Error('Redis response lost')); } return original(...args); };
  const f = await t.form('add', variantQuote(variant, 'AU')); const result = await t.service.execute(t.session.sid, f.token, { quantity: '1' });
  assert.equal(result.code, 'unknown'); assert.equal((await t.store.read(t.session.sid)).pending.unknown, true); assert.equal(t.api.count, 1);
});
test('uncertain discounts survive recovery; explicit empty selection escapes unavailable-item dead end', async () => {
  const t = await setup(); await t.add(); t.api.mutate = async () => { throw new Error('did not receive discount response'); };
  const discount = await t.form('discount'); assert.equal((await t.service.execute(t.session.sid, discount.token, { codes: 'SAVE10' })).code, 'unknown');
  t.api.variant = async () => ({ ...variant, availableForSale: false });
  const q = await t.service.recoveryQuote(await t.store.read(t.session.sid)); assert.equal(q.codes[0].code, 'SAVE10'); assert.equal(q.lines[0].available, false);
  const fresh = fixture(); t.api.mutate = fresh.mutate;
  const recover = await t.form('recover', q); const result = await t.service.execute(t.session.sid, recover.token, { recovery: 'selection', confirm: 'yes' });
  assert.equal(result.status, 200); const state = await t.store.read(t.session.sid); assert.equal(state.summary.totalQuantity, 0); assert.equal(state.generation, 1); assert.equal(state.discountCodes[0], 'SAVE10');
});
test('concurrent overlay installers have one owner; unknown/corrupt state stays unchanged', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'palate-commerce-install-')));
  try {
    await fs.mkdir(path.join(directory, 'src/layouts'), { recursive: true });
    await fs.writeFile(path.join(directory, 'src/layouts/BaseLayout.astro'), '<slot />');
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '7.3.2' } }));
    await fs.writeFile(path.join(directory, 'astro.config.mjs'), "export default { integrations: [] };\n");
    const marker = path.join(directory, 'palate.project.json');
    for (const content of ['{broken', JSON.stringify({ schema: 999, workflow: 'live-design' })]) {
      await fs.writeFile(marker, content); const before = await fs.readdir(directory);
      await assert.rejects(installShopifyOverlay(directory, { confirmShopify: true })); assert.deepEqual(await fs.readdir(directory), before); assert.equal(await fs.readFile(marker, 'utf8'), content);
      const child = path.join(directory, 'nested'); await fs.mkdir(child, { recursive: true });
      await assert.rejects(installShopifyOverlay(child, { confirmShopify: true }), /nested inside/); assert.deepEqual(await fs.readdir(child), []);
    }
    await fs.unlink(marker);
    const results = await Promise.allSettled([installShopifyOverlay(directory, { confirmShopify: true }), installShopifyOverlay(directory, { confirmShopify: true })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); assert.equal(pkg.dependencies.redis, '6.2.1'); assert.equal(pkg.dependencies['@astrojs/vercel'], '11.0.10');
    assert.match(await fs.readFile(path.join(directory, 'astro.config.mjs'), 'utf8'), /adapter: shopifyRuntime\(\)/);
    assert.ok(sourceFiles(directory).includes('scripts/shopify-runtime.mjs'));
    await assert.rejects(fs.access(path.join(directory, '.palate-shopify-install.lock')));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('a newer failed checkout fences an older otherwise valid checkout receipt', async () => {
  const t = await setup(); await t.add(); const old = await t.form('checkout', cartQuote(await t.api.cart())); assert.equal((await t.service.execute(t.session.sid, old.token)).status, 303);
  const cart = await t.api.cart(); cart.cost.totalAmount.amount = 'malformed'; t.api.setCart(cart);
  const newer = await t.form('checkout', cartQuote(cart)); assert.equal((await t.service.execute(t.session.sid, newer.token)).code, 'invalid-cart');
  assert.equal((await t.service.execute(t.session.sid, old.token)).code, 'confirmation-required');
});
test('cart line pagination is complete and every mutation emits balanced GraphQL selections', async () => {
  let reads = 0; const seen = [];
  const api = new Storefront({ domain: 'test.myshopify.com', token: 'fixture', fetcher: async (_url, init) => {
    const { query, variables } = JSON.parse(init.body); let depth = 0;
    for (const character of query) { if (character === '{') depth++; if (character === '}') depth--; assert.ok(depth >= 0); } assert.equal(depth, 0, 'GraphQL selection must close every fragment');
    seen.push(variables);
    if (query.startsWith('query')) { reads++; return Response.json({ data: { cart: { id: 'fixture-capability', lines: { nodes: [{ id: `line-${reads}` }], pageInfo: { hasNextPage: reads === 1, endCursor: `cursor-${reads}` } } } } }); }
    const field = query.match(/\{(cart\w+)\(/)[1]; return Response.json({ data: { [field]: { cart: null, userErrors: [{ message: 'fixture validation' }], warnings: [] } } });
  } });
  const cart = await api.cart('fixture-capability'); assert.equal(cart.lines.nodes.length, 2); assert.equal(seen[1].cursor, 'cursor-1');
  for (const kind of ['create', 'add', 'update', 'remove', 'discount']) await api.mutate(kind, 'fixture-capability', { lines: [], ids: [], codes: [] });
});
