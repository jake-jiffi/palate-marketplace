import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readState } from '../.palate/runtime/live/project.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const privateDir = join(root, '.palate');
const recordPath = join(privateDir, 'preview-server.json');
const lockPath = join(privateDir, 'preview-server.lock');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const astroBin = () => realpathSync(join(root, 'node_modules/.bin/astro'));

function startIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

function readRecord() {
  try {
    if (lstatSync(recordPath).isSymbolicLink()) throw new Error('Preview record must not be a symlink');
    return JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function owns(record) {
  if (!record || record.cwd !== root || !Number.isInteger(record.port) || record.port < 1024 || record.port > 65535 || record.url !== `http://127.0.0.1:${record.port}` || !/^[a-f0-9-]{36}$/.test(record.instance || '') || !record.startIdentity || startIdentity(record.pid) !== record.startIdentity) return false;
  try {
    const command = execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return command.includes(astroBin()) && command.includes(`--port ${record.port}`);
  } catch { return false; }
}

async function answers(record) {
  if (!owns(record)) return false;
  try {
    const response = await fetch(`${record.url}/_palate/health`, { signal: AbortSignal.timeout(1200), redirect: 'error' });
    const data = await response.json();
    return response.ok && data.service === 'palate-live-preview' && data.instance === record.instance;
  } catch { return false; }
}

async function freePort(preferred) {
  for (let port = preferred; port <= Math.min(preferred + 30, 65535); port++) {
    const server = createServer();
    const free = await new Promise(resolve => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No free preview port in the requested range. Choose another --port.');
}

async function lock() {
  mkdirSync(privateDir, { recursive: true });
  if (lstatSync(privateDir).isSymbolicLink()) throw new Error('.palate must not be a symlink');
  const value = JSON.stringify({ pid: process.pid, startIdentity: startIdentity(process.pid), token: randomUUID() });
  const until = Date.now() + 10000;
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, value); closeSync(fd);
      return () => { if (readFileSync(lockPath, 'utf8') === value) unlinkSync(lockPath); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try {
        if (lstatSync(lockPath).isSymbolicLink()) throw new Error();
        previous = readFileSync(lockPath, 'utf8');
        const owner = JSON.parse(previous);
        if (!owner.startIdentity || !Number.isSafeInteger(owner.pid)) throw new Error();
        if (startIdentity(owner.pid) !== owner.startIdentity && readFileSync(lockPath, 'utf8') === previous) { unlinkSync(lockPath); continue; }
      } catch (cause) {
        if (cause.code === 'ENOENT') continue;
        // An owner may still be filling the newly opened lock. Never remove unknown ownership.
      }
      if (Date.now() >= until) throw new Error('Preview command is locked. An active or unreadable owner must be resolved before retrying.');
      await pause(100);
    }
  }
}

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

export async function runPreview(argv) {
  const action = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'start';
  if (action === 'help' || argv.includes('--help')) {
    output({ usage: 'npm run preview:live -- [start|status|stop] [--port 4321]', scope: 'A loopback development preview for this project only.' });
    return;
  }
  if (!['start', 'status', 'stop'].includes(action)) throw new Error(`Unknown preview action: ${action}`);
  readState(root); // Unknown schemas must not create a lock, log or server record.
  let requested = 4321;
  while (argv.length) {
    const arg = argv.shift();
    if (arg !== '--port' || !argv.length) throw new Error(`Unknown preview argument: ${arg}`);
    requested = Number(argv.shift());
  }
  if (!Number.isInteger(requested) || requested < 1024 || requested > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
  const release = await lock();
  try {
    const previous = readRecord();
    if (action === 'status') {
      const running = await answers(previous);
      output({ running, ...(running ? previous : {}), restart: 'npm run preview:live' });
      if (!running) process.exitCode = 1;
      return;
    }
    if (action === 'stop') {
      if (owns(previous)) {
        process.kill(previous.pid, 'SIGTERM');
        for (let i = 0; i < 50 && owns(previous); i++) await pause(100);
        if (owns(previous)) throw new Error('Owned preview did not stop. Its process was left intact; inspect it before retrying.');
      }
      if (previous) unlinkSync(recordPath);
      output({ running: false, stopped: true });
      return;
    }
    if (await answers(previous)) { output({ running: true, reused: true, ...previous, gallery: `${previous.url}/_palate/` }); return; }
    if (owns(previous)) throw new Error('The owned preview is running but not responding. Run preview:live -- stop, inspect .palate/preview.log, then restart.');
    const port = await freePort(requested);
    const instance = randomUUID();
    const logPath = join(privateDir, 'preview.log');
    try { if (lstatSync(logPath).isSymbolicLink()) throw new Error('Preview log must not be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const log = openSync(logPath, 'a', 0o600);
    const child = spawn(process.execPath, [astroBin(), 'dev', '--host', '127.0.0.1', '--port', String(port)], {
      // This is already the detached worker. Astro 7 uses this marker for its own
      // background child, preventing a second fork and keeping PID ownership exact.
      cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, PALATE_PREVIEW_INSTANCE: instance, ASTRO_DEV_BACKGROUND: '1', ASTRO_TELEMETRY_DISABLED: '1' },
    });
    closeSync(log);
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.unref();
    let identity;
    for (let i = 0; i < 20 && !identity; i++) { identity = startIdentity(child.pid); if (!identity) await pause(50); }
    if (spawnError || !identity) throw new Error('Preview could not start. Run npm ci and inspect .palate/preview.log.');
    const record = { pid: child.pid, startIdentity: identity, cwd: root, port, url: `http://127.0.0.1:${port}`, instance, startedAt: new Date().toISOString() };
    const temporary = join(privateDir, `preview-launch-${instance}.json`);
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, recordPath);
    for (let i = 0; i < 120; i++) {
      if (await answers(record)) { output({ running: true, reused: false, ...record, gallery: `${record.url}/_palate/`, restart: 'npm run preview:live' }); return; }
      if (!owns(record)) break;
      await pause(250);
    }
    if (owns(record)) process.kill(record.pid, 'SIGTERM');
    throw new Error('Preview did not become ready. Inspect .palate/preview.log and retry npm run preview:live.');
  } finally { release(); }
}
