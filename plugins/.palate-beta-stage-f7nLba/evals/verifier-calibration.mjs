#!/usr/bin/env node
/**
 * verifier-calibration.mjs - the "eval the scorer" gate for the BUILD verifier.
 *
 * SPIKE (v1.5.0 item 5). The build verifier scores six visual axes plus the v1.5
 * pairwise/ambition blocks as an uncalibrated LLM judgement. The LIBRARY side has a
 * calibration gate (scripts/lib/calibrate.mjs) that proved its VLM craft scorer
 * tracks Jake's taste at 0.716 pairwise concordance (_meta/vlm/calibration.json).
 * This script is the missing build-side equivalent: does the verifier's preference
 * order agree with Jake's labelled comparisons?
 *
 * It MIRRORS THE METHOD that actually cleared the library gate. The deployed library
 * metric was not kappa/pearson (both null on that run) but PAIRWISE CONCORDANCE: the
 * fraction of DECISIVE human comparisons the scorer orders the same way. Ties are
 * excluded from the denominator (the library counted 67 decisive of 101 total), and
 * the chance baseline for a two-way decisive choice is 0.5.
 *
 * Usage:
 *   node verifier-calibration.mjs [labels.json]
 *
 * Env overrides:
 *   PALATE_VC_GATE      deploy-gate concordance threshold (default 0.7)
 *   PALATE_VC_HOLDOUT   held-out fraction 0..1 (default 0.3)
 *   PALATE_VC_MIN       minimum decisive comparisons to report a result (default 5)
 *   PALATE_VC_SEED      integer seed for the reproducible train/holdout split (default 1)
 *
 * Exit codes:
 *   0  concordance >= gate (held-out if there is a held-out fold, else train)
 *   1  concordance below the gate
 *   2  not enough labels yet (under PALATE_VC_MIN decisive comparisons)
 *
 * No dependencies beyond node builtins. ES module. `node --check` clean.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const GATE = numEnv("PALATE_VC_GATE", 0.7);
const HOLDOUT = clamp01(numEnv("PALATE_VC_HOLDOUT", 0.3));
const MIN_DECISIVE = Math.max(1, Math.floor(numEnv("PALATE_VC_MIN", 5)));
const SEED = Math.floor(numEnv("PALATE_VC_SEED", 1));
const CHANCE = 0.5; // two-way decisive choice (a vs b); ties excluded from the denominator

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Read + parse a JSON file, or return null with no throw. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Resolve a label-file report path: absolute as-is, else relative to the labels file. */
function resolveReport(p, labelsDir) {
  if (typeof p !== "string" || !p.length) return null;
  return isAbsolute(p) ? p : resolve(labelsDir, p);
}

// ---------------------------------------------------------------------------
// The verifier's preference signal
// ---------------------------------------------------------------------------

/**
 * One axis value can be a flat number (lumen/monolith shape) or a per-viewport
 * { desktop, mobile } object (ferrous shape). Reduce to a single number (mean of the
 * present viewport scores), or null if neither shape is present.
 */
function axisValue(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const parts = ["desktop", "mobile"]
      .map((k) => v[k])
      .filter((x) => typeof x === "number");
    if (parts.length) return parts.reduce((s, x) => s + x, 0) / parts.length;
  }
  return null;
}

const AXES = [
  "philosophy",
  "hierarchy",
  "execution",
  "specificity",
  "restraint",
  "variety",
];

/**
 * A single scalar "how good does the verifier think this build is" from a
 * verify-report.json, used to order one build against another. Higher is better.
 * Returns null when the report carries no usable visual signal at all.
 *
 * The axis sum is the primary signal (the six rubric axes are the verifier's craft
 * judgement). The verdict and the v1.5 ambition/pairwise blocks are folded in as small
 * tie-breakers so two builds that both max the axes (the exact failure mode of the
 * three seed builds: Variety 5 while Explore collapsed) can still be separated by
 * whether they actually cleared the bold bar.
 */
