import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transformBeta, activate, buildBeta } from '../build-beta.mjs';
import { verifyBeta } from '../verify-beta.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'palate-package-test-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
test('packaging CLIs emit the same diagnostic through direct and symlinked paths', () => {
  const scripts = fileURLToPath(new URL('../', import.meta.url));
  const link = path.join(scratch, 'linked-scripts');
  fs.symlinkSync(scripts, link, 'dir');
  for (const name of ['build-beta.mjs', 'verify-beta.mjs']) {
    const direct = spawnSync(process.execPath, [path.join(scripts, name)], { encoding: 'utf8' });
    const linked = spawnSync(process.execPath, [path.join(link, name)], { encoding: 'utf8' });
    assert.equal(direct.status, 1, direct.stderr);
    assert.ok(direct.stderr.trim(), 'The direct command must actually execute');
    assert.equal(linked.status, direct.status);
    assert.equal(linked.stderr, direct.stderr);
    assert.equal(linked.stdout, direct.stdout);
  }
});
function write(root, name, value) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture(name) {
  const root = path.join(scratch, name);
  write(root, 'VERSION', '1.18.0\n');
  write(root, 'SKILL.md', '---\nname: palate-website-builder\ndescription: Build a website\n---\n[Live](references/live-build.md) [Legacy](LEGACY.md)\nUse /palate-website-builder:pick and the package\'s `scripts/palate.mjs init`.\n');
  write(root, 'LEGACY.md', 'Use /palate-website-builder:status.\n');
  write(root, 'references/live-build.md', 'Live instructions.\n');
  write(root, 'agents/palate-surveyor.md', '---\nname: palate-surveyor\ndescription: Research live or legacy designs\ntools: Read, Write\n---\nFor legacy mode, read [Legacy survey](../references/legacy-survey.md).\n');
  write(root, 'references/legacy-survey.md', 'Legacy survey instructions. Use /palate-website-builder:survey.\n');
  write(root, 'scripts/palate.mjs', 'console.log("runtime");\n');
  write(root, 'hooks/hooks.json', { hooks: {} });
  write(root, 'live-policy.json', { schema: 1, newProjects: true });
  const base = { name: 'palate-website-builder', version: '1.18.0', description: 'Build sites', author: { name: 'Jiffi' } };
  write(root, '.claude-plugin/plugin.json', base);
  write(root, '.codex-plugin/plugin.json', { ...base, skills: './skills/', interface: {
    displayName: 'Palate', shortDescription: 'Sites', longDescription: 'Build sites', developerName: 'Jiffi', category: 'Design', defaultPrompt: ['Build a site'], capabilities: ['Write'],
  } });
  return root;
}
function repository(name) {
  const source = fixture(`${name}-repo`), marketplace = path.join(scratch, `${name}-marketplace`);
  const git = args => { const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  git(['init', '-b', 'beta']); git(['config', 'user.name', 'Package Test']); git(['config', 'user.email', 'test@example.invalid']); git(['add', '.']); git(['commit', '-m', 'fixture']);
  write(marketplace, '.claude-plugin/marketplace.json', { name: 'palate', plugins: [{ name: 'palate-beta', version: '1.17.0-beta.22', source: './plugins/palate-beta' }] });
  write(marketplace, 'plugins/palate-beta/sentinel', 'old beta');
  return { source, marketplace };
}
const commit = 'a'.repeat(40);

test('one nested entry and a root marker preserve links, namespace and runtime bytes', () => {
  const root = fixture('candidate');
  const runtime = fs.readFileSync(path.join(root, 'scripts/palate.mjs'));
  const result = transformBeta(root, { version: '1.18.0-beta.1', commit });
  const nested = fs.readFileSync(path.join(root, result.entry), 'utf8');
  assert.match(nested, /\]\(\.\.\/\.\.\/references\/live-build.md\)/);
  assert.match(nested, /\/palate-beta:pick/);
  assert.match(nested, /`\.\.\/\.\.\/scripts\/palate.mjs init`/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8'), /^---/);
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')), 'Old wrapper file-existence contract');
  assert.deepEqual(fs.readFileSync(path.join(root, 'scripts/palate.mjs')), runtime);
  assert.equal(json(path.join(root, '.codex-plugin/plugin.json')).skills, './skills/');
  assert.equal(json(path.join(root, '.claude-plugin/plugin.json')).version, '1.18.0-beta.1');
  const surveyor = path.join(root, 'agents/palate-surveyor.md');
  const legacyLink = fs.readFileSync(surveyor, 'utf8').match(/\[Legacy survey\]\(([^)]+)\)/)[1];
  assert.equal(path.resolve(path.dirname(surveyor), legacyLink), path.join(root, 'references/legacy-survey.md'));
  assert.equal(fs.readFileSync(path.resolve(path.dirname(surveyor), legacyLink), 'utf8'), 'Legacy survey instructions. Use /palate-beta:survey.\n');
  assert.equal(result.sourceCommit, commit);
});

