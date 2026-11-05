import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const SCHEMA = 1;
export const RUNTIME_VERSION = '1.18.0';
export const MARKER = 'palate.project.json';
export const LEGACY_MARKERS = ['.palate-skill-state.json', 'build-manifest.json', 'palate.manifest.json', '.palate/state.json', '.palate/manifest.json'];
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export function fail(message, code = 'INVALID') { throw Object.assign(new Error(message), { code }); }
export function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(`Cannot read valid JSON at ${file}: ${error.message}`, 'CORRUPT'); } }
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function normalPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail(`Unsafe relative path: ${value}`);
  return value;
}
export function noSymlinks(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) fail(`Symlinked path is unsupported: ${current}`, 'UNSAFE_PATH');
    }
  }
  return absolute;
}
export function confined(project, relative) { return noSymlinks(path.join(project, normalPath(relative))); }
export function listFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail(`Symlinked file is unsupported: ${name}`, 'UNSAFE_PATH');
    if (entry.isDirectory()) result.push(...listFiles(path.join(root, entry.name), name));
    else if (entry.isFile()) result.push(name);
    else fail(`Only normal files are supported: ${name}`, 'UNSAFE_PATH');
  }
  return result;
}
export function atomicJson(file, value) {
  noSymlinks(file);
  const temporary = `${file}.write-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function ancestors(start) {
  const dirs = []; let current = path.resolve(start);
  while (true) { dirs.push(current); if (path.dirname(current) === current) return dirs; current = path.dirname(current); }
}
export function resolveProject(explicit, cwd = process.cwd()) {
  const start = noSymlinks(explicit || cwd);
  const matches = ancestors(start).filter(dir => fs.existsSync(path.join(dir, MARKER)) || LEGACY_MARKERS.some(marker => fs.existsSync(path.join(dir, marker))));
  if (matches.length > 1) fail('Nested project markers are ambiguous. Use a separate project directory.', 'AMBIGUOUS_PROJECT');
  const project = explicit ? start : matches[0];
  if (!project || !fs.existsSync(path.join(project, MARKER))) fail('No live-design project marker found.', 'NOT_LIVE_PROJECT');
  if (LEGACY_MARKERS.some(marker => fs.existsSync(path.join(project, marker)))) fail('Both legacy and live-design markers exist. No state was changed.', 'AMBIGUOUS_PROJECT');
  return project;
}
export function validateState(state) {
  if (!state || state.schema !== SCHEMA || state.workflow !== 'live-design') fail('Unsupported project schema or workflow. No state was changed.', 'UNSUPPORTED_SCHEMA');
  if (!Number.isSafeInteger(state.revision) || state.revision < 1 || typeof state.projectId !== 'string' || !state.projectId || !Array.isArray(state.directions) || !Array.isArray(state.verification) || !Array.isArray(state.operations) || !state.runtime || typeof state.runtime.digest !== 'string') fail('Malformed live-design state.', 'CORRUPT');
  if (!['initialising', 'designing', 'selected', 'building', 'verified', 'released'].includes(state.stage)) fail('Unknown project stage.', 'CORRUPT');
  const ids = new Set();
  for (const direction of state.directions) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(direction.id) || ids.has(direction.id) || !['pending', 'ready', 'failed'].includes(direction.status)) fail('Malformed direction registry.', 'CORRUPT');
    ids.add(direction.id);
    if (direction.entry !== `src/directions/${direction.id}/index.astro`) fail('Direction entry must be its own index.astro.', 'CORRUPT');
    if (typeof direction.label !== 'string' || typeof direction.rationale !== 'string' || !Array.isArray(direction.referenceDecisions) || (direction.status === 'ready' && (!/^[a-f0-9]{64}$/.test(direction.fingerprint || '') || typeof direction.previewUrl !== 'string'))) fail('Malformed direction evidence.', 'CORRUPT');
  }
  if (state.selection && (!ids.has(state.selection.optionId) || typeof state.selection.decisionId !== 'string')) fail('Selection references an absent direction.', 'CORRUPT');
  for (const record of state.verification) if (!record || !Array.isArray(record.required) || !Array.isArray(record.checks) || !['passed', 'failed'].includes(record.result) || record.checks.some(check => !check || !['executed-command', 'supplied-review'].includes(check.kind) || !['passed', 'failed'].includes(check.result))) fail('Malformed verification record.', 'CORRUPT');
  const operationIds = new Set();
  for (const operation of state.operations) { if (!operation || typeof operation.id !== 'string' || operationIds.has(operation.id) || !/^[a-f0-9]{64}$/.test(operation.digest || '') || !operation.result || typeof operation.result !== 'object') fail('Malformed operation receipt.', 'CORRUPT'); operationIds.add(operation.id); }
  return state;
}
export function readState(project) { return validateState(json(confined(project, MARKER))); }
export function fileHashes(project, names) {
  return [...new Set(names)].sort().map(name => ({ path: name, sha256: sha256(fs.readFileSync(confined(project, name))) }));
}
const configName = name => /^(package(?:-lock)?\.json|npm-shrinkwrap\.json|(?:astro|vite|tsconfig|eslint|postcss|tailwind)\..+|\.npmrc|\.node-version|\.nvmrc)$/.test(name);
export function sourceFiles(project, optionId) {
  const names = [];
  for (const directory of ['src', 'public', 'scripts', 'palate-preview']) {
    for (const file of listFiles(confined(project, directory), directory)) {
      if (optionId && file.startsWith('src/directions/') && !file.startsWith(`src/directions/${optionId}/`)) continue;
      names.push(file);
    }
  }
  for (const name of fs.readdirSync(project)) if (configName(name)) { confined(project, name); if (fs.lstatSync(path.join(project, name)).isFile()) names.push(name); }
  return names;
}
export function fingerprint(project, optionId) { return sha256(stable({ profile: readState(project).profile, files: fileHashes(project, sourceFiles(project, optionId)) })); }
export function buildFingerprint(project) {
  const dist = confined(project, 'dist');
  if (!fs.existsSync(dist) || !fs.readdirSync(dist).length) return null;
  return sha256(stable(fileHashes(project, listFiles(dist, 'dist'))));
}
export function readStatus(project) {
  project = resolveProject(project);
  const state = readState(project);
  const evidenceCurrent = evidence => {
    try { return Boolean(evidence && /^[a-f0-9]{64}$/.test(evidence.sha256 || '') && sha256(fs.readFileSync(confined(project, evidence.path))) === evidence.sha256); }
    catch { return false; }
  };
  const directions = state.directions.map(direction => {
    const currentFingerprint = fingerprint(project, direction.id);
    return { id: direction.id, current: direction.status === 'ready' && direction.fingerprint === currentFingerprint && [direction.thumbnail, ...(direction.proofs || [])].filter(Boolean).every(evidenceCurrent), fingerprint: currentFingerprint };
  });
  const selected = state.selection && directions.find(direction => direction.id === state.selection.optionId);
  const selectionCurrent = Boolean(selected?.current && (!state.selection.combine?.length || selected.fingerprint !== state.selection.fingerprint));
  const currentSource = fingerprint(project);
  const currentBuild = buildFingerprint(project);
  const currentVerification = [...state.verification].reverse().find(record => record.result === 'passed' && record.sourceFingerprint === currentSource && record.buildFingerprint === currentBuild && currentBuild && record.decisionId === state.selection?.decisionId && record.checks.every(evidenceCurrent) && record.required.every(scope => record.checks.some(check => check.scope === scope && check.result === 'passed')));
  return { state, validity: { directions, selectionCurrent, verificationCurrent: Boolean(selectionCurrent && currentVerification), sourceFingerprint: currentSource, buildFingerprint: currentBuild } };
}
export function processIdentity(pid = process.pid) {
  try { const start = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return start || null; }
  catch { try { process.kill(pid, 0); return 'unknown-live'; } catch (error) { if (error.code === 'ESRCH') return null; return 'unknown-live'; } }
}
export function ownerGone(owner) {
  if (owner.machine !== os.hostname() || !Number.isSafeInteger(owner.pid) || typeof owner.start !== 'string') return false;
  const current = processIdentity(owner.pid);
  return current === null || (current !== 'unknown-live' && current !== owner.start);
}
export async function acquireLock(project, timeout = 5000) {
  const dir = confined(project, '.palate/locks'); fs.mkdirSync(dir, { recursive: true });
  const owner = { pid: process.pid, start: processIdentity(), machine: os.hostname(), nonce: crypto.randomUUID() };
  if (!owner.start || owner.start === 'unknown-live') fail('Cannot establish this process identity.', 'LOCK_IDENTITY');
  const pending = path.join(dir, `.claim-${owner.nonce}`); atomicJson(pending, owner);
  const deadline = Date.now() + timeout;
  try {
    while (true) {
      const generations = fs.readdirSync(dir).filter(name => /^\d{12}\.json$/.test(name)).sort();
      const latest = generations.at(-1);
      let available = !latest;
      if (latest) {
        const claim = json(confined(project, `.palate/locks/${latest}`));
        const receipt = confined(project, `.palate/locks/${latest}.done`);
        if (fs.existsSync(receipt) && json(receipt).nonce !== claim.nonce) fail('Lock completion receipt does not match its owner.', 'CORRUPT_LOCK');
        available = fs.existsSync(receipt) || ownerGone(claim);
      }
      if (available) {
        const number = latest ? Number(latest.slice(0, 12)) + 1 : 1;
        const name = `${String(number).padStart(12, '0')}.json`;
        const claimPath = path.join(dir, name);
        try {
          fs.linkSync(pending, claimPath);
          return () => { atomicJson(`${claimPath}.done`, { nonce: owner.nonce }); };
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (Date.now() >= deadline) fail('Another live process owns the project lock. Retry after it finishes.', 'LOCKED');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { fs.unlinkSync(pending); }
}