function verifierScore(report) {
  if (!report || typeof report !== "object") return null;

  // Last iteration's axes are the converged judgement.
  const iters = report?.visual?.iterations;
  const lastIter = Array.isArray(iters) && iters.length ? iters[iters.length - 1] : null;
  const axesObj = lastIter?.axes;

  let axisSum = null;
  if (axesObj && typeof axesObj === "object") {
    const vals = AXES.map((k) => axisValue(axesObj[k])).filter((x) => x != null);
    if (vals.length) axisSum = vals.reduce((s, x) => s + x, 0);
  }

  // verdict: a weak but always-present floor signal (pass beats fail).
  const verdictBonus = report.verdict === "pass" ? 1 : 0;

  // v1.5 bold-bar signals (present only on high-intensity builds). Each nudges the
  // score so a build that ALSO cleared ambition / won pairwise / built Explore ranks
  // above one that maxed the axes but collapsed those gates.
  let boldBonus = 0;
  if (report.ambition && typeof report.ambition === "object") {
    if (report.ambition.clears === true) boldBonus += 0.5;
    else if (report.ambition.clears === false) boldBonus -= 0.5;
  }
  if (report.pairwise && report.pairwise.ran === true) {
    if (report.pairwise.won === true) boldBonus += 0.5;
    else if (report.pairwise.won === false) boldBonus -= 0.5;
  }
  if (report.explore && typeof report.explore.built_routes === "number") {
    if (report.explore.built_routes === 0) boldBonus -= 0.5; // Explore collapsed
    else boldBonus += 0.25;
  }

  if (axisSum == null) {
    // No axes at all: fall back to the verdict alone so the comparison is not lost,
    // but only if the report at least declares a verdict.
    if (report.verdict !== "pass" && report.verdict !== "fail") return null;
    return verdictBonus + boldBonus;
  }
  return axisSum + verdictBonus + boldBonus;
}

/**
 * The verifier's preference between two reports: "a" | "b" | "tie" | null.
 * null means the verifier could not score one of the pair (so the comparison is
 * skipped, not counted against it). A scalar tie is a genuine "tie".
 */
function verifierPrefers(scoreA, scoreB) {
  if (scoreA == null || scoreB == null) return null;
  if (scoreA > scoreB) return "a";
  if (scoreB > scoreA) return "b";
  return "tie";
}

// ---------------------------------------------------------------------------
// Building the comparison set
// ---------------------------------------------------------------------------

/**
 * Turn the label file into a flat list of pairwise comparisons, each with the human
 * preference and the verifier's preference. Two sources feed it:
 *   1. explicit pairwise entries { a, b, human_prefers }
 *   2. derived pairs from absolute labels: a "ship" report is preferred over a
 *      "do-not-ship" report (this only yields pairs across DIFFERING labels, so a
 *      seed set of all-"do-not-ship" anchors correctly produces zero derived pairs).
 * Returns { comparisons, notes } where each comparison is
 *   { source, aId, bId, human, verifier } and human/verifier in {a,b,tie}.
 */