test('compatibility package disables creation and retains the same runtime', () => {
  const candidate = fixture('normal'), rollback = fixture('rollback');
  transformBeta(candidate, { version: '1.18.0-beta.1', commit });
  transformBeta(rollback, { version: '1.18.0-beta.2', commit, rollback: true });
  assert.equal(json(path.join(rollback, 'live-policy.json')).newProjects, false);
  assert.deepEqual(fs.readFileSync(path.join(candidate, 'scripts/palate.mjs')), fs.readFileSync(path.join(rollback, 'scripts/palate.mjs')));
  assert.deepEqual(fs.readFileSync(path.join(candidate, 'skills/palate-website-builder/SKILL.md')), fs.readFileSync(path.join(rollback, 'skills/palate-website-builder/SKILL.md')));
  for (const file of ['agents/palate-surveyor.md', 'references/legacy-survey.md']) {
    assert.deepEqual(fs.readFileSync(path.join(candidate, file)), fs.readFileSync(path.join(rollback, file)));
  }
});

for (const [name, mutate, diagnostic] of [
  ['missing legacy reference', root => fs.unlinkSync(path.join(root, 'references/legacy-survey.md')), /legacy survey.*file/i],
  ['legacy reference is a directory', root => {
    fs.unlinkSync(path.join(root, 'references/legacy-survey.md'));
    fs.mkdirSync(path.join(root, 'references/legacy-survey.md'));
  }, /legacy survey.*file/i],
  ['outside legacy target', root => {
    write(scratch, 'outside-legacy-survey.md', 'Existing file outside the package.\n');
    write(root, 'agents/palate-surveyor.md', '[Legacy survey](../../outside-legacy-survey.md)\n');
  }, /legacy survey.*target/i],
  ['wrong existing in-package legacy target', root => write(root, 'agents/palate-surveyor.md', '[Legacy survey](../LEGACY.md)\n'), /legacy survey.*target/i],
  ['missing intermediate legacy directory', root => {
    write(root, 'agents/palate-surveyor.md', '[Legacy survey](../references/missing/../legacy-survey.md)\n');
    assert.throws(() => fs.readFileSync(`${root}/agents/../references/missing/../legacy-survey.md`), { code: 'ENOENT' });
  }, /legacy survey.*target/i],
  ['absolute legacy target', root => write(root, 'agents/palate-surveyor.md', `[Legacy survey](${path.join(root, 'references/legacy-survey.md')})\n`), /legacy survey.*target/i],
  ['redirected legacy reference', root => {
    fs.unlinkSync(path.join(root, 'references/legacy-survey.md'));
    fs.symlinkSync(path.join(root, 'LEGACY.md'), path.join(root, 'references/legacy-survey.md'));
  }, /symlinks/],
  ['wrong link label', root => write(root, 'agents/palate-surveyor.md', '[Other reference](../references/legacy-survey.md)\n'), /one Legacy survey link/],
  ['ambiguous legacy links', root => fs.appendFileSync(path.join(root, 'agents/palate-surveyor.md'), '[Legacy survey](../LEGACY.md)\n'), /one Legacy survey link/],
]) {
  test(`candidate and rollback reject ${name}`, () => {
    for (const rollback of [false, true]) {
      const root = fixture(`${name.replaceAll(' ', '-')}-${rollback}`);
      mutate(root);
      assert.throws(() => transformBeta(root, { version: '1.18.0-beta.1', commit, rollback }), diagnostic);
      assert.equal(fs.existsSync(path.join(root, 'package-provenance.json')), false);
    }
  });
}

