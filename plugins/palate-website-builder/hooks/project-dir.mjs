/**
 * hooks/project-dir.mjs - resolve ONE project directory, the same way in every hook.
 *
 * THE BUG THIS EXISTS FOR. The manifest hook wrote `build-manifest.json` into the SESSION
 * cwd while gate-done.sh derives the project from the manifest's own directory and then
 * looks for `dist/`, `verify-report.json` and `.palate-shots/` beside it. SKILL.md says to
 * build under `WORK_ROOT/{slug}-site` and nothing ever changes directory, so on a real build
 * those two answers are different directories. When they disagree the done gate hits "no
 * renderable preview" and SKIPS, which means the entire visual half of the gate suite
 * evaluates against nothing and reads, in the transcript, exactly like a clean pass.
 *
 * The live proof was this repo's own root: one `build-manifest.json` holding 188 files_written
 * spanning three unrelated repositories and /tmp, because the session cwd is a workspace root
 * and every project underneath it appended to the same file.
 *
 * THE RESOLUTION ORDER, most explicit first. Every rung is bounded and does no I/O beyond a
 * handful of stats, because this runs on every single tool call.
 *   1. PALATE_PROJECT_DIR   an explicit override. It wins outright, including over detection,
 *                           because the person who set it knows something we cannot detect.
 *   2. up from the HINT     the file the tool call is writing. This is the strongest signal
 *                           available: a write into src/pages/index.astro names its project
 *                           even when the session cwd is two levels above it.
 *   3. up from the START    the session cwd, for the case where the agent is already inside
 *                           the project.
 *   4. ONE level down       the SKILL.md shape exactly: cwd is WORK_ROOT and the project is
 *                           WORK_ROOT/{slug}-site. Only taken when EXACTLY ONE child qualifies;
 *                           two candidates is ambiguity, and guessing under ambiguity is how
 *                           telemetry ends up in the wrong repo.
 *   5. the start dir        unchanged from the old behaviour, so nothing that works today breaks.
 *
 * A "project" is a directory with BOTH package.json and src/pages. Both are required:
 * package.json alone matches every repo on the machine, and src/pages alone matches a docs
 * folder. Together they are the shape gate-done.sh and gate-shipready.mjs already assume.
 *
 * WHY THE MANIFEST PATH IS CHOSEN SEPARATELY (resolveBuildContext). A build diverges BEFORE it
 * scaffolds, so for the first half of a build there is no package.json and no src/pages and the
 * only honest answer is the cwd. If readers then flipped to the project directory the moment
 * the scaffold appeared, they would read an empty manifest and the DIVERGE wall would block the
 * first source write of a build that had already diverged. So readers use whichever candidate
 * ALREADY HOLDS a manifest, and only the writer (hooks/palate-manifest.mjs) moves it, once.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Deep enough for any real tree, bounded so a symlink cycle or a pathological path cannot spin.
const MAX_UP = 12;

/**
 * THE PLUGIN IS NOT A SITE, and nothing said so.
 *
 * Every gate defaults its project to "." and this resolver falls back to the start directory
 * when it detects nothing, so a gate run from the plugin checkout measured the plugin. Its
 * doctrine files QUOTE the tells the lint hunts, its templates carry {{PLACEHOLDER}} tokens on
 * purpose, and its repo root is not anybody's website: ux-lint read 314 of the plugin's own
 * files and returned 179 findings. The hooks did the same in the other direction, writing five
 * stray build-manifest.json files inside the repo, one recording 188 files_written spanning
 * three unrelated repositories.
 *
 * IT WALKS ANCESTORS, BOUNDED BY THE GIT TOPLEVEL. Checking the candidate alone left the fault
 * half open: a session standing in `scripts/test` or `templates/astro-project` still resolved a
 * project and the manifest hook still wrote `build-manifest.json` there, which is two of the
 * five stray locations and the habit (an agent cd-ing into a subdirectory of its own build) the
 * 2026-08-28 changelog already records. The walk stops at the directory holding `.git`, so it
 * cannot reach out of the repository it started in, and there is no environment escape hatch:
 * a test that needs a fixture linted copies it to a temporary directory first, which is what
 * most of the suites here already do.
 *
 * Returns the reason to refuse, or null when the directory is fair game.
 */