function buildComparisons(labels, labelsDir) {
  const notes = [];
  const comparisons = [];

  // cache report path -> score so each report is read+scored once
  const scoreCache = new Map();
  const scoreFor = (path, id) => {
    if (scoreCache.has(path)) return scoreCache.get(path);
    const report = readJson(path);
    if (report == null) {
      notes.push(`skip: could not read/parse report for "${id}" (${path})`);
      scoreCache.set(path, null);
      return null;
    }
    const s = verifierScore(report);
    if (s == null) notes.push(`skip: no usable visual signal in report for "${id}"`);
    scoreCache.set(path, s);
    return s;
  };

  // 1. explicit pairwise comparisons
  const pairwise = Array.isArray(labels?.comparisons) ? labels.comparisons : [];
  for (const c of pairwise) {
    if (c?.todo === true || c?._todo === true) continue; // placeholder rows for Jake
    const human = normaliseHuman(c?.human_prefers);
    if (human == null) {
      notes.push(`skip: comparison missing/invalid human_prefers (a="${c?.a}", b="${c?.b}")`);
      continue;
    }
    const aPath = resolveReport(c?.a, labelsDir);
    const bPath = resolveReport(c?.b, labelsDir);
    if (!aPath || !bPath) {
      notes.push(`skip: comparison missing a/b path (a="${c?.a}", b="${c?.b}")`);
      continue;
    }
    const sa = scoreFor(aPath, c.a);
    const sb = scoreFor(bPath, c.b);
    const verifier = verifierPrefers(sa, sb);
    if (verifier == null) continue; // a note was already pushed by scoreFor
    comparisons.push({ source: "pairwise", aId: c.a, bId: c.b, human, verifier });
  }

  // 2. derived pairs from absolute labels (only across differing labels)
  const absolutes = (Array.isArray(labels?.absolute) ? labels.absolute : [])
    .filter((a) => !(a?.todo === true || a?._todo === true))
    .map((a) => ({
      report: resolveReport(a?.report, labelsDir),
      id: a?.report,
      human: normaliseAbsolute(a?.human),
    }))
    .filter((a) => a.report && a.human);

  const shipAnchors = absolutes.filter((a) => a.human === "ship").length;
  const dnsAnchors = absolutes.filter((a) => a.human === "do-not-ship").length;
  if (absolutes.length) {
    notes.push(`absolute anchors loaded: ${shipAnchors} ship, ${dnsAnchors} do-not-ship`);
  }

  for (let i = 0; i < absolutes.length; i++) {
    for (let j = i + 1; j < absolutes.length; j++) {
      const x = absolutes[i];
      const y = absolutes[j];
      if (x.human === y.human) continue; // same verdict gives no ordering
      const sx = scoreFor(x.report, x.id);
      const sy = scoreFor(y.report, y.id);
      const verifier = verifierPrefers(sx, sy);
      if (verifier == null) continue;
      // human prefers the "ship" side
      const human = x.human === "ship" ? "a" : "b";
      comparisons.push({ source: "absolute", aId: x.id, bId: y.id, human, verifier });
    }
  }

  return { comparisons, notes, shipAnchors, dnsAnchors };
}

function normaliseHuman(v) {
  if (v === "a" || v === "b" || v === "tie") return v;
  return null;
}

function normaliseAbsolute(v) {
  if (v === "ship" || v === "do-not-ship") return v;
  return null;
}

// ---------------------------------------------------------------------------
// Concordance (the library's metric)
// ---------------------------------------------------------------------------

/**
 * Pairwise concordance over a list of comparisons. A comparison is DECISIVE when both
 * the human and the verifier express a non-tie preference; concordance is the fraction
 * of decisive comparisons where the two preferences match. Mirrors the library run
 * (67 decisive of 101; ties excluded from the denominator).
 */
function concordance(comparisons) {
  let decisive = 0;
  let agree = 0;
  let humanTies = 0;
  let verifierTies = 0;
  for (const c of comparisons) {
    const ht = c.human === "tie";
    const vt = c.verifier === "tie";
    if (ht) humanTies++;
    if (vt) verifierTies++;
    if (ht || vt) continue;
    decisive++;
    if (c.human === c.verifier) agree++;
  }
  return {
    total: comparisons.length,
    decisive,
    agree,
    humanTies,
    verifierTies,
    concordance: decisive ? round3(agree / decisive) : null,
  };
}

// ---------------------------------------------------------------------------
// Reproducible train / holdout split
// ---------------------------------------------------------------------------

/** Deterministic 32-bit hash of a string (FNV-1a), for a stable per-comparison key. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Split comparisons into { train, holdout } deterministically. Each comparison hashes
 * (its ids + seed) to a stable [0,1) value; the lowest `holdoutFrac` go to holdout.
 * Deterministic so the gate verdict is reproducible across runs.
 */
