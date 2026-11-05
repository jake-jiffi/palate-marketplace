#!/usr/bin/env node
/**
 * scripts/manifest-merge.mjs - fold COMPUTED verdicts from the real artefacts into
 * build-manifest.json. This is what keeps the manifest's visual/verifier blocks a
 * CACHE OF COMPUTED EVIDENCE rather than narration.
 *
 * It reads two sibling artefacts produced by scripts/tools (never by an LLM boolean):
 *   - .palate-shots/manifest.json - the screenshot driver's own manifest
 *     (screenshot-build.mjs): shot paths, the captured viewports/sections, and
 *     console_errors counted from the live page.
 *   - verify-report.json - the palate-verifier's computed report: the per-iteration
 *     rubric scores (axes/defects/score), the visual pass/fail, and the overall verdict.
 *
 * From those it writes build-manifest.json `visual` and `verifier` blocks. It NEVER
 * invents a pass: visual.pass and verifier.pass are copied straight from the
 * artefacts (and visual.pass is additionally pinned false if the screenshot manifest
 * recorded any console error, so a thrown build can never be merged in as a pass).
 *
 * The NOVELTY block is owned by Move 1 (gate-novelty.mjs writes it); this script does
 * NOT touch novelty, diverge, converge, variants or buildability - those are the
 * agent's / Move 1's to set. Merge is additive and idempotent.
 *
 * Pure Node, no deps. Always exits 0: a merge failure must never wedge a build (the
 * gates read the artefacts directly as the source of truth, the manifest block is a
 * convenience cache). Run by palate-verifier at the end of its pass, or by the Stop
 * hook before gating.
 *
 * Usage:
 *   node scripts/manifest-merge.mjs [--manifest build-manifest.json] \
 *     [--report verify-report.json] [--shots .palate-shots/manifest.json]
 * Defaults resolve relative to the current project (cwd).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const CWD = process.cwd();
const MANIFEST = arg("--manifest", join(CWD, "build-manifest.json"));
const REPORT = arg("--report", join(CWD, "verify-report.json"));
const SHOTS = arg("--shots", join(CWD, ".palate-shots", "manifest.json"));

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function main() {
  const m = readJSON(MANIFEST);
  if (!m) {
    // No build manifest = not a tracked build. Nothing to merge into; exit clean.
    process.stderr.write("manifest-merge: no build-manifest.json; nothing to merge.\n");
    return;
  }

  const report = readJSON(REPORT); // verifier's computed report
  const shots = readJSON(SHOTS); // screenshot driver's own manifest

  // ---- console errors: count from the screenshot artefact, the live truth ----
  // Prefer the screenshot manifest's count (it counted them off the running page);
  // fall back to the verifier's recorded count only if the shots manifest is absent.
  let consoleErrors = null;
  if (shots && typeof shots.console_errors === "number") consoleErrors = shots.console_errors;
  else if (report?.visual && typeof report.visual.console_errors === "number") consoleErrors = report.visual.console_errors;

  // ---- VISUAL block: per-iteration rubric scores + the computed pass --------
  // The verifier writes report.visual with iterations[] (axes/defects/score). Copy it
  // verbatim - these are script/critic-computed evidence, not a self-claimed boolean.
  if (report?.visual) {
    const v = report.visual;
    const ran = v.ran === true || (Array.isArray(v.iterations) && v.iterations.length > 0);
    // pass is taken from the artefact, then HARD-PINNED false on any console error:
    // a thrown build is an automatic visual fail regardless of the recorded boolean.
    let pass = v.pass === true;
    if (consoleErrors && consoleErrors > 0) pass = false;
    m.visual = {
      ran,
      pass,
      iterations: Array.isArray(v.iterations) ? v.iterations : [],
      console_errors: consoleErrors ?? (typeof v.console_errors === "number" ? v.console_errors : 0),
      shots_dir: report.shots_dir ?? (shots ? ".palate-shots" : null),
    };
  } else if (shots) {
    // No verifier report yet, but a screenshot run exists: record that the loop RAN
    // (shots captured) without claiming a pass. pass stays false until the verifier
    // scores the pixels - the loop running is not the loop passing.
    m.visual = {
      ran: shots.status === "captured",
      pass: false,
      iterations: [],
      console_errors: consoleErrors ?? 0,
      shots_dir: ".palate-shots",
    };
  }

  // ---- VERIFIER block: the overall computed verdict + report path ------------
  if (report) {
    m.verifier = {
      ran: true,
      pass: report.verdict === "pass",
      verdict: report.verdict ?? "fail",
      report_path: REPORT,
    };
  }

  // Idempotent additive write; never disturb the agent/Move-1 blocks.
  try {
    writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
    process.stderr.write(
      `manifest-merge: folded visual=${m.visual ? (m.visual.pass ? "pass" : "fail") : "absent"}, ` +
        `verifier=${m.verifier ? m.verifier.verdict : "absent"} into build-manifest.json.\n`,
    );
  } catch {
    process.stderr.write("manifest-merge: could not write build-manifest.json (non-fatal).\n");
  }
}

main();
process.exit(0);
