import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { editedPaths, inspectWorkflow } from "../lib/workflow-route.mjs";
import { mergeManifest } from "../gate-board-judge.mjs";
import { writeCanvasJson } from "../boards-render.mjs";

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "palate-live-routing-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function site(label, state = { schema: 1, workflow: "live-design", stage: "designing", projectId: label, revision: 1, runtime: { version: "1.18.0", digest: "0".repeat(64) }, directions: [], selection: null, verification: [], operations: [], profile: null }) {
  const root = path.join(scratch, label);
  fs.mkdirSync(path.join(root, "src/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"private":true}');
  fs.writeFileSync(path.join(root, "src/pages/index.astro"), "<h1>Kept</h1>");
  fs.writeFileSync(path.join(root, "palate.project.json"), typeof state === "string" ? state : JSON.stringify(state));
  return root;
}
function snapshot(root) {
  const output = {};
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name), rel = path.relative(root, file);
      if (item.isDirectory()) walk(file);
      else output[rel] = item.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : fs.readFileSync(file).toString("base64");
    }
  }
  walk(root); return output;
}
function command(script, args, cwd, env = {}) {
  return spawnSync(script.endsWith(".sh") ? "bash" : process.execPath, [path.join(PACKAGE, "scripts", script), ...args], {
    cwd, encoding: "utf8", timeout: 10000, env: { ...process.env, PALATE_PROJECT_DIR: "", ...env },
  });
}
function hook(name, payload, env = {}) {
  return spawnSync(process.execPath, [path.join(PACKAGE, "hooks", `palate-${name}.mjs`)], {
    input: JSON.stringify(payload), encoding: "utf8", timeout: 10000,
    env: { ...process.env, PALATE_PROJECT_DIR: "", ...env },
  });
}

test("native patch paths include all additions, updates, deletions and moves once", () => {
  const cwd = site("patch");
  const files = editedPaths({ cwd, tool_name: "apply_patch", tool_input: { command:
    "*** Begin Patch\n*** Add File: src/a.astro\n+x\n*** Update File: src/b.astro\n*** Move to: src/c.astro\n*** Delete File: src/a.astro\n*** End Patch" } });
  assert.deepEqual(files, ["src/a.astro", "src/b.astro", "src/c.astro"].map(file => path.join(cwd, file)));
});

test("every legacy semantic writer refuses before changing a new project", () => {
  const root = site("writers"), nested = path.join(root, "src/pages");
  const before = snapshot(root);
  const calls = [
    ["state-init.sh", ["kept", "Kept", "example.test", "--force"], nested],
    ["state-update.sh", ["set", ".stage", '"production"'], nested],
    ["promote-to-production.sh", [], nested],
    ["create-palate.sh", [root], scratch],
    ["create-palate.sh", [path.join(root, "child")], scratch],
    ["manifest-merge.mjs", ["--manifest", path.join(root, "build-manifest.json"), "--set", '{"forbidden":true}'], scratch],
    ["manifest-merge.mjs", ["--gates-off"], nested],
    ["palate-pick.mjs", [root, "b1"], scratch],
    ["boards-render.mjs", [root], scratch],
    ["gate-board-judge.mjs", [root], scratch],
    ["gate-page-judge.mjs", ["--check", root], scratch],
    ["kit-survey-snapshot.mjs", [path.join(root, "build-manifest.json")], scratch],
  ];
  for (const [script, args, cwd] of calls) {
    const result = command(script, args, cwd);
    assert.notEqual(result.status, 0, `${script} unexpectedly succeeded: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /live-design|legacy workflow/ , `${script} did not reach the workflow guard: ${result.stderr}`);
    assert.deepEqual(snapshot(root), before, `${script} changed files before refusing`);
  }
  assert.match(mergeManifest(root, { forbidden: true }, () => true), /live-design/);
  assert.deepEqual(snapshot(root), before);
});

test("new reader and gate routes do not fall back to absent legacy evidence", () => {
  const root = site("readers");
  for (const [script, args] of [
    ["state-resume.sh", []], ["gate-done.sh", []], ["gate-mcp-depth.sh", []],
    ["gate-explore.mjs", [root]], ["gate-look.mjs", [root]], ["gate-fidelity.mjs", [root]],
    ["gate-shipready.mjs", [root]], ["gate-client-imagery.mjs", [root]],
    ["gate-novelty.mjs", ["--manifest", path.join(root, "build-manifest.json")]],
    ["gate-uniqueness.mjs", ["--project", root]], ["verify-is-real-astro.sh", []],
  ]) {
    const result = command(script, args, root);
    assert.equal(result.status, 2, `${script}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /project runtime is missing/);
  }
});

test("unknown, corrupt, conflicting and nested new identities are never legacy", () => {
  const unknown = site("future", { schema: 999, workflow: "live-design" });
  const corrupt = site("corrupt", "{not json");
  const conflicting = site("conflicting");
  fs.writeFileSync(path.join(conflicting, "build-manifest.json"), '{"schema":3}');
  const parent = site("parent"), child = site("parent/child");
  for (const root of [unknown, corrupt, conflicting, child]) {
    assert.equal(inspectWorkflow([root]).kind, "unsupported");
    const before = snapshot(root);
    const result = command("state-init.sh", ["x", "x", "x", "--force"], root);
    assert.equal(result.status, 2);
    assert.deepEqual(snapshot(root), before);
  }
  assert.equal(inspectWorkflow([parent]).kind, "live");
});

