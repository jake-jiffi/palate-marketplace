#!/usr/bin/env node
/**
 * hooks/palate-stop.mjs - make "done" machine-checkable from evidence (Stop hook).
 *
 * Registered at the user level. Guards against loops with `stop_hook_active`. It
 * only acts on a real build (a build-manifest.json that recorded source writes);
 * non-build sessions pass untouched. On a real build it runs, in order:
 *   1. the MCP-depth gate (gate-mcp-depth.sh)  - KEEP THE FLOOR, unchanged behaviour.
 *   2. the DONE gate (gate-done.sh)            - the VISUAL loop ran + passed
 *      (screenshots on disk, zero console errors, every rubric axis cleared the bar)
 *      AND the fresh-context palate-verifier ran + returned verdict:pass. It reads the
 *      real ARTEFACTS (verify-report.json, .palate-shots/*), never a manifest boolean
 *      an LLM could have set - anti-reward-hacking is the whole point.
 *   3. fold the computed verdicts into build-manifest.json (manifest-merge.mjs) so the
 *      manifest's visual/verifier blocks are a cache of computed evidence.
 *
 * Both gates FAIL OPEN: each skips (exit 0) when it cannot run - no jq, no manifest, no
 * MCP calls (MCP not connected / surveyed in a subagent), and (gate-done only) no
 * renderable preview (no dist/ and no verify-report.json). So enforcement fires ONLY
 * on a build that COULD have been verified and was not - never on a public-plugin user
 * whose token is not set or who is editing an existing app.
 *
 * Enforcement split (the "enforce-when-possible" default): the GATES enforce when they
 * CAN (renderable + MCP connected); the HOOK stays nudge-by-default. On any gate
 * failure: by DEFAULT allow finishing with a loud non-blocking reminder; HARD-BLOCK
 * (decision:"block") only under PALATE_GATE_STRICT=1. recordBuild runs ONLY after ALL
 * gates pass, so a build that fails the loop is not written to cross-build memory.
 *
 * Escape hatch: PALATE_GATE_OFF=1. Hard enforcement: PALATE_GATE_STRICT=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildLogEntry } from "./build-log-entry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "..", "scripts", "gate-mcp-depth.sh");
const DONE_GATE = path.join(HERE, "..", "scripts", "gate-done.sh");
const MERGE = path.join(HERE, "..", "scripts", "manifest-merge.mjs");
const PHANTOM = path.join(HERE, "..", "scripts", "phantom-utility-check.mjs");
const SOURCE = /\.(astro|svelte|vue|tsx?|jsx?|mjs|css|scss)$/i;
const OVERFLOW_PX = 16; // a layout break, not a scrollbar/sub-pixel (clean builds read ~0)

// Positive ON-DISK evidence of a REAL failure - the "enforce on evidence" layer. Unlike a
// gate exit code (which conflates a real fail with could-not-verify, e.g. a subagent survey
// the depth gate cannot see), every signal here fires ONLY when the evidence is PRESENT and
// BAD, so an absent artefact is never a false trap. These BLOCK by default; the softer gate
// failures keep nudging unless PALATE_GATE_STRICT=1. Console errors, phantom utilities and
// verdict:fail are unambiguous; overflow is conservative (>16px) so it never trips on a clean
// page. This is what closes the "verdict:pass shipped a broken site" gap without false-blocking.
function positiveFailures(proj) {
  const reasons = [];
  const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const rep = readJSON(path.join(proj, "verify-report.json"));
  const sm = readJSON(path.join(proj, ".palate-shots", "manifest.json"));

  // 1. Runtime console errors on the rendered page (the driver's own count).
  let consoleErrs = null;
  if (sm && Number.isFinite(sm.console_errors)) consoleErrs = sm.console_errors;
  else if (rep && rep.visual && Number.isFinite(rep.visual.console_errors)) consoleErrs = rep.visual.console_errors;
  if (consoleErrs > 0) reasons.push(`${consoleErrs} runtime console error(s) on the rendered page (.palate-shots/errors.json) - a thrown build cannot ship`);

  // 2. PAGE-LEVEL horizontal overflow only: the whole document wider than the viewport =
  //    horizontal scroll = a layout break. Page-level is the robust, low-FP signal (a real
  //    build reads ~0; a too-wide row spilling past the viewport reads hundreds of px).
  //    Per-section internal overflow (s.overflow in the manifest) is deliberately NOT a
  //    block: scrollWidth-clientWidth picks up shadows, decorative bleeds and sub-pixel, so
  //    a clean section can read ~20px - that is the verifier/persona's call, not a hard gate.
  if (sm) {
    const pageOv = Object.entries(sm.overflow || {}).filter(([, v]) => Number(v) > OVERFLOW_PX);
    if (pageOv.length) reasons.push(`the page scrolls horizontally (content wider than the viewport) at ${pageOv.map(([vp, v]) => `${vp} +${Math.round(v)}px`).join(", ")} - a layout break`);
  }

  // 3. Phantom/undefined utility classes (compile to nothing -> unstyled markup). Re-run the
  //    static check against the FRESH dist only (--require-fresh SKIPs a stale oracle, so a
  //    not-rebuilt tree never false-flags real utilities); exit 1 = real phantoms present.
  if (fs.existsSync(path.join(proj, "dist")) && fs.existsSync(PHANTOM)) {
    try {
      execFileSync("node", [PHANTOM, proj, "--no-build", "--require-fresh", "--ci"], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      if (e && e.status === 1) reasons.push("phantom/undefined Tailwind utility classes that compile to nothing (they ship as unstyled markup) - run scripts/phantom-utility-check.mjs to list them, fix the names, rebuild");
      /* status 2 = stale/internal = could-not-verify; never block on it */
    }
  }

  // 4. The fresh-context verifier itself returned verdict:fail (it ran and judged it a fail).
  if (rep && rep.verdict === "fail") reasons.push("the fresh-context verifier returned verdict:fail (see verify-report.json) - resolve the named findings");

  // 5. Interaction-state failures from the rendered interaction pass (verify-rendered.mjs
  //    drives a real pointer / keyboard and asserts the state changed). Only the OBJECTIVE,
  //    low-FP checks are written here (a dead hover, a deleted focus ring, a hover/expand nav
  //    that never opens or traps Escape); the pass keeps its softer findings advisory. So a
  //    PRESENT, non-empty list is a real, blockable failure; an absent file = the pass did
  //    not run (never a false trap), consistent with every other signal above.
  const ix = readJSON(path.join(proj, ".palate-shots", "interaction.json"));
  if (ix && Array.isArray(ix.interaction_failures) && ix.interaction_failures.length) {
    const n = ix.interaction_failures.length;
    const sample = ix.interaction_failures.slice(0, 3).map((f) => (f && f.msg ? f.msg : String(f))).join("; ");
    reasons.push(`${n} interaction-state failure(s) on the rendered page (.palate-shots/interaction.json): ${sample}${n > 3 ? "; ..." : ""} - drive the state, fix it, and re-verify`);
  }

  return reasons;
}

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Pull the display FACE names a rendered variant actually used, so cross-build
// type-face recurrence (the smell gate-novelty.mjs catches) has data. The recurring
// FACE across unrelated builds is the tell, not the family - see references/type-
// selection.md. Normalise each declaration's first family + Google-Fonts link families
// to a bare lower-case token; drop the generic fallbacks.
function facesFromHtml(html) {
  const faces = new Set();
  const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset", ""]);
  // Capture the whole value up to ; or } (quotes included) so a quoted first family is read.
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const f = m[1].replace(/['"]/g, "").split(",")[0].trim().toLowerCase().replace(/\s+/g, " ");
    if (!GENERIC.has(f) && !f.startsWith("var(")) faces.add(f);
  }
  for (const m of html.matchAll(/family=([A-Za-z0-9+]+)/g)) {
    const f = m[1].replace(/\+/g, " ").trim().toLowerCase();
    if (!GENERIC.has(f)) faces.add(f);
  }
  return [...faces];
}

function recordBuild(manifest) {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const dir = path.join(os.homedir(), ".config", "palate");
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, "builds.log.json");
    let entries = [];
    try {
      entries = JSON.parse(fs.readFileSync(log, "utf8"));
    } catch {
      // Back-compat: migrate the v1 jiffi-namespaced log on first write.
      try {
        entries = JSON.parse(
          fs.readFileSync(path.join(os.homedir(), ".config", "jiffi", "builds.log.json"), "utf8"),
        );
      } catch {
        entries = [];
      }
    }
    // Record the display faces used, read from the rendered variant HTML the manifest
    // points at, so type-face recurrence is computable across builds. Best-effort: a
    // missing/unreadable variant file just contributes no faces.
    const faces = new Set();
    const mdir = path.dirname(manifest);
    for (const v of Array.isArray(m.variants) ? m.variants : []) {
      const hp = v && v.html_path;
      if (typeof hp !== "string") continue;
      const abs = path.isAbsolute(hp) ? hp : path.join(mdir, hp);
      try {
        for (const f of facesFromHtml(fs.readFileSync(abs, "utf8"))) faces.add(f);
      } catch {
        /* variant file gone; skip */
      }
    }
    // Entry shape (incl. the W1 Explore labels) lives in build-log-entry.mjs so it is
    // unit-testable without faking a whole passing build.
    entries.push(buildLogEntry(m, [...faces]));
    fs.writeFileSync(log, JSON.stringify(entries, null, 2) + "\n");
  } catch {
    /* memory is best-effort; never block finishing over it */
  }
}