export function pluginRootRefusal(dir) {
  let resolved;
  try {
    resolved = path.resolve(dir);
  } catch {
    return null; // an unresolvable path is somebody else's error, not a plugin
  }
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root && root.trim()) {
    try {
      const abs = path.resolve(root.trim());
      if (resolved === abs) return `${resolved} is CLAUDE_PLUGIN_ROOT, the Palate plugin itself, not a site`;
      if (resolved.startsWith(abs + path.sep)) return `${resolved} is inside CLAUDE_PLUGIN_ROOT (${abs}), so it is part of the Palate plugin, not a site`;
    } catch {
      /* an unresolvable override is not a reason to refuse a real project */
    }
  }

  let cur = resolved;
  for (let i = 0; i < MAX_UP; i++) {
    let isPlugin = false;
    try {
      isPlugin = fs.statSync(path.join(cur, ".claude-plugin", "plugin.json")).isFile();
    } catch {
      /* not a plugin checkout at this level */
    }
    if (isPlugin) {
      return cur === resolved
        ? `${resolved} carries .claude-plugin/plugin.json, so it is a Claude Code plugin checkout, not a site`
        : `${resolved} is inside the Claude Code plugin checkout at ${cur} (.claude-plugin/plugin.json), not a site`;
    }
    // The repository root is the ceiling. `.git` is a directory in a clone and a FILE in a
    // worktree, so existsSync rather than a directory test.
    let atRepoRoot = false;
    try {
      atRepoRoot = fs.existsSync(path.join(cur, ".git"));
    } catch {
      /* unreadable: treat as not a root and keep the MAX_UP bound */
    }
    if (atRepoRoot) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** A directory with both package.json and src/pages: the shape the gates already assume. */
export function isProjectDir(dir) {
  try {
    if (!fs.statSync(path.join(dir, "package.json")).isFile()) return false;
    return fs.statSync(path.join(dir, "src", "pages")).isDirectory();
  } catch {
    return false;
  }
}

function walkUp(from) {
  let dir;
  try {
    dir = path.resolve(from);
  } catch {
    return null;
  }
  for (let i = 0; i < MAX_UP; i++) {
    if (isProjectDir(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Exactly one qualifying child, or nothing. Ambiguity (a monorepo of sites) returns null on
// purpose: a wrong confident answer here files a build's telemetry under a different site.
// Budgeted, because this runs on every tool call and the session cwd can be anything: a
// directory big enough to exhaust the budget gives no answer rather than a slow one.
const SCAN_BUDGET = 400;
function singleChildProject(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let hit = null;
  let budget = SCAN_BUDGET;
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    if (budget-- <= 0) return null;
    const p = path.join(dir, e.name);
    if (!isProjectDir(p)) continue;
    if (hit) return null; // two candidates: ambiguous, say nothing
    hit = p;
  }
  return hit;
}

// A hint is the path of the file a tool call touched. It may not exist yet (PreToolUse) and it
// may be relative, so resolve it against the start dir and step up to its directory.
function hintDir(hint, startDir) {
  if (typeof hint !== "string" || !hint.trim()) return null;
  let abs;
  try {
    abs = path.isAbsolute(hint) ? hint : path.resolve(startDir, hint);
  } catch {
    return null;
  }
  try {
    if (fs.statSync(abs).isDirectory()) return abs;
  } catch {
    /* does not exist yet: treat it as a file path */
  }
  return path.dirname(abs);
}

/**
 * The project directory for this tool call.
 * Returns { dir, how } where `how` is one of env | hint | cwd | child | fallback | refused.
 * `how === "fallback"` means NOTHING was detected: callers must not treat that as knowledge.
 * `how === "refused"` means the candidate is the Palate plugin itself: `dir` is null and
 * `reason` says why. A caller must do NOTHING with a refusal, never fall back to the cwd.
 */
export function resolveProjectDir(startDir, opts = {}) {
  const start = (() => {
    try {
      return path.resolve(startDir || process.cwd());
    } catch {
      return process.cwd();
    }
  })();

  // Refused before every rung, the env override included: an override pointing into the plugin
  // is a mistake, not an instruction, and it is the one place where honouring it writes a
  // client's telemetry into the tool.
  const refuse = (reason) => ({ dir: null, how: "refused", reason });
  const startRefusal = pluginRootRefusal(start);
  if (startRefusal) return refuse(startRefusal);

  const env = process.env.PALATE_PROJECT_DIR;
  if (env && env.trim()) {
    try {
      const dir = path.resolve(env.trim());
      if (fs.statSync(dir).isDirectory()) {
        const r = pluginRootRefusal(dir);
        return r ? refuse(r) : { dir, how: "env" };
      }
    } catch {
      /* an override pointing at nothing is not a reason to stop: fall through to detection */
    }
  }

  const fromHint = walkUp(hintDir(opts.hint, start) || "");
  if (fromHint) {
    const r = pluginRootRefusal(fromHint);
    return r ? refuse(r) : { dir: fromHint, how: "hint" };
  }

  const fromCwd = walkUp(start);
  if (fromCwd) {
    const r = pluginRootRefusal(fromCwd);
    return r ? refuse(r) : { dir: fromCwd, how: "cwd" };
  }

  const child = singleChildProject(start);
  if (child) {
    const r = pluginRootRefusal(child);
    return r ? refuse(r) : { dir: child, how: "child" };
  }

  return { dir: start, how: "fallback" };
}

const MANIFEST_NAME = "build-manifest.json";

function hasManifest(dir) {
  try {
    return fs.statSync(path.join(dir, MANIFEST_NAME)).isFile();
  } catch {
    return false;
  }
}

/**
 * Where this build's manifest is, and where it BELONGS.
 *
 * Readers use `manifest` and get the file that actually exists, so a build mid-scaffold is
 * never read as a build with no history. The writer additionally sees `detected` and `stale`
 * so it can move the file once, at the moment the project directory first appears.
 *
 *   dir        the project directory to resolve artefacts against (dist/, .palate-shots/, ...)
 *   manifest   the manifest path to READ (the one that exists, when only one does)
 *   detected   the project directory, or null when nothing was detected (how === "fallback")
 *   stale      a manifest at the start dir that belongs in `detected` and has not moved yet
 */

/**
 * The nearest EXISTING manifest at or above a directory, or null.
 *
 * THE BUG THIS EXISTS FOR, seen on a live client build. An agent `cd`s into a subdirectory
 * during a build (reading donors under `.palate/harvest`, say), the Palate calls it makes from
 * there resolve to that subdirectory because no project shape is detectable inside it, and both
 * the manifest AND the journal get written there instead. The build's real manifest, sitting two
 * levels up with everything else in it, is ignored. The depth gate then reported "0 references
 * surveyed" on a build that had made 23 calls, and the agent had to hand-write a script to merge
 * three scattered journals back together before it could proceed.
 *
 * A build's manifest is at or above the working directory essentially always, so look up before
 * falling back to the cwd. BOUNDED so it cannot reach into an unrelated project: it stops at a
 * repository root (the directory holding `.git` is checked, nothing above it is), at the HOME
 * directory (never checked: a manifest in `~` or above it belongs to nobody), and at MAX_UP
 * either way.
 *
 * THE HOME CEILING WAS MISSING, AND A REAL BUILD LOST ITS SURVEY TO IT. A client build ran in a
 * plain folder under ~/dev with no `.git`, so the repo-root ceiling never applied, the walk
 * reached `~/build-manifest.json` (a stray one that had been absorbing calls from every
 * repo-less session since June) and recorded every survey call of the build there, under
 * `project: /Users/<user>`. The build's own directory held no manifest and no journal, so the
 * depth gate would have read 66 calls as zero.
 */
function homeDir() {
  try {
    return path.resolve(os.homedir());
  } catch {
    return null;
  }
}

function manifestAbove(from) {
  let dir;
  try {
    dir = path.resolve(from);
  } catch {
    return null;
  }
  const home = homeDir();
  for (let i = 0; i < MAX_UP; i++) {
    // HOME (or anything above it) is never a build: stop BEFORE looking there.
    if (home && (dir === home || home.startsWith(dir + path.sep) || path.dirname(dir) === dir)) return null;
    if (hasManifest(dir)) return dir;
    // A repo root is the ceiling: a manifest above it belongs to something else.
    let atRepoRoot = false;
    try {
      atRepoRoot = fs.existsSync(path.join(dir, ".git"));
    } catch {
      /* unreadable: treat as not a root and keep the MAX_UP bound */
    }
    if (atRepoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function resolveBuildContext(startDir, opts = {}) {
  const start = (() => {
    try {
      return path.resolve(startDir || process.cwd());
    } catch {
      return process.cwd();
    }
  })();
  const { dir, how, reason } = resolveProjectDir(start, opts);
  // A refusal is not a project with a caveat, it is the absence of one. Hand back nothing to
  // read and nothing to write, so a caller that ignores `how` still cannot touch the plugin.
  if (how === "refused") return { dir: null, how, reason, detected: null, manifest: null, stale: null };
  const detected = how === "fallback" ? null : dir;

  // An explicit override is an instruction, not a guess: never second-guess it with the cwd.
  if (how === "env") {
    return { dir, how, detected, manifest: path.join(dir, MANIFEST_NAME), stale: null };
  }

  if (detected && detected !== start && !hasManifest(detected) && hasManifest(start)) {
    // The project exists but its manifest has not moved there yet. Read the one that exists;
    // the writer moves it. Reporting `dir` as the project (not the start dir) is deliberate:
    // artefacts already live beside the project, and that is the disagreement being closed.
    return {
      dir,
      how,
      detected,
      manifest: path.join(start, MANIFEST_NAME),
      stale: path.join(start, MANIFEST_NAME),
    };
  }

  // NOTHING WAS DETECTED and the cwd holds no manifest: before accepting the cwd, look UP for one
  // that already exists. This is the case where an agent has stepped into a subdirectory of its
  // own build, and writing a second manifest there fragments the evidence the gates read.
  if (how === "fallback" && !hasManifest(dir)) {
    const above = manifestAbove(dir);
    if (above && above !== dir) {
      return { dir: above, how: "ancestor", detected: above, manifest: path.join(above, MANIFEST_NAME), stale: null };
    }
  }

  return { dir, how, detected, manifest: path.join(dir, MANIFEST_NAME), stale: null };
}
