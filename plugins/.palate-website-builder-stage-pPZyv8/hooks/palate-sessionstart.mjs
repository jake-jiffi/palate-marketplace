#!/usr/bin/env node
/**
 * hooks/palate-sessionstart.mjs - one line of state when a session opens (SessionStart).
 *
 * A session opens with no memory of the last one. The facts that matter on the first turn are
 * small and already on disk: is the index behind the source, did the last check catch something
 * that still blocks, has a route moved away from the baseline it is judged against, and has
 * nothing gone up in two months. Reporting them costs nothing and stops the first answer of the
 * session being confidently based on a stale index.
 *
 * THE WHOLE CONTRACT:
 *   - QUIET when there is nothing to say. Silence is the default and the common case. A hook that
 *     speaks every session is a hook people learn to skim, and then it cannot warn them.
 *   - ONE line. Not a report. `/palate-website-builder:status` is the report.
 *   - NEVER blocks and exits 0 always, including on a malformed payload, an unreadable file or a
 *     thrown error. Nothing here is worth costing someone a session.
 *   - SINGLE-DIGIT MILLISECONDS of its own work. Everything is an fs read against a file that is
 *     already small, every walk is bounded and exits on its first hit, and nothing spawns a
 *     process, imports a sibling module, touches git or opens a socket. PALATE_HOOK_TIMING=1
 *     prints the real figure to stderr.
 *
 * It reports facts, never verdicts. "The index is behind" is a fact; "your site is broken" is a
 * judgement this hook has not earned, because it has rendered nothing and run no check.
 */
import fs from "node:fs";
import path from "node:path";

// A source file newer than its baseline by less than this is checkout noise, not an edit. See
// staleBaselines() for why the comparison is mtime-to-mtime rather than mtime-to-timestamp.
const BASELINE_GRACE_MS = 30_000;
// palate-index.mjs writes the index AFTER reading src, so a fresh index is always strictly newer
// than its sources and a real edit lands seconds later at the very least. Anything inside a second
// is filesystem timestamp rounding, not a person typing.
const INDEX_GRACE_MS = 2_000;
const STALE_DAYS = 60; // matches the STALE block in commands/status.md; keep the two in step
// Dirents, not files: a hard ceiling on the only unbounded loop here. Measured on this machine a
// cold statSync is ~7us and a warm one ~2us, so 800 is ~5.6ms in the worst case and the whole hook
// stays inside single digits even on a cold cache. A tree big enough to exhaust it goes quiet.
const WALK_BUDGET = 800;
const MAX_CLAUSES = 4;

const started = process.hrtime.bigint();

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The last parseable JSON line of a JSONL file, read from the tail.
 *
 * The ledger grows one line per check forever, so it is never read whole. Reading a fixed window
 * off the end can slice the first line in half, which is why this walks backwards and parses:
 * the fragment fails JSON.parse and is skipped, rather than being reported as a corrupt ledger.
 */
function lastJsonLine(file) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    if (!size) return null;
    const span = Math.min(size, 8192);
    const buf = Buffer.alloc(span);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, span, size - span);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        return JSON.parse(line);
      } catch {
        /* a truncated first line, or a hand-edited one; keep walking back */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing to do about a failed close in a hook */
      }
    }
  }
}

/**
 * The first file under `root` modified after `cutoffMs`, or null.
 *
 * Returns on the FIRST hit rather than finding the newest, because the answer being reported is
 * "the index is behind", which one file settles. Budgeted so a pathological tree cannot turn the
 * first moment of a session into a pause.
 *
 * BREADTH first, deliberately. The budget will not cover a very large tree, so it should be spent
 * where an edit is most likely: `src/pages/about.astro` and `src/content/posts/*` sit one level
 * down, while the deep tail of a thousand-entry collection does not. Depth-first would spend the
 * whole budget in whichever subtree it happened to enter first.
 */