const p = readStdin() || {};
if (p.stop_hook_active === true || process.env.PALATE_GATE_OFF === "1") process.exit(0);

const cwd = p.cwd || process.cwd();
const manifest = path.join(cwd, "build-manifest.json");
if (!fs.existsSync(manifest)) process.exit(0); // not a build session

// Only gate a real build (one that wrote source files).
try {
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const wroteSource = (m.files_written ?? []).some((f) => SOURCE.test(f));
  if (!wroteSource) process.exit(0);
} catch {
  process.exit(0);
}

// Fold the COMPUTED verdicts from the artefacts into the manifest before gating, so
// the visual/verifier cache blocks are fresh. Best-effort and never fatal: the gates
// read the artefacts directly as the source of truth, so a merge miss cannot weaken
// or strengthen the verdict.
try {
  execFileSync("node", [MERGE, "--manifest", manifest], { cwd, stdio: ["ignore", "ignore", "ignore"] });
} catch {
  /* merge is a cache convenience; never block finishing over it */
}

// ENFORCE-ON-EVIDENCE (the fix for "verdict:pass shipped a broken site"): block by DEFAULT
// when there is positive on-disk evidence of a real failure, independent of the gate exit
// codes (which conflate a real fail with could-not-verify). This fires even if the verifier
// set visual.pass:true on a hero-biased read, so a broken section/route cannot ship silently.
// It only blocks on PRESENT+BAD evidence, so an unverifiable session is never false-trapped.
let positive = [];
try { positive = positiveFailures(cwd); } catch { positive = []; } // a detector bug must never trap the user
if (positive.length) {
  const reason =
    "Palate gate: this build has on-disk evidence of a real failure - " + positive.join("; ") +
    ". Fix the named issue, re-render, and re-verify before finishing. (PALATE_GATE_OFF=1 bypasses, for a deliberate exception only.)";
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

try {
  execFileSync("bash", [GATE, manifest], { stdio: ["ignore", "ignore", "pipe"] }); // existing depth gate - KEEP THE FLOOR
  execFileSync("bash", [DONE_GATE, manifest], { stdio: ["ignore", "ignore", "pipe"] }); // NEW: visual loop + verifier (reads artefacts, fails open)
  recordBuild(manifest); // MOVED: only record the build to cross-build memory after ALL gates pass
  process.exit(0);
} catch (e) {
  const reason =
    (e.stderr ? e.stderr.toString() : "").trim() ||
    "Palate gate: this build is not done - it did not draw on the library deeply enough, or the visual loop / verifier has not passed.";
  // Hard enforcement is opt-in. By DEFAULT never block finishing — blocking traps a
  // session that cannot satisfy the gate (MCP not connected, surveyed in a subagent).
  // Surface a non-blocking reminder instead so the build is still nudged toward depth.
  if (process.env.PALATE_GATE_STRICT === "1") {
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(0);
  }
  process.stderr.write(`[palate] ${reason}\n(Set PALATE_GATE_STRICT=1 to enforce this as a hard gate.)\n`);
  process.exit(0);
}
