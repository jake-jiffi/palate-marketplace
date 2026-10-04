#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { invokedDirectly } from './cli-entry.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function canonicalTarget(target) {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current)); current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}
function overlaps(a, b) {
  const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  return inside(a, b) || inside(b, a);
}
function noRedirects(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Package path must not be redirected: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function inventory(root) {
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name), rel = path.relative(root, file).split(path.sep).join('/');
      if (item.isSymbolicLink()) throw new Error(`Package symlinks are not supported: ${rel}`);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) files.push([rel, sha(fs.readFileSync(file))]);
      else throw new Error(`Unexpected package file type: ${rel}`);
    }
  }
  walk(root); return files;
}

// Two tracks are built from the same live-design source tree. Beta is renamed so it can sit in the
// marketplace beside the customer plugin; prod keeps the source's own name and command namespace.
export const TRACKS = {
  beta: { name: 'palate-beta', ref: 'beta', rewrite: true, descriptionPrefix: 'Palate beta. Use one Palate plugin at a time. ', codexName: 'Palate Beta' },
  prod: { name: 'palate-website-builder', ref: 'main', rewrite: false, descriptionPrefix: '', codexName: 'Palate' },
};

export function transformBeta(root, { version, commit, rollback = false, track = 'beta' }) {
  const t = TRACKS[track];
  if (!t) throw new Error(`Unknown track: ${track}`);
  if (track === 'beta' && !/^\d+\.\d+\.\d+-beta\.\d+(?:\+codex\.[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Expected an explicit beta version');
  if (track === 'prod' && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a release version for prod');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected the archived source commit SHA');
  if (fs.existsSync(path.join(root, '.git'))) throw new Error('Transform an archived staging directory, never a checkout');
  const original = inventory(root);
  const sourceVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (track === 'beta' && !version.startsWith(sourceVersion + '-beta.')) throw new Error('Beta version must use the archived source version');
  if (track === 'prod' && version !== sourceVersion) throw new Error('Prod version must equal the archived source version');
  for (const required of ['SKILL.md', 'LEGACY.md', 'references/live-build.md', 'agents/palate-surveyor.md', 'scripts/palate.mjs', 'hooks/hooks.json', 'live-policy.json']) {
    if (!fs.statSync(path.join(root, required)).isFile()) throw new Error(`Missing package input: ${required}`);
  }
  const surveyor = path.join(root, 'agents/palate-surveyor.md');
  const legacyLinks = [...fs.readFileSync(surveyor, 'utf8').matchAll(/\[Legacy survey\]\(([^)\r\n]+)\)/g)];
  if (legacyLinks.length !== 1) throw new Error('Expected one Legacy survey link in agents/palate-surveyor.md');
  const legacyTarget = path.resolve(path.dirname(surveyor), legacyLinks[0][1]);
  if (legacyLinks[0][1] !== '../references/legacy-survey.md' || legacyTarget !== path.resolve(root, 'references/legacy-survey.md')) throw new Error(`Wrong legacy survey agent link target: ${legacyLinks[0][1]}`);
  if (!fs.existsSync(legacyTarget) || !fs.statSync(legacyTarget).isFile()) throw new Error('Missing legacy survey reference file: references/legacy-survey.md');
  for (const [rel] of original) {
    if (t.rewrite && rel.endsWith('.md')) {
      const file = path.join(root, rel);
      const text = fs.readFileSync(file, 'utf8');
      const next = text.replaceAll('/palate-website-builder:', '/palate-beta:');
      if (next !== text) fs.writeFileSync(file, next);
    }
  }
  const entry = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const links = [];
  const nested = entry.replace(/\]\(([^)]+)\)/g, (match, target) => {
    if (/^(?:https?:|#|\/)/.test(target)) return match;
    const clean = target.split('#')[0];
    const full = path.resolve(root, clean);
    if (!full.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(full)) throw new Error(`Unresolved source skill link: ${target}`);
    links.push(target);
    return `](../../${target.replace(/^\.\//, '')})`;
  }).replace("package's `scripts/palate.mjs init`", "package's `../../scripts/palate.mjs init`");
  const skillDir = path.join(root, 'skills/palate-website-builder');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), nested);
  fs.writeFileSync(path.join(root, 'SKILL.md'),
    '# Palate package compatibility marker\n\nThis file preserves discovery by existing project command wrappers. The builder skill is [palate-website-builder](skills/palate-website-builder/SKILL.md).\n');
  for (const host of ['.claude-plugin', '.codex-plugin']) {
    const file = path.join(root, host, 'plugin.json'), manifest = readJSON(file);
    if (!manifest.author?.name || !manifest.description) throw new Error(`Incomplete ${host} manifest`);
    manifest.name = t.name; manifest.version = version;
    manifest.description = t.descriptionPrefix + manifest.description;
    if (host === '.codex-plugin') {
      manifest.skills = './skills/';
      delete manifest.hooks;
      manifest.interface.displayName = t.codexName;
      for (const field of ['shortDescription', 'longDescription', 'developerName', 'category', 'defaultPrompt', 'capabilities']) {
        if (!manifest.interface[field]) throw new Error(`Missing Codex interface.${field}`);
      }
    }
    writeJSON(file, manifest);
  }
  const policy = readJSON(path.join(root, 'live-policy.json'));
  if (policy.schema !== 1) throw new Error('Unsupported live policy');
  policy.newProjects = !rollback;
  writeJSON(path.join(root, 'live-policy.json'), policy);
  fs.writeFileSync(path.join(root, 'VERSION'), version + '\n');
  const content = inventory(root);
  const provenance = {
    schema: 1, track, sourceCommit: commit, sourceVersion, version, rollback,
    sourceDigest: sha(JSON.stringify(original)), contentDigest: sha(JSON.stringify(content)),
    entry: 'skills/palate-website-builder/SKILL.md', rebasedLinks: links,
  };
  writeJSON(path.join(root, 'package-provenance.json'), provenance);
  return provenance;
}