function firstNewerThan(root, cutoffMs) {
  const queue = [root];
  let budget = WALK_BUDGET;
  while (queue.length) {
    let ents;
    const dir = queue.shift();
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (budget-- <= 0) return null; // out of budget: say nothing rather than say it slowly
      if (e.isDirectory()) {
        // Only a real directory is enqueued. A dirent for a symlink reports isDirectory() false,
        // so a loop like src/x -> src cannot be followed and the walk cannot spin.
        if (e.name !== "node_modules" && !e.name.startsWith(".")) queue.push(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      const m = mtime(full);
      if (m !== null && m > cutoffMs) return full;
    }
  }
  return null;
}

// Mirrors baselinePath() in scripts/palate-contract.mjs. Duplicated rather than imported: that
// module costs 3-5ms to load, which is most of this hook's budget for one two-line function. If
// the naming ever diverges the derived file simply will not exist and this check goes quiet,
// which is the right way for a duplicate to fail.
const baselineFile = (route) =>
  (route === "/" ? "_root" : route.replace(/^\//, "").replace(/[\\/]/g, "_")) + ".json";

/**
 * Routes whose source has been touched since the baseline they are judged against was written.
 *
 * Compares the source file's mtime against the BASELINE FILE's mtime, deliberately, not against
 * the `at` timestamp inside it. Baselines are committed and sources are committed, so a fresh
 * clone rewrites both to checkout time and the comparison stays quiet. Reading `at` instead would
 * make every route on a newly cloned site report as moved, on the session where the person has
 * least context to dismiss it.
 */
function staleBaselines(dir, index) {
  const routes = Array.isArray(index?.routes) ? index.routes : [];
  let count = 0;
  for (const r of routes) {
    if (r.kind !== "static" || !r.source) continue;
    const bm = mtime(path.join(dir, ".palate", "baselines", baselineFile(r.path)));
    if (bm === null) continue; // no baseline is not drift, it is an absence; status.md reports it
    const sm = mtime(path.join(dir, r.source));
    if (sm !== null && sm > bm + BASELINE_GRACE_MS) count++;
  }
  return count;
}

// Flatten and bound a string lifted out of the ledger. The ledger is written by an agent, so its
// `what` field is free text: a newline in it would turn this hook's one line into several, and a
// long one would push the useful clauses off the end. Neither is worth trusting to good manners.
function oneLine(value, max) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Days since the newest published entry, or null when there is nothing published to age.
function daysSincePublished(index) {
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  let newest = null;
  for (const e of entries) {
    if (e.draft || !e.publishedAt) continue;
    const t = Date.parse(e.publishedAt);
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  if (newest === null) return null;
  return Math.floor((Date.now() - newest) / 86_400_000);
}

function main() {
  const payload = readStdin();

  // "compact" is not a session opening, it is the middle of one. The person has already seen this
  // line and the state is churning under an active build, so re-injecting it is noise at best and
  // stale at worst.
  if (payload && payload.source === "compact") return;

  const dir = (payload && typeof payload.cwd === "string" && payload.cwd) || process.cwd();

  // The `.palate` directory is the marker for a site this plugin manages. Anywhere else, this
  // hook has no business speaking, and the cheap existence check is what keeps it free in every
  // other repo on the machine.
  try {
    if (!fs.statSync(path.join(dir, ".palate")).isDirectory()) return;
  } catch {
    return;
  }

  const clauses = [];
  let red = false;

  // 1. Index freshness. The index is derived and gitignored, so a missing one is normal (a fresh
  //    clone, a first session) and not worth a word: the commands rebuild it on demand. A PRESENT
  //    but behind index is the dangerous state, because everything downstream reads it as current.
  const indexPath = path.join(dir, ".palate", "index.json");
  const im = mtime(indexPath);
  if (im !== null) {
    const newer = firstNewerThan(path.join(dir, "src"), im + INDEX_GRACE_MS);
    if (newer) clauses.push(`index is behind ${oneLine(path.relative(dir, newer), 60)}`);
  }

  // 2. The last check. cap and block are the two verdicts that stopped something; heal, review and
  //    merge are the loop working, and reporting those would make this line permanent furniture.
  const last = lastJsonLine(path.join(dir, ".palate", "ledger.jsonl"));
  if (last && (last.verdict === "cap" || last.verdict === "block")) {
    const first = Array.isArray(last.caught) ? last.caught[0] : null;
    const detail = first ? oneLine([first.lane, first.route, first.what].filter(Boolean).join(" "), 70) : "";
    clauses.push(`last check was a ${last.verdict}${detail ? `: ${detail}` : ""}`);
    red = true;
  }

  const index = im === null ? null : readJSON(indexPath);

  // 3. Drift, as far as it can be known without rendering. This is not a distance and must not
  //    read as one: it says the baseline is older than the page, so whatever /drift last measured
  //    describes a version that no longer exists.
  if (index) {
    const n = staleBaselines(dir, index);
    if (n) clauses.push(`${n} route${n === 1 ? "" : "s"} edited since ${n === 1 ? "its" : "their"} baseline`);
  }

  // 4. Stale.
  if (index) {
    const days = daysSincePublished(index);
    if (days !== null && days >= STALE_DAYS) clauses.push(`nothing published in ${days} days`);
  }

  if (!clauses.length) return;
  const line = `Palate: ${clauses.slice(0, MAX_CLAUSES).join(" · ")}${red ? " · run /palate-website-builder:status" : ""}`;
  process.stdout.write(line + "\n");
}

try {
  main();
} catch {
  /* a hook that throws on the first turn of a session is worse than a hook that says nothing */
}
if (process.env.PALATE_HOOK_TIMING === "1") {
  process.stderr.write(`palate-sessionstart: ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(2)}ms\n`);
}
process.exit(0);
