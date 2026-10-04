#!/usr/bin/env node
/**
 * scripts/eval-suite.mjs - the aggregate eval runner (Move 5, MOVE 5 §5.4).
 *
 * The missing top of the eval pyramid. eval-runner.mjs scores ONE finished build;
 * this script runs it across a WHOLE briefs file and emits a pass-rate summary, so
 * the golden + audacious sets can be checked in one command on every skill change and
 * every model upgrade.
 *
 * A full skill build per brief is heavy (research + DIVERGE/CONVERGE + 8-10 variants +
 * the per-variant visual loop, x N briefs). So the suite does NOT drive the model: it
 * reads each brief's already-FINISHED build artefacts off disk and scores them. The
 * builds are produced out-of-band (one skill run per brief, or a batch overnight) into
 * a results dir laid out as one folder per brief id:
 *
 *   <results>/<brief-id>/build-manifest.json
 *   <results>/<brief-id>/*.html            (the rendered variants, any name)
 *
 * Usage:
 *   node scripts/eval-suite.mjs --briefs evals/golden-briefs.json --results <dir>
 *   node scripts/eval-suite.mjs --briefs evals/audacious-briefs.json --results <dir>
 *   node scripts/eval-suite.mjs --briefs evals/golden-briefs.json --list   # just print the brief ids + expected dirs, build nothing
 *
 * A brief with no results folder is reported as "missing" (not a fail and not a pass):
 * it tells the operator which builds still need running. The exit code is 0 when every
 * PRESENT build passes (missing builds do not flip the code, so a partial run is not a
 * false failure), 2 when any present build fails its eval. Use --strict to also fail
 * (exit 2) when a brief is missing, for a CI "every brief must be built" gate.
 *
 * Pure Node + the existing eval-runner; no new dependency. Prints a JSON summary so it
 * is machine-readable, plus a one-line human tally on stderr.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "eval-runner.mjs");

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const briefsPath = arg("--briefs", join(HERE, "..", "evals", "golden-briefs.json"));
const resultsDir = arg("--results");
const listOnly = has("--list");
const strict = has("--strict");

function die(msg) { console.error(`eval-suite: ${msg}`); process.exit(1); }

if (!existsSync(briefsPath)) die(`no briefs file at ${briefsPath}`);
let briefsDoc;
try { briefsDoc = JSON.parse(readFileSync(briefsPath, "utf8")); }
catch (e) { die(`briefs file is not valid JSON: ${e.message}`); }
const briefs = Array.isArray(briefsDoc.briefs) ? briefsDoc.briefs : [];
if (briefs.length === 0) die(`briefs file has no .briefs[] array`);

// --- --list: enumerate the briefs and the dir each build is expected in --------
if (listOnly) {
  const rows = briefs.map((b) => ({
    id: b.id,
    category: b.category,
    vertical: b.vertical,
    audacious: b.audacious === true,
    expectedDir: resultsDir ? join(resultsDir, b.id) : `<results>/${b.id}`,
  }));
  console.log(JSON.stringify({ briefsFile: briefsPath, count: rows.length, briefs: rows }, null, 2));
  process.exit(0);
}

if (!resultsDir) die("pass --results <dir> (one folder per brief id with build-manifest.json + variant HTML), or --list to enumerate the briefs.");

// Collect the rendered variant HTML files in a build dir (any .html that is not an
// obvious non-variant artefact). Kept loose because variant filenames are not fixed.
function variantsIn(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.toLowerCase().endsWith(".html"))
    .map((n) => join(dir, n))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .sort();
}

const results = [];
for (const b of briefs) {
  const dir = join(resultsDir, b.id);
  const manifest = join(dir, "build-manifest.json");
  if (!existsSync(manifest)) {
    results.push({ id: b.id, audacious: b.audacious === true, status: "missing", note: `no build at ${dir}` });
    continue;
  }
  const variants = variantsIn(dir);
  const runnerArgs = [RUNNER, "--manifest", manifest];
  if (variants.length) runnerArgs.push("--variants", ...variants);
  let report = null, ec = 0;
  try {
    const out = execFileSync("node", runnerArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    report = JSON.parse(out);
  } catch (e) {
    ec = typeof e.status === "number" ? e.status : 1;
    // eval-runner prints its JSON report to stdout even on a fail (exit 2); recover it.
    try { report = JSON.parse(e.stdout?.toString() ?? ""); } catch { report = null; }
  }
  const verdict = report?.verdict ?? (ec === 0 ? "pass" : "fail");
  results.push({
    id: b.id,
    audacious: b.audacious === true,
    status: verdict === "pass" ? "pass" : "fail",
    variants: variants.length,
    processScore: report?.process?.score ?? null,
    reasons: [...(report?.process?.reasons ?? []), ...(report?.output?.reasons ?? [])],
  });
}

const present = results.filter((r) => r.status !== "missing");
const passed = present.filter((r) => r.status === "pass").length;
const failed = present.filter((r) => r.status === "fail").length;
const missing = results.filter((r) => r.status === "missing").length;
const passRate = present.length ? Math.round((passed / present.length) * 100) : 0;

const summary = {
  briefsFile: briefsPath,
  resultsDir,
  total: results.length,
  present: present.length,
  passed,
  failed,
  missing,
  passRate,
  results,
};
console.log(JSON.stringify(summary, null, 2));
console.error(`eval-suite: ${passed}/${present.length} present builds passed (${passRate}%), ${failed} failed, ${missing} not yet built.`);

// Exit 0 when every PRESENT build passes; a missing build does not flip the code unless
// --strict. This makes a partial run usable without producing a false failure.
const failExit = failed > 0 || (strict && missing > 0);
process.exit(failExit ? 2 : 0);
