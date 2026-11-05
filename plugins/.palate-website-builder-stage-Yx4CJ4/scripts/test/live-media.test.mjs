import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute } from '../live/cli.mjs';
import { readState } from '../live/project.mjs';

// A fake Higgsfield CLI and a local result server, so no test reaches a real account.
const guard = fileURLToPath(new URL('../../hooks/palate-media-guard.mjs', import.meta.url));
const base = fs.realpathSync(os.tmpdir());
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FAKE_HF_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'account') {
  if (env.FAKE_HF_SIGNED_OUT) { process.stderr.write('Error: No workspace selected.\\nHint: Run: hf workspace set <workspace_id>\\n'); process.exit(4); }
  process.stdout.write(JSON.stringify({ credits: Number(env.FAKE_HF_CREDITS || 1000), email: 'person@example.com', subscription_plan_type: 'ultra' }));
} else if (args[0] === 'model' && args[1] === 'get') {
  const schemas = { gpt_image_2: ['prompt', 'image_references', 'aspect_ratio', 'quality', 'resolution'], gpt_image_2_5: ['prompt', 'image_references', 'aspect_ratio', 'quality', 'resolution'], nano_banana_pro: ['prompt', 'image_references', 'aspect_ratio', 'resolution'], seedance_2_5: ['prompt', 'start_image', 'end_image', 'duration', 'resolution', 'generate_audio'], seedance_2_0: ['prompt', 'start_image', 'end_image', 'duration', 'mode', 'resolution', 'generate_audio'], seedance_2_0_mini: ['prompt', 'start_image', 'end_image', 'duration', 'generate_audio'], kling3_0: ['prompt', 'start_image', 'duration', 'mode', 'sound'] };
  if (!schemas[args[2]] || (env.FAKE_HF_MISSING || '').split(',').includes(args[2])) { process.stderr.write('Error: unknown job type\\n'); process.exit(4); }
  process.stdout.write(JSON.stringify({ job_type: args[2], params: schemas[args[2]].map(name => ({ name })) }));
} else if (args[0] === 'generate' && args[1] === 'cost') {
  const prices = JSON.parse(env.FAKE_HF_COSTS || '{}');
  process.stdout.write(JSON.stringify({ credits: prices[args[2]] ?? Number(env.FAKE_HF_COST || 6.5) }));
} else if (args[0] === 'generate' && args[1] === 'create') {
  if (args.includes('--wait')) process.exit(3); // the wrapper must never block on create
  if (env.FAKE_HF_FAIL) { process.stderr.write('Error: Higgsfield API error (HTTP 400)\\n'); process.exit(1); }
  const id = 'job-' + Date.now();
  fs.appendFileSync(env.FAKE_HF_JOBS, JSON.stringify({ id, job_type: args[2], created_at: new Date().toISOString(), status: 'in_progress', params: { prompt: args[args.indexOf('--prompt') + 1] } }) + '\\n');
  // Real output of \`create --json\` without --wait (CLI 1.1.26): an array of bare job ids.
  process.stdout.write(env.FAKE_HF_GARBLE ? 'Submitted.' : JSON.stringify([id], null, 2));
} else if (args[0] === 'generate' && args[1] === 'list') {
  process.stdout.write(JSON.stringify(fs.readFileSync(env.FAKE_HF_JOBS, 'utf8').split('\\n').filter(Boolean).map(line => JSON.parse(line)).reverse()));
} else if (args[0] === 'generate' && args[1] === 'wait') {
  if (env.FAKE_HF_WAIT_FAIL) { process.stderr.write('Error: Higgsfield API error (HTTP 503)\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify({ id: args[2], status: 'completed', result_url: env.FAKE_HF_URL }));
} else if (args[0] === 'generate' && args[1] === 'get') {
  const status = env.FAKE_HF_GET_STATUS || 'completed';
  process.stdout.write(JSON.stringify({ id: args[2], status, result_url: status === 'completed' ? env.FAKE_HF_URL : null }));
} else process.exit(2);
`;

async function fixture(t, { credits = 1000, cost = 6.5 } = {}) {
  const root = fs.mkdtempSync(path.join(base, 'palate-media-'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'higgsfield'), FAKE, { mode: 0o755 });
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const log = path.join(root, 'calls.log'); fs.writeFileSync(log, '');
  const jobs = path.join(root, 'jobs.log'); fs.writeFileSync(jobs, '');
  const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'image/png' }); response.end(PNG); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  const nodeDir = path.dirname(process.execPath);
  Object.assign(process.env, { PATH: `${bin}${path.delimiter}${nodeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`, HOME: home, FAKE_HF_LOG: log, FAKE_HF_JOBS: jobs, FAKE_HF_CREDITS: String(credits), FAKE_HF_COST: String(cost), FAKE_HF_URL: `http://127.0.0.1:${server.address().port}/result.png` });
  for (const key of ['FAKE_HF_FAIL', 'FAKE_HF_SIGNED_OUT', 'FAKE_HF_WAIT_FAIL', 'FAKE_HF_GET_STATUS', 'FAKE_HF_GARBLE', 'FAKE_HF_COSTS', 'FAKE_HF_MISSING']) delete process.env[key];
  t.after(() => { server.close(); Object.assign(process.env, saved); fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'site');
  await execute({ command: 'init', project, expect: '0', op: 'init' });
  const creates = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(args => args[1] === 'create').length;
  return { root, bin, home, project, creates };
}
function input(project, value) { const file = path.join(path.dirname(project), `in-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(value)); return file; }
const media = (project, action, value, op = crypto.randomUUID()) => execute({ command: 'media', action, project, input: value === undefined ? undefined : input(project, value), op });
async function mutate(project, command, value) { return execute({ command, project, input: input(project, value), expect: String(readState(project).revision), op: crypto.randomUUID() }); }
async function select(project) {
  await mutate(project, 'source', { productKind: 'service', platform: 'wordpress', routes: ['/'], journeys: ['enquiry'] });
  fs.mkdirSync(path.join(project, 'src/directions/a'), { recursive: true }); fs.writeFileSync(path.join(project, 'src/directions/a/index.astro'), '<h1>a</h1>');
  await mutate(project, 'option', { id: 'a', status: 'ready', label: 'a', previewUrl: 'http://127.0.0.1:4321/_palate/directions/a' });
  await mutate(project, 'select', { optionId: 'a' });
}
const still = (direction, name, extra = {}) => ({ need: 'still', args: ['--prompt', 'A clay world, no text', '--aspect_ratio', '3:2'], purpose: 'Opening world', direction, dest: `src/directions/${direction}/media/${name}.png`, ...extra });
const clip = (name, extra = {}) => ({ need: 'film-leg', args: ['--prompt', 'Continue the same slow, steady forward glide', '--duration', '8'], purpose: 'Film leg', dest: `src/media/${name}.mp4`, ...extra });
async function refused(promise, code) { await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; }); }

test('absent tooling is silent: nothing available, nothing asked', async t => {
  const { project } = await fixture(t);
  const empty = fs.mkdtempSync(path.join(base, 'palate-media-path-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  process.env.PATH = empty; // the real CLI can share a directory with node, so no system PATH here
  const result = await media(project, 'detect');
  assert.equal(result.available, false);
  assert.equal(result.cli.present, false);
  assert.equal(result.mcp.configured, false);
  assert.equal(result.consent, null);
});

test('detect reads the signed-in CLI, a configured MCP server and a signed-out CLI, without keeping the email', async t => {
  const { project, home } = await fixture(t, { credits: 7520.96 });
  let result = await media(project, 'detect');
  assert.deepEqual([result.available, result.cli.ready, result.cli.credits, result.cli.plan], [true, true, 7520.96, 'ultra']);
  assert.doesNotMatch(JSON.stringify(result), /person@example\.com/);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { higgsfield: { type: 'http', url: 'https://mcp.higgsfield.ai/mcp' } } }));
  assert.deepEqual((await media(project, 'detect')).mcp, { configured: true, sources: ['claude-user'] });
  process.env.FAKE_HF_SIGNED_OUT = '1';
  result = await media(project, 'detect');
  assert.deepEqual([result.available, result.cli.present, result.cli.ready, result.cli.message], [true, true, false, 'Error: No workspace selected.']);
});

test('consent is held to half the live balance and replays by operation', async t => {
  const { project } = await fixture(t, { credits: 400 });
  const first = await media(project, 'consent', { decision: 'cap-300' }, 'consent-1');
  assert.equal(first.cap, 200);
  assert.equal((await media(project, 'consent', { decision: 'cap-300' }, 'consent-1')).cap, 200);
  await assert.rejects(media(project, 'consent', { decision: 'cap-9000' }));
  assert.equal((await media(project, 'consent', { decision: 'declined' }, 'consent-2')).cap, 0);
});

test('nothing generates without consent, and a declined site generates nothing', async t => {
  const { project, creates } = await fixture(t);
  await refused(media(project, 'generate', still('a', 'one')), 'MEDIA_NO_CONSENT');
  await media(project, 'consent', { decision: 'declined' });
  await refused(media(project, 'generate', still('a', 'one')), 'MEDIA_DECLINED');
  assert.equal(creates(), 0);
});

test('design options get at most two stills each, inside their own directory, and no video', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  await refused(media(project, 'generate', clip('leg-0')), 'MEDIA_STAGE');
  await assert.rejects(media(project, 'generate', still(undefined, 'x', { dest: 'src/media/x.png' })), /names the option/);
  await assert.rejects(media(project, 'generate', still('a', 'x', { dest: 'src/directions/b/media/x.png' })), /stays inside src\/directions\/a/);
  const one = await media(project, 'generate', still('a', 'one'));
  assert.equal(one.entry.status, 'done');
  assert.equal(one.entry.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.deepEqual(fs.readFileSync(path.join(project, 'src/directions/a/media/one.png')), PNG);
  await media(project, 'generate', still('a', 'two'));
  await refused(media(project, 'generate', still('a', 'three')), 'MEDIA_STAGE');
  assert.equal((await media(project, 'generate', still('b', 'one'))).entry.status, 'done');
  assert.equal(creates(), 3);
  assert.equal((await media(project, 'status')).spent, 19.5);
});

test('the cap refuses a job before it runs, and the create call never happens', async t => {
  const { project, creates } = await fixture(t, { cost: 250 });
  await media(project, 'consent', { decision: 'cap-300' });
  await select(project);
  await media(project, 'generate', clip('leg-0'));
  const error = await media(project, 'generate', clip('leg-1')).catch(value => value);
  assert.equal(error.code, 'MEDIA_BUDGET');
  assert.match(error.message, /about 250 credits and 50 of the agreed 300 remain/);
  assert.equal(creates(), 1);
  assert.equal(fs.existsSync(path.join(project, 'src/media/leg-1.mp4')), false);
});

test('two jobs priced at the same moment cannot both take the last of the cap', async t => {
  const { project, creates } = await fixture(t, { cost: 250 });
  await media(project, 'consent', { decision: 'cap-300' });
  await select(project);
  const results = await Promise.allSettled([media(project, 'generate', clip('race-a')), media(project, 'generate', clip('race-b'))]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'MEDIA_BUDGET');
  assert.equal(creates(), 1);
});

test('an images-only agreement refuses video after selection; the full tier allows it', async t => {
  const { project } = await fixture(t);
  await select(project);
  await media(project, 'consent', { decision: 'images-100' });
  await refused(media(project, 'generate', clip('leg-0')), 'MEDIA_DECLINED');
  await media(project, 'consent', { decision: 'cap-800' });
  assert.equal((await media(project, 'generate', clip('leg-0'))).entry.kind, 'video');
});

test('a job Higgsfield refused costs nothing, and its operation is not reused', async t => {
  const { project } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  process.env.FAKE_HF_FAIL = '1';
  await refused(media(project, 'generate', still('a', 'one'), 'job-1'), 'MEDIA_FAILED');
  delete process.env.FAKE_HF_FAIL;
  const status = await media(project, 'status');
  assert.deepEqual([status.entries[0].status, status.entries[0].submitted, status.spent], ['failed', false, 0]);
  await refused(media(project, 'generate', still('a', 'one'), 'job-1'), 'OPERATION_CONFLICT');
  const done = await media(project, 'generate', still('a', 'one'), 'job-2');
  assert.equal((await media(project, 'generate', still('a', 'one'), 'job-2')).replayed, true);
  assert.equal(done.entry.status, 'done');
});

test('a dropped wait keeps the job: it stays counted and the same operation collects it without paying again', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  Object.assign(process.env, { FAKE_HF_WAIT_FAIL: '1', FAKE_HF_GET_STATUS: 'in_progress' });
  await refused(media(project, 'generate', still('a', 'one'), 'still-0'), 'MEDIA_PENDING');
  let status = await media(project, 'status');
  assert.deepEqual([status.entries[0].status, status.entries[0].recoverable, status.spent], ['failed', true, 6.5]);
  process.env.FAKE_HF_GET_STATUS = 'completed'; // the wait still fails; the job has finished
  const recovered = await media(project, 'generate', still('a', 'one'), 'still-0');
  assert.equal(recovered.entry.status, 'done');
  assert.deepEqual(fs.readFileSync(path.join(project, 'src/directions/a/media/one.png')), PNG);
  status = await media(project, 'status');
  assert.deepEqual([creates(), status.spent], [1, 6.5]);
});

test('an interrupted run is collected by its operation, not submitted again', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  const file = path.join(project, '.palate/media/budget.json');
  const budget = JSON.parse(fs.readFileSync(file, 'utf8'));
  budget.entries.push({ id: 'x', op: 'killed', status: 'reserved', kind: 'image', model: 'gpt_image_2', args: [], purpose: 'Interrupted', stage: 'option', direction: 'a', dest: 'src/directions/a/media/one.png', estimate: 6.5, credits: 0, jobId: 'job-interrupted', at: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(budget));
  const collected = await media(project, 'generate', still('a', 'one'), 'killed');
  assert.deepEqual([collected.entry.status, collected.entry.jobId, creates(), collected.spent], ['done', 'job-interrupted', 0, 6.5]);
});

test('a submission whose id cannot be read is found in the job list, never treated as free', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  process.env.FAKE_HF_GARBLE = '1';
  const done = await media(project, 'generate', still('a', 'one'));
  assert.equal(done.entry.status, 'done');
  assert.match(done.entry.jobId, /^job-/);
  assert.deepEqual([creates(), done.spent], [1, 6.5]);
});

test('a job that ends in a content refusal is counted and reported, not retried', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  Object.assign(process.env, { FAKE_HF_WAIT_FAIL: '1', FAKE_HF_GET_STATUS: 'nsfw' });
  const error = await media(project, 'generate', still('a', 'one')).catch(value => value);
  assert.equal(error.code, 'MEDIA_FAILED');
  assert.match(error.message, /status nsfw/);
  assert.deepEqual([creates(), (await media(project, 'status')).spent], [1, 6.5]);
});

test('inputs from outside the project, overwrites and mislabelled video models are refused', async t => {
  const { root, project } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  const outside = path.join(root, 'private.png'); fs.writeFileSync(outside, PNG);
  await refused(media(project, 'generate', still('a', 'one', { args: ['--prompt', 'x', '--image', outside] })), 'UNSAFE_PATH');
  fs.mkdirSync(path.join(project, 'src/directions/a/media'), { recursive: true }); fs.writeFileSync(path.join(project, 'src/directions/a/media/taken.png'), 'keep');
  await assert.rejects(media(project, 'generate', still('a', 'taken')), /already exists/);
  await assert.rejects(media(project, 'generate', { ...still('a', 'x'), need: undefined, model: 'seedance_2_0', kind: 'image', reason: 'They asked for it' }), /video model/);
  await assert.rejects(media(project, 'generate', { ...still('a', 'x', { args: ['--prompt', 'x', '--wait'] }), need: undefined, model: 'gpt_image_2', kind: 'image', reason: 'They asked for it' }), /Leave out --wait/);
  await assert.rejects(media(project, 'generate', still('a', 'x', { dest: 'src/directions/a/index2.astro' })), /saved as \.png/);
});

test('MCP spend recorded by hand counts against the cap', async t => {
  const { project } = await fixture(t);
  await media(project, 'consent', { decision: 'images-100' });
  const result = await media(project, 'record', { model: 'nano_banana_2', credits: 60, purpose: 'Texture', via: 'mcp' });
  assert.deepEqual([result.spent, result.remaining], [60, 40]);
});

function hook(payload) {
  const result = spawnSync(process.execPath, [guard], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
}
test('the guard keeps direct spend out of a live site and leaves everything else alone', async t => {
  const { root, project } = await fixture(t);
  const bash = (command, cwd = project) => hook({ tool_name: 'Bash', cwd, tool_input: { command } });
  assert.match(bash('higgsfield generate create gpt_image_2 --prompt x --wait').permissionDecisionReason, /palate\.mjs media generate/);
  assert.match(bash('cd src && /usr/local/bin/higgs generate create kling3_0 --prompt x').permissionDecisionReason, /palate\.mjs media generate/);
  assert.match(bash('bash -c "higgsfield generate create gpt_image_2 --prompt x"').permissionDecisionReason, /palate\.mjs media generate/);
  assert.equal(bash('higgsfield generate cost seedance_2_0 --prompt x'), null);
  assert.equal(bash('higgsfield account status --json'), null);
  assert.equal(bash('ls -la'), null);
  const elsewhere = path.join(root, 'elsewhere'); fs.mkdirSync(elsewhere);
  assert.equal(bash('higgsfield generate create gpt_image_2 --prompt x', elsewhere), null);

  const mcp = name => hook({ tool_name: name, cwd: project, tool_input: {} });
  assert.match(mcp('mcp__higgsfield__generate_image').permissionDecisionReason, /Nobody has agreed/);
  assert.match(mcp('mcp__plugin_studio_higgsfield__create_video_job').permissionDecisionReason, /Nobody has agreed/);
  assert.equal(mcp('mcp__higgsfield__get_balance'), null);
  await media(project, 'consent', { decision: 'images-100' });
  assert.equal(mcp('mcp__higgsfield__generate_image'), null);
  assert.match(bash('higgsfield generate create gpt_image_2 --prompt x').permissionDecisionReason, /palate\.mjs media generate/, 'consent never licenses bypassing the wrapper');
  await media(project, 'record', { model: 'x', credits: 100, purpose: 'All of it' });
  assert.match(mcp('mcp__higgsfield__generate_image').permissionDecisionReason, /budget for this site is spent/);
  await media(project, 'consent', { decision: 'declined' });
  assert.match(mcp('mcp__higgsfield__generate_image').permissionDecisionReason, /declined/);
});

test('a new project carries media support in its pinned runtime', async t => {
  const { project } = await fixture(t);
  const result = spawnSync(process.execPath, [path.join(project, 'scripts/palate.mjs'), 'media', 'status'], { cwd: project, encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).entries, []);
});

test('a need picks the first model that exists, accepts the job and fits, and records every skip', async t => {
  const { project } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  const first = await media(project, 'generate', still('a', 'one'));
  assert.deepEqual([first.entry.need, first.entry.model, first.entry.skipped], ['still', 'gpt_image_2', []]);
  assert.deepEqual(first.entry.args.slice(0, 4), ['--quality', 'high', '--resolution', '2k']);
  process.env.FAKE_HF_MISSING = 'gpt_image_2';
  const second = await media(project, 'generate', still('a', 'two'));
  assert.equal(second.entry.model, 'gpt_image_2_5');
  assert.deepEqual(second.entry.skipped, [{ model: 'gpt_image_2', reason: 'not in the live Higgsfield catalogue' }]);
});

test('routing skips a model that lacks a required input or does not fit, and pins a chain to one model', async t => {
  const { project } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  await select(project);
  process.env.FAKE_HF_COSTS = JSON.stringify({ seedance_2_5: 250, seedance_2_0: 40, kling3_0: 7.5 });
  const leg = await media(project, 'generate', clip('leg-0'), 'leg-0');
  assert.equal(leg.entry.model, 'seedance_2_5');
  const fallback = await media(project, 'generate', clip('leg-1'), 'leg-1');
  assert.equal(fallback.entry.model, 'seedance_2_0');
  assert.match(fallback.entry.skipped[0].reason, /costs about 250 credits and 50 of the agreed 300 remain/);
  process.env.FAKE_HF_COSTS = JSON.stringify({ seedance_2_5: 10, seedance_2_0: 10, kling3_0: 7.5 });
  // leg-1 fell back to seedance_2_0; seedance_2_5 now fits, but the chain keeps the film on one model.
  const connector = await media(project, 'generate', { need: 'film-connector', args: ['--prompt', 'Rise and glide'], purpose: 'Seam', dest: 'src/media/conn-0.mp4', chain: fallback.entry.op });
  assert.deepEqual([connector.entry.model, connector.entry.args.slice(0, 6)], ['seedance_2_0', ['--mode', 'std', '--resolution', '1080p', '--generate_audio', 'false']]);
  process.env.FAKE_HF_MISSING = 'seedance_2_5,seedance_2_0';
  const error = await media(project, 'generate', { need: 'film-connector', args: ['--prompt', 'x'], purpose: 'Seam', dest: 'src/media/conn-1.mp4' }).catch(value => value);
  assert.equal(error.code, 'MEDIA_UNAVAILABLE');
  assert.match(error.message, /kling3_0: does not accept end_image/);
});

test('a quote routes and prices a need without spending', async t => {
  const { project, creates } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  await select(project);
  process.env.FAKE_HF_COSTS = JSON.stringify({ seedance_2_5: 60 });
  const quoted = await media(project, 'quote', { need: 'film-connector', args: ['--prompt', 'x', '--duration', '5'] });
  assert.deepEqual([quoted.model, quoted.estimate, quoted.spent, creates()], ['seedance_2_5', 60, 0, 0]);
});

test('a need takes only job flags, and a named model needs the reason the person asked for it', async t => {
  const { project } = await fixture(t);
  await media(project, 'consent', { decision: 'cap-300' });
  await assert.rejects(media(project, 'generate', still('a', 'one', { args: ['--prompt', 'x', '--resolution', '4k'] })), /belong to the model table/);
  await assert.rejects(media(project, 'generate', { ...still('a', 'one'), need: undefined, model: 'gpt_image_2', kind: 'image' }), /with the reason the person asked/);
  const named = await media(project, 'generate', { ...still('a', 'one'), need: undefined, model: 'nano_banana_pro', kind: 'image', reason: 'They asked for Nano Banana' });
  assert.deepEqual([named.entry.model, named.entry.override], ['nano_banana_pro', 'They asked for Nano Banana']);
});
