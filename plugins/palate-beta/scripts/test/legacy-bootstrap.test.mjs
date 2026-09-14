import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK = path.join(ROOT, "hooks/palate-manifest.mjs");
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "palate-legacy-start-")));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, PALATE_PROJECT_DIR: "", CLAUDE_PLUGIN_ROOT: ROOT };
function folder(name) { const dir = path.join(scratch, name); fs.mkdirSync(dir, { recursive: true }); return dir; }
function bootstrap(dir, extra = {}) {
  return spawnSync(process.execPath, [HOOK, "--init-legacy", "--project", dir], { encoding: "utf8", env: { ...env, ...extra }, timeout: 15000 });
}
function fire(dir, response = { content: [{ type: "text", text: '{"results":[{"slug":"aesop"}]}' }] }) {
  return spawnSync(process.execPath, [HOOK], { encoding: "utf8", env, timeout: 15000,
    input: JSON.stringify({ cwd: dir, tool_name: "mcp__palate__refs_search", tool_input: { query: "fixture" }, tool_response: response }),
  });
}
function marker(dir, value = {}) {
  const data = JSON.stringify({ schema: 1, workflow: "live-design", stage: "initialising", projectId: "fixture", revision: 1,
    runtime: { digest: "0".repeat(64) }, directions: [], verification: [], operations: [], ...value });
  fs.writeFileSync(path.join(dir, "palate.project.json"), data);
  return data;
}
function noLegacy(dir) {
  assert.equal(fs.existsSync(path.join(dir, "build-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(dir, ".palate/mcp-journal.jsonl")), false);
}

test("an MCP result before init leaves the target empty and real live init succeeds", () => {
  const dir = folder("before-init");
  assert.equal(fire(dir).status, 0); assert.deepEqual(fs.readdirSync(dir), []);
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/palate.mjs"), "init", "--project", dir, "--expect", "0", "--op", "bootstrap-boundary"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "palate.project.json"))).workflow, "live-design");
  noLegacy(dir);
});

test("markerless source inspection and quota refusal never create telemetry state", () => {
  const dir = folder("source-only"); fs.writeFileSync(path.join(dir, "source.txt"), "Keep this source");
  assert.equal(fire(dir).status, 0);
  const quota = fire(dir, { content: [{ type: "text", text: '{"error":"quota_exceeded","upgradeUrl":"https://palatemcp.com/pricing"}' }] });
  assert.equal(quota.status, 0); assert.equal(JSON.parse(quota.stdout).decision, "block");
  assert.match(JSON.parse(quota.stdout).reason, /STOP DEEP READS/);
  assert.deepEqual(fs.readdirSync(dir), ["source.txt"]);
  assert.equal(fs.readFileSync(path.join(dir, "source.txt"), "utf8"), "Keep this source");
});

test("explicit bootstrap is byte-preserving on repeat and its early journal restores deletion", () => {
  const dir = folder("repeat"); const manifest = path.join(dir, "build-manifest.json");
  assert.equal(bootstrap(dir).status, 0); const first = fs.readFileSync(manifest);
  assert.equal(fs.statSync(manifest).mode & 0o777, 0o600);
  assert.equal(bootstrap(dir).status, 0); assert.deepEqual(fs.readFileSync(manifest), first);
  assert.equal(fire(dir).status, 0); const recorded = fs.readFileSync(manifest);
  assert.equal(bootstrap(dir).status, 0); assert.deepEqual(fs.readFileSync(manifest), recorded);
  fs.unlinkSync(manifest); assert.equal(fire(dir).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(manifest)).mcp_calls.length, 2);
});

test("bootstrap preserves corrupt, redirected and dangling existing records", () => {
  for (const kind of ["corrupt", "symlink", "dangling"]) {
    const dir = folder(`existing-${kind}`), manifest = path.join(dir, "build-manifest.json");
    const external = path.join(scratch, `external-${kind}.json`);
    if (kind === "corrupt") fs.writeFileSync(manifest, "not valid JSON{");
    else { if (kind === "symlink") fs.writeFileSync(external, '{"kept":true}'); fs.symlinkSync(external, manifest); }
    const result = bootstrap(dir); assert.equal(result.status, 2, kind); assert.match(result.stderr, /Legacy start refused/);
    if (kind === "corrupt") assert.equal(fs.readFileSync(manifest, "utf8"), "not valid JSON{");
    else { assert.equal(fs.readlinkSync(manifest), external); assert.equal(fs.existsSync(external), kind === "symlink"); }
    if (kind === "symlink") assert.equal(fs.readFileSync(external, "utf8"), '{"kept":true}');
    assert.deepEqual(fs.readdirSync(dir), ["build-manifest.json"]);
  }
});

test("direct and ancestor live, unknown or corrupt markers refuse bootstrap without changing bytes", () => {
  for (const kind of ["live", "unknown", "corrupt"]) {
    const dir = folder(`marker-${kind}`), child = path.join(dir, "child"); fs.mkdirSync(child);
    const data = kind === "corrupt" ? "{" : marker(dir, kind === "unknown" ? { schema: 999 } : {});
    if (kind === "corrupt") fs.writeFileSync(path.join(dir, "palate.project.json"), data);
    for (const target of [dir, child]) { assert.equal(bootstrap(target).status, 2, `${kind}: ${target}`); noLegacy(target); }
    assert.equal(fs.readFileSync(path.join(dir, "palate.project.json"), "utf8"), data);
    assert.deepEqual(fs.readdirSync(child), []);
  }
});

test("both lexical and canonical symlink project boundaries remain read-only", () => {
  const live = folder("symlink-live"), outside = folder("symlink-outside"); marker(live);
  const outward = path.join(live, "outward"), inward = path.join(outside, "inward");
  fs.symlinkSync(outside, outward); fs.symlinkSync(live, inward);
  for (const target of [outward, inward]) assert.equal(bootstrap(target).status, 2, target);
  noLegacy(live); noLegacy(outside);
  assert.equal(fs.readlinkSync(outward), outside); assert.equal(fs.readlinkSync(inward), live);
});

test("bootstrap refuses the plugin itself through a symlink", () => {
  const linked = path.join(scratch, "plugin-link"); fs.symlinkSync(ROOT, linked);
  const before = fs.existsSync(path.join(ROOT, "build-manifest.json"));
  assert.equal(bootstrap(linked).status, 2);
  assert.equal(fs.existsSync(path.join(ROOT, "build-manifest.json")), before);
});

// These two tests pause at the exclusive-create boundary in the child process. They
// model live init's actual atomic directory rename and a competing legacy writer.
function atCreate(dir, action) {
  const preload = path.join(scratch, `${path.basename(dir)}.cjs`);
  fs.writeFileSync(preload, `const fs = require('node:fs'); const original = fs.openSync; const originalWrite = fs.writeFileSync;
let fired = false;
function intervene(file, flags) {
  if (!fired && file === process.env.PALATE_TEST_TARGET && flags === 'wx') { fired = true; ${action} }
}
fs.openSync = function(file, flags, ...rest) {
  intervene(file, flags);
  return original.call(this, file, flags, ...rest);
};
fs.writeFileSync = function(file, data, options) {
  intervene(file, options && options.flag);
  return originalWrite.call(this, file, data, options);
};`);
  return { ...env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${preload}`, PALATE_TEST_TARGET: path.join(dir, "build-manifest.json") };
}

test("live init winning immediately before create leaves only live state", () => {
  const dir = folder("init-wins"), staging = folder("init-staging"), bytes = marker(staging);
  const result = bootstrap(dir, { ...atCreate(dir, "fs.renameSync(process.env.PALATE_TEST_STAGING, require('node:path').dirname(file));"), PALATE_TEST_STAGING: staging });
  assert.equal(result.status, 2, result.stderr); noLegacy(dir);
  assert.equal(fs.readFileSync(path.join(dir, "palate.project.json"), "utf8"), bytes);
  assert.deepEqual(fs.readdirSync(dir), ["palate.project.json"]);
});

test("a competing writer's manifest is never overwritten or removed", () => {
  const dir = folder("writer-wins"), bytes = '{"schema":3,"kept":"another writer"}';
  const result = bootstrap(dir, { ...atCreate(dir, "const fd = original.call(this, file, 'wx', 0o600); fs.writeFileSync(fd, process.env.PALATE_TEST_BYTES); fs.closeSync(fd);"), PALATE_TEST_BYTES: bytes });
  assert.equal(result.status, 2); assert.equal(fs.readFileSync(path.join(dir, "build-manifest.json"), "utf8"), bytes);
  assert.deepEqual(fs.readdirSync(dir), ["build-manifest.json"]);
});

test("conflict cleanup preserves a replacement manifest with another inode", () => {
  const dir = folder("replacement-wins"), bytes = '{"kept":"replacement writer"}';
  const markerSource = folder("replacement-marker"), liveBytes = marker(markerSource);
  const action = `fs.writeFileSync = function(value, data, options) {
    const result = originalWrite.call(this, value, data, options);
    if (typeof value === 'number') {
      fs.unlinkSync(file);
      originalWrite.call(this, file, process.env.PALATE_TEST_BYTES, { flag: 'wx' });
      originalWrite.call(this, require('node:path').join(require('node:path').dirname(file), 'palate.project.json'), process.env.PALATE_TEST_MARKER);
    }
    return result;
  };`;
  const result = bootstrap(dir, { ...atCreate(dir, action), PALATE_TEST_BYTES: bytes, PALATE_TEST_MARKER: liveBytes });
  assert.equal(result.status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "build-manifest.json"), "utf8"), bytes);
  assert.equal(fs.readFileSync(path.join(dir, "palate.project.json"), "utf8"), liveBytes);
});

test("concurrent explicit starts never corrupt or truncate a manifest", async () => {
  const dir = folder("parallel-start"), run = promisify(execFile);
  const results = await Promise.allSettled([1, 2, 3].map(() => run(process.execPath, [HOOK, "--init-legacy", "--project", dir], { env, timeout: 15000 })));
  assert.ok(results.some(result => result.status === "fulfilled"));
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, 2);
  const file = path.join(dir, "build-manifest.json"), before = fs.readFileSync(file);
  assert.equal(JSON.parse(before).project, dir); assert.equal(bootstrap(dir).status, 0);
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(dir), ["build-manifest.json"]);
});
