#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { invokedDirectly } from './cli-entry.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function present(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function inventory(root, prefix = '') {
  const entries = [];
  for (const item of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Publication refused: redirected package file ${name}`);
    if (item.isDirectory()) entries.push(...inventory(root, name));
    else if (item.isFile()) entries.push([name, hash(fs.readFileSync(path.join(root, name)))]);
    else throw new Error(`Publication refused: non-file package entry ${name}`);
  }
  return entries;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0 || result.error) throw new Error(`Publication source verification failed: ${command}: ${result.error?.message || result.stderr?.toString() || result.signal || result.status}`);
  return result.stdout;
}

/** Read-only publication gate. It never removes a lock or repairs a mismatched package. */
export function verifyBeta({ source, marketplace, commit, version }) {
  if (!source || !marketplace) throw new Error('Source and marketplace paths are required');
  source = fs.realpathSync(source); marketplace = fs.realpathSync(marketplace);
  const lock = path.join(marketplace, '.palate-beta-build.lock');
  if (present(lock)) {
    let detail = 'unreadable owner';
    try { const owner = json(lock); detail = `recorded PID ${owner.pid ?? 'unknown'}, started ${owner.startedAt ?? 'unknown'}`; } catch {}
    throw new Error(`Publication refused: active or leftover beta build lock (${detail}). Prove the recorded process is gone before explicit cleanup and regeneration; elapsed time is not proof.`);
  }
  const registry = json(path.join(marketplace, '.claude-plugin/marketplace.json'));
  const entries = registry.plugins?.filter(plugin => plugin.name === 'palate-beta') || [];
  if (entries.length !== 1 || entries[0].source !== './plugins/palate-beta') throw new Error('Publication refused: expected exactly one beta entry pointing to ./plugins/palate-beta');
  const root = path.join(marketplace, 'plugins/palate-beta');
  for (const file of [path.join(marketplace, 'plugins'), root, path.join(marketplace, '.claude-plugin'), path.join(marketplace, '.claude-plugin/marketplace.json')]) if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Publication refused: redirected marketplace path ${file}`);
  const provenance = json(path.join(root, 'package-provenance.json'));
  if (provenance.schema !== 1 || !/^[a-f0-9]{40}$/.test(provenance.sourceCommit || '')) throw new Error('Publication refused: invalid package provenance');
  const packageVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+-beta\.\d+(?:\+codex\.[a-zA-Z0-9.-]+)?$/.test(packageVersion)) throw new Error('Publication refused: invalid beta package version');
  for (const host of ['.claude-plugin', '.codex-plugin']) {
    const manifest = json(path.join(root, host, 'plugin.json'));
    if (manifest.name !== 'palate-beta' || manifest.version !== packageVersion) throw new Error(`Publication refused: ${host} identity/version disagrees with package VERSION`);
  }
  if (entries[0].version !== packageVersion || provenance.version !== packageVersion || (version && version !== packageVersion)) throw new Error(`Publication refused: beta package/pin/version mismatch (package ${packageVersion}, pin ${entries[0].version}, expected ${version || provenance.version})`);
  const betaCommit = run('git', ['-C', source, 'rev-parse', '--verify', 'beta^{commit}'], { encoding: 'utf8' }).trim();
  if (provenance.sourceCommit !== betaCommit || (commit && commit !== betaCommit)) throw new Error(`Publication refused: source commit mismatch (package ${provenance.sourceCommit}, beta ${betaCommit}, expected ${commit || betaCommit})`);
  const contentDigest = hash(JSON.stringify(inventory(root).filter(([name]) => name !== 'package-provenance.json')));
  if (contentDigest !== provenance.contentDigest) throw new Error('Publication refused: generated package content digest changed after generation');
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'palate-publication-source-'));
  try {
    const archive = run('git', ['-C', source, 'archive', betaCommit]);
    run('tar', ['-x', '-C', temporary], { input: archive });
    const sourceDigest = hash(JSON.stringify(inventory(temporary)));
    const sourceVersion = fs.readFileSync(path.join(temporary, 'VERSION'), 'utf8').trim();
    if (sourceDigest !== provenance.sourceDigest || sourceVersion !== provenance.sourceVersion || !packageVersion.startsWith(sourceVersion + '-beta.')) throw new Error('Publication refused: archived source digest/version disagrees with package provenance');
    if (present(lock)) throw new Error('Publication refused: a beta build started during verification. Wait for its result, then verify again.');
    return { ok: true, version: packageVersion, sourceCommit: betaCommit, sourceDigest, contentDigest, rollback: provenance.rollback, marketplace, package: root };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (invokedDirectly(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  try { process.stdout.write(JSON.stringify(verifyBeta({ source: value('--source'), marketplace: value('--marketplace'), commit: value('--commit'), version: value('--version') }), null, 2) + '\n'); }
  catch (error) { process.stderr.write(`verify-beta: ${error.message}\n`); process.exitCode = 1; }
}
