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
import path from "node:path";

// Deep enough for any real tree, bounded so a symlink cycle or a pathological path cannot spin.
const MAX_UP = 12;

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
 * Returns { dir, how } where `how` is one of env | hint | cwd | child | fallback.
 * `how === "fallback"` means NOTHING was detected: callers must not treat that as knowledge.
 */
export function resolveProjectDir(startDir, opts = {}) {
  const start = (() => {
    try {
      return path.resolve(startDir || process.cwd());
    } catch {
      return process.cwd();
    }
  })();

  const env = process.env.PALATE_PROJECT_DIR;
  if (env && env.trim()) {
    try {
      const dir = path.resolve(env.trim());
      if (fs.statSync(dir).isDirectory()) return { dir, how: "env" };
    } catch {
      /* an override pointing at nothing is not a reason to stop: fall through to detection */
    }
  }

  const fromHint = walkUp(hintDir(opts.hint, start) || "");
  if (fromHint) return { dir: fromHint, how: "hint" };

  const fromCwd = walkUp(start);
  if (fromCwd) return { dir: fromCwd, how: "cwd" };

  const child = singleChildProject(start);
  if (child) return { dir: child, how: "child" };

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
export function resolveBuildContext(startDir, opts = {}) {
  const start = (() => {
    try {
      return path.resolve(startDir || process.cwd());
    } catch {
      return process.cwd();
    }
  })();
  const { dir, how } = resolveProjectDir(start, opts);
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

  return { dir, how, detected, manifest: path.join(dir, MANIFEST_NAME), stale: null };
}
