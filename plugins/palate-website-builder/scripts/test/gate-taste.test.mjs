/**
 * gate-taste.test.mjs - the local grade's own ladder, read at done time.
 *
 * On the eastcoast v3 build `grade-local.mjs` had already judged the built home `somewhat_worse`
 * than both exemplars, at the 12.9th taste percentile, with `flattery.risk: true` - and nothing
 * read the file. This gate reads it. Pass requires the rung to be `comparable` or `better` AND
 * `flattery.risk` to be falsy; either one failing is a refusal.
 *
 * Run: node --test scripts/test/gate-taste.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "gate-taste.mjs");

const TMP = mkdtempSync(join(tmpdir(), "gate-taste-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

let n = 0;
function project() {
  const dir = join(TMP, `proj-${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeResult(dir, result, { outDir = ".palate-shots" } = {}) {
  const abs = join(dir, outDir);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "local-grade.json"), JSON.stringify(result, null, 2));
}

const RUNG = (id, overrides = {}) => ({
  applicable: true,
  rung: id,
  meanRaw: 0.5,
  results: [],
  ...overrides,
});

function baseResult(overrides = {}) {
  return {
    version: 1,
    url: "https://example.com",
    domain: "example.com",
    overall: 71,
    flattery: null,
    taste: { applicable: true, percentile: 62.5 },
    ladder: RUNG("comparable"),
    findings: [
      { id: "some_check", label: "Some check", raw: 0.2, recoverable: 5, detail: "The accent colour is a framework default.", fix: "Swap it for the client's own accent." },
    ],
    ...overrides,
  };
}

/** Run the gate. Never throws: the exit code is part of what is being asserted. */
function run(dir, env = {}, args = []) {
  try {
    const out = execFileSync(process.execPath, [CLI, dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

test("no local-grade.json anywhere skips, naming how to run it", () => {
  const dir = project();
  const r = run(dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /^gate-taste: skipped \(the local grade has not run: node scripts\/reference-capture\/grade-local\.mjs/m);
});

test("ladder not applicable skips, naming the reason", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: { applicable: false, reason: "no exemplars fetched", checks: [] } }));
  const r = run(dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /^gate-taste: skipped \(the ladder was not applicable: no exemplars fetched\)/m);
});

test("comparable rung, no flattery risk -> pass", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("comparable") }));
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /comparable/);
});

test("better rung, no flattery risk -> pass", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("better") }));
  const r = run(dir);
  assert.equal(r.code, 0);
});

test("somewhat_worse rung refuses, naming the rung, taste percentile and first finding", () => {
  const dir = project();
  writeResult(dir, baseResult({
    ladder: RUNG("somewhat_worse"),
    taste: { applicable: true, percentile: 12.9 },
  }));
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /somewhat worse/);
  assert.match(r.out, /12\.9/);
  assert.match(r.out, /The accent colour is a framework default\./);
  assert.match(r.out, /Swap it for the client's own accent\./);
});

test("clearly_worse rung refuses", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("clearly_worse") }));
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /clearly worse/);
});

test("comparable rung but flattery.risk true still refuses, naming the honest range", () => {
  const dir = project();
  writeResult(dir, baseResult({
    ladder: RUNG("comparable"),
    taste: { applicable: true, percentile: 22 },
    flattery: {
      risk: true,
      tastePercentile: 22,
      floor: 30,
      observedOverscore: { n: 4, min: 17, max: 26 },
      honestRange: [45, 54],
    },
  }));
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /flattery\.risk is true/);
  assert.match(r.out, /45 to 54/);
});

test("better rung with flattery.risk true still refuses (both must hold)", () => {
  const dir = project();
  writeResult(dir, baseResult({
    ladder: RUNG("better"),
    flattery: { risk: true, tastePercentile: 20, floor: 30, observedOverscore: { n: 3, min: 10, max: 20 }, honestRange: [30, 40] },
  }));
  const r = run(dir);
  assert.equal(r.code, 1);
});