test('invalid source links, wrong version and redirected files are rejected', () => {
  const bad = fixture('bad-link');
  fs.appendFileSync(path.join(bad, 'SKILL.md'), '[Missing](missing.md)');
  assert.throws(() => transformBeta(bad, { version: '1.18.0-beta.1', commit }), /Unresolved/);
  assert.throws(() => transformBeta(fixture('bad-version'), { version: '1.19.0-beta.1', commit }), /source version/);
  const linked = fixture('linked');
  fs.symlinkSync(path.join(linked, 'LEGACY.md'), path.join(linked, 'redirect.md'));
  assert.throws(() => transformBeta(linked, { version: '1.18.0-beta.1', commit }), /symlinks/);
});

test('actual atomic exchange retains the complete previous package', () => {
  const old = path.join(scratch, 'old'), next = path.join(scratch, 'next');
  write(old, 'value.txt', 'old'); write(next, 'value.txt', 'next');
  assert.equal(activate(next, old), next);
  assert.equal(fs.readFileSync(path.join(old, 'value.txt'), 'utf8'), 'next');
  assert.equal(fs.readFileSync(path.join(next, 'value.txt'), 'utf8'), 'old');
});

test('archive publication changes beta only; failed generation preserves served files', () => {
  const source = fixture('source-repo'), marketplace = path.join(scratch, 'marketplace');
  const git = args => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git(['init', '-b', 'beta']); git(['config', 'user.name', 'Package Test']); git(['config', 'user.email', 'test@example.invalid']);
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  const production = { name: 'palate-website-builder', version: '1.16.0', source: './plugins/palate-website-builder' };
  write(marketplace, '.claude-plugin/marketplace.json', { name: 'palate', plugins: [production, { name: 'palate-beta', version: '1.17.0-beta.22', source: './plugins/palate-beta' }] });
  write(marketplace, 'plugins/palate-website-builder/sentinel', 'production unchanged');
  write(marketplace, 'plugins/palate-beta/sentinel', 'previous beta');
  const result = buildBeta({ source, marketplace, version: '1.18.0-beta.1' });
  assert.equal(result.sourceCommit, git(['rev-parse', 'HEAD']));
  const registry = json(path.join(marketplace, '.claude-plugin/marketplace.json'));
  assert.deepEqual(registry.plugins[0], production);
  assert.equal(fs.readFileSync(path.join(marketplace, 'plugins/palate-website-builder/sentinel'), 'utf8'), 'production unchanged');
  assert.equal(fs.readFileSync(path.join(result.previousPackage, 'sentinel'), 'utf8'), 'previous beta');
  assert.equal(fs.readFileSync(path.join(result.destination, 'references/legacy-survey.md'), 'utf8'), 'Legacy survey instructions. Use /palate-beta:survey.\n');
  const before = fs.readFileSync(path.join(marketplace, 'plugins/palate-beta/package-provenance.json'));
  fs.appendFileSync(path.join(source, 'SKILL.md'), '[Broken](absent.md)'); git(['add', '.']); git(['commit', '-m', 'broken fixture']);
  assert.throws(() => buildBeta({ source, marketplace, version: '1.18.0-beta.2' }), /Unresolved/);
  assert.deepEqual(fs.readFileSync(path.join(marketplace, 'plugins/palate-beta/package-provenance.json')), before);
  assert.equal(json(path.join(marketplace, '.claude-plugin/marketplace.json')).plugins[1].version, '1.18.0-beta.1');
});

