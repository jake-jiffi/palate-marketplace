// Optional generated media through Higgsfield. Absent tooling is silent: detect reports it and
// nothing else changes. Spend is capped per project, agreed once, and recorded in
// .palate/media/budget.json, which sits outside the source fingerprints on purpose.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail, json, atomicJson, confined, normalPath, noSymlinks, readState, acquireLock, sha256 } from './project.mjs';

export const TIERS = {
  'cap-300': { cap: 300, kinds: ['image', 'video', 'model'] },
  'cap-800': { cap: 800, kinds: ['image', 'video', 'model'] },
  'images-100': { cap: 100, kinds: ['image'] },
  declined: { cap: 0, kinds: [] },
};
export const OPTION_STILLS = 2; // per design option, before a direction is chosen
const DEFAULT_ESTIMATE = { image: 20, video: 80, model: 40 }; // used only when a quote carries no number
// Which model serves which need lives in data, so a better model is a table edit, not a doctrine change.
export const ROUTES = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./media-models.json', import.meta.url)), 'utf8'));
const VIDEO_MODEL = /seedance|kling|veo|hailuo|minimax|wan|sora|omni|video|runway|luma|pika|hunyuan/i;
const BUDGET = '.palate/media/budget.json';
const DESTINATIONS = ['src/', 'public/', '.palate/media/'];
const EXTENSIONS = { image: /\.(?:png|jpe?g|webp)$/i, video: /\.(?:mp4|webm|mov)$/i, model: /\.(?:glb|gltf)$/i };
const SAVED_AS = { image: '.png, .jpg or .webp', video: '.mp4, .webm or .mov', model: '.glb or .gltf' };

export function findBinary(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}
function run(bin, args, timeout, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, shell: false });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
}
function parse(text) { try { return JSON.parse(text); } catch { return null; } }
function findKey(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, key) && value[key] !== null && value[key] !== '') return value[key];
  for (const nested of Object.values(value)) { const found = findKey(nested, key); if (found !== undefined) return found; }
  return undefined;
}
function credits(data, text = '') {
  for (const key of ['credits_exact', 'credits']) {
    const number = Number(findKey(data, key));
    if (Number.isFinite(number)) return number;
  }
  const match = /([\d,]+(?:\.\d+)?)\s+credits/i.exec(text);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}
const firstLine = text => text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || null;

