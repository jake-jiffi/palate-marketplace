// Run against an isolated local generated app configured for an authenticated development shop.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
if (!process.argv.includes('--allow-development-cart-mutations')) throw new Error('Explicit development cart mutation flag required');
const env = {}; for (const line of (await fs.readFile(process.env.SHOPIFY_TEST_ENV_FILE, 'utf8')).split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const admin = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN }, body: JSON.stringify({ query: '{shop{plan{partnerDevelopment}}}' }) });
assert.equal((await admin.json()).data?.shop?.plan?.partnerDevelopment, true);
const origin = process.env.PALATE_TEST_COMMERCE_ORIGIN || 'http://127.0.0.1:4397'; assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
let cookie = '';
async function request(path, options = {}) { const r = await fetch(origin + path, { redirect: 'manual', ...options, headers: { Cookie: cookie, ...options.headers } }); if (r.status !== 403) assert.match(r.headers.get('cache-control') || '', /no-store/); return r; }
const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
const token = (html, kind) => { const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].find(m => m[0].includes(`data-kind="${kind}"`)); assert.ok(form, `Expected ${kind} form`); return form[0].match(/name="token"\s+value="([a-f0-9]+)"/)?.[1]; };
const productPath = '/products/gift-card?variant=44819749273773';
let r = await request(productPath); let html = await r.text(); assert.equal(r.status, 200); assert.match(html, /Start shopping/); assert.doesNotMatch(html, /data-kind="add"/);
r = await post('/api/shopify/session', { returnTo: productPath }); assert.equal(r.status, 303); const sessionCookie = r.headers.getSetCookie().find(c => c.startsWith('palate_shop_sid=')); assert.match(sessionCookie, /HttpOnly/i); assert.match(sessionCookie, /SameSite=Lax/i); cookie = sessionCookie.split(';')[0];
r = await request(productPath); html = await r.text(); assert.match(html, /\$25\.00/); const first = token(html, 'add');
r = await post('/api/shopify/cart', { token: first, quantity: '1' }); assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null); assert.match(await r.text(), /Your cart is updated/);
r = await request(productPath); const second = token(await r.text(), 'add'); assert.notEqual(first, second);
r = await post('/api/shopify/cart', { token: second, quantity: '1' }); assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null);
r = await request('/cart'); html = await r.text(); assert.match(html, /value="2"/); assert.match(html, /\$50\.00/); assert.doesNotMatch(html, /gid:\/\/shopify\/Cart\//);
r = await post('/api/shopify/cart', { token: second, quantity: '2' }); assert.equal(r.status, 409);
r = await post('/api/shopify/cart', { token: second, quantity: '1' }, { Origin: 'https://untrusted.invalid' }); assert.equal(r.status, 403);
const retainedCookie = cookie; cookie = ''; r = await post('/api/shopify/cart', { token: second, quantity: '1' }); assert.equal(r.status, 409); assert.match(await r.text(), /Continue with this tab/); cookie = retainedCookie;
r = await request('/cart'); html = await r.text(); const checkout = token(html, 'checkout'); r = await post('/api/shopify/cart', { token: checkout }); assert.equal(r.status, 303); assert.equal(new URL(r.headers.get('location')).hostname, env.SHOPIFY_STORE_DOMAIN); assert.equal(r.headers.get('set-cookie'), null);
r = await request('/products/filter-papers-sample?variant=47389098049709'); assert.match(await r.text(), /\$0\.00/);
r = await request('/products/the-out-of-stock-snowboard'); html = await r.text(); assert.match(html, /sold out/); assert.doesNotMatch(html, /data-kind="add"/);
r = await request('/products/gift-card?variant=not-a-variant'); html = await r.text(); assert.match(html, /exact option combination does not exist/); assert.doesNotMatch(html, /data-kind="add"/);
console.log(JSON.stringify({ noJavaScript: true, sessionRoundTrip: true, opaqueCookie: true, deliberateSecondAdd: true, reloadQuantity: 2, subtotal: '50.00 AUD', mutationDoesNotSetCookie: true, crossTabConflict: true, changedPayloadRejected: true, originRejected: true, checkout303: true, zero: true, soldOut: true, invalidVariant: true, paymentAttempted: false }));
