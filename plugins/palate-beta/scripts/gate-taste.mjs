#!/usr/bin/env node
/**
 * scripts/gate-taste.mjs - the local grade's own ladder, read at done time.
 *
 * ========================== THE FAULT THIS CLOSES ==========================
 *
 * On the eastcoast v3 build the local grade's pairwise ladder judged the built home
 * `somewhat_worse` than both exemplars, at the 12.9th taste percentile, with `flattery.risk:
 * true` - the instrument that says "the honest number is likely lower than this" was already
 * true. Nothing read the file. The done gate ran clean, because every other check measures
 * hygiene, similarity or facts, and a page can pass all three while reading as visibly worse
 * than the library it was supposed to match.
 *
 * `grade-local.mjs` already computes this. It was just never wired to anything that could stop
 * a build. This gate reads its result and refuses to let a build read worse than its exemplar
 * pass quietly.
 *
 * ============================== WHAT IT ASKS ===============================
 *
 * Pass requires BOTH: the ladder's rung is `comparable` or `better`, AND the flattery guard
 * (the appearance head putting this page below the library median, where the instrument is
 * measured to over-score) is not tripped. Either one failing is a refusal, because a rung of
 * `comparable` earned under `flattery.risk: true` is not trustworthy evidence that the page is
 * actually comparable.
 *
 * ============================== FAIL-OPEN ==================================
 *
 * The local grade is a self-check the agent runs voluntarily (`references/local-grade.md`,
 * SKILL.md A.12), not a step the pick or the scaffold writes for it. A build that has not run
 * it yet, or whose ladder was never applicable (no exemplars fetched), skips rather than
 * blocking: this gate can only read a record, it cannot make one. `PALATE_GATE_TASTE=0`
 * releases it with a named skip, the same discipline as `PALATE_GATE_LOOK` and
 * `PALATE_GATE_JUDGE`.
 *
 * A malformed result file is refused as unreadable, never read as a pass: a corrupt record is
 * not evidence the page cleared the bar.
 *
 * Usage: node scripts/gate-taste.mjs <projectDir> [--grade <path to local-grade.json>]
 * Exit: 0 the ladder is comparable or better with no flattery risk, 1 findings, 2 cannot check
 *       (first stderr line `gate-taste: skipped (<reason>)`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `--grade <path>` NAMES THE RESULT FILE, and its value is not a project directory. Without
 * that exclusion `gate-taste.mjs . --grade out/local-grade.json` would resolve the project to
 * the file and report a build with no grade.
 */
