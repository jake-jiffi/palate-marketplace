import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCHEMA, RUNTIME_VERSION, MARKER, sha256, stable, json, fail, noSymlinks, confined, listFiles, atomicJson, resolveProject, readState, validateState, fingerprint, buildFingerprint, readStatus, acquireLock } from './project.mjs';
import { allowedArtefact, emptyTarget, stagingDirectory, activate, createCheckpoint, restoreCheckpoint, discardStaging } from './checkpoint.mjs';
import { detect, readBudget, summary, consent, quote, generate, record } from './media.mjs';
import { checkSystem } from './system.mjs';
import { seoCheck, factsCheck, tasteEvidence, probeRelease } from './gates.mjs';

const runtimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function options(args) {
  const parsed = { command: args.shift() || 'status' };
  if (parsed.command === '--help') return { command: 'help' };
  if (['checkpoint', 'media', 'system', 'seo', 'facts'].includes(parsed.command)) parsed.action = args.shift();
  while (args.length) {
    const flag = args.shift();
    if (!['--project', '--input', '--expect', '--op', '--id', '--into', '--check', '--help'].includes(flag)) fail(`Unknown argument: ${flag}`);
    const key = flag.slice(2);
    if (['check', 'help'].includes(key)) parsed[key] = true;
    else { if (!args.length || args[0].startsWith('--')) fail(`Missing value for ${flag}`); parsed[key] = args.shift(); }
  }
  return parsed;
}
function mutationIdentity(args, input) {
  if (!args.op || !/^[A-Za-z0-9._:-]{1,128}$/.test(args.op) || !/^\d+$/.test(args.expect || '')) fail('Mutations need --expect <revision> and --op <unique-operation-id>.', 'MISSING_REVISION');
  return sha256(stable({ command: args.command, action: args.action || null, input, expect: Number(args.expect), id: args.id || null, into: args.into ? path.resolve(args.into) : null }));
}
function replay(state, args, digest) {
  const operation = state.operations.find(item => item.id === args.op);
  if (operation) {
    if (operation.digest !== digest) fail('This operation ID was already used with different input.', 'OPERATION_CONFLICT');
    return operation.result;
  }
  if (state.revision !== Number(args.expect)) fail(`Revision conflict: expected ${args.expect}, current ${state.revision}. Read status and retry deliberately.`, 'REVISION_CONFLICT');
  return null;
}
function proof(project, value) {
  if (!value || typeof value.path !== 'string') fail('Evidence needs a project-relative path.');
  allowedArtefact(value.path);
  const digest = sha256(fs.readFileSync(confined(project, value.path)));
  if (value.sha256 && value.sha256 !== digest) fail(`Evidence hash mismatch: ${value.path}`);
  return { path: value.path, sha256: digest };
}
function safeProfile(input) {
  if (!input || !['service', 'portfolio', 'editorial', 'saas-marketing', 'commerce', 'hybrid', 'unknown'].includes(input.productKind) || typeof input.platform !== 'string' || !input.platform.trim()) fail('Source needs productKind and an observed platform, or platform "unknown".');
  const profile = { productKind: input.productKind, platform: input.platform };
  for (const key of ['facts', 'identity', 'assets', 'routes', 'journeys', 'integrations', 'unresolved', 'artefacts']) {
    if (input[key] !== undefined && !Array.isArray(input[key])) fail(`Source ${key} must be an array.`);
    profile[key] = input[key] || [];
  }
  for (const name of profile.artefacts) allowedArtefact(name);
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) { if (/^(?:password|secret|token|accessToken|apiKey|authorization|cookie)$/i.test(key)) fail('Credentials do not belong in the public project record.'); inspect(nested); }
  };
  inspect(profile);
  return profile;
}
/** Slugs of Palate references this project actually read, from the hook record; null where no hook ran (Codex). */
function recordedSlugs(project) {
  const folder = path.join(project, '.palate', 'events');
  if (!fs.existsSync(folder)) return null;
  let palate = false; const seen = new Set();
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.json')) continue;
    let event; try { event = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')); } catch { continue; }
    if (!String(event.tool || '').startsWith('mcp__palate__')) continue;
    palate = true;
    if (event.ok) for (const slug of event.slugs || []) seen.add(slug);
  }
  return palate ? seen : null;
}
/** A ready option is grounded in references it actually read, or says plainly why it is not. */
function groundOption(project, record, input) {
  if (!record.referenceDecisions.length) {
    const why = input.ungrounded ?? record.ungrounded;
    if (typeof why !== 'string' || !why.trim()) fail('A ready option needs at least one reference decision from a Palate reference you inspected, or "ungrounded" with the reason (for example the library was unreachable). An ungrounded option is labelled as one.', 'UNGROUNDED');
    record.ungrounded = why.trim();
    return;
  }
  delete record.ungrounded;
  const seen = recordedSlugs(project);
  if (!seen) return;
  const unread = record.referenceDecisions.map(d => d.slug).filter(slug => !seen.has(slug));
  if (unread.length) fail(`These reference decisions name references this project never read: ${unread.join(', ')}. Read them with the Palate tools first.`, 'UNGROUNDED');
}
function optionRecord(project, input, old) {
  if (!input || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id || '') || !['pending', 'ready', 'failed'].includes(input.status)) fail('Option needs a safe ID and pending, ready or failed status.');
  const record = { ...old, id: input.id, label: input.label ?? old?.label ?? input.id, status: input.status, rationale: input.rationale ?? old?.rationale ?? '', entry: input.entry ?? old?.entry ?? `src/directions/${input.id}/index.astro`, referenceDecisions: input.referenceDecisions ?? old?.referenceDecisions ?? [] };
  if (typeof record.label !== 'string' || typeof record.rationale !== 'string' || !Array.isArray(record.referenceDecisions)) fail('Option label/rationale must be text and referenceDecisions an array.');
  if (record.entry !== `src/directions/${record.id}/index.astro`) fail('An option entry must be src/directions/<id>/index.astro so the gallery can open it.');
  if (input.error !== undefined) record.error = String(input.error);
  if (input.previewUrl !== undefined) {
    let url; try { url = new URL(input.previewUrl); } catch { fail('Option previewUrl is invalid.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Option previewUrl needs a public HTTP(S) URL without credentials.');
    record.previewUrl = url.href;
  }
  if (input.thumbnail) record.thumbnail = proof(project, input.thumbnail);
  if (input.proofs) { if (!Array.isArray(input.proofs)) fail('Option proofs must be an array.'); record.proofs = input.proofs.map(value => proof(project, value)); }
  if (record.referenceDecisions.some(d => !d || typeof d !== 'object' || typeof d.slug !== 'string' || !d.slug.trim())) fail('Each reference decision needs the slug of a Palate reference that was actually inspected.');
  if (input.status === 'ready') {
    if (!fs.existsSync(confined(project, record.entry)) || !fs.statSync(confined(project, record.entry)).isFile() || !record.previewUrl) fail('A ready option needs its actual entry file and live preview URL.');
    groundOption(project, record, input);
    record.fingerprint = fingerprint(project, record.id); record.checkedAt = new Date().toISOString(); delete record.error;
  }
  return record;
}
export function validateRuntime(project) {
  const state = readState(project);
  const root = confined(project, '.palate/runtime');
  const manifest = json(path.join(root, 'digest.json'));
  if (manifest.schema !== SCHEMA || manifest.version !== state.runtime.version || !Array.isArray(manifest.files) || sha256(stable(manifest.files)) !== state.runtime.digest) fail('Pinned runtime identity does not match the project.', 'RUNTIME_MISMATCH');
  const actual = listFiles(root).filter(name => name !== 'digest.json');
  if (stable(actual.sort()) !== stable(manifest.files.map(file => file.path).sort())) fail('Pinned runtime file inventory changed.', 'RUNTIME_MISMATCH');
  for (const entry of manifest.files) if (sha256(fs.readFileSync(confined(root, entry.path))) !== entry.sha256) fail(`Pinned runtime changed: ${entry.path}`, 'RUNTIME_MISMATCH');
  return manifest;
}
function vendor(staging) {
  const destination = confined(staging, '.palate/runtime'); fs.mkdirSync(destination, { recursive: true });
  const isVendored = fs.existsSync(path.join(runtimeRoot, 'digest.json'));
  const template = isVendored ? path.join(runtimeRoot, 'template') : path.resolve(runtimeRoot, '../templates/live-astro-project');
  if (!fs.existsSync(template)) fail('The neutral live Astro starter is absent from this package.');
  const copies = isVendored ? listFiles(runtimeRoot).filter(name => name !== 'digest.json').map(name => [name, path.join(runtimeRoot, name)]) : [
    ['palate.mjs', path.join(runtimeRoot, 'palate.mjs')],
    ...listFiles(path.join(runtimeRoot, 'live'), 'live').map(name => [name, path.join(runtimeRoot, name)]),
    ...listFiles(template, 'template').map(name => [name, path.join(template, name.slice('template/'.length))]),
    ...['gate-seo.mjs', 'gate-facts.mjs', 'palate-index.mjs', 'lib/invoked-directly.mjs'].map(name => [`gates/${name}`, path.join(runtimeRoot, name)]),
    ['hooks/project-dir.mjs', path.resolve(runtimeRoot, '../hooks/project-dir.mjs')],
  ];
  for (const [name, source] of copies) { const output = confined(destination, name); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(noSymlinks(source), output); }
  const files = listFiles(destination).map(name => ({ path: name, sha256: sha256(fs.readFileSync(path.join(destination, name))) }));
  atomicJson(path.join(destination, 'digest.json'), { schema: SCHEMA, version: RUNTIME_VERSION, files });
  return { version: RUNTIME_VERSION, digest: sha256(stable(files)) };
}
// Validate bytes before importing code from the pinned runtime. The wrapper is part of source evidence.
const wrapper = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
try {
  for (const name of [project, path.join(project, 'palate.project.json'), path.join(project, '.palate'), path.join(project, '.palate/runtime'), path.join(project, '.palate/runtime/digest.json')]) if (fs.lstatSync(name).isSymbolicLink()) throw new Error('Symlinked runtime paths are unsupported.');
  const state = JSON.parse(fs.readFileSync(path.join(project, 'palate.project.json'), 'utf8'));
  const root = path.join(project, '.palate/runtime');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'digest.json'), 'utf8'));
  if (state.schema !== 1 || state.workflow !== 'live-design' || manifest.schema !== 1 || manifest.version !== state.runtime.version || hash(stable(manifest.files)) !== state.runtime.digest) throw new Error('Pinned runtime identity is invalid.');
  const scan = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Runtime symlinks are unsupported.');
    return entry.isDirectory() ? scan(path.join(directory, entry.name), name + '/') : [name];
  });
  if (JSON.stringify(scan(root).filter(name => name !== 'digest.json').sort()) !== JSON.stringify(manifest.files.map(file => file.path).sort())) throw new Error('Pinned runtime inventory changed.');
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\\\') || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe runtime path.');
    if (hash(fs.readFileSync(path.join(root, file.path))) !== file.sha256) throw new Error('Pinned runtime content changed: ' + file.path);
  }
  const { main } = await import('../.palate/runtime/live/cli.mjs');
  const args = process.argv.slice(2);
  if (!args.includes('--project') && args[0] !== 'init') args.push('--project', project);
  await main(args);
} catch (error) { process.stderr.write(JSON.stringify({ ok: false, code: 'RUNTIME_MISMATCH', message: error.message }) + '\\n'); process.exitCode = 1; }
`;
async function initialise(args, input, digest) {
  if (!args.project) fail('init needs an explicit empty --project directory.');
  if (fs.existsSync(path.join(runtimeRoot, 'digest.json'))) fail('Create new projects through the installed Palate package. This pinned runtime continues its existing project.', 'INSTALLED_PACKAGE_REQUIRED');
  const project = path.resolve(args.project);
  if (fs.existsSync(path.join(project, MARKER))) {
    resolveProject(project); const current = readState(project);
    const operation = current.operations.find(item => item.id === args.op);
    if (operation && operation.digest === digest) return operation.result;
    fail('Destination already contains a project.', 'DESTINATION_NOT_EMPTY');
  }
  const policyPath = path.resolve(runtimeRoot, '../live-policy.json');
  const policy = json(noSymlinks(policyPath));
  if (policy.schema !== 1 || policy.newProjects !== true) fail('This compatibility package pauses creation of new live-design projects. Existing projects remain supported.', 'NEW_PROJECTS_PAUSED');
  if (Number(args.expect) !== 0 || Object.keys(input).length) fail('init starts at expected revision 0 with a neutral starter and no profile input.');
  emptyTarget(project);
  const staging = stagingDirectory(project, 'init');
  try {
    const isVendored = fs.existsSync(path.join(runtimeRoot, 'digest.json'));
    const template = isVendored ? path.join(runtimeRoot, 'template') : path.resolve(runtimeRoot, '../templates/live-astro-project');
    for (const name of listFiles(noSymlinks(template))) { const output = confined(staging, name); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(path.join(template, name), output); }
    const runtime = vendor(staging);
    fs.mkdirSync(confined(staging, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(staging, 'scripts/palate.mjs'), wrapper, { flag: 'wx', mode: 0o755 });
    const state = { schema: SCHEMA, workflow: 'live-design', projectId: crypto.randomUUID(), runtime, revision: 1, stage: 'initialising', profile: null, directions: [], selection: null, verification: [], operations: [], createdAt: new Date().toISOString() };
    const result = { ok: true, project, projectId: state.projectId, revision: 1, stage: state.stage };
    state.operations.push({ id: args.op, digest, result }); validateState(state); atomicJson(path.join(staging, MARKER), state); validateRuntime(staging);
    activate(staging, project); return result;
  } catch (error) { error.message += ` Staging retained at ${staging}.`; throw error; }
}
// Scopes whose evidence is a command this runtime runs itself. A supplied review cannot stand in
// for them, and no other command can claim them: verification passed on `true` until this.
const PINNED = { check: ['npm', 'run', 'check'], build: ['npm', 'run', 'build'], system: ['node', 'scripts/palate.mjs', 'system', 'check'], seo: ['node', 'scripts/palate.mjs', 'seo', 'check'], facts: ['node', 'scripts/palate.mjs', 'facts', 'check'] };
/** The project's own check and build must really check and build; `astro check || true` checks nothing. */
function realScripts(project) {
  const scripts = json(confined(project, 'package.json')).scripts || {};
  for (const [name, tool] of [['check', 'astro check'], ['build', 'astro build']]) {
    const script = String(scripts[name] || '').trim();
    if (!script.startsWith(tool) || script.includes('||')) fail(`package.json "${name}" must run ${tool} (it is "${script}"); verification cannot pass on a ${name} that does nothing.`);
  }
}
/** Browser evidence is the journeys actually walked: named cases, each passed or failed. */
function browserCases(project, review) {
  let evidence; try { evidence = JSON.parse(fs.readFileSync(confined(project, review.path), 'utf8')); } catch { fail('Browser evidence must be JSON with the journeys that were walked.'); }
  const cases = Array.isArray(evidence?.cases) ? evidence.cases : [];
  if (!cases.length || cases.some(c => !c || typeof c.name !== 'string' || !c.name.trim() || !['passed', 'failed'].includes(c.result))) fail('Browser evidence needs "cases": each a named journey with result passed or failed.');
  const allPassed = cases.every(c => c.result === 'passed');
  if (review.result === 'passed' && !allPassed) fail('Browser evidence says passed, but a case in it failed.');
}
function runVerification(project, state, input) {
  if (!state.selection) fail('Select a direction before verifying the full site.');
  realScripts(project);
  if (!Array.isArray(input.commands) || !Array.isArray(input.reviews || []) || !Array.isArray(input.required || [])) fail('Verification needs commands, optional reviews and required scopes.');
  const required = [...new Set(['check', 'build', 'browser', 'system', 'seo', 'facts', 'taste', ...(input.required || [])])];
  const order = input.commands.map(command => command?.scope);
  for (const scope of ['seo', 'facts']) if (order.includes(scope) && order.indexOf(scope) < order.indexOf('build')) fail(`Run ${scope} after build: it reads the built site.`);
  const before = fingerprint(project);
  const checks = [];
  for (const command of input.commands) {
    if (!command.scope || !Array.isArray(command.argv) || !command.argv.length || command.argv.some(value => typeof value !== 'string')) fail('Each executed check needs scope and an argv string array.');
    if (PINNED[command.scope] && stable(command.argv) !== stable(PINNED[command.scope])) fail(`The ${command.scope} scope must execute ${PINNED[command.scope].join(' ')}; arbitrary commands cannot claim that scope.`);
    if (command.scope === 'browser') fail('The browser scope is the journeys actually walked, supplied as a review with cases, not a command.');
    const result = spawnSync(command.argv[0], command.argv.slice(1), { cwd: project, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000, shell: false });
    const report = `.palate/verification/${crypto.randomUUID()}.json`; fs.mkdirSync(path.dirname(confined(project, report)), { recursive: true });
    atomicJson(confined(project, report), { argv: command.argv, status: result.status, signal: result.signal, error: result.error?.message || null, stdout: result.stdout || '', stderr: result.stderr || '' });
    checks.push({ scope: command.scope, kind: 'executed-command', result: result.status === 0 && !result.error ? 'passed' : 'failed', ...proof(project, { path: report }) });
  }
  for (const review of input.reviews || []) {
    if (!review.scope || !['passed', 'failed'].includes(review.result)) fail('A supplied review needs scope and passed/failed result.');
    if (PINNED[review.scope]) fail(`The ${review.scope} scope cannot be a supplied review; run ${PINNED[review.scope].join(' ')}.`);
    if (review.scope === 'browser') browserCases(project, review);
    const taste = review.scope === 'taste' ? tasteEvidence(project, review) : {};
    checks.push({ scope: review.scope, kind: 'supplied-review', result: review.result, ...taste, ...proof(project, review) });
  }
  const source = fingerprint(project), build = buildFingerprint(project);
  const status = readStatus(project);
  const passed = before === source && build && status.validity.selectionCurrent && Object.keys(PINNED).every(scope => checks.some(check => check.scope === scope && check.kind === 'executed-command' && check.result === 'passed')) && required.every(scope => checks.some(check => check.scope === scope && check.result === 'passed')) && checks.every(check => check.result === 'passed');
  return { id: crypto.randomUUID(), at: new Date().toISOString(), decisionId: state.selection.decisionId, scope: input.scope || 'full-site', required, checks, sourceFingerprint: source, buildFingerprint: build, result: passed ? 'passed' : 'failed', sourceChangedDuringChecks: before !== source };
}
async function media(args, input) {
  if (args.action === 'detect') {
    let project = null; try { project = resolveProject(args.project); } catch {}
    return detect(project);
  }
  const project = resolveProject(args.project);
  if (args.action === 'status') return { ok: true, ...summary(readBudget(project)) };
  if (args.action === 'consent') return consent(project, input, args.op);
  if (args.action === 'quote') return quote(project, input);
  if (args.action === 'generate') return generate(project, input, args.op);
  if (args.action === 'record') return record(project, input, args.op);
  fail('Use media detect, status, consent, quote, generate or record.');
}
export async function execute(args) {
  const input = args.input ? json(noSymlinks(path.resolve(args.input))) : {};
  if (args.command === 'media') return media(args, input);
  if (args.command === 'system') { if (args.action !== 'check') fail('Use system check.'); return checkSystem(resolveProject(args.project)); }
  if (args.command === 'seo') { if (args.action !== 'check') fail('Use seo check.'); return seoCheck(resolveProject(args.project)); }
  if (args.command === 'facts') { if (args.action !== 'check') fail('Use facts check.'); return factsCheck(resolveProject(args.project)); }
  if (args.command === 'status') return { ok: true, ...readStatus(resolveProject(args.project)) };
  if (args.command === 'verify' && args.check) {
    const status = readStatus(resolveProject(args.project));
    if (!status.validity.verificationCurrent) fail('No current passing verification for the selected source and build.', 'NOT_VERIFIED');
    return { ok: true, verified: true, revision: status.state.revision, validity: status.validity };
  }
  if (!['init', 'source', 'option', 'select', 'verify', 'checkpoint', 'release'].includes(args.command)) fail(`Unknown operation: ${args.command}`);
  const digest = mutationIdentity(args, input);
  if (args.command === 'init') return initialise(args, input, digest);
  const project = resolveProject(args.project);
  readState(project); // Unknown schemas never create even a lock artefact.
  const receipt = args.command === 'release' ? await probeRelease(input) : null;
  const release = await acquireLock(project);
  try {
    const state = readState(project);
    if (args.command === 'checkpoint' && args.action === 'restore' && args.into && fs.existsSync(path.join(path.resolve(args.into), MARKER))) {
      const restored = readState(resolveProject(path.resolve(args.into)));
      const operation = restored.operations.find(item => item.id === args.op);
      if (operation && operation.digest === digest && restored.parentCheckpoint?.id === args.id) return operation.result;
      fail('Restore destination is already occupied.', 'DESTINATION_NOT_EMPTY');
    }
    const oldResult = replay(state, args, digest); if (oldResult) return oldResult;
    let details = {};
    if (args.command === 'source') {
      state.profile = safeProfile(input);
      for (const name of state.profile.artefacts) proof(project, { path: name });
      state.stage = state.selection ? 'building' : 'designing'; state.verification = [];
    } else if (args.command === 'option') {
      const index = state.directions.findIndex(direction => direction.id === input.id);
      const record = optionRecord(project, input, state.directions[index]);
      if (index < 0) state.directions.push(record); else state.directions[index] = record;
      if (!state.selection) state.stage = 'designing'; details.option = record;
    } else if (args.command === 'select') {
      const chosen = state.directions.find(direction => direction.id === input.optionId);
      const status = readStatus(project);
      if (!chosen || !status.validity.directions.find(direction => direction.id === chosen.id)?.current) fail('The chosen option is absent, pending, failed or changed. Open it, then refresh its ready record.', 'STALE_OPTION');
      const donors = input.combine || [];
      if (!Array.isArray(donors) || donors.some(id => !status.validity.directions.find(direction => direction.id === id)?.current)) fail('Combined directions must all have current ready evidence.', 'STALE_OPTION');
      if (donors.length && (typeof input.instructions !== 'string' || !input.instructions.trim())) fail('Combining directions needs explicit composition instructions.');
      if (state.selection) details.checkpoint = createCheckpoint(project, state);
      const parent = state.selection?.decisionId || null;
      state.selection = { optionId: chosen.id, fingerprint: chosen.fingerprint, decisionId: crypto.randomUUID(), parentDecision: parent, combine: donors.map(id => ({ optionId: id, fingerprint: state.directions.find(direction => direction.id === id).fingerprint })), instructions: input.instructions || '', selectedAt: new Date().toISOString() };
      state.stage = parent || donors.length ? 'building' : 'selected'; state.verification = []; details.selection = state.selection;
    } else if (args.command === 'verify') {
      const verification = runVerification(project, state, input); state.verification.push(verification); state.stage = verification.result === 'passed' ? 'verified' : 'building'; details.verification = verification;
    } else if (args.command === 'release') {
      const status = readStatus(project);
      if (!status.validity.verificationCurrent) fail('Release needs a current passing verification of the selected source and build. Run verify, then deploy that build.', 'NOT_VERIFIED');
      const verification = [...state.verification].reverse().find(record => record.result === 'passed' && record.sourceFingerprint === status.validity.sourceFingerprint && record.buildFingerprint === status.validity.buildFingerprint);
      state.release = { ...receipt, at: new Date().toISOString(), decisionId: state.selection.decisionId, verificationId: verification.id, sourceFingerprint: status.validity.sourceFingerprint, buildFingerprint: status.validity.buildFingerprint };
      state.stage = 'released'; details.release = state.release;
    } else if (args.action === 'create') details.checkpoint = createCheckpoint(project, state);
    else if (args.action === 'restore') {
      if (!args.into) fail('checkpoint restore needs --into <empty directory>.');
      return restoreCheckpoint(project, args.id, args.into, { operationId: args.op, digest, sourceRevision: state.revision, sourceStage: state.stage }, validateRuntime);
    } else if (args.action === 'discard-staging') {
      if (!args.into) fail('checkpoint discard-staging needs --into <owned abandoned staging directory>.');
      details = discardStaging(args.into);
    } else fail('Use checkpoint create, checkpoint restore or checkpoint discard-staging.');
    state.revision += 1;
    const result = { ok: true, project, revision: state.revision, stage: state.stage, ...details };
    state.operations.push({ id: args.op, digest, result }); validateState(state); atomicJson(path.join(project, MARKER), state);
    return result;
  } finally { release(); }
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = options([...argv]);
    if (args.help || args.command === 'help') { process.stdout.write(`Palate live design
