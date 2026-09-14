import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { execute } from '../live/cli.mjs';
import { readState, readStatus, fingerprint, listFiles, sha256 } from '../live/project.mjs';

const cli = fileURLToPath(new URL('../palate.mjs', import.meta.url));
const projectModule = new URL('../live/project.mjs', import.meta.url).href;
const cliModule = new URL('../live/cli.mjs', import.meta.url).href;
const base = fs.realpathSync(os.tmpdir());
function setup(t) {
  const root = fs.mkdtempSync(path.join(base, 'palate-live-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project: path.join(root, 'site') };
}
function write(project, name, value) { const output = path.join(project, name); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, typeof value === 'string' ? value : JSON.stringify(value)); return output; }
async function mutate(project, command, input = {}, extra = {}) {
  const inputFile = path.join(path.dirname(project), `input-${crypto.randomUUID()}.json`); fs.writeFileSync(inputFile, JSON.stringify(input));
  return execute({ command, project, input: inputFile, expect: String(readState(project).revision), op: crypto.randomUUID(), ...extra });
}
async function initial(t) { const fixture = setup(t); await execute({ command: 'init', project: fixture.project, expect: '0', op: 'initial' }); return fixture; }
async function source(project) { return mutate(project, 'source', { productKind: 'service', platform: 'wordpress', facts: ['Source business'], routes: ['/'], journeys: ['enquiry'] }); }
async function ready(project, id = 'a') {
  write(project, `src/directions/${id}/index.astro`, `<h1>${id}</h1>`);
  return mutate(project, 'option', { id, status: 'ready', label: id, previewUrl: `http://127.0.0.1:4321/_palate/directions/${id}` });
}
function child(args) {
  return new Promise(resolve => { const proc = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; proc.stdout.on('data', data => stdout += data); proc.stderr.on('data', data => stderr += data); proc.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr })); });
}
test('neutral creation is empty-target only and the pinned wrapper works without a host', async t => {
  const { root, project } = await initial(t);
  const state = readState(project); assert.equal(state.profile, null); assert.equal(state.stage, 'initialising'); assert.deepEqual(state.directions, []);
  const result = spawnSync(process.execPath, [path.join(project, 'scripts/palate.mjs'), 'status'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).state.projectId, state.projectId);
  assert.equal((await execute({ command: 'init', project, expect: '0', op: 'initial' })).projectId, state.projectId);
  const occupied = path.join(root, 'occupied'); write(occupied, 'AGENTS.md', 'Keep me');
  await assert.rejects(execute({ command: 'init', project: occupied, expect: '0', op: 'other' }), /empty/); assert.equal(fs.readFileSync(path.join(occupied, 'AGENTS.md'), 'utf8'), 'Keep me');
  fs.appendFileSync(path.join(project, '.palate/runtime/live/project.mjs'), '\n// altered');
  const changed = spawnSync(process.execPath, [path.join(project, 'scripts/palate.mjs'), 'status'], { encoding: 'utf8' }); assert.equal(changed.status, 1); assert.match(changed.stderr, /runtime content changed/i);
});
test('operation replay is stable and conflicting payload or revision preserves state bytes', async t => {
  const { project, root } = await initial(t);
  const input = write(root, 'source.json', { productKind: 'service', platform: 'wordpress' });
  const args = { command: 'source', project, input, expect: '1', op: 'source-1' };
  const first = await execute(args), bytes = fs.readFileSync(path.join(project, 'palate.project.json'));
  assert.deepEqual(await execute(args), first);
  write(root, 'source.json', { productKind: 'portfolio', platform: 'wordpress' }); await assert.rejects(execute(args), /different input/);
  await assert.rejects(execute({ ...args, op: 'stale' }), /Revision conflict/); assert.deepEqual(fs.readFileSync(path.join(project, 'palate.project.json')), bytes);
});
test('isolated directions keep evidence while shared and source-profile changes invalidate it', async t => {
  const { project } = await initial(t); await source(project); await ready(project);
  const first = fingerprint(project, 'a'); await ready(project, 'b'); assert.equal(fingerprint(project, 'a'), first); assert.equal(readStatus(project).validity.directions[0].current, true);
  await mutate(project, 'select', { optionId: 'a' });
  write(project, 'src/shared.css', 'body{color:navy}'); assert.equal(readStatus(project).validity.selectionCurrent, false);
  await assert.rejects(mutate(project, 'select', { optionId: 'a' }), /changed/);
  await ready(project); assert.equal(readStatus(project).validity.selectionCurrent, true);
  await mutate(project, 'source', { productKind: 'service', platform: 'unknown', facts: ['New facts'] }); assert.equal(readStatus(project).validity.selectionCurrent, false);
});
test('intake provenance and option proposals survive late brand updates and a fresh restored wrapper', async t => {
  const { project, root } = await initial(t);
  const wrapperStatus = target => {
    const result = spawnSync(process.execPath, [path.join(target, 'scripts/palate.mjs'), 'status'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const empty = { productKind: 'unknown', platform: 'unknown', facts: [], identity: [], assets: [], routes: [], journeys: [], integrations: [], unresolved: [], artefacts: [] };
  await mutate(project, 'source', empty); assert.deepEqual(wrapperStatus(project).state.profile, empty);
  write(project, '.palate/evidence/intake.json', { origin: 'supplied guide', inspected: true });
  const profile = {
    ...empty, productKind: 'service',
    facts: ['Legacy text remains valid', { status: 'supplied', value: 'Acoustic panels for studios', basis: { file: 'guide.pdf', page: 1 } }],
    identity: [{ status: 'supplied', value: { colour: '#003C46' }, basis: 'guide.pdf page 2' }, { status: 'supplied', value: 'Keep the logo proportions', basis: 'guide.pdf page 3' }],
    assets: [{ status: 'supplied', value: 'logo.svg', basis: { visibility: 'public', source: 'client attachment' } }],
    routes: [{ status: 'proposed', value: '/', basis: 'one-page studio brief' }],
    journeys: [{ status: 'supplied', value: 'Explore panels and enquire', basis: 'user brief' }],
    integrations: [{ status: 'unknown', value: 'Enquiry delivery', basis: 'no backend supplied' }],
    unresolved: [{ status: 'unknown', value: 'Font licence availability', basis: 'guide omits licence details' }],
    artefacts: ['.palate/evidence/intake.json'],
  };
  await mutate(project, 'source', profile);
  const proposals = { a: 'Proposed identity: editorial serif and sliding panel composition.', b: 'Proposed identity: geometric sans and spatial tile composition.' };
  for (const id of ['a', 'b']) {
    write(project, `src/directions/${id}/index.astro`, `<h1>Studio ${id}</h1>`);
    await mutate(project, 'option', { id, status: 'ready', rationale: proposals[id], previewUrl: `http://127.0.0.1:4321/_palate/directions/${id}` });
    assert.equal(readStatus(project).validity.directions.find(direction => direction.id === 'a').current, true);
    assert.deepEqual(readState(project).profile, profile);
  }
  await mutate(project, 'select', { optionId: 'a' });
  const selected = wrapperStatus(project), choice = selected.state.selection;
  assert.equal(choice.optionId, 'a'); assert.equal(selected.validity.selectionCurrent, true);
  const newColour = { status: 'supplied', value: { colour: '#174C3C' }, basis: 'later explicit user instruction, supersedes guide.pdf page 2' };
  const chosenProposal = { status: 'proposed', value: 'Editorial serif', basis: 'selected option a' };
  const merged = { ...selected.state.profile, identity: [newColour, ...selected.state.profile.identity.slice(1), chosenProposal] };
  await mutate(project, 'source', merged);
  const expected = { ...profile, identity: [newColour, profile.identity[1], chosenProposal] };
  const stale = wrapperStatus(project);
  assert.deepEqual(stale.state.profile, expected); assert.deepEqual(stale.state.selection, choice);
  assert.equal(stale.validity.selectionCurrent, false); assert.ok(stale.validity.directions.every(direction => !direction.current));
  await mutate(project, 'option', { id: 'a', status: 'ready' });
  const refreshed = wrapperStatus(project);
  assert.equal(refreshed.validity.selectionCurrent, true);
  assert.equal(refreshed.validity.directions.find(direction => direction.id === 'b').current, false);
  assert.deepEqual(refreshed.state.selection, choice); assert.deepEqual(refreshed.state.profile, expected);
  assert.deepEqual(Object.fromEntries(refreshed.state.directions.map(direction => [direction.id, direction.rationale])), proposals);
  const checkpoint = await mutate(project, 'checkpoint', {}, { action: 'create' });
  const into = path.join(root, 'restored-intake');
  await execute({ command: 'checkpoint', action: 'restore', project, id: checkpoint.checkpoint.id, into, expect: String(readState(project).revision), op: 'restore-intake' });
  const restored = wrapperStatus(into);
  assert.deepEqual(restored.state.profile, expected); assert.deepEqual(restored.state.selection, choice);
  assert.deepEqual(Object.fromEntries(restored.state.directions.map(direction => [direction.id, direction.rationale])), proposals);
  assert.equal(restored.validity.selectionCurrent, false);
  assert.ok(restored.state.directions.every(direction => direction.status === 'pending' && !direction.previewUrl));
  assert.ok(restored.validity.directions.every(direction => !direction.current));
  const marker = path.join(into, 'palate.project.json'), before = fs.readFileSync(marker);
  const unsafe = write(root, 'unsafe-intake.json', { ...restored.state.profile, integrations: [...restored.state.profile.integrations, { basis: { attachment: [{ accessToken: 'synthetic-test-value' }] } }] });
  const rejected = spawnSync(process.execPath, [path.join(into, 'scripts/palate.mjs'), 'source', '--input', unsafe, '--expect', String(restored.state.revision), '--op', 'unsafe-intake'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Credentials do not belong/);
  assert.deepEqual(fs.readFileSync(marker), before); assert.deepEqual(wrapperStatus(into).state, restored.state);
});
test('two native processes cannot both select at the same revision', async t => {
  const { project, root } = await initial(t); await source(project); await ready(project); await ready(project, 'b');
  const revision = String(readState(project).revision), a = write(root, 'a.json', { optionId: 'a' }), b = write(root, 'b.json', { optionId: 'b' });
  const results = await Promise.all([a, b].map((input, index) => child([cli, 'select', '--project', project, '--input', input, '--expect', revision, '--op', `select-${index}`])));
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1]); assert.equal(readState(project).revision, Number(revision) + 1); assert.match(results.find(result => result.code === 1).stderr, /REVISION_CONFLICT/);
});
test('a killed writer leaves valid old state and its proven-dead claim can be recovered', async t => {
  const { project, root } = await initial(t); const before = fs.readFileSync(path.join(project, 'palate.project.json'));
  const input = write(root, 'source.json', { productKind: 'service', platform: 'wordpress' });
  const script = `import fs from 'node:fs'; import {execute} from ${JSON.stringify(cliModule)}; const rename=fs.renameSync; fs.renameSync=(a,b)=>{if(b===${JSON.stringify(path.join(project, 'palate.project.json'))}) process.kill(process.pid,'SIGKILL'); return rename(a,b)}; await execute(${JSON.stringify({ command: 'source', project, input, expect: '1', op: 'crash' })});`;
  const killed = await child(['--input-type=module', '-e', script]); assert.equal(killed.signal, 'SIGKILL'); assert.deepEqual(fs.readFileSync(path.join(project, 'palate.project.json')), before);
  await source(project); assert.equal(readState(project).revision, 2); assert.equal(fs.readdirSync(path.join(project, '.palate/locks')).filter(name => /^\d+\.json$/.test(name)).length, 2);
});
test('an active lock cannot be stolen even when the wait expires', async t => {
  const { project } = await initial(t);
  const proc = spawn(process.execPath, ['--input-type=module', '-e', `import {acquireLock} from ${JSON.stringify(projectModule)}; await acquireLock(${JSON.stringify(project)}); process.stdout.write('ready'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill('SIGKILL'));
  await new Promise((resolve, reject) => { proc.stdout.once('data', resolve); proc.once('error', reject); });
  const { acquireLock } = await import(projectModule); await assert.rejects(acquireLock(project, 60), /live process/); assert.equal(readState(project).revision, 1);
});
test('unknown, corrupt, nested and symlinked projects refuse mutation before side effects', async t => {
  const { project, root } = await initial(t); const marker = path.join(project, 'palate.project.json'), original = fs.readFileSync(marker);
  const state = readState(project); state.schema = 999; fs.writeFileSync(marker, JSON.stringify(state));
  const before = listFiles(project); await assert.rejects(execute({ command: 'source', project, expect: '1', op: 'bad' }), /Unsupported/); assert.deepEqual(listFiles(project), before);
  fs.writeFileSync(marker, '{'); await assert.rejects(execute({ command: 'status', project }), /valid JSON/); fs.writeFileSync(marker, original);
  write(project, 'palate.manifest.json', '{}'); await assert.rejects(execute({ command: 'status', project }), /Both legacy/); fs.unlinkSync(path.join(project, 'palate.manifest.json'));
  for (const marker of ['.palate-skill-state.json', 'build-manifest.json']) { write(project, marker, '{}'); await assert.rejects(execute({ command: 'status', project }), /Both legacy/); fs.unlinkSync(path.join(project, marker)); }
  await assert.rejects(execute({ command: 'init', project: path.join(project, 'nested'), expect: '0', op: 'nested' }), /inside another/);
  fs.symlinkSync(project, path.join(root, 'alias')); await assert.rejects(execute({ command: 'status', project: path.join(root, 'alias') }), /Symlinked/);
  fs.symlinkSync(path.join(root, 'outside'), path.join(project, 'src', 'escape')); await assert.rejects(execute({ command: 'status', project }), /Symlinked/);
});
test('verification distinguishes executed commands from reviews and expires after source or build edits', async t => {
  const { project } = await initial(t); await source(project); await ready(project); await mutate(project, 'select', { optionId: 'a' });
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json')));
  pkg.scripts.check = 'node -e "process.exit(0)"'; pkg.scripts.build = `node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','built')"`;
  write(project, 'package.json', pkg); await ready(project);
  write(project, '.palate/evidence/browser.json', { cases: [{ name: 'enquiry journey', result: 'passed' }] });
  const input = { commands: [{ scope: 'check', argv: ['npm', 'run', 'check'] }, { scope: 'build', argv: ['npm', 'run', 'build'] }], reviews: [{ scope: 'browser', path: '.palate/evidence/browser.json', result: 'passed' }] };
  const verification = await mutate(project, 'verify', input); assert.equal(verification.verification.result, 'passed'); assert.deepEqual(verification.verification.checks.map(check => check.kind), ['executed-command', 'executed-command', 'supplied-review']);
  assert.equal((await execute({ command: 'verify', project, check: true })).verified, true);
  write(project, '.palate/evidence/browser.json', { changed: true }); await assert.rejects(execute({ command: 'verify', project, check: true }), /No current/); await mutate(project, 'verify', input);
  write(project, 'dist/index.html', 'different build'); await assert.rejects(execute({ command: 'verify', project, check: true }), /No current/);
  await mutate(project, 'verify', input); write(project, 'src/new.astro', '<p>new</p>'); await assert.rejects(execute({ command: 'verify', project, check: true }), /No current/);
  const claimed = await mutate(project, 'verify', { commands: [], reviews: [{ scope: 'check', path: '.palate/evidence/browser.json', result: 'passed' }, { scope: 'build', path: '.palate/evidence/browser.json', result: 'passed' }] }); assert.equal(claimed.verification.result, 'failed');
});
test('checkpoint restore preserves the original, excludes private data and carries a working runtime', async t => {
  const { project, root } = await initial(t); await source(project); await ready(project); await mutate(project, 'select', { optionId: 'a' });
  write(project, '.env.local', 'PRIVATE_EXCLUDED_VALUE'); write(project, '.palate/submissions/one.json', 'private enquiry'); write(project, 'src/pages/cart/index.astro', '<p>cart code is source</p>'); await ready(project);
  const checkpoint = await mutate(project, 'checkpoint', {}, { action: 'create' });
  const before = fs.readFileSync(path.join(project, 'palate.project.json')), files = listFiles(project).filter(name => !name.startsWith('.palate/locks/')).map(name => [name, sha256(fs.readFileSync(path.join(project, name)))]);
  const into = path.join(root, 'restored'), args = { command: 'checkpoint', action: 'restore', project, id: checkpoint.checkpoint.id, into, expect: String(readState(project).revision), op: 'restore-one' };
  const restored = await execute(args); assert.deepEqual(await execute(args), restored); assert.deepEqual(fs.readFileSync(path.join(project, 'palate.project.json')), before);
  assert.deepEqual(listFiles(project).filter(name => !name.startsWith('.palate/locks/')).map(name => [name, sha256(fs.readFileSync(path.join(project, name)))]), files);
  assert.equal(fs.existsSync(path.join(into, '.env.local')), false); assert.equal(fs.existsSync(path.join(into, '.palate/submissions/one.json')), false); assert.equal(fs.existsSync(path.join(into, 'src/pages/cart/index.astro')), true);
  assert.notEqual(readState(into).projectId, readState(project).projectId); assert.equal(readState(into).selection.decisionId, readState(project).selection.decisionId); assert.deepEqual(readState(into).verification, []);
  const wrapper = spawnSync(process.execPath, [path.join(into, 'scripts/palate.mjs'), 'status'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' }); assert.equal(wrapper.status, 0, wrapper.stderr); assert.equal(JSON.parse(wrapper.stdout).validity.verificationCurrent, false);
  const archive = path.join(project, checkpoint.checkpoint.path), value = JSON.parse(fs.readFileSync(archive)); value.files[0].path = '../outside'; fs.writeFileSync(archive, JSON.stringify(value));
  await assert.rejects(execute({ ...args, into: path.join(root, 'unsafe'), op: 'restore-bad' }), /Unsafe/); assert.equal(fs.existsSync(path.join(root, 'unsafe')), false);
});
test('changed selection checkpoints first and stale worker registration cannot replace it', async t => {
  const { project } = await initial(t); await source(project); await ready(project); await ready(project, 'b'); await mutate(project, 'select', { optionId: 'a' });
  const oldDecision = readState(project).selection.decisionId, oldRevision = String(readState(project).revision);
  const changed = await mutate(project, 'select', { optionId: 'b' }); assert.equal(changed.stage, 'building'); assert.ok(changed.checkpoint.id); assert.equal(changed.selection.parentDecision, oldDecision);
  await assert.rejects(mutate(project, 'option', { id: 'a', status: 'ready' }, { expect: oldRevision }), /Revision conflict/); assert.equal(readState(project).selection.optionId, 'b');
});
test('restore interruption retains owned staging and the original is unchanged', async t => {
  const { project, root } = await initial(t); await source(project); await ready(project);
  const checkpoint = await mutate(project, 'checkpoint', {}, { action: 'create' });
  for (const afterState of [false, true]) {
    const before = fs.readFileSync(path.join(project, 'palate.project.json'));
    const into = path.join(root, afterState ? 'crash-after-state' : 'crash-before-state');
    const args = { command: 'checkpoint', action: 'restore', project, id: checkpoint.checkpoint.id, into, expect: String(readState(project).revision), op: `restore-crash-${afterState}` };
    const script = `import fs from 'node:fs'; import path from 'node:path'; import {execute} from ${JSON.stringify(cliModule)}; const write=fs.writeFileSync; fs.writeFileSync=(file,...rest)=>{ const target=typeof file==='string' && path.basename(file)==='palate.project.json' && file.includes(${JSON.stringify(`.${path.basename(into)}-restore-`)}); if(target && !${afterState}) process.kill(process.pid,'SIGKILL'); const result=write(file,...rest); if(target && ${afterState}) process.kill(process.pid,'SIGKILL'); return result; }; await execute(${JSON.stringify(args)});`;
    const result = await child(['--input-type=module', '-e', script]); assert.equal(result.signal, 'SIGKILL'); assert.equal(fs.existsSync(into), false); assert.deepEqual(fs.readFileSync(path.join(project, 'palate.project.json')), before);
    const stagingName = fs.readdirSync(root).find(name => name.startsWith(`.${path.basename(into)}-restore-`)); assert.ok(stagingName);
    await mutate(project, 'checkpoint', {}, { action: 'discard-staging', into: path.join(root, stagingName) }); assert.equal(fs.existsSync(path.join(root, stagingName)), false);
    // The explicit cleanup records a normal operation; the interrupted restore itself did not.
    if (!afterState) { const restored = await execute({ ...args, into: path.join(root, 'recovered'), expect: String(readState(project).revision), op: 'restore-recovered' }); assert.ok(restored.restored.projectId); }
  }
});
test('compatibility policy refuses new creation without touching the target, while existing projects still run', async t => {
  const { root, project } = await initial(t);
  const packageRoot = path.join(root, 'rollback-package');
  fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
  fs.cpSync(fileURLToPath(new URL('../live', import.meta.url)), path.join(packageRoot, 'scripts/live'), { recursive: true });
  fs.copyFileSync(cli, path.join(packageRoot, 'scripts/palate.mjs'));
  write(packageRoot, 'live-policy.json', { schema: 1, newProjects: false });
  const target = path.join(root, 'new-site'); fs.mkdirSync(target);
  const denied = await child([path.join(packageRoot, 'scripts/palate.mjs'), 'init', '--project', target, '--expect', '0', '--op', 'paused']);
  assert.equal(denied.code, 1); assert.match(denied.stderr, /NEW_PROJECTS_PAUSED/); assert.deepEqual(fs.readdirSync(target), []); assert.equal(fs.readdirSync(root).some(name => name.startsWith('.new-site-')), false);
  const status = await child([path.join(packageRoot, 'scripts/palate.mjs'), 'status', '--project', project]); assert.equal(status.code, 0, status.stderr);
  const pinnedInit = await child([path.join(project, 'scripts/palate.mjs'), 'init', '--project', target, '--expect', '0', '--op', 'pinned']); assert.equal(pinnedInit.code, 1); assert.match(pinnedInit.stderr, /INSTALLED_PACKAGE_REQUIRED/);
  const help = await child([cli, '--help']); assert.equal(help.code, 0); assert.match(help.stdout, /"productKind":"service"/);
});
