import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { MARKER, LEGACY_MARKERS, sha256, stable, json, fail, noSymlinks, normalPath, confined, listFiles, sourceFiles, readState, validateState, atomicJson, processIdentity, ownerGone } from './project.mjs';

const privateName = name => name.split('/').some(part => /^\.env(?:\.|$)/i.test(part) || /^(?:credentials?|secrets?|node_modules|dist|\.git)$/i.test(part)) || /^\.palate\/(?:submissions?|cart|sessions?|locks|checkpoints)\//i.test(name) || /(?:\.pem|\.key|credentials\.json|\.npmrc)$/i.test(name);
export function allowedArtefact(name) {
  normalPath(name);
  if (!name.startsWith('.palate/') || privateName(name) || /^\.palate\/(?:runtime|checkpoints)\//.test(name)) fail(`Only explicit non-secret evidence under .palate/ can be included: ${name}`);
  return name;
}
export function emptyTarget(target) {
  noSymlinks(target);
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) fail(`Destination must be empty: ${target}`, 'DESTINATION_NOT_EMPTY');
  let parent = path.dirname(target);
  while (true) {
    if ([MARKER, ...LEGACY_MARKERS].some(marker => fs.existsSync(path.join(parent, marker)))) fail('A project cannot be created inside another project.', 'AMBIGUOUS_PROJECT');
    if (path.dirname(parent) === parent) break;
    parent = path.dirname(parent);
  }
}
export function stagingDirectory(target, kind) {
  emptyTarget(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), `.${path.basename(target)}-${kind}-`));
  atomicJson(path.join(staging, '.palate-staging.json'), { format: 1, target, kind, pid: process.pid, start: processIdentity(), machine: os.hostname(), createdAt: new Date().toISOString() });
  return staging;
}
export function activate(staging, target) {
  emptyTarget(target);
  fs.unlinkSync(path.join(staging, '.palate-staging.json'));
  try { fs.renameSync(staging, target); }
  catch (error) { atomicJson(path.join(staging, '.palate-staging.json'), { format: 1, target, kind: 'activation-failed', pid: process.pid, start: processIdentity(), machine: os.hostname(), reason: error.code }); throw error; }
}
export function discardStaging(staging) {
  staging = noSymlinks(path.resolve(staging));
  const owner = json(path.join(staging, '.palate-staging.json'));
  if (owner.format !== 1 || typeof owner.target !== 'string' || path.dirname(owner.target) !== path.dirname(staging) || !path.basename(staging).startsWith(`.${path.basename(owner.target)}-`) || !ownerGone(owner)) fail('Staging ownership is unproven or its process is still alive.', 'STAGING_OWNERSHIP');
  listFiles(staging); // Refuse symlink entries before removing anything.
  fs.rmSync(staging, { recursive: true });
  return { discarded: staging };
}
export function createCheckpoint(project, state = readState(project)) {
  const names = new Set([...sourceFiles(project), MARKER, ...listFiles(confined(project, '.palate/runtime'), '.palate/runtime')]);
  for (const name of ['README.md', 'AGENTS.md', '.gitignore']) if (fs.existsSync(confined(project, name))) names.add(name);
  for (const name of state.profile?.artefacts || []) names.add(allowedArtefact(name));
  for (const direction of state.directions) for (const proof of [direction.thumbnail, ...(direction.proofs || [])].filter(Boolean)) names.add(allowedArtefact(proof.path));
  for (const verification of state.verification) for (const check of verification.checks) if (check.path) names.add(allowedArtefact(check.path));
  const files = [...names].sort().filter(name => !privateName(name)).map(name => {
    const file = confined(project, name), stat = fs.lstatSync(file);
    if (!stat.isFile()) fail(`Checkpoint entry is not a normal file: ${name}`);
    const data = fs.readFileSync(file);
    return { path: name, mode: stat.mode & 0o111 ? 0o755 : 0o644, sha256: sha256(data), data: data.toString('base64') };
  });
  const manifest = { format: 1, files: files.map(({ data, ...file }) => file) };
  const id = sha256(stable(manifest));
  const directory = confined(project, '.palate/checkpoints'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${id}.json`);
  if (!fs.existsSync(file)) atomicJson(file, { ...manifest, id, files });
  return { id, path: `.palate/checkpoints/${id}.json`, files: files.length };
}
export function restoreCheckpoint(project, id, target, receipt, validateRuntime) {
  if (!/^[a-f0-9]{64}$/.test(id)) fail('Invalid checkpoint ID.');
  target = path.resolve(target); emptyTarget(target);
  const archive = json(confined(project, `.palate/checkpoints/${id}.json`));
  if (archive.format !== 1 || archive.id !== id || !Array.isArray(archive.files)) fail('Invalid checkpoint archive.', 'CORRUPT');
  const names = new Set();
  const files = archive.files.map(entry => {
    const name = normalPath(entry.path);
    if (privateName(name) || names.has(name) || ![0o644, 0o755].includes(entry.mode) || typeof entry.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) fail(`Unsafe checkpoint entry: ${name}`, 'CORRUPT');
    names.add(name);
    const data = Buffer.from(entry.data, 'base64');
    if (sha256(data) !== entry.sha256) fail(`Checkpoint hash mismatch: ${name}`, 'CORRUPT');
    return { ...entry, data };
  });
  if (sha256(stable({ format: 1, files: files.map(({ data, ...entry }) => entry) })) !== id || !names.has(MARKER) || !names.has('.palate/runtime/digest.json') || !names.has('scripts/palate.mjs')) fail('Checkpoint manifest or required runtime files are invalid.', 'CORRUPT');
  const state = validateState(JSON.parse(files.find(entry => entry.path === MARKER).data.toString()));
  state.parentCheckpoint = { id, projectId: state.projectId, revision: state.revision };
  state.projectId = crypto.randomUUID(); state.revision += 1; state.verification = []; state.operations = [];
  state.stage = state.selection ? 'building' : state.profile ? 'designing' : 'initialising';
  state.restoredAt = new Date().toISOString();
  for (const direction of state.directions) { delete direction.previewUrl; direction.status = 'pending'; }
  const result = { ok: true, project, revision: receipt.sourceRevision, stage: receipt.sourceStage, restored: { id, target, projectId: state.projectId, revision: state.revision, stage: state.stage } };
  state.operations.push({ id: receipt.operationId, digest: receipt.digest, result });
  const staging = stagingDirectory(target, 'restore');
  try {
    for (const entry of files) {
      const output = confined(staging, entry.path); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, entry.data, { flag: 'wx', mode: entry.mode });
    }
    atomicJson(path.join(staging, MARKER), state); validateRuntime(staging);
    activate(staging, target);
  } catch (error) { error.message += ` Staging retained at ${staging}.`; throw error; }
  return result;
}