New empty project: node scripts/palate.mjs init --project /absolute/new-site --expect 0 --op init-1
Project operations: node scripts/palate.mjs COMMAND --input /path/input.json --expect CURRENT_REVISION --op UNIQUE_ID
Read state/revision: node scripts/palate.mjs status

source input (facts are public, observed source details; keep unknowns explicit):
{"productKind":"service","platform":"wordpress","facts":[],"identity":[],"assets":[],"routes":["/"],"journeys":["enquiry"],"integrations":[],"unresolved":[],"artefacts":[]}
productKind: service, portfolio, editorial, saas-marketing, commerce, hybrid or unknown. Shopify uses platform "shopify" with observed evidence.

option input (pending and failed work may be registered before a file exists):
{"id":"a","label":"Coastal architecture","status":"ready","entry":"src/directions/a/index.astro","rationale":"Source-specific composition and interaction decisions","previewUrl":"http://127.0.0.1:4321/_palate/directions/a","referenceDecisions":[{"slug":"linear","observed":"Sticky product stage","uses":"Pinned hero that changes as the visitor scrolls"}]}
Optional thumbnail/proofs: {"path":".palate/previews/a.png","sha256":"optional-verified-hash"}. Reference decisions describe actual inspected evidence, never invented calls.
A ready option needs at least one reference decision whose slug this project actually read (checked against the hook record where one exists), or "ungrounded":"<reason>" when the library could not be reached. An ungrounded option is labelled as one.
Ready registration records current source bytes after reopening the option. Refresh it after shared/full-site edits before verification. Isolated sibling directions do not stale each other.