const argv = process.argv.slice(2);
const gradeIndex = argv.indexOf("--grade");
const gradeFlag = gradeIndex >= 0 ? argv[gradeIndex + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--grade"));
const dir = resolve(positional[0] || ".");

const skip = (reason) => {
  process.stderr.write(`gate-taste: skipped (${reason})\n`);
  process.exitCode = 2;
};

const HOW_TO_RUN = "node scripts/reference-capture/grade-local.mjs --url <the built preview URL>";

/**
 * WHERE THE GRADE IS, RATHER THAN WHERE IT WAS SUPPOSED TO BE.
 *
 * `grade-local.mjs` writes `local-grade.json` into whatever `--out` directory it was given
 * (default `.palate-shots`), and its state object records no `out` field, so a build that ran
 * it with `--out .palate/grade` left a real result this gate could not see. That is exactly
 * what the eastcoast v3 build did, and this gate skipped saying "the local grade has not run",
 * which is false and is the one sentence it exists not to print.
 *
 * So the file is looked for in the order it is likely to be: the flag if one was given, the
 * default directory, the directory v3 actually used, then one level under either working
 * directory, newest first, because a build that ran the grade twice into two directories means
 * the later run. Only when none of those exists is the grade genuinely absent.
 */
function scanOneLevel(root) {
  const found = [];
  for (const base of [".palate", ".palate-shots"]) {
    let entries = [];
    try { entries = readdirSync(join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const candidate = join(root, base, e.name, "local-grade.json");
      try { found.push({ path: candidate, at: statSync(candidate).mtimeMs }); } catch { /* not there */ }
    }
  }
  found.sort((a, b) => b.at - a.at);
  return found[0]?.path ?? null;
}

function resolveResultFile(root) {
  if (gradeFlag) {
    const named = resolve(gradeFlag);
    return existsSync(named) ? { path: named, named: true } : null;
  }

  for (const p of [join(root, ".palate-shots", "local-grade.json"), join(root, ".palate", "grade", "local-grade.json")])
    if (existsSync(p)) return { path: p, named: false };

  const scanned = scanOneLevel(root);
  if (scanned) return { path: scanned, named: true };

  /**
   * A STATE FILE NAMING ITS OWN `out` is honoured last, for a grade written somewhere the scan
   * above cannot reach (an `--out` outside `.palate/` and `.palate-shots/`). `grade-local.mjs`
   * writes no such field today, so this branch is defensive rather than load-bearing.
   */
  for (const statePath of [
    join(root, ".palate", "grade", "local-grade-state.json"),
    join(root, ".palate-shots", "local-grade-state.json"),
  ]) {
    if (!existsSync(statePath)) continue;
    let state;
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { continue; }
    const out = typeof state?.out === "string" && state.out ? state.out : null;
    if (!out) continue;
    const candidate = join(root, out, "local-grade.json");
    if (existsSync(candidate)) return { path: candidate, named: true };
  }
  return null;
}

function main() {
  if (process.env.PALATE_GATE_TASTE === "0") return skip("PALATE_GATE_TASTE=0");

  if (gradeIndex >= 0 && (!gradeFlag || gradeFlag.startsWith("--")))
    return skip("--grade was given with no value: name the file, --grade <dir>/local-grade.json");

  const found = resolveResultFile(dir);
  if (!found)
    return skip(
      gradeFlag
        ? `--grade ${gradeFlag} does not exist`
        : `the local grade has not run: ${HOW_TO_RUN}`,
    );
  const resultPath = found.path;

  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    return skip(`${resultPath} is not readable JSON`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return skip(`${resultPath} is not readable JSON`);
  }

  const ladder = result.ladder && typeof result.ladder === "object" ? result.ladder : null;
  if (!ladder || ladder.applicable !== true) {
    const reason = (ladder && typeof ladder.reason === "string" && ladder.reason) || "no reason given";
    return skip(`the ladder was not applicable: ${reason}`);
  }

  const rung = typeof ladder.rung === "string" ? ladder.rung : null;
  const okRung = rung === "comparable" || rung === "better";
  const flattery = result.flattery && typeof result.flattery === "object" ? result.flattery : null;
  const atRisk = !!flattery?.risk;

  const tastePercentile =
    typeof result.taste?.percentile === "number" ? result.taste.percentile : (typeof flattery?.tastePercentile === "number" ? flattery.tastePercentile : null);

  if (okRung && !atRisk) {
    console.log(
      `gate-taste: the local grade's ladder reads this build ${rung} against its exemplar` +
        (tastePercentile != null ? ` (taste percentile ${tastePercentile})` : "") +
        (found.named ? `, read from ${resultPath}.` : "."),
    );
    return;
  }

  const lines = [];
  const rungLabel = rung ? rung.replace(/_/g, " ") : "unknown";
  lines.push(
    `gate-taste: the local grade's ladder reads this build ${rungLabel} than its exemplar` +
      (tastePercentile != null ? ` at the ${tastePercentile} taste percentile.` : "."),
  );
  if (atRisk) {
    const range = Array.isArray(flattery.honestRange) ? flattery.honestRange : null;
    lines.push(
      `  flattery.risk is true: the appearance head puts this page below the library median, where this` +
        ` instrument is measured to over-score. The honest range is roughly ${range ? `${range[0]} to ${range[1]}` : "lower than the reported score"}.`,
    );
  }
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const first = findings.find((f) => f && (f.detail || f.fix));
  if (first) {
    lines.push(`  ${first.detail || "(no detail)"}${first.fix ? ` Fix: ${first.fix}` : ""}`);
  }
  lines.push(`  Fix it and re-run: ${HOW_TO_RUN}`);
  process.stderr.write(lines.join("\n") + "\n");
  process.exitCode = 1;
}

main();
