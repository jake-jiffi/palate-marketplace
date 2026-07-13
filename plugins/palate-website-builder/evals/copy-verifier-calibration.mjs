#!/usr/bin/env node
/**
 * copy-verifier-calibration.mjs - W8 (gap2 measure-first). The copy twin of
 * verifier-calibration.mjs: does the copy verifier's preference order agree with a human's?
 *
 * Reads a labelled set of HERO-COPY pairs (copy-verifier-calibration-labels.json), derives
 * the copy verifier's preference from its 4-axis read of each hero line (Specificity,
 * Voice-fit, Momentum, Restraint - the W9 axes), and reports PAIRWISE CONCORDANCE: the
 * fraction of decisive human comparisons the verifier orders the same way. Mirrors the
 * method that cleared the library gate (concordance, ties excluded, chance 0.5).
 *
 * Each label row is:
 *   { "a": { "hero": "<line>", "axes": { "specificity":n, "voiceFit":n, "momentum":n, "restraint":n } },
 *     "b": { ... }, "human_prefers": "a" | "b" | "tie", "comment": "..." }
 * The verifier's per-line scalar is the axis sum; ties on the scalar are ties. A row with
 * "todo": true is ignored (a placeholder for Jake).
 *
 * NOTE on the ground truth: the only on-disk copy-quality signal is the W6 marketingTellScore,
 * which has low variance (most corpus copy is not filler-laden), so it is too weak a target on
 * its own. The deeper signal is Jake's copy labels (human_prefers), which do not exist yet -
 * so like the build-side spike this is the plumbing; the number is future work once Jake labels.
 *
 * Usage: node copy-verifier-calibration.mjs [labels.json]
 * Exit 0 = concordance >= gate (PALATE_CVC_GATE, default 0.7); 1 = below; 2 = too few labels.
 * No deps. ES module.
 */
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = num("PALATE_CVC_GATE", 0.7);
const MIN_DECISIVE = Math.max(1, Math.floor(num("PALATE_CVC_MIN", 5)));
const AXES = ["specificity", "voiceFit", "momentum", "restraint"];

export function verifierScalar(side) {
  const ax = side && side.axes;
  if (!ax || typeof ax !== "object") return null;
  const vals = AXES.map((k) => ax[k]).filter((v) => typeof v === "number");
  return vals.length ? vals.reduce((s, x) => s + x, 0) : null;
}

export function concordance(rows) {
  let decisive = 0, agree = 0, humanTies = 0;
  for (const r of rows) {
    if (r.todo === true) continue;
    const human = r.human_prefers;
    if (human !== "a" && human !== "b") { humanTies++; continue; }
    const sa = verifierScalar(r.a), sb = verifierScalar(r.b);
    if (sa == null || sb == null || sa === sb) continue; // verifier indecisive -> not decisive
    decisive++;
    const verifierPrefers = sa > sb ? "a" : "b";
    if (verifierPrefers === human) agree++;
  }
  return { decisive, agree, humanTies, concordance: decisive ? round3(agree / decisive) : null };
}

function num(name, d) { const v = Number(process.env[name]); return Number.isFinite(v) ? v : d; }
function round3(x) { return Math.round(x * 1000) / 1000; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const path = arg ? (isAbsolute(arg) ? arg : resolve(process.cwd(), arg)) : resolve(HERE, "copy-verifier-calibration-labels.json");
  let labels;
  try { labels = JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    console.error(`cannot read ${path}: ${e.message}`); process.exit(2);
  }
  const rows = Array.isArray(labels?.comparisons) ? labels.comparisons : [];
  const c = concordance(rows);
  console.log(`Copy-verifier calibration (W8). labels: ${path}`);
  console.log(`gate: concordance >= ${GATE} (chance 0.5). ${rows.length} rows, ${c.decisive} decisive, ${c.humanTies} human ties.`);
  if (c.decisive < MIN_DECISIVE) {
    console.log(`not enough labels yet (have ${c.decisive} decisive, need ${MIN_DECISIVE}). Plumbing only; the number awaits Jake's copy labels.`);
    process.exit(2);
  }
  console.log(`concordance: ${c.concordance} (${c.agree}/${c.decisive})`);
  process.exit(c.concordance >= GATE ? 0 : 1);
}
