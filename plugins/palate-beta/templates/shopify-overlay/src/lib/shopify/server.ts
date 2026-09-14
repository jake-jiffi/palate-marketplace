import { getSecret } from 'astro:env/server';
import { createClient } from 'redis';
import { isIP } from 'node:net';
import { SessionStore } from './session.mjs';
import { Storefront } from './storefront.mjs';
import { Commerce } from './commerce.mjs';

export const COOKIE = 'palate_shop_sid';
export const privatePage = (astro: any) => { astro.response.headers.set('Cache-Control', 'private, no-store'); astro.response.headers.set('Vary', 'Cookie'); astro.response.headers.set('Referrer-Policy', 'same-origin'); };
let connection: Promise<any> | undefined;
export async function services() {
  const domain = getSecret('SHOPIFY_STORE_DOMAIN');
  const token = getSecret('SHOPIFY_STOREFRONT_TOKEN');
  const country = getSecret('SHOPIFY_COUNTRY') || 'AU';
  const url = getSecret('SHOPIFY_REDIS_URL');
  if (!url) throw new Error('Commerce session storage is not configured');
  const target = new URL(url);
  if (!['redis:', 'rediss:'].includes(target.protocol) || (target.protocol !== 'rediss:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) throw new Error('Remote Redis requires TLS');
  if (!connection) connection = (async () => {
    const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false }, disableOfflineQueue: true });
    client.on('error', () => { connection = undefined; }); // Never log a credential-bearing URL.
    await client.connect(); return client;
  })().catch(error => { connection = undefined; throw error; });
  const store = new SessionStore(await connection, { namespace: getSecret('SHOPIFY_REDIS_NAMESPACE') || 'palate-commerce' });
  const api = new Storefront({ domain, token, country });
  const checkoutHosts = (getSecret('SHOPIFY_CHECKOUT_HOSTS') || '').split(',').map(s => s.trim()).filter(Boolean);
  return { store, api, commerce: new Commerce(store, api, { checkoutHosts }) };
}
export function buyerIp(context: any) {
  // Use the adapter's trusted client address, never an arbitrary forwarded header.
  try { const ip = context.clientAddress; return isIP(ip) ? ip : undefined; } catch { return undefined; }
}
export const safeReturn = (value: unknown) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/cart';
export function setSession(context: any, sid: string) {
  context.cookies.set(COOKIE, sid, { httpOnly: true, secure: context.url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 604800 });
}
export async function shopping(context: any) {
  privatePage(context);
  const service = await services();
  const sid = context.cookies.get(COOKIE)?.value;
  const state = await service.store.read(sid);
  return { ...service, sid, state, ip: buyerIp(context) };
}
export async function postBody(context: any) {
  const request: Request = context.request;
  if (request.headers.get('origin') !== context.url.origin) throw new Error('origin');
  const contentType = request.headers.get('content-type')?.split(';')[0];
  if (!['application/x-www-form-urlencoded', 'application/json'].includes(contentType || '')) throw new Error('content-type');
  // Bound bytes while reading; Content-Length alone is controlled by the caller.
  const reader = request.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16384) { await reader.cancel(); throw new Error('body-size'); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const text = new TextDecoder().decode(bytes);
  if (contentType === 'application/json') { const parsed = JSON.parse(text); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('body'); return parsed; }
  const params = new URLSearchParams(text); const body: Record<string, string> = {};
  for (const [key, value] of params) { if (Object.hasOwn(body, key)) throw new Error('duplicate-field'); body[key] = value; }
  return body;
}
export function listingParams(url: URL, collection = false) {
  const cursor = url.searchParams.get('after');
  if (cursor && cursor.length > 2048) throw new Error('Invalid page cursor');
  const sortInput = url.searchParams.get('sort') || (collection ? 'featured' : 'relevance');
  const sorts: Record<string, [string, boolean]> = collection ? { featured: ['COLLECTION_DEFAULT', false], 'price-asc': ['PRICE', false], 'price-desc': ['PRICE', true], newest: ['CREATED', true], title: ['TITLE', false] } : { relevance: ['RELEVANCE', false], 'price-asc': ['PRICE', false], 'price-desc': ['PRICE', true] };
  if (!sorts[sortInput]) throw new Error('Invalid sort');
  const filters = url.searchParams.getAll('filter').map(raw => {
    if (raw.length > 1500) throw new Error('Invalid filter');
    const value = JSON.parse(raw); const keys = Object.keys(value);
    // Inputs are copied verbatim from Storefront's returned filter values. Reject unknown shapes.
    if (keys.length !== 1 || !['available', 'price', 'productType', 'productVendor', 'tag', 'variantOption', 'productMetafield', 'variantMetafield', 'taxonomyMetafield'].includes(keys[0])) throw new Error('Invalid filter');
    return value;
  });
  if (filters.length > 20) throw new Error('Too many filters');
  return { cursor, sort: sorts[sortInput][0], reverse: sorts[sortInput][1], filters };
}