test('an archived misdirected surveyor link cannot replace the served beta or registry', () => {
  const { source, marketplace } = repository('archived-agent-link');
  const registry = path.join(marketplace, '.claude-plugin/marketplace.json'), before = fs.readFileSync(registry);
  write(source, 'agents/palate-surveyor.md', '[Legacy survey](../LEGACY.md)\n');
  for (const args of [['add', '.'], ['commit', '-m', 'misdirected surveyor fixture']]) {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.throws(() => buildBeta({ source, marketplace, version: '1.18.0-beta.1' }), /legacy survey.*target/i);
  assert.equal(fs.readFileSync(path.join(marketplace, 'plugins/palate-beta/sentinel'), 'utf8'), 'old beta');
  assert.deepEqual(fs.readFileSync(registry), before);
});

test('candidate output cannot replace the source clone or production package', () => {
  const { source, marketplace } = repository('output-boundary');
  const production = path.join(marketplace, 'plugins/palate-website-builder'); write(production, 'sentinel', 'production');
  assert.throws(() => buildBeta({ source, marketplace, version: '1.18.0-beta.1', output: source }), /isolated|source|destination/i);
  assert.ok(fs.existsSync(path.join(source, '.git')));
  assert.throws(() => buildBeta({ source, marketplace, version: '1.18.0-beta.1', output: production }), /isolated|production|marketplace/i);
  assert.equal(fs.readFileSync(path.join(production, 'sentinel'), 'utf8'), 'production');
});

test('registry rename failure restores the prior beta package and pin', () => {
  const { source, marketplace } = repository('registry-failure');
  const registry = path.join(marketplace, '.claude-plugin/marketplace.json'), before = fs.readFileSync(registry);
  const canonicalRegistry = fs.realpathSync(registry);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === canonicalRegistry) throw Object.assign(new Error('Injected registry rename failure'), { code: 'EIO' }); return rename(from, to); };
  try { assert.throws(() => buildBeta({ source, marketplace, version: '1.18.0-beta.1' }), /registry rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(marketplace, 'plugins/palate-beta/sentinel'), 'utf8'), 'old beta');
  assert.deepEqual(fs.readFileSync(registry), before);
});

test('publication verifier checks both manifests, actual source and package bytes', () => {
  const { source, marketplace } = repository('publication-verifier');
  const built = buildBeta({ source, marketplace, version: '1.18.0-beta.1' });
  const verified = verifyBeta({ source, marketplace, commit: built.sourceCommit, version: built.version }); assert.equal(verified.ok, true);
  const manifest = path.join(marketplace, 'plugins/palate-beta/.codex-plugin/plugin.json'), old = fs.readFileSync(manifest);
  const changed = json(manifest); changed.version = '1.18.0-beta.999'; fs.writeFileSync(manifest, JSON.stringify(changed));
  assert.throws(() => verifyBeta({ source, marketplace }), /identity\/version/); fs.writeFileSync(manifest, old);
  const runtime = path.join(marketplace, 'plugins/palate-beta/scripts/palate.mjs'); fs.appendFileSync(runtime, '\n// changed');
  assert.throws(() => verifyBeta({ source, marketplace }), /content digest/); fs.writeFileSync(runtime, 'console.log("runtime");\n');
  const provenance = path.join(marketplace, 'plugins/palate-beta/package-provenance.json'), record = json(provenance); record.sourceDigest = '0'.repeat(64); fs.writeFileSync(provenance, JSON.stringify(record));
  assert.throws(() => verifyBeta({ source, marketplace }), /source digest/);
});

test('a killed build blocks publication until its dead lock and package/pin mismatch are resolved', () => {
  const { source, marketplace } = repository('killed-build');
  const builderURL = new URL('../build-beta.mjs', import.meta.url).href;
  const script = `import fs from 'node:fs'; import {buildBeta} from ${JSON.stringify(builderURL)}; const rename=fs.renameSync; fs.renameSync=(a,b)=>{if(b.endsWith('/.claude-plugin/marketplace.json')) process.kill(process.pid,'SIGKILL'); return rename(a,b)}; buildBeta(${JSON.stringify({ source, marketplace, version: '1.18.0-beta.1' })});`;
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 }); assert.equal(killed.signal, 'SIGKILL');
  assert.throws(() => verifyBeta({ source, marketplace }), /active or leftover beta build lock/);
  // This test owns the child and has its terminal SIGKILL result. Removing a live lock is never automatic.
  fs.unlinkSync(path.join(marketplace, '.palate-beta-build.lock'));
  assert.throws(() => verifyBeta({ source, marketplace }), /package\/pin\/version mismatch/);
  const stages = fs.readdirSync(path.join(marketplace, 'plugins')).filter(name => name.startsWith('.palate-beta-stage-'));
  assert.ok(stages.some(name => fs.existsSync(path.join(marketplace, 'plugins', name, 'sentinel'))), 'previous package retained after interruption');
  buildBeta({ source, marketplace, version: '1.18.0-beta.1' });
  assert.equal(verifyBeta({ source, marketplace }).ok, true);
});
