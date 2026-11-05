#!/usr/bin/env node
/**
 * palate.mjs - find the installed Palate plugin and run its gates.
 *
 * WHY THIS SHIPS IN THE SCAFFOLD. The plugin owns the quality tooling (ux-lint, the rendered
 * gate, the hygiene loop, the local grade), but an npm script runs in a plain shell where
 * `${CLAUDE_PLUGIN_ROOT}` does not exist. Without a resolver, a project that wants a `check`
 * script has to work out where the plugin lives, and one real build did exactly that:
 *
 *   const PLUGIN = process.env.PALATE_PLUGIN_ROOT ??
 *     "/Users/<someone>/.claude/plugins/cache/palate/palate-beta/1.13.0-beta.3";
 *
 * A version-pinned absolute path on one laptop. It broke on the next version bump, and it was
 * never going to work on a colleague's machine or in CI. That project then hand-wrote roughly
 * 1,700 lines of gates the plugin already had, because reaching them was harder than rewriting
 * them. This file is the fifteen lines that make that unnecessary.
 *
 * Usage:
 *   node scripts/palate.mjs ux-lint [dir]
 *   node scripts/palate.mjs verify --url http://localhost:4321
 *   node scripts/palate.mjs grade  --url http://localhost:4321
 *   node scripts/palate.mjs root                 # print the resolved plugin root and exit
 *
 * Exit: whatever the gate exits. 2 = the plugin could not be found (never a pass).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolution order, most explicit first. Every step is a real location the plugin is known to
 * live in; none of them is a guess about a version number.
 */
function pluginRoot() {
  const env = process.env.PALATE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  if (env && existsSync(join(env, "SKILL.md"))) return env;

  // The installed plugin records its own path, so the version never has to be guessed. Both
  // tracks are accepted: a tester on palate-beta must not silently get no gates.
  const manifest = join(homedir(), ".claude", "plugins", "installed_plugins.json");
  if (existsSync(manifest)) {
    try {
      const j = JSON.parse(readFileSync(manifest, "utf8"));
      const entries = Object.entries(j.plugins || {})
        .filter(([k]) => /^palate-(website-builder|beta)@/.test(k))
        .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
        .filter((e) => e && e.installPath && existsSync(join(e.installPath, "SKILL.md")));
      if (entries.length) return entries[0].installPath;
    } catch {
      /* a malformed manifest is not fatal; fall through to the error below */
    }
  }
  return null;
}

const GATES = {
  "ux-lint": { file: "scripts/ux-lint.sh", runner: "bash" },
  verify: { file: "scripts/reference-capture/verify-rendered.mjs", runner: "node" },
  grade: { file: "scripts/reference-capture/grade-local.mjs", runner: "node" },
  hygiene: { file: "scripts/reference-capture/hygiene-loop.mjs", runner: "node" },
  index: { file: "scripts/palate-index.mjs", runner: "node" },
};

const [, , gate, ...rest] = process.argv;
const root = pluginRoot();

if (!root) {
  console.error(
    "palate: the Palate plugin was not found, so no gate ran. This is BLOCKED, not a pass.\n" +
      "  Install it:  /plugin marketplace add jake-jiffi/palate-marketplace\n" +
      "               /plugin install palate-website-builder@palate\n" +
      "  Or point at a checkout:  PALATE_PLUGIN_ROOT=/path/to/palate-website-builder",
  );
  process.exit(2);
}

if (!gate || gate === "root") {
  console.log(root);
  process.exit(0);
}

const g = GATES[gate];
if (!g) {
  console.error(`palate: unknown gate "${gate}". Available: ${Object.keys(GATES).join(", ")}, root`);
  process.exit(2);
}

const target = join(root, g.file);
if (!existsSync(target)) {
  // A gate that is missing from the installed plugin is a real signal, usually a version older
  // than the script being asked for. Say which, rather than failing as if the gate had passed.
  console.error(
    `palate: ${gate} is not in the installed plugin at ${root}.\n` +
      "  It is probably older than this scaffold expects. Update it:\n" +
      "  /plugin marketplace update palate   (then /reload-plugins)",
  );
  process.exit(2);
}

const r = spawnSync(g.runner, [target, ...rest], { stdio: "inherit" });
process.exit(r.status === null ? 2 : r.status);