select input: {"optionId":"a"}
Combine: {"optionId":"a","combine":["b"],"instructions":"Explicit chosen mechanisms"}. Recompose and reopen the chosen direction before verification.

verify input (after npm run build; seo and facts read the built site, so they come after build):
{"commands":[{"scope":"check","argv":["npm","run","check"]},{"scope":"build","argv":["npm","run","build"]},{"scope":"system","argv":["node","scripts/palate.mjs","system","check"]},{"scope":"seo","argv":["node","scripts/palate.mjs","seo","check"]},{"scope":"facts","argv":["node","scripts/palate.mjs","facts","check"]}],"reviews":[{"scope":"browser","path":".palate/evidence/browser.json","result":"passed"},{"scope":"taste","path":".palate/grade/local-grade.json","result":"passed"}]}
check, build, system, seo, facts, browser and taste are always required. The five commands are only ever the ones above, and package.json must run astro check and astro build.
Browser evidence is a JSON file with "cases": [{"name":"enquiry journey","result":"passed"}], one per journey walked.
Facts evidence is .palate/evidence/facts.json: {"claims":[{"page":"/about/","quote":"verbatim from the page","source":"client URL or profile fact","verdict":"supported"}]}. Every claim must be supported by the client's own source; gate-facts disagreements are fixed or explained under "disagreements".
Taste evidence is local-grade.json from grade-local.mjs: passed only when its ladder reads comparable or better with no flattery risk. A ladder that could not run is recorded with "unjudged":"<reason>".
node scripts/palate.mjs system check    type and colour from src/styles/system.css only, after a direction is chosen (references/site-system.md)
node scripts/palate.mjs seo check       gate-seo over dist: sitemap, robots, canonicals, structured data, llms.txt
node scripts/palate.mjs facts check     gate-facts over dist, plus the claims in .palate/evidence/facts.json
node scripts/palate.mjs verify --check is read-only and refuses stale source/build evidence.
release input, after deploying the verified build: {"url":"https://example.com/","host":"vercel","production":true}
node scripts/palate.mjs release --input FILE --expect REV --op ID   needs current verification; checks the URL answers

