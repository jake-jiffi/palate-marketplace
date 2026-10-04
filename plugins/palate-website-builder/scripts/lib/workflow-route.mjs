import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { invokedDirectly } from "./invoked-directly.mjs";
import { validateState, LEGACY_MARKERS } from "../live/project.mjs";

const MARKER = "palate.project.json";

function present(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function canonicalTarget(target) {
  let current = path.resolve(target);
  const missing = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...missing); } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.unshift(path.basename(current)); current = parent;
    }
  }
}

/** Detect identity before any legacy writer, including before a scaffold exists. */
export function inspectWorkflow(targets = [process.cwd()]) {
  const roots = new Map();
  try {
    // Inspect both names: a symlink into src must find its real root, and a symlink
    // pointing out of a project must not conceal the lexical project boundary.
    const starts = targets.filter(Boolean).flatMap(target => [path.resolve(target), canonicalTarget(target)]);
    for (const target of new Set(starts)) {
      let dir = path.resolve(target);
      try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch {
        // A new source file need not exist yet. Its parent still identifies the project.
        if (path.extname(dir)) dir = path.dirname(dir);
      }
      for (;;) {
        const marker = path.join(dir, MARKER);
        if (present(marker)) {
          const stat = fs.lstatSync(marker);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${marker} must be a normal file`);
          const real = fs.realpathSync(dir);
          const state = validateState(JSON.parse(fs.readFileSync(marker, "utf8")));
          if (LEGACY_MARKERS.some(legacy => present(path.join(dir, legacy)))) {
            throw new Error(`Conflicting new and legacy state at ${dir}`);
          }
          roots.set(real, { root: real, state });
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    if (roots.size > 1) throw new Error("Multiple Palate projects were named; run each operation in its own project");
    return roots.size ? { kind: "live", ...roots.values().next().value } : { kind: "legacy" };
  } catch (error) {
    return { kind: "unsupported", error: error.message };
  }
}

/** Only file paths are retained. Tool text/results can contain credentials or customer data. */
export function editedPaths(payload) {
  const input = payload.tool_input || {};
  const cwd = payload.cwd || process.cwd();
  if (payload.tool_name === "apply_patch") {
    const patch = typeof input.command === "string" ? input.command : "";
    const names = [];
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
      if (match) names.push(path.resolve(cwd, match[1]));
    }
    return [...new Set(names)];
  }
  const file = input.file_path || input.filePath || input.path;
  return typeof file === "string" ? [path.resolve(cwd, file)] : [];
}

/**
 * Whether a file sits inside some other Palate project, live or legacy. The walk stops below the
 * home directory: stray legacy state in HOME (a ~/build-manifest.json is common) is not a project,
 * and counting it would refuse every write outside the current one.
 */
function insidePalateProject(file) {
  const home = canonicalTarget(os.homedir());
  let dir = path.dirname(file);
  for (;;) {
    if (dir === home) return false;
    if (present(path.join(dir, MARKER)) || LEGACY_MARKERS.some(marker => present(path.join(dir, marker)))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function hookWorkflow(payload, additional = []) {
  let files;
  try { files = editedPaths(payload).map(canonicalTarget); }
  catch (error) { return { kind: "unsupported", error: error.message }; }
  const result = inspectWorkflow([payload.cwd || process.cwd(), ...files, ...additional]);
  if (result.kind !== "live") return { ...result, files };
  // A live project may write outside itself (notes, memory, another tool's config), which is
  // how legacy behaved. Writing into another Palate project from here is still refused, because
  // that project's records would change without its own workflow knowing.
  const outside = files.filter(file => {
    const rel = path.relative(result.root, file);
    return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  });
  if (outside.some(insidePalateProject)) {
    return { kind: "unsupported", error: "The edit reaches into another Palate project; run it from that project" };
  }
  return { ...result, files: files.filter(file => !outside.includes(file)) };
}

export function reportRoute(result, operation) {
  const message = result.kind === "unsupported" ? result.error
    : `${operation} belongs to the legacy workflow. Use this project's scripts/palate.mjs commands.`;
  process.stderr.write(`[palate] ${message}\n`);
}

export function refuseLegacy(targets, operation) {
  const result = inspectWorkflow(targets);
  if (result.kind === "legacy") return false;
  reportRoute(result, operation);
  const error = new Error(result.kind === "unsupported" ? result.error : `Cannot run legacy ${operation} in a live-design project`);
  error.code = "PALATE_WORKFLOW";
  throw error;
}

/** Shell callers distinguish an already handled live reader (10) from legacy (0). */
export function routeCommand(kind, operation, targets) {
  const result = inspectWorkflow(targets);
  if (result.kind === "legacy") return 0;
  if (result.kind === "unsupported" || kind === "writer") {
    reportRoute(result, operation);
    return 2;
  }
  const wrapper = path.join(result.root, "scripts", "palate.mjs");
  if (!present(wrapper)) {
    process.stderr.write("[palate] The project runtime is missing; restore its pinned files before continuing.\n");
    return 2;
  }
  const args = kind === "gate" ? ["verify", "--check"] : ["status"];
  const child = spawnSync(process.execPath, [wrapper, ...args, "--project", result.root], { stdio: "inherit" });
  return child.status === 0 ? 10 : (child.status || 2);
}

export function routeOrExit(kind, operation, targets) {
  const code = routeCommand(kind, operation, targets);
  if (code !== 0) process.exit(code === 10 ? 0 : code);
}

if (invokedDirectly(import.meta.url)) {
  const [kind, operation, ...targets] = process.argv.slice(2);
  if (!["reader", "gate", "writer"].includes(kind) || !operation) {
    process.stderr.write("Usage: workflow-route.mjs <reader|gate|writer> <operation> [targets...]\n");
    process.exit(2);
  }
  process.exit(routeCommand(kind, operation, targets.length ? targets : [process.cwd()]));
}
