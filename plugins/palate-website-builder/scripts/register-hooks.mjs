#!/usr/bin/env node
/**
 * scripts/register-hooks.mjs <install|uninstall> [skillRoot]
 *
 * Idempotently registers (or removes) the Palate gate hooks in the user's
 * ~/.claude/settings.json. Install is implemented as strip-then-add, so re-running
 * it is both idempotent AND an update (it refreshes the hook paths if the skill
 * moved). Backs up settings.json first and prints every change.
 *
 * Used by scripts/install.sh; standalone-testable by setting HOME to a temp dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2] || "install";
const skillRoot = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = path.join(skillRoot, "hooks");

const home = process.env.HOME || os.homedir();
const dir = path.join(home, ".claude");
const file = path.join(dir, "settings.json");

const OURS = /palate-(manifest|pretooluse|stop)\.mjs/;
// [event, matcher (null = no tool matcher), hook script]
const ENTRIES = [
  ["PostToolUse", "mcp__palate__.*", "palate-manifest.mjs"],
  ["PostToolUse", "Edit|Write|MultiEdit", "palate-manifest.mjs"],
  ["PreToolUse", "Write|MultiEdit", "palate-pretooluse.mjs"],
  ["Stop", null, "palate-stop.mjs"],
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const settings = load();
settings.hooks = settings.hooks || {};
const changes = [];

if (fs.existsSync(file)) {
  fs.copyFileSync(file, `${file}.palate-bak`);
}

// Strip any previously-registered Palate hooks (idempotent + update-safe).
for (const ev of ["PreToolUse", "PostToolUse", "Stop"]) {
  if (!Array.isArray(settings.hooks[ev])) continue;
  const before = JSON.stringify(settings.hooks[ev]);
  settings.hooks[ev] = settings.hooks[ev]
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !OURS.test(h.command || "")) }))
    .filter((g) => (g.hooks || []).length > 0);
  if (JSON.stringify(settings.hooks[ev]) !== before) changes.push(`cleared old ${ev} entries`);
  if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
}

if (action === "install") {
  for (const [ev, matcher, base] of ENTRIES) {
    const cmd = `node "${path.join(hooksDir, base)}"`;
    const entry =
      matcher == null
        ? { hooks: [{ type: "command", command: cmd }] }
        : { matcher, hooks: [{ type: "command", command: cmd }] };
    settings.hooks[ev] = settings.hooks[ev] || [];
    settings.hooks[ev].push(entry);
    changes.push(`registered ${ev}${matcher ? ` [${matcher}]` : ""} -> ${base}`);
  }
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");

console.log(`${action === "install" ? "Installed" : "Removed"} Palate hooks in ${file}`);
for (const c of changes) console.log("  - " + c);
if (fs.existsSync(`${file}.palate-bak`)) console.log(`  (backup: ${file}.palate-bak)`);
