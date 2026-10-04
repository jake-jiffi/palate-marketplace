/**
 * scripts/lib/invoked-directly.mjs - was this module run as a command, or imported?
 *
 * ===================== WHY IT IS A SHARED FILE =====================
 *
 * Fifteen scripts hand-rolled this test and every one of them was wrong through a symlinked
 * path, in one of three ways:
 *
 *   `resolve(argv[1]) === fileURLToPath(import.meta.url)`  resolve does not follow symlinks and
 *                                                          Node's loader already has
 *   `fileURLToPath(import.meta.url) === argv[1]`           neither side resolved, and a
 *                                                          relative argv fails too
 *   `import.meta.url === "file://" + argv[1]`              the same, plus it breaks on any path
 *                                                          needing URL escaping (a space, a #)
 *
 * The failure is silent and it reports success: `main()` never runs, nothing is printed, and
 * the process exits 0. An operator reads that as a tool that ran and had nothing to say. It was
 * found in `boards-render.mjs` by a real seed run from `/tmp`, which on macOS is a symlink to
 * `/private/tmp`, so every `mktemp -d` reproduces it, as does a symlinked home, a symlinked dev
 * directory, and any plugin root recorded through one.
 *
 * `templates/astro-project/scripts/palate.mjs` hands `installPath` from
 * `~/.claude/plugins/installed_plugins.json` straight to `spawnSync` without resolving it, so
 * `node scripts/palate.mjs grade` in a client project is a live route to this, not a
 * hypothetical one.
 *
 * ONE FILE RATHER THAN FIFTEEN COPIES because `scripts/` and `scripts/reference-capture/` ship
 * together and already import across that boundary (`verify-rendered.mjs` imports
 * `../palate-index.mjs`), and none of these scripts is ever fetched flat: the marketplace
 * vendors the whole tree with `git archive`, and the only file distributed on its own is the
 * scaffold's own resolver, which is not one of them.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The real path, or the path as given when it is not there. A missing file is not a match. */
const real = (p) => {
  try { return realpathSync(p); } catch { return p; }
};

/**
 * @param {string} moduleUrl the caller's `import.meta.url`
 * @param {string} [argv1] the invoked script path, defaulting to `process.argv[1]`
 * @returns {boolean} true when this module IS the script node was asked to run
 */
export function invokedDirectly(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  let self;
  try { self = fileURLToPath(moduleUrl); } catch { return false; }
  return real(resolve(argv1)) === real(self);
}