function mcpConfigured(project) {
  const sources = [];
  const mentions = (name, config) => /higgsfield/i.test(name) || /higgsfield/i.test(JSON.stringify(config || {}));
  const scan = (label, servers) => { if (servers && typeof servers === 'object' && Object.entries(servers).some(([name, config]) => mentions(name, config))) sources.push(label); };
  try {
    const user = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    scan('claude-user', user.mcpServers);
    if (project) scan('claude-local', user.projects?.[project]?.mcpServers);
  } catch {}
  if (project) { try { scan('project', JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')).mcpServers); } catch {} }
  try { if (/^\s*\[mcp_servers\.[^\]]*higgsfield[^\]]*\]/mi.test(fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8'))) sources.push('codex'); } catch {}
  return { configured: sources.length > 0, sources };
}

export function readBudget(project) {
  const file = confined(project, BUDGET);
  if (!fs.existsSync(file)) return { schema: 1, consent: null, entries: [] };
  const budget = json(file);
  if (budget.schema !== 1 || !Array.isArray(budget.entries)) fail('The media budget record is malformed. No media was generated.', 'CORRUPT');
  return budget;
}
export function spent(budget) {
  // A reservation counts until it settles, so a crash mid-generation cannot free the cap. A
  // submitted job that failed counts its estimate too: the charge may have landed. Only a job
  // Higgsfield never accepted is free.
  return budget.entries.reduce((sum, entry) => sum + (entry.status === 'done' || entry.status === 'recorded' ? entry.credits : entry.submitted === false ? 0 : entry.estimate || 0), 0);
}
export function summary(budget) {
  const cap = budget.consent?.cap ?? 0;
  return { consent: budget.consent, cap, spent: spent(budget), remaining: Math.max(0, cap - spent(budget)), entries: budget.entries };
}

export function detect(project) {
  const bin = findBinary(['higgsfield', 'higgs']);
  const cli = { present: Boolean(bin) };
  if (bin) {
    const status = run(bin, ['account', 'status', '--json'], 15000);
    cli.ready = status.ok;
    if (status.ok) {
      const data = parse(status.stdout);
      cli.plan = findKey(data, 'plan_type') ?? findKey(data, 'subscription_plan_type') ?? null;
      cli.credits = credits(data, status.stdout);
    } else cli.message = firstLine(status.stderr) || firstLine(status.stdout) || status.error;
  }
  const mcp = mcpConfigured(project);
  let consent = null;
  if (project) { try { consent = readBudget(project).consent; } catch {} }
  return { ok: true, available: cli.present || mcp.configured, cli, mcp, video: Boolean(findBinary(['ffmpeg']) && findBinary(['ffprobe'])), consent };
}

function requireOp(op) { if (!op || !/^[A-Za-z0-9._:-]{1,128}$/.test(op)) fail('Media changes need --op <unique-operation-id>.', 'MISSING_OPERATION'); }

export async function consent(project, input, op) {
  requireOp(op);
  const tier = TIERS[input.decision];
  if (!tier) fail(`Consent decision must be one of: ${Object.keys(TIERS).join(', ')}.`);
  // Half the live balance at most, so one site cannot empty the account the person uses elsewhere.
  const balance = input.decision === 'declined' ? null : detect(project).cli.credits ?? null;
  const cap = balance === null ? tier.cap : Math.min(tier.cap, Math.floor(balance / 2));
  const release = await acquireLock(project);
  try {
    const budget = readBudget(project);
    if (budget.consent?.op === op) return { ok: true, ...summary(budget) };
    budget.consent = { decision: input.decision, cap, kinds: tier.kinds, balanceAtConsent: balance, op, at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(confined(project, BUDGET)), { recursive: true });
    atomicJson(confined(project, BUDGET), budget);
    return { ok: true, ...summary(budget) };
  } finally { release(); }
}

function destination(project, dest, stage, direction, kind) {
  normalPath(dest);
  if (!EXTENSIONS[kind].test(dest)) fail(`A generated ${kind} is saved as ${SAVED_AS[kind]}.`);
  if (!DESTINATIONS.some(prefix => dest.startsWith(prefix))) fail(`Generated media belongs under ${DESTINATIONS.join(', ')}.`);
  if (stage === 'option' && !dest.startsWith(`src/directions/${direction}/`) && !dest.startsWith('.palate/media/')) fail(`Before a direction is chosen, media for option ${direction} stays inside src/directions/${direction}/ so other options are not staled.`);
  const file = confined(project, dest);
  if (fs.existsSync(file)) fail(`${dest} already exists. Choose a new file name; generated media is never overwritten.`);
  return file;
}
function localInputs(project, args) {
  // Media flags upload local files. Only files inside the project may leave the machine this way.
  for (const value of args) {
    if (value.startsWith('--') || !/[/\\]|\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a)$/i.test(value)) continue;
    const absolute = path.resolve(project, value);
    if (fs.existsSync(absolute)) {
      const relative = path.relative(project, noSymlinks(absolute));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`Media inputs must come from inside the project: ${value}`, 'UNSAFE_PATH');
    } else if (path.isAbsolute(value)) fail(`Media input not found: ${value}`);
  }
}
async function download(url, file) {
  let parsed; try { parsed = new URL(url); } catch { fail('Higgsfield returned no usable result URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) fail('Result URLs must be HTTPS.');
  const response = await fetch(parsed, { redirect: 'follow' });
  if (!response.ok) fail(`Downloading the result failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 512 * 1024 * 1024) fail('The result is larger than 512 MB.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  return sha256(bytes);
}
async function settle(project, op, patch) {
  const release = await acquireLock(project);
  try {
    const budget = readBudget(project);
    const entry = budget.entries.find(item => item.op === op);
    if (entry.status === 'done' && patch.status && patch.status !== 'done') return entry; // a late duplicate never undoes a result
    Object.assign(entry, patch, patch.status ? { settledAt: new Date().toISOString() } : {});
    atomicJson(confined(project, BUDGET), budget);
    return entry;
  } finally { release(); }
}

// What the job is for and which models may serve it. Synchronous, so a bad request costs no quotes.
function resolve(project, input) {
  const { need, reason, args = [] } = input || {};
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) fail('args must be an array of strings, exactly as `higgsfield generate create` takes them.');
  if (args.some(value => /^--(?:wait|json)(?:=|$)/.test(value))) fail('Leave out --wait and --json; the budget wrapper adds them.');
  let kind, candidates, requires, override = null;
  if (need !== undefined) {
    const spec = ROUTES.needs[need] || fail(`Unknown need "${need}". Needs: ${Object.keys(ROUTES.needs).join(', ')}.`);
    ({ kind, candidates } = spec); requires = spec.requires || [];
    const foreign = args.filter(value => value.startsWith('--') && !ROUTES.jobFlags.includes(value.split('=')[0]));
    if (foreign.length) fail(`With a need, pass only the job's own flags (${ROUTES.jobFlags.join(', ')}). ${foreign.join(', ')} belong to the model table.`);
  } else {
    // A named model is for when the person asked for one; the reason is recorded beside the spend.
    ({ kind } = input || {});
    if (typeof input?.model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(input.model) || typeof reason !== 'string' || !reason.trim()) fail(`Name a need (${Object.keys(ROUTES.needs).join(', ')}), or a model with the reason the person asked for it.`);
    if (!['image', 'video', 'model'].includes(kind)) fail('A named model needs kind "image", "video" or "model".');
    if (kind === 'image' && VIDEO_MODEL.test(input.model)) fail(`${input.model} is a video model; declare kind "video".`);
    candidates = [{ model: input.model, args: [] }]; requires = []; override = reason.trim();
  }
  if (input?.chain !== undefined) {
    // One model for a whole film: later legs and connectors are pinned to the chain's first render,
    // because a change of model shows as a pop in render character at the seam.
    const first = readBudget(project).entries.find(item => item.op === input.chain && item.status === 'done');
    if (!first) fail(`Chain ${input.chain} has no finished generation to match.`);
    if (first.kind !== kind) fail(`Chain ${input.chain} is a ${first.kind}, not a ${kind}.`);
    candidates = [{ model: first.model, args: modelFlags(first.args || []) }];

  }
  const stage = readState(project).selection ? 'site' : 'option';
  if (stage === 'option' && kind !== 'image') fail('Video, films and 3D wait until a direction is chosen. Design options may use generated stills only.', 'MEDIA_STAGE');
  localInputs(project, args);
  return { need: need ?? null, kind, candidates, requires, override, stage, args };
}

// Choose deterministically: the first candidate in the live catalogue whose schema accepts the need,
// whose free price check accepts this exact job, and whose price fits. Every skip keeps its reason.
function choose(project, job) {
  const bin = findBinary(['higgsfield', 'higgs']) || fail('The Higgsfield CLI is not on PATH.', 'MEDIA_UNAVAILABLE');
  const agreed = readBudget(project).consent;
  if (!agreed) fail('Nobody has agreed to Higgsfield spend on this site. Ask once, then record it with `media consent`.', 'MEDIA_NO_CONSENT');
  if (!agreed.kinds.includes(job.kind)) fail(agreed.decision === 'declined' ? 'The person declined generated media for this site.' : `The agreed budget covers ${agreed.kinds.join(' and ') || 'nothing'}, not ${job.kind}.`, 'MEDIA_DECLINED');
  const account = run(bin, ['account', 'status', '--json'], 15000);
  if (!account.ok) fail(`Higgsfield is not ready: ${firstLine(account.stderr) || 'account status failed'}. Ask the person to run \`! higgsfield auth login\`, then retry.`, 'MEDIA_UNAVAILABLE');
  const balance = credits(parse(account.stdout), account.stdout);
  const available = summary(readBudget(project)).remaining;
  const skipped = [], schemas = new Map(); // read fresh for every job: the catalogue changes
  for (const candidate of job.candidates) {
    const params = schemaParams(bin, candidate.model, schemas);
    if (!params) { skipped.push({ model: candidate.model, reason: 'not in the live Higgsfield catalogue' }); continue; }
    const missing = job.requires.filter(name => !params.has(name));
    if (missing.length) { skipped.push({ model: candidate.model, reason: `does not accept ${missing.join(', ')}` }); continue; }
    const jobArgs = [...candidate.args, ...job.args];
    const quote = run(bin, ['generate', 'cost', candidate.model, ...jobArgs, '--json'], 120000, project);
    if (!quote.ok) { skipped.push({ model: candidate.model, reason: firstLine(quote.stderr) || 'the price check refused this job' }); continue; }
    const price = credits(parse(quote.stdout), quote.stdout);
    const estimate = price ?? DEFAULT_ESTIMATE[job.kind];
    if (estimate > available) { skipped.push({ model: candidate.model, reason: `costs about ${estimate} credits and ${available} of the agreed ${agreed.cap} remain` }); continue; }
    if (balance !== null && estimate > balance) { skipped.push({ model: candidate.model, reason: `costs about ${estimate} credits and the account holds ${balance}` }); continue; }
    return { bin, skipped, chosen: { model: candidate.model, args: jobArgs, estimate, estimateSource: price === null ? 'default' : 'higgsfield' } };
  }
  const why = skipped.map(item => `${item.model}: ${item.reason}`).join('; ');
  fail(`No model can do this ${job.need ? `"${job.need}" ` : ''}job within the agreement. ${why}.`, skipped.some(item => /remain|account holds/.test(item.reason)) ? 'MEDIA_BUDGET' : 'MEDIA_UNAVAILABLE');
}

// A free dry run of routing and price, for planning a film before asking the person.
export function quote(project, input) {
  const { bin, ...routed } = choose(project, resolve(project, input));
  return { ok: true, model: routed.chosen.model, estimate: routed.chosen.estimate, skipped: routed.skipped, ...summary(readBudget(project)) };
}

export async function generate(project, input, op) {
  requireOp(op);
  // A retried operation returns its receipt, or recovers its submitted job, before anything is spent.
  const prior = readBudget(project).entries.find(item => item.op === op);
  if (prior?.status === 'done') return { ok: true, replayed: true, entry: prior, ...summary(readBudget(project)) };
  // A submitted job whose wait failed, or whose process was interrupted, is collected, never resubmitted.
  if (prior?.jobId && (prior.status === 'reserved' || (prior.status === 'failed' && prior.recoverable))) {
    const bin = findBinary(['higgsfield', 'higgs']) || fail('The Higgsfield CLI is not on PATH.', 'MEDIA_UNAVAILABLE');
    const file = confined(project, prior.dest);
    if (fs.existsSync(file)) fail(`${prior.dest} already exists.`);
    return finish(project, bin, op, prior.jobId, file, prior.dest, prior.estimate, prior.kind);
  }
  const job = resolve(project, input);
  const { purpose, direction = null, dest } = input;
  if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 300) fail('Generation needs a short purpose saying where the media is used.');
  if (job.stage === 'option' && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(direction || '')) fail('Before a direction is chosen, a generated still names the option it belongs to.');
  const file = destination(project, typeof dest === 'string' ? dest : '', job.stage, direction, job.kind);
  const { bin, chosen, skipped } = choose(project, job);
  const { need, kind, override, stage } = job;
  const { model, estimate } = chosen;

  const release = await acquireLock(project);
  let entry;
  try {
    const budget = readBudget(project);
    const previous = budget.entries.find(item => item.op === op);
    if (previous?.status === 'done') return { ok: true, replayed: true, entry: previous, ...summary(budget) };
    if (previous) fail(`Operation ${op} was already ${previous.status}. Use a new --op; a reservation left by a crash is settled with \`media record\`.`, 'OPERATION_CONFLICT');
    if (budget.entries.some(item => item.dest === dest && item.status !== 'failed')) fail(`${dest} is already claimed by another generation.`);
    const agreed = budget.consent;
    if (!agreed) fail('Nobody has agreed to Higgsfield spend on this site. Ask once, then record it with `media consent`.', 'MEDIA_NO_CONSENT');
    if (!agreed.kinds.includes(kind)) fail(agreed.decision === 'declined' ? 'The person declined generated media for this site.' : `The agreed budget covers ${agreed.kinds.join(' and ') || 'nothing'}, not ${kind}.`, 'MEDIA_DECLINED');
    if (stage === 'option' && budget.entries.filter(item => item.direction === direction && item.stage === 'option' && item.status !== 'failed').length >= OPTION_STILLS) fail(`Option ${direction} already has ${OPTION_STILLS} generated stills. Compose with those.`, 'MEDIA_STAGE');
    // Re-checked under the lock: a job priced alongside this one may have reserved the room since.
    const remaining = agreed.cap - spent(budget);
    if (estimate > remaining) fail(`This costs about ${estimate} credits and ${Math.max(0, remaining)} of the agreed ${agreed.cap} remain. Use a cheaper model or tier, or ask whether to raise the cap.`, 'MEDIA_BUDGET');
    entry = { id: crypto.randomUUID(), op, status: 'reserved', kind, need: need ?? null, override, model, args: chosen.args, skipped, purpose: purpose.trim(), stage, direction, dest, estimate, estimateSource: chosen.estimateSource, credits: 0, at: new Date().toISOString() };
    budget.entries.push(entry);
    fs.mkdirSync(path.dirname(confined(project, BUDGET)), { recursive: true });
    atomicJson(confined(project, BUDGET), budget);
  } finally { release(); }

  // Submit without waiting and keep the job id: a dropped wait must never lose a job that is charged.
  // `create --json` prints an array of job ids. Output that cannot be read is reconciled against the
  // account's job list before anything is treated as free, because an unread id is still a charge.
  const submitted = run(bin, ['generate', 'create', model, ...chosen.args, '--json'], 180000, project);
  const jobId = submittedId(parse(submitted.stdout)) ?? findSubmitted(project, bin, model, chosen.args, entry.at);
  if (typeof jobId !== 'string') {
    const error = firstLine(submitted.stderr) || submitted.error || 'no job id returned';
    if (submitted.ok) {
      await settle(project, op, { status: 'failed', error: `${error}; check \`higgsfield generate list\`` });
      fail(`The job may have been submitted but no id came back. Its estimate stays counted; check \`higgsfield generate list\` and record it with \`media record\`.`, 'MEDIA_FAILED');
    }
    await settle(project, op, { status: 'failed', submitted: false, error });
    fail(`Higgsfield did not accept the job: ${error}. Nothing was submitted, so nothing is counted.`, 'MEDIA_FAILED');
  }
  await settle(project, op, { jobId });
  return finish(project, bin, op, jobId, file, dest, estimate, kind);
}

function modelFlags(args) {
  const kept = [];
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith('--')) continue;
    const hasValue = index + 1 < args.length && !args[index + 1].startsWith('--');
    if (!ROUTES.jobFlags.includes(args[index])) kept.push(args[index], ...(hasValue ? [args[index + 1]] : []));
    if (hasValue) index++;
  }
  return kept;
}
function schemaParams(bin, model, schemas) {
  if (!schemas.has(model)) {
    const result = run(bin, ['model', 'get', model, '--json'], 30000);
    const params = parse(result.stdout)?.params;
    schemas.set(model, result.ok && Array.isArray(params) ? new Set(params.map(param => param.name)) : null);
  }
  return schemas.get(model);
}

function submittedId(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string' && first.trim()) return first.trim();
  const id = findKey(first, 'id') ?? findKey(first, 'job_id');
  return typeof id === 'string' ? id : null;
}
function findSubmitted(project, bin, model, args, since) {
  const jobs = parse(run(bin, ['generate', 'list', '--json'], 30000).stdout);
  if (!Array.isArray(jobs)) return null;
  const known = new Set(readBudget(project).entries.map(item => item.jobId).filter(Boolean));
  const prompt = args.includes('--prompt') ? args[args.indexOf('--prompt') + 1] : null;
  const match = jobs.find(job => job && job.job_type === model && !known.has(job.id) && Date.parse(job.created_at) >= Date.parse(since) - 60000 && (!prompt || job.params?.prompt === prompt));
  return typeof match?.id === 'string' ? match.id : null;
}

const RUNNING = new Set(['queued', 'pending', 'in_progress', 'running', 'processing', 'waiting']);
async function finish(project, bin, op, jobId, file, dest, estimate, kind) {
  const minutes = kind === 'video' ? 20 : 10;
  let job = null, ended = null;
  for (let attempt = 0; attempt < 3 && !job && !ended; attempt++) {
    const waited = run(bin, ['generate', 'wait', jobId, '--timeout', `${minutes}m`, '--quiet', '--json'], (minutes + 1) * 60000, project);
    const result = parse(waited.stdout);
    if (waited.ok && typeof findKey(result, 'result_url') === 'string') { job = result; break; }
    // A wait can fail on a transient error while the job itself carries on: ask for the job directly.
    const current = parse(run(bin, ['generate', 'get', jobId, '--json'], 30000, project).stdout);
    const status = findKey(current, 'status');
    if (status === 'completed' && typeof findKey(current, 'result_url') === 'string') job = current;
    else if (status && !RUNNING.has(status)) ended = status;
  }
  if (!job) {
    await settle(project, op, { status: 'failed', recoverable: true, error: ended ? `Job ended with status ${ended}` : 'Result not confirmed' });
    if (ended) fail(`Generation ended with status ${ended}. Its estimate stays counted in case it was charged.`, 'MEDIA_FAILED');
    fail(`Job ${jobId} was submitted but its result is not confirmed yet. Re-run with the same --op to collect it without paying again.`, 'MEDIA_PENDING');
  }
  try {
    const digest = await download(findKey(job, 'result_url'), file);
    const done = await settle(project, op, { status: 'done', recoverable: false, credits: estimate, jobId, file: dest, sha256: digest });
    return { ok: true, entry: done, ...summary(readBudget(project)) };
  } catch (error) {
    await settle(project, op, { status: 'failed', recoverable: true, error: `Generated but not saved: ${error.message}` });
    throw error;
  }
}

// For work done outside the wrapper (the Higgsfield MCP) or a reservation left by a crash.
export async function record(project, input, op) {
  requireOp(op);
  const amount = Number(input?.credits);
  if (!Number.isFinite(amount) || amount < 0) fail('record needs the credits the generation actually cost.');
  if (input.file !== undefined) { normalPath(input.file); if (!fs.existsSync(confined(project, input.file))) fail(`${input.file} does not exist.`); }
  const release = await acquireLock(project);
  try {
    const budget = readBudget(project);
    if (!budget.consent || budget.consent.decision === 'declined') fail('No agreed Higgsfield budget exists for this site.', 'MEDIA_NO_CONSENT');
    const file = input.file ? { file: input.file, sha256: sha256(fs.readFileSync(confined(project, input.file))) } : {};
    const pending = budget.entries.find(item => item.op === op);
    if (pending && pending.status !== 'reserved') fail(`Operation ${op} is already ${pending.status}.`, 'OPERATION_CONFLICT');
    if (pending) Object.assign(pending, { status: 'recorded', credits: amount, ...file, settledAt: new Date().toISOString() });
    else {
      if (typeof input.purpose !== 'string' || !input.purpose.trim() || typeof input.model !== 'string') fail('record needs model and purpose.');
      budget.entries.push({ id: crypto.randomUUID(), op, status: 'recorded', kind: input.kind === 'video' ? 'video' : 'image', model: input.model, purpose: input.purpose.trim(), stage: readState(project).selection ? 'site' : 'option', direction: input.direction || null, credits: amount, estimate: amount, via: input.via || 'mcp', ...file, at: new Date().toISOString() });
    }
    fs.mkdirSync(path.dirname(confined(project, BUDGET)), { recursive: true });
    atomicJson(confined(project, BUDGET), budget);
    return { ok: true, ...summary(budget) };
  } finally { release(); }
}