function splitTrainHoldout(comparisons, holdoutFrac, seed) {
  if (holdoutFrac <= 0 || comparisons.length === 0) {
    return { train: comparisons, holdout: [] };
  }
  const keyed = comparisons.map((c) => ({
    c,
    r: hash32(`${seed}|${c.source}|${c.aId}|${c.bId}|${c.human}`) / 0x100000000,
  }));
  keyed.sort((p, q) => p.r - q.r);
  const nHold = Math.min(keyed.length, Math.round(comparisons.length * holdoutFrac));
  const holdout = keyed.slice(0, nHold).map((k) => k.c);
  const train = keyed.slice(nHold).map((k) => k.c);
  return { train, holdout };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmt(x) {
  return x == null ? "n/a" : x.toFixed(3);
}

function main() {
  const argPath = process.argv[2];
  const labelsPath = argPath
    ? (isAbsolute(argPath) ? argPath : resolve(process.cwd(), argPath))
    : resolve(HERE, "verifier-calibration-labels.json");
  const labelsDir = dirname(labelsPath);

  const labels = readJson(labelsPath);
  if (labels == null) {
    console.error(`Could not read or parse labels file: ${labelsPath}`);
    console.error(`Create it (see verifier-calibration.md for the format).`);
    process.exit(2);
  }

  const { comparisons, notes, shipAnchors, dnsAnchors } = buildComparisons(labels, labelsDir);

  console.log("Palate build-verifier calibration (SPIKE)");
  console.log(`labels:   ${labelsPath}`);
  console.log(`gate:     concordance >= ${GATE.toFixed(2)}  (chance baseline ${CHANCE.toFixed(2)})`);
  console.log(`holdout:  ${(HOLDOUT * 100).toFixed(0)}%   min decisive: ${MIN_DECISIVE}   seed: ${SEED}`);
  console.log("");

  if (notes.length) {
    console.log("notes:");
    for (const n of notes) console.log(`  - ${n}`);
    console.log("");
  }

  const overall = concordance(comparisons);
  console.log(
    `comparisons: ${overall.total} total, ${overall.decisive} decisive ` +
      `(${overall.humanTies} human ties, ${overall.verifierTies} verifier ties)`
  );

  // Not enough decisive comparisons to say anything.
  if (overall.decisive < MIN_DECISIVE) {
    console.log("");
    console.log(
      `not enough labels yet - add more in ${labelsPath.split("/").pop()} ` +
        `(have ${overall.decisive} decisive, need ${MIN_DECISIVE}).`
    );
    console.log(
      `Seed anchors present (${shipAnchors} ship / ${dnsAnchors} do-not-ship) but they ` +
        `only become comparisons once there are BOTH ship and do-not-ship labels, or ` +
        `explicit pairwise rows. This spike is infrastructure, not a result yet.`
    );
    process.exit(2);
  }

  const { train, holdout } = splitTrainHoldout(comparisons, HOLDOUT, SEED);
  const trainC = concordance(train);
  const holdoutC = concordance(holdout);

  console.log("");
  console.log("concordance:");
  console.log(
    `  all:      ${fmt(overall.concordance)}  (${overall.agree}/${overall.decisive} decisive)`
  );
  console.log(
    `  train:    ${fmt(trainC.concordance)}  (${trainC.agree}/${trainC.decisive} decisive)`
  );
  console.log(
    `  held-out: ${fmt(holdoutC.concordance)}  (${holdoutC.agree}/${holdoutC.decisive} decisive)`
  );
  console.log("");

  // The gate verdict is read off the HELD-OUT fold when it carries enough signal
  // (the literature is explicit: judge on data the prompt was not tuned against);
  // otherwise it falls back to the train (== all) concordance with a warning.
  const holdoutUsable = holdoutC.decisive >= MIN_DECISIVE && holdoutC.concordance != null;
  const gateValue = holdoutUsable ? holdoutC.concordance : overall.concordance;
  const gateBasis = holdoutUsable ? "held-out" : "all (held-out fold too small)";

  console.log(`gate verdict (on ${gateBasis}): ${fmt(gateValue)} vs ${GATE.toFixed(2)}`);
  if (gateValue == null) {
    console.log("  -> no decisive comparisons; cannot judge.");
    process.exit(2);
  }
  if (gateValue >= GATE) {
    console.log(`  -> PASS: the verifier orders builds the way the human does at/above the gate.`);
    if (!holdoutUsable) {
      console.log(`     (warning: judged on all data, no held-out fold yet - add labels to de-risk overfit.)`);
    }
    process.exit(0);
  }
  console.log(`  -> BELOW GATE: the verifier's order does not yet track the human's well enough.`);
  if (gateValue <= CHANCE) {
    console.log(`     (at or below chance ${CHANCE.toFixed(2)} - the axis signal is not ordering these builds.)`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

main();
