#!/usr/bin/env node
/**
 * scripts/eval-runner.mjs - the two-plane eval harness (S2 step 7).
 *
 * Scores a finished build on two planes and emits a JSON verdict, so quality is a
 * measured outcome, not narration. The DETERMINISTIC gates are authoritative here; an
 * LLM judge (the visual rubric gate, run by palate-verifier) is advisory and lives
 * outside this script.
 *
 *   PROCESS plane (from build-manifest.json): did the build actually draw on the
 *     library with depth - refs surveyed, a rich taste/craft layer pulled, inner-page
 *     coverage, donor diversity, the signature move sourced. (Move 5) PLUS: did the
 *     divergent concept spine run - DIVERGE sampled a wide concept set and CONVERGE
 *     scored each candidate on two SEPARATE axes (originality + craft-feasibility).
 *   OUTPUT plane (from the rendered variant HTML): are the variants genuinely distinct
 *     (uniqueness gate), free of slop patterns / AI-tell copy, AND novel - not a
 *     near-repeat of a recent build and not riding a recurring display face
 *     (gate-novelty.mjs, Move 1).
 *
 * Usage: node scripts/eval-runner.mjs --manifest build-manifest.json --variants a.html b.html [...]
 * Prints a JSON report to stdout. Exit 0 = both planes pass, 2 = a gate failed.
 *
 * KEEP THE FLOOR: the five original PROCESS checks and the two original OUTPUT checks
 * are unchanged. The diverge/converge checks and the novelty check are ADDITIVE, and
 * each is fail-OPEN at the artefact level (a manifest with no diverge block, or fewer
 * than two variants, does not fail the build - the underlying gate skips). The eval
 * folds a real novelty/spine FAILURE into the verdict, never a not-applicable skip.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const list = (k) => { const i = args.indexOf(k); if (i < 0) return []; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out; };

const manifestPath = arg("--manifest") ?? "build-manifest.json";
const variants = list("--variants");

const RICH = new Set(["signature_moves", "do_dont", "component_prompts", "design", "pages"]);
const AI_TELLS = /\b(leverage|seamless|game-?changer|elevate your|unlock|robust|effortless|delve|in the realm of|it's worth noting|testament to|cutting-edge|best-in-class)\b/i;

// ---- PROCESS plane -------------------------------------------------------
function processPlane() {
  if (!existsSync(manifestPath)) return { pass: false, score: 0, reasons: ["no build-manifest.json"] };
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  const refs = new Set(m.references_surveyed ?? []).size;
  const inner = (m.inner_pages_viewed ?? []).length;
  const calls = m.mcp_calls ?? [];
  const tools = new Set(calls.map((c) => c.tool)).size;
  const richLayers = new Set();
  for (const c of calls) {
    if (c.tool !== "mcp__palate__refs_get") continue;
    const ls = Array.isArray(c.args?.layer) ? c.args.layer : (c.args?.layer ? [c.args.layer] : []);
    if (c.args?.format === "design") ls.push("design");
    for (const l of ls) if (RICH.has(l)) richLayers.add(l);
  }
  const sigSourced = !!(m.signature_move && m.signature_move.source_slug && (m.references_surveyed ?? []).includes(m.signature_move.source_slug));

  // --- the divergent concept spine (Move 1) ---------------------------------
  // DIVERGE: sampled a WIDE set (N>=6 concepts, each carrying a self-tagged
  // conventionality) before narrowing. CONVERGE: scored each candidate on TWO
  // SEPARATE axes (never one creativity number) and recorded which it advanced.
  // Both are fail-OPEN: a manifest with no diverge/converge block (a calm
  // conversion brief that skipped the spine, or the MCP not connected) is NOT a
  // failure here - the check passes when the spine is absent, exactly like
  // signatureSourced. The audacity eval (evals/11-novelty.md) is where presence
  // is asserted; this plane only catches a spine that ran SHALLOW (ran but did
  // not sample wide, or scored on one axis instead of two).
  const dv = m.diverge;
  const cv = m.converge;
  const divergePresent = !!(dv && dv.ran);
  const divergeWide = divergePresent && Array.isArray(dv.concepts) && dv.concepts.length >= 6
    && dv.concepts.every((c) => c && typeof c.conventionality === "number");
  const convergePresent = !!(cv && cv.ran);
  const convergeTwoAxis = convergePresent && Array.isArray(cv.scored) && cv.scored.length >= 1
    && cv.scored.every((s) => s && typeof s.originality === "number" && typeof s.craft_feasibility === "number");

  const checks = {
    refsSurveyed: refs >= 8,
    richLayer: richLayers.size >= 1,
    innerPages: inner >= 3,
    toolSpread: tools >= 3,
    signatureSourced: sigSourced || m.signature_move == null,
    // Move 5 spine checks (fail-open: true when absent, true when present-and-deep).
    divergeRan: !divergePresent || divergeWide,
    convergeScored: !convergePresent || convergeTwoAxis,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    pass: Object.values(checks).every(Boolean),
    score: Math.round((passed / Object.keys(checks).length) * 100),
    metrics: {
      refs, inner, tools, richLayers: [...richLayers],
      diverge: divergePresent ? { ran: true, n: Array.isArray(dv.concepts) ? dv.concepts.length : 0 } : { ran: false },
      converge: convergePresent ? { ran: true, scored: Array.isArray(cv.scored) ? cv.scored.length : 0, advanced: Array.isArray(cv.advanced) ? cv.advanced.length : 0 } : { ran: false },
    },
    checks,
    reasons: Object.entries(checks).filter(([, v]) => !v).map(([k]) => `process: ${k} failed`),
  };
}

// ---- OUTPUT plane --------------------------------------------------------
function outputPlane() {
  const reasons = [];
  // uniqueness (deterministic gate)
  let uniquePass = null;
  if (variants.length >= 2) {
    try { execFileSync("node", [join(HERE, "gate-uniqueness.mjs"), ...variants], { stdio: "pipe" }); uniquePass = true; }
    catch { uniquePass = false; reasons.push("output: variants are near-duplicates (uniqueness gate)"); }
  }
  // slop / AI-tell scan over the rendered copy (visible text only is ideal; here a
  // whole-file scan is a cheap floor - the visual rubric gate is the real judge)
  const slop = [];
  for (const f of variants) {
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8");
    // Scan VISIBLE copy only: strip script/style blocks and HTML comments, then tags,
    // so an AI-tell word in a code comment ("Robust:") is not a false positive.
    const html = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ");
    if (AI_TELLS.test(html)) slop.push(`${f.split("/").pop()}: AI-tell copy`);
    // gradient-hero needs the raw CSS + markup (a purple/pink gradient near an h1).
    if (/linear-gradient\([^)]*\)[^;]*;[\s\S]{0,400}<h1/i.test(raw) && /purple|#8b5cf6|#a855f7|#d946ef|#ec4899/i.test(raw)) slop.push(`${f.split("/").pop()}: purple-pink gradient hero`);
  }
  if (slop.length) reasons.push(...slop.map((s) => "output: " + s));

  // --- novelty (the cross-build gate, Move 1) -------------------------------
  // gate-novelty.mjs asks the cross-build question uniqueness cannot: is this build a
  // near-repeat of a recent one, or does a display face recur build-to-build? It reads
  // the recordBuild history (~/.config/palate/builds.log.json) and is itself fully
  // fail-OPEN - it SKIPS (exit 0) with <2 variants, no build history, or no diverge
  // block. So calling it here only ever surfaces a REAL novelty failure (exit 2); a
  // not-applicable skip is exit 0 and leaves the build passing. We also feed --manifest
  // so the CONVERGE pre-check (a safe-only converge) is caught in the same call.
  let noveltyPass = null;
  if (variants.length >= 2) {
    const novArgs = [join(HERE, "gate-novelty.mjs"), "--variants", ...variants];
    if (manifestPath && existsSync(manifestPath)) novArgs.push("--manifest", manifestPath);
    try { execFileSync("node", novArgs, { stdio: "pipe" }); noveltyPass = true; }
    catch { noveltyPass = false; reasons.push("output: build is a near-repeat / safe-only converge / recurring face (novelty gate)"); }
  } else if (manifestPath && existsSync(manifestPath)) {
    // <2 rendered variants: still run the CONVERGE concept pre-check from the manifest.
    try { execFileSync("node", [join(HERE, "gate-novelty.mjs"), "--manifest", manifestPath], { stdio: "pipe" }); noveltyPass = true; }
    catch { noveltyPass = false; reasons.push("output: CONVERGE advanced only safe concepts (novelty gate)"); }
  }

  return {
    pass: (uniquePass !== false) && (noveltyPass !== false) && slop.length === 0,
    uniqueness: uniquePass,
    novelty: noveltyPass,
    slop,
    reasons,
  };
}

const proc = processPlane();
const out = outputPlane();
const report = {
  process: proc,
  output: out,
  verdict: proc.pass && out.pass ? "pass" : "fail",
  note: "deterministic planes; the visual 6-axis rubric gate (palate-verifier) is the advisory output judge",
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "pass" ? 0 : 2);
