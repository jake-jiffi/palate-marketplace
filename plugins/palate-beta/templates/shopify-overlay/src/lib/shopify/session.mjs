import { randomBytes, createHash } from 'node:crypto';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const randomId = () => randomBytes(24).toString('hex');
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// One Redis value owns a session's generation, revision and journal. Every transition below
// executes atomically. A lease expiring never grants permission to repeat a Shopify mutation.
const TRANSITION = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({code='expired'}) end
local s = cjson.decode(raw)
local a = cjson.decode(ARGV[1])
local function save() redis.call('SET', KEYS[1], cjson.encode(s), 'EX', ARGV[2]) end
local function reply(code, more) more = more or {}; more.code=code; return cjson.encode(more) end
if a.action == 'read' then redis.call('EXPIRE',KEYS[1],ARGV[2]); return reply('ok',{session=s}) end
if a.action == 'claim' then
  local old = s.operations[a.operationId]
  if old then
    if old.hash ~= a.hash or old.kind ~= a.kind then return reply('payload-conflict') end
    if old.status == 'done' then
      if a.kind == 'checkout' and (s.generation ~= old.generation or s.revision ~= old.revision or old.receiptExpires <= a.now) then return reply('stale') end
      if a.kind == 'checkout' and s.pending and s.pending ~= cjson.null then return reply(s.pending.unknown and 'unknown' or 'pending') end
      if a.kind == 'checkout' and s.needsAcknowledgement then return reply('confirmation-required') end
      return reply('replay',{receipt=old.receipt})
    end
  end
  if s.generation ~= a.generation or s.revision ~= a.revision then return reply('stale') end
  local p = s.pending
  if p and p ~= cjson.null then
    if p.kind == 'checkout' and p.untilMs <= a.now then
      s.operations[p.operationId].status='retryable'
      s.pending=cjson.null
    elseif a.kind == 'recover' and p.kind ~= 'checkout' then
      -- Explicit recovery retires the entire uncertain generation. Its worker may still finish
      -- upstream, but its owner/generation can no longer complete against this session.
    else
      if p.kind ~= 'checkout' and (p.untilMs <= a.now or p.unknown) then
        p.unknown=true; save(); return reply('unknown')
      end
      return reply('pending')
    end
  end
  if a.kind == 'recover' then
    table.insert(s.retired,{generation=s.generation,cartId=s.cartId,summary=s.summary,pending=s.pending})
    s.recoveryIntent=a.payload.quote
    s.generation=s.generation+1; s.revision=0; s.cartId=cjson.null; s.pending=cjson.null
  end
  local op={operationId=a.operationId,hash=a.hash,payload=a.payload,previousSummary=s.summary,kind=a.kind,owner=a.owner,generation=s.generation,revision=s.revision,status='pending',untilMs=a.now+a.leaseMs}
  s.operations[a.operationId]=op; s.pending=op; save()
  return reply('claimed',{session=s,owner=a.owner,generation=s.generation,revision=s.revision})
end
if a.action == 'complete' or a.action == 'unknown' then
  local p=s.pending
  if not p or p == cjson.null or p.owner ~= a.owner or p.operationId ~= a.operationId or s.generation ~= a.generation or s.revision ~= a.revision then return reply('owner-conflict') end
  if p.kind == 'checkout' and p.untilMs <= a.now then return reply('owner-conflict') end
  if a.action == 'unknown' then p.unknown=true; s.operations[a.operationId].unknown=true; save(); return reply('unknown') end
  if a.cartId then s.cartId=a.cartId end
  if a.summary then s.summary=a.summary end
  if a.codes then s.discountCodes=a.codes end
  if a.needsAcknowledgement ~= nil then s.needsAcknowledgement=a.needsAcknowledgement end
  if p.kind ~= 'checkout' then s.revision=s.revision+1 end
  s.operations[a.operationId]={hash=p.hash,kind=p.kind,status='done',receipt=a.receipt,generation=s.generation,revision=s.revision,receiptExpires=a.now+30000}
  s.pending=cjson.null; save(); return reply('completed',{receipt=a.receipt})
end
return reply('invalid-action')
`;

export class SessionStore {
  constructor(redis, { namespace = 'palate-commerce', now = Date.now, leaseMs = 15000 } = {}) {
    if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(namespace)) throw new Error('Invalid Redis namespace');
    this.redis = redis; this.prefix = namespace; this.now = now; this.leaseMs = leaseMs;
  }
  key(sid) {
    if (!/^[a-f0-9]{48}$/.test(sid ?? '')) throw new Error('Invalid session identifier');
    return `${this.prefix}:session:${sid}`;
  }
  async create(country, currency) {
    const sid = randomId();
    const state = { version: 1, generation: 0, revision: 0, country, currency, cartId: null,
      summary: null, discountCodes: [], needsAcknowledgement: false, pending: null, operations: {}, retired: [] };
    await this.redis.set(this.key(sid), JSON.stringify(state), { NX: true, EX: SESSION_SECONDS });
    return { sid, state };
  }
  async transition(sid, action) {
    return JSON.parse(await this.redis.eval(TRANSITION, {
      keys: [this.key(sid)], arguments: [JSON.stringify({ ...action, now: this.now(), leaseMs: this.leaseMs }), String(SESSION_SECONDS)],
    }));
  }
  async read(sid) {
    if (!/^[a-f0-9]{48}$/.test(sid ?? '')) return null;
    const r = await this.transition(sid, { action: 'read' });
    return r.code === 'ok' ? r.session : null;
  }
  /** @param {string} sid @param {any} state @param {string} kind @param {any} quote */
  async form(sid, state, kind, quote = null) {
    const token = randomId();
    const value = { sid, operationId: randomId(), generation: state.generation, revision: state.revision, kind, quote };
    await this.redis.set(`${this.prefix}:form:${token}`, JSON.stringify(value), { EX: SESSION_SECONDS, NX: true });
    return { token, ...value };
  }
  async readForm(token) {
    if (!/^[a-f0-9]{48}$/.test(token ?? '')) return null;
    const raw = await this.redis.get(`${this.prefix}:form:${token}`);
    return raw ? JSON.parse(raw) : null;
  }
  claim(sid, form, payload, kind = form.kind) {
    return this.transition(sid, { action: 'claim', operationId: form.operationId, generation: form.generation,
      revision: form.revision, hash: digest(payload), payload, kind, owner: randomId() });
  }
  complete(sid, form, claim, result) {
    return this.transition(sid, { action: 'complete', operationId: form.operationId, owner: claim.owner,
      generation: claim.generation, revision: claim.revision, ...result });
  }
  unknown(sid, form, claim) {
    return this.transition(sid, { action: 'unknown', operationId: form.operationId, owner: claim.owner,
      generation: claim.generation, revision: claim.revision });
  }
}