node scripts/palate.mjs checkpoint create --expect REV --op ID
node scripts/palate.mjs checkpoint restore --id HASH --into /absolute/empty-target --expect REV --op ID
Restore preserves the original project and records its receipt in the new target. The restored preview and build need fresh verification.
node scripts/palate.mjs checkpoint discard-staging --into /absolute/owned-staging --expect REV --op ID
Only staging whose recorded process identity is proven gone can be removed.

Optional generated media (Higgsfield), see references/generated-media.md:
node scripts/palate.mjs media detect            read-only; reports nothing to the person when unavailable
node scripts/palate.mjs media consent --input FILE --op ID    {"decision":"cap-300"}: cap-300, cap-800, images-100 or declined
node scripts/palate.mjs media quote --input FILE              free: which model a need routes to, and its price
node scripts/palate.mjs media generate --input FILE --op ID
  {"need":"still","args":["--prompt","...","--aspect_ratio","16:9"],"purpose":"Opening scene","direction":"a","dest":"src/directions/a/media/opening.png"}
  Needs and their models: scripts/live/media-models.json. Later film legs add "chain":"<first leg op>".
node scripts/palate.mjs media record --input FILE --op ID      {"model":"...","credits":15,"purpose":"...","file":"src/..."}
node scripts/palate.mjs media status
`); return; }
    const result = await execute(args); process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.verification?.result === 'failed' || result.ok === false) process.exitCode = 1;
  } catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'ERROR', message: error.message })}\n`); process.exitCode = 1; }
}