test("new hooks route before gates-off writes, and native edit evidence is idempotent", () => {
  const root = site("hooks");
  const payload = { cwd: root, tool_name: "apply_patch", tool_use_id: "real-shape-1", tool_input: {
    command: "*** Begin Patch\n*** Update File: src/pages/index.astro\n@@\n-x\n+y\n*** Add File: src/pages/about.astro\n+z\n*** End Patch",
  } };
  const initial = fs.readFileSync(path.join(root, "palate.project.json"), "utf8");
  for (const name of ["pretooluse", "stop", "sessionstart", "manifest", "manifest"]) {
    const result = hook(name, payload, { PALATE_GATE_OFF: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(root, "build-manifest.json")), false);
    assert.equal(fs.existsSync(path.join(root, ".palate-skill-state.json")), false);
    assert.equal(fs.readFileSync(path.join(root, "palate.project.json"), "utf8"), initial);
  }
  const events = fs.readdirSync(path.join(root, ".palate/events"));
  assert.equal(events.length, 1);
  const event = JSON.parse(fs.readFileSync(path.join(root, ".palate/events", events[0]), "utf8"));
  assert.deepEqual(event.paths, ["src/pages/index.astro", "src/pages/about.astro"]);
  assert.equal("command" in event, false);
});

test("a patch crossing projects is refused without assigning it to the first file", () => {
  const a = site("mixed-a"), b = site("mixed-b");
  const payload = { cwd: scratch, tool_name: "apply_patch", tool_use_id: "cross", tool_input: {
    command: `*** Begin Patch\n*** Update File: ${a}/src/pages/index.astro\n*** Update File: ${b}/src/pages/index.astro\n*** End Patch`,
  } };
  const before = [snapshot(a), snapshot(b)];
  const result = hook("pretooluse", payload);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  hook("manifest", payload);
  assert.deepEqual([snapshot(a), snapshot(b)], before);
});

test("a detected new child never adopts its parent workspace's old manifest", () => {
  const parent = path.join(scratch, "adoption");
  const root = site("adoption/site");
  fs.writeFileSync(path.join(parent, "build-manifest.json"), '{"schema":3,"kept":true}');
  const before = snapshot(parent);
  for (const name of ["manifest", "pretooluse", "stop"]) {
    const result = hook(name, { cwd: parent, tool_name: "mcp__palate__refs_get", tool_input: {} }, { PALATE_GATE_OFF: "1" });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(snapshot(parent), before);
  assert.equal(fs.existsSync(path.join(root, "build-manifest.json")), false);
});

test("legacy state initialisation and recording still execute", () => {
  const root = site("legacy");
  fs.unlinkSync(path.join(root, "palate.project.json"));
  const init = command("state-init.sh", ["legacy", "Legacy", "example.test"], root);
  assert.equal(init.status, 0, init.stderr);
  const result = hook("manifest", { cwd: root, tool_name: "Write", tool_input: { file_path: path.join(root, "src/pages/index.astro") } });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "build-manifest.json"), "utf8"));
  assert.equal(manifest.schema, 3);
  assert.ok(manifest.files_written.some(file => file.endsWith("index.astro")));
});

test("a symlink into a nested source directory cannot hide its live project from direct writers", () => {
  const root = site("alias-source");
  const alias = path.join(scratch, "alias-into-source");
  fs.symlinkSync(path.join(root, "src"), alias);
  const target = path.join(alias, "build-manifest.json");
  fs.writeFileSync(target, '{"schema":3,"keep":true}');
  const before = snapshot(root);
  const result = command("manifest-merge.mjs", ["--manifest", target, "--set", '{"forbidden":true}'], scratch);
  assert.notEqual(result.status, 0, `${result.stdout} ${result.stderr}`);
  assert.deepEqual(snapshot(root), before);
  const bootstrap = command("create-palate.sh", [path.join(alias, "new-child")], scratch);
  assert.notEqual(bootstrap.status, 0);
  assert.match(bootstrap.stderr, /live-design/);
  assert.deepEqual(snapshot(root), before);
});

test("schema-one corruption remains read-only even for optional hook evidence", () => {
  const root = site("malformed-v1", { schema: 1, workflow: "live-design", stage: "designing" });
  const before = snapshot(root);
  const payload = { cwd: root, tool_name: "Write", tool_use_id: "malformed-write", tool_input: { file_path: path.join(root, "src/pages/index.astro") } };
  const pre = hook("pretooluse", payload);
  assert.equal(JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision, "deny");
  hook("manifest", payload);
  assert.equal(inspectWorkflow([root]).kind, "unsupported");
  assert.deepEqual(snapshot(root), before);
});

test("board writers guard their output destination as well as their source", () => {
  const root = site("board-output");
  const legacy = path.join(scratch, "legacy-board-source"); fs.mkdirSync(legacy);
  const before = snapshot(root);
  assert.throws(() => writeCanvasJson({ boards: [], out: path.join(root, 'canvas.json') }), /live-design/);
  const result = command("boards-render.mjs", [legacy, "--out", path.join(root, '.palate/boards')], scratch);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /live-design/);
  assert.deepEqual(snapshot(root), before);
});
