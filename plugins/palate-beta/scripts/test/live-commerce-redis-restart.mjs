// Restart only the explicitly named disposable container after checking its task label.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { SessionStore } from '../../templates/shopify-overlay/src/lib/shopify/session.mjs';
const container = process.env.PALATE_TEST_REDIS_CONTAINER;
if (container !== 'palate-commerce-20260913') throw new Error('Set the exact authorised disposable Redis container name.');
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.Config.Labels['palate.task'], 'palate-7xv');
assert.ok(info.Mounts.some(m => m.Name === 'palate-commerce-20260913' && m.Destination === '/data'));
assert.ok(info.Config.Cmd.includes('--appendonly') && info.Config.Cmd.includes('always'));
const module = process.env.PALATE_TEST_REDIS_MODULE || 'redis'; const { createClient } = await import(module.startsWith('/') ? pathToFileURL(module).href : module);
const connect = async () => { const c = createClient({ url: 'redis://127.0.0.1:16379', socket: { reconnectStrategy: false } }); c.on('error', () => {}); await c.connect(); return c; };
let redis = await connect(); const namespace = `palate-restart:${randomUUID()}`;
const store = new SessionStore(redis, { namespace, now: () => 1000, leaseMs: 100 }); const { sid, state } = await store.create('AU', 'AUD');
const form = await store.form(sid, state, 'add', { merchandiseId: 'gid://shopify/ProductVariant/1' });
assert.equal((await store.claim(sid, form, { quantity: 1 })).code, 'claimed'); await redis.close();
execFileSync('docker', ['restart', container], { stdio: 'pipe' });
for (let attempt = 0; attempt < 20; attempt++) { try { redis = await connect(); break; } catch { if (attempt === 19) throw new Error('Disposable Redis failed to restart'); await new Promise(r => setTimeout(r, 250)); } }
const resumed = new SessionStore(redis, { namespace, now: () => 1200, leaseMs: 100 });
assert.ok(await resumed.readForm(form.token)); assert.equal((await resumed.claim(sid, form, { quantity: 1 })).code, 'unknown');
assert.equal((await resumed.read(sid)).pending.payload.quantity, 1);
for await (const keys of redis.scanIterator({ MATCH: `${namespace}:*`, COUNT: 100 })) if (keys.length) await redis.del(keys);
await redis.close(); console.log(JSON.stringify({ redisRestart: true, durableIntent: true, formSurvived: true, unknownNotReplayed: true }));
