#!/usr/bin/env node
/**
 * .claude/hooks/anti-slop-check.js - the project-level aesthetic gate.
 *
 * Ships in templates/astro-project/_claude/ in the skill; Phase A renames
 * `_claude/` to `.claude/` (merging with the existing `.claude/` content) so
 * the final project carries this at `.claude/hooks/anti-slop-check.js`.
 *
 * Fires on every Edit / Write / MultiEdit (wired in .claude/settings.local.json).
 * Reads the tool-call payload from stdin, checks the affected file content
 * against the Critical-severity rules, and exits non-zero to block the edit if a
 * Critical violation is introduced.
 *
 * SINGLE RULE SOURCE: the rules are NOT hardcoded here. They are parsed from
 * `.claude/anti-patterns.md`, scaffolded next to this hook from the skill's
 * `references/anti-patterns.md` - the same file `scripts/ux-lint.sh` parses at
 * build time. So the lifecycle hook and the build gate cannot drift. If the
 * rules file is absent, the hook fails open (the build-time ux-lint.sh is the
 * authoritative gate; this is its post-handover counterpart).
 *
 * Per-line escape: add a `ux-lint-disable <rule-id>` comment on the same or
 * preceding line; `ux-lint-disable-all` exempts the line entirely.
 *
 * Exit codes: 0 allow, 2 block (Claude sees the message and revises).
 *
 * Note: written as ESM (`import`) because the host project's package.json
 * declares `"type": "module"`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Turn a `Files:` glob list (e.g. "*.astro,*.css") into a single extension regex.
function globsToRegex(files) {
  const exts = files
    .split(",")
    .map((g) => g.trim().replace(/^\*\./, "").replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  return new RegExp("\\.(" + exts.join("|") + ")$", "i");
}

// Parse the Critical-severity rules out of the shipped anti-patterns.md. Each
// `### Rule:` block carries Severity / Files / Pattern (a regex in backticks) / Fix.
function loadRules() {
  const rulesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "anti-patterns.md");
  let md;
  try {
    md = fs.readFileSync(rulesPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.severity === "Critical" && cur.pattern && cur.files) {
      try {
        out.push({
          id: cur.id,
          files: globsToRegex(cur.files),
          pattern: new RegExp(cur.pattern, "i"),
          fix: cur.fix || "",
        });
      } catch {
        /* a rule whose regex won't compile is skipped, never fatal */
      }
    }
    cur = null;
  };
  for (const line of md.split("\n")) {
    let m;
    if ((m = line.match(/^### Rule:\s*(.+?)\s*$/))) {
      flush();
      cur = { id: m[1] };
    } else if (!cur) {
      continue;
    } else if ((m = line.match(/^- Severity:\s*(.+?)\s*$/))) cur.severity = m[1];
    else if ((m = line.match(/^- Files:\s*(.+?)\s*$/))) cur.files = m[1];
    else if ((m = line.match(/^- Pattern:\s*`(.*)`\s*$/))) cur.pattern = m[1];
    else if ((m = line.match(/^- Fix:\s*(.+?)\s*$/))) cur.fix = m[1];
  }
  flush();
  return out;
}

const RULES = loadRules();

function readStdinJson() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractFilePath(payload) {
  if (!payload || typeof payload !== "object") return null;
  const ti = payload.tool_input || {};
  return ti.file_path || ti.filePath || ti.path || null;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function fileMatches(p) {
  const skip = ["/node_modules/", "/.git/", "/dist/", "/.astro/", "/.wrangler/", "/_explore-archive/"];
  for (const s of skip) if (p.includes(s)) return false;
  return true;
}

function findViolations(filePath, content) {
  const out = [];
  const lines = content.split("\n");
  for (const rule of RULES) {
    if (!rule.files.test(filePath)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(`ux-lint-disable ${rule.id}`)) continue;
      if (line.includes("ux-lint-disable-all")) continue;
      if (i > 0 && lines[i - 1].includes(`ux-lint-disable ${rule.id}`)) continue;
      if (rule.pattern.test(line)) {
        out.push({ rule: rule.id, line: i + 1, text: line.trim(), fix: rule.fix });
      }
    }
  }
  return out;
}

// No rules loaded (the file was not shipped) -> fail open; ux-lint.sh is the gate.
if (RULES.length === 0) process.exit(0);

const payload = readStdinJson();
const filePath = extractFilePath(payload);
if (!filePath || !fileMatches(filePath)) process.exit(0);
const content = readFileSafe(filePath);
if (content == null) process.exit(0);
const violations = findViolations(filePath, content);
if (violations.length === 0) process.exit(0);

console.error(`[anti-slop] ${violations.length} Critical violation(s) in ${filePath}:`);
for (const v of violations) {
  console.error(`  ${filePath}:${v.line}  [${v.rule}]  ${v.text}`);
  console.error(`    Fix: ${v.fix}`);
}
console.error("");
console.error("Per-line escape: add comment `ux-lint-disable <rule-id>` on the same or preceding line.");
process.exit(2);