/** Atomic directory exchange, with the previous package left at the owned staging path. */
export function activate(staged, destination) {
  if (fs.existsSync(destination) && (!fs.lstatSync(destination).isDirectory() || fs.lstatSync(destination).isSymbolicLink())) {
    throw new Error('Package destination must be a normal directory');
  }
  if (!fs.existsSync(destination)) { fs.renameSync(staged, destination); return null; }
  const code = `import ctypes, os, sys\nlib=ctypes.CDLL(None,use_errno=True)\na=os.fsencode(sys.argv[1]);b=os.fsencode(sys.argv[2])\nif sys.platform=='darwin':\n result=lib.renameatx_np(-2,a,-2,b,2)\nelif sys.platform.startswith('linux') and hasattr(lib,'renameat2'):\n result=lib.renameat2(-100,a,-100,b,2)\nelse:\n raise SystemExit('Atomic directory exchange is unavailable; package was not changed')\nif result:\n raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))\n`;
  const result = spawnSync('python3', ['-c', code, staged, destination], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Atomic package exchange failed');
  return staged;
}

export function buildBeta({ source, marketplace, version, output, rollback = false, track = 'beta' }) {
  if (!TRACKS[track]) throw new Error(`Unknown track: ${track}`);
  if (!source || !marketplace) throw new Error('Source and marketplace directories are required');
  source = fs.realpathSync(source); marketplace = fs.realpathSync(marketplace);
  if (output) {
    output = canonicalTarget(output);
    if (overlaps(output, source) || overlaps(output, marketplace)) throw new Error('Candidate output must be isolated from the source clone and marketplace, including production packages');
    if (fs.existsSync(output) && fs.readdirSync(output).length && (!fs.existsSync(path.join(output, 'package-provenance.json')) || readJSON(path.join(output, '.claude-plugin/plugin.json')).name !== TRACKS[track].name)) throw new Error('Candidate destination is occupied by an unrelated directory');
  }
  const lock = path.join(marketplace, `.palate-${track}-build.lock`);
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(lockFd);
  try { return buildLocked({ source, marketplace, version, output, rollback, track }); }
  finally { fs.unlinkSync(lock); }
}

function buildLocked({ source, marketplace, version, output, rollback, track }) {
  const t = TRACKS[track];
  const git = args => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'Source git command failed');
    return result.stdout.trim();
  };
  const commit = git(['rev-parse', '--verify', `${t.ref}^{commit}`]);
  const marketplaceFile = path.join(marketplace, '.claude-plugin/marketplace.json');
  noRedirects(marketplace, marketplaceFile);
  const nextMarketplace = output ? null : readJSON(marketplaceFile);
  const betaEntry = nextMarketplace?.plugins?.find(plugin => plugin.name === t.name);
  if (!output && !betaEntry) throw new Error(`Missing existing ${t.name} marketplace entry`);
  if (!output && betaEntry.source !== `./plugins/${t.name}`) throw new Error(`The ${t.name} marketplace entry must point to its local package`);
  const destination = path.resolve(output || path.join(marketplace, `plugins/${t.name}`));
  if (!output) noRedirects(marketplace, destination);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const staged = fs.mkdtempSync(path.join(parent, `.${t.name}-stage-`));
  // A failed extraction is retained for diagnosis. It never replaces the current beta.
  const archive = spawnSync('git', ['-C', source, 'archive', commit], { maxBuffer: 256 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error('Source archive failed');
  const extraction = spawnSync('tar', ['-x', '-C', staged], { input: archive.stdout, maxBuffer: 1024 * 1024 });
  if (extraction.status !== 0) throw new Error('Source archive extraction failed');
  const provenance = transformBeta(staged, { version, commit, rollback, track });
  // Host manifests and all generated links are validated before replacing the package.
  for (const host of ['.claude-plugin', '.codex-plugin']) {
    const manifest = readJSON(path.join(staged, host, 'plugin.json'));
    if (manifest.name !== t.name || manifest.version !== version) throw new Error('Host package identity mismatch');
  }
  for (const link of provenance.rebasedLinks) {
    if (!fs.existsSync(path.resolve(staged, 'skills/palate-website-builder', '../../' + link.split('#')[0]))) throw new Error(`Broken generated link: ${link}`);
  }
  let registryTemp;
  if (!output) {
    betaEntry.version = version;
    if (track === 'beta') betaEntry.description = 'Opt-in tester beta, expected to have bugs. Live Astro design options with real MCP references, interactive motion and optional Shopify commerce. Design speed, visual consistency and complete end-to-end workflows are not yet validated. Use disposable projects, not client production work. Install one Palate plugin at a time. See BETA-TESTING.md.';
    registryTemp = marketplaceFile + `.tmp-${randomUUID()}`;
    const fd = fs.openSync(registryTemp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(nextMarketplace, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  const previous = activate(staged, destination);
  if (registryTemp) {
    try { fs.renameSync(registryTemp, marketplaceFile); }
    catch (error) {
      try { if (previous) activate(previous, destination); else fs.renameSync(destination, staged); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], `Registry update and local package recovery failed. Inspect ${destination} and ${staged} before publishing.`); }
      throw error;
    }
  }
  // The previous package stays locally available. It is never an untested rollback claim.
  return { ...provenance, destination, previousPackage: previous };
}

if (invokedDirectly(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  try {
    const result = buildBeta({
      source: value('--source'), marketplace: value('--marketplace'), version: value('--version'),
      output: value('--output'), rollback: args.includes('--rollback'), track: value('--track') || 'beta',
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) { process.stderr.write(`build-beta: ${error.message}\n`); process.exitCode = 1; }
}
