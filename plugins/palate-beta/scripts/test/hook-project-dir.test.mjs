/**
 * hook-project-dir.test.mjs - the manifest keystone writes to the PROJECT, and counts
 * grounding from the RESULT.
 *
 * Two real faults are covered here.
 *
 * 1. PROJECT DIR DISAGREEMENT. hooks/palate-manifest.mjs wrote build-manifest.json into the
 *    SESSION cwd, while gate-done.sh derives the project from the manifest's own directory
 *    and looks for dist/, verify-report.json and .palate-shots/ beside it. SKILL.md builds
 *    under WORK_ROOT/{slug}-site and never changes directory, so on a real build the two
 *    answers were different directories, the done gate hit "no renderable preview", and the
 *    whole visual half of the suite evaluated against nothing while reading like a pass.
 *
 * 2. GROUNDING FROM THE REQUEST. Any mcp__palate__* call was recorded as grounding whether or
 *    not it returned anything, so a refused or empty refs_* call satisfied the depth gate's
 *    "the build drew on the library" test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "..", "..", "hooks", "palate-manifest.mjs");

function tmp() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "palate-hook-"));
}

// A project is package.json + src/pages, the shape gate-done.sh and gate-shipready.mjs assume.
function scaffold(dir) {
  fs.mkdirSync(path.join(dir, "src", "pages"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"site"}\n');
  return dir;
}

function fire(payload, env = {}) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PALATE_PROJECT_DIR: "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return out;
}

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

const textResult = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

test("a write into WORK_ROOT/{slug}-site files the manifest in the PROJECT, not the session cwd", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  const file = path.join(proj, "src", "pages", "index.astro");
  fs.writeFileSync(file, "<h1>hi</h1>");

  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: file }, tool_response: { ok: true } });

  assert.equal(exists(path.join(proj, "build-manifest.json")), true, "manifest must land beside the artefacts");
  assert.equal(exists(path.join(root, "build-manifest.json")), false, "nothing should be written to the session cwd");
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.project, proj);
  assert.deepEqual(m.files_written, [file]);
});

test("an MCP call with no file hint finds the same project one level down from the cwd", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));

  fire({
    cwd: root,
    tool_name: "mcp__palate__refs_get",
    tool_input: { slug: "aesop", layer: ["do_dont"] },
    tool_response: textResult({ slug: "aesop", do_dont: ["one considered idea"] }),
  });

  assert.equal(exists(path.join(proj, "build-manifest.json")), true);
  assert.equal(exists(path.join(root, "build-manifest.json")), false);
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.mcp_calls.length, 1);
  assert.deepEqual(m.references_surveyed, ["aesop"]);
});

test("two candidate projects under the cwd is ambiguous, so the cwd is used rather than a guess", () => {
  const root = tmp();
  scaffold(path.join(root, "a-site"));
  scaffold(path.join(root, "b-site"));

  fire({ cwd: root, tool_name: "mcp__palate__refs_search", tool_input: { query: "x" }, tool_response: textResult({ results: [{ slug: "linear" }] }) });

  assert.equal(exists(path.join(root, "build-manifest.json")), true, "ambiguity falls back, it does not pick");
  assert.equal(exists(path.join(root, "a-site", "build-manifest.json")), false);
});

test("PALATE_PROJECT_DIR overrides detection", () => {
  const root = tmp();
  scaffold(path.join(root, "acme-site"));
  const forced = fs.mkdirSync(path.join(root, "elsewhere"), { recursive: true }) || path.join(root, "elsewhere");

  fire(
    { cwd: root, tool_name: "mcp__palate__refs_search", tool_input: { query: "x" }, tool_response: textResult({ results: [{ slug: "linear" }] }) },
    { PALATE_PROJECT_DIR: forced },
  );

  assert.equal(exists(path.join(forced, "build-manifest.json")), true);
  assert.equal(exists(path.join(root, "acme-site", "build-manifest.json")), false);
});

test("a manifest started before the scaffold MOVES into the project, taking its diverge block", () => {
  // A build diverges before it scaffolds, so the first half of a build legitimately writes its
  // telemetry beside the cwd. If that file were orphaned there, the PreToolUse wall would read
  // an empty manifest and block the first source write of a build that had already diverged.
  const root = tmp();
  fs.writeFileSync(
    path.join(root, "build-manifest.json"),
    JSON.stringify({ schema: 3, mcp_calls: [], files_written: [], diverge: { ran: true, n: 9 }, converge: { ran: true, advanced: ["c1"] } }),
  );
  const proj = scaffold(path.join(root, "acme-site"));
  const file = path.join(proj, "src", "pages", "index.astro");
  fs.writeFileSync(file, "<h1>hi</h1>");

  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: file }, tool_response: { ok: true } });

  assert.equal(exists(path.join(root, "build-manifest.json")), false, "the old copy must not linger as a second source of truth");
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.diverge.ran, true, "the diverge block must survive the move");
  assert.equal(m.converge.advanced.length, 1);
  assert.equal(m.project, proj);
});

test("a manifest recorded for another project is not appended to", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  fs.writeFileSync(
    path.join(proj, "build-manifest.json"),
    JSON.stringify({ schema: 3, project: "/somewhere/else", mcp_calls: [{ tool: "x" }], files_written: ["/somewhere/else/a.astro"] }),
  );
  const file = path.join(proj, "src", "pages", "index.astro");
  fs.writeFileSync(file, "<h1>hi</h1>");

  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: file }, tool_response: { ok: true } });

  const m = read(path.join(proj, "build-manifest.json"));
  assert.deepEqual(m.files_written, [file], "the other project's writes must not travel");
  assert.equal(m.mcp_calls.length, 0);
  assert.equal(m.project, proj);
});

test("a write outside the detected project is recorded separately, never as part of the build", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  const inside = path.join(proj, "src", "pages", "index.astro");
  fs.writeFileSync(inside, "<h1>hi</h1>");
  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: inside }, tool_response: { ok: true } });

  const scratch = path.join(root, "scratch.mjs");
  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: scratch }, tool_response: { ok: true } });

  const m = read(path.join(proj, "build-manifest.json"));
  assert.deepEqual(m.files_written, [inside]);
  assert.deepEqual(m.files_written_outside, [scratch], "recorded, not erased");
});

test("with NO project detected, every write is still recorded (no silent filtering)", () => {
  // Filtering on a guess would empty files_written, and the Stop hook uses that to decide a
  // build happened at all. The gates would go quiet without ever saying why.
  const root = tmp();
  const file = path.join(root, "notes", "thing.astro");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");

  fire({ cwd: root, tool_name: "Write", tool_input: { file_path: file }, tool_response: { ok: true } });

  const m = read(path.join(root, "build-manifest.json"));
  assert.equal(m.project_resolved_by, "fallback");
  assert.deepEqual(m.files_written, [file]);
});

// ------------------------------------------------------------------ grounding from the result

const groundingCases = [
  {
    name: "an MCP error result is NOT grounding",
    response: { isError: true, content: [{ type: "text", text: "upstream 502" }] },
  },
  {
    name: "a structured error envelope is NOT grounding",
    response: { structuredContent: { error: "not_found" }, content: [] },
  },
  {
    name: "an error serialised into a text block is NOT grounding",
    response: textResult({ error: "quota_exceeded", upgradeUrl: "https://palatemcp.com/pricing" }),
  },
  {
    name: "an empty result set is NOT grounding",
    response: textResult({ total: 0, results: [] }),
  },
  {
    name: "no content blocks at all is NOT grounding",
    response: { content: [] },
  },
];

for (const c of groundingCases) {
  test(c.name, () => {
    const root = tmp();
    const proj = scaffold(path.join(root, "acme-site"));
    fire({
      cwd: root,
      tool_name: "mcp__palate__refs_get",
      tool_input: { slug: "aesop", layer: ["do_dont"] },
      tool_response: c.response,
    });
    const m = read(path.join(proj, "build-manifest.json"));
    assert.equal(m.mcp_calls.length, 0, "a call that returned nothing is not a call that grounded the build");
    assert.equal(m.mcp_failures.length, 1, "but it must still be visible");
    assert.deepEqual(m.references_surveyed, [], "the request named a slug the response never delivered");
    assert.deepEqual(m.layers_read, []);
  });
}

test("a result carrying real content IS grounding", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  fire({
    cwd: root,
    tool_name: "mcp__palate__refs_get",
    tool_input: { slug: "aesop", layer: ["do_dont"] },
    tool_response: textResult({ slug: "aesop", do_dont: { do: ["let the accent be punctuation"] } }),
  });
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.mcp_calls.length, 1);
  assert.equal(m.mcp_calls[0].evidence, "ok");
  assert.deepEqual(m.references_surveyed, ["aesop"]);
  assert.deepEqual(m.layers_read, ["do_dont"]);
  assert.equal(m.mcp_failures.length, 0);
});

test("a payload with no result field at all still counts (unknown must not zero out grounding)", () => {
  // If Claude Code renames the result field again, the honest failure is over-counting on one
  // build, not reporting every build on every machine as ungrounded.
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  fire({ cwd: root, tool_name: "mcp__palate__refs_search", tool_input: { query: "dental" } });
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.mcp_calls.length, 1);
  assert.equal(m.mcp_calls[0].evidence, "unknown");
});

test("a quota refusal still emits the hard-stop directive while being recorded as a failure", () => {
  const root = tmp();
  const proj = scaffold(path.join(root, "acme-site"));
  const out = fire({
    cwd: root,
    tool_name: "mcp__palate__refs_get",
    tool_input: { slug: "aesop" },
    tool_response: textResult({ error: "quota_exceeded", upgradeUrl: "https://palatemcp.com/pricing" }),
  });
  assert.match(out, /"decision":"block"/);
  const m = read(path.join(proj, "build-manifest.json"));
  assert.equal(m.mcp_calls.length, 0);
  assert.equal(m.mcp_failures.length, 1);
});