test("a malformed result file is refused as corrupt, never read as a pass", () => {
  const dir = project();
  mkdirSync(join(dir, ".palate-shots"), { recursive: true });
  writeFileSync(join(dir, ".palate-shots", "local-grade.json"), "{ not json");
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /not readable JSON/);
});

test("a result file that is valid JSON but not an object is refused as corrupt", () => {
  const dir = project();
  mkdirSync(join(dir, ".palate-shots"), { recursive: true });
  writeFileSync(join(dir, ".palate-shots", "local-grade.json"), "[1,2,3]");
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /not readable JSON/);
});

test("PALATE_GATE_TASTE=0 releases it with a named skip", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("clearly_worse") }));
  const r = run(dir, { PALATE_GATE_TASTE: "0" });
  assert.equal(r.code, 2);
  assert.match(r.out, /^gate-taste: skipped \(PALATE_GATE_TASTE=0\)/m);
});

test("a custom --out directory named in the default state file's own out field is honoured", () => {
  // grade-local.mjs's own state object carries no `out` field today (checked directly against
  // its source before writing this), so this exercises the defensive fallback rather than a
  // real recorded shape: a state file at the conventional `.palate-shots/` location naming a
  // different directory should send the gate there for the actual result.
  const dir = project();
  const customOut = "grade-output";
  mkdirSync(join(dir, ".palate-shots"), { recursive: true });
  writeFileSync(join(dir, ".palate-shots", "local-grade-state.json"), JSON.stringify({ out: customOut }));
  writeResult(dir, baseResult({ ladder: RUNG("comparable") }), { outDir: customOut });
  const r = run(dir);
  assert.equal(r.code, 0);
});

test("a grade written to .palate/grade/ is found, not reported as never run", () => {
  // THE SKIP THIS GATE WAS WRITTEN FOR. The eastcoast v3 build ran the local grade with
  // `--out .palate/grade`, which `grade-local.mjs` honours and records nowhere, so the gate
  // looked only in `.palate-shots/`, found nothing and printed "the local grade has not run"
  // over a real result that said `somewhat_worse` at the 12.9th percentile.
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("somewhat_worse"), taste: { applicable: true, percentile: 12.9 } }), {
    outDir: join(".palate", "grade"),
  });
  // AND IT IS THE NAMED LOCATION, not merely one the scan happens to reach: a newer file in a
  // sibling directory does not outrank the directory the grade is supposed to be written to.
  writeResult(dir, baseResult({ ladder: RUNG("comparable") }), { outDir: join(".palate", "scratch") });
  const r = run(dir);
  assert.equal(r.code, 1, `the grade is there to be read: ${r.out}`);
  assert.match(r.out, /somewhat worse/);
  assert.match(r.out, /12\.9/);
});

test("a grade one level under .palate/ is found, and the newest of two wins and is named", () => {
  const dir = project();
  // Two runs into two directories. The later one is the build's current reading, and the note
  // has to say which file it read or the operator cannot tell which run they are arguing with.
  writeResult(dir, baseResult({ ladder: RUNG("clearly_worse") }), { outDir: join(".palate", "grade-first") });
  writeResult(dir, baseResult({ ladder: RUNG("comparable") }), { outDir: join(".palate", "grade-second") });
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(dir, ".palate", "grade-first", "local-grade.json"), old, old);
  const r = run(dir);
  assert.equal(r.code, 0, `the newest run is the one that counts: ${r.out}`);
  assert.match(r.out, /grade-second/);
  assert.doesNotMatch(r.out, /clearly worse/);
});

test("--grade names the file outright, and a named file that is not there is a skip saying so", () => {
  const dir = project();
  writeResult(dir, baseResult({ ladder: RUNG("comparable") }), { outDir: "anywhere" });
  const r = run(dir, {}, ["--grade", join(dir, "anywhere", "local-grade.json")]);
  assert.equal(r.code, 0, r.out);
  const missing = run(dir, {}, ["--grade", join(dir, "nowhere", "local-grade.json")]);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /does not exist/);
  const naked = run(dir, {}, ["--grade"]);
  assert.equal(naked.code, 2);
  assert.match(naked.out, /--grade was given with no value/);
});
