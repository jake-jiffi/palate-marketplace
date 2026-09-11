#!/usr/bin/env node
/**
 * scripts/gate-board-judge.mjs - every Explore board is compared with its own donor.
 *
 * ========================== WHAT IT IS PROTECTING ==========================
 *
 * Canvas-first Explore makes the boards fast and complete. It does not make them GOOD. The
 * visual rubric that every board already clears measures hygiene: on the eastcoast v2 build five
 * boards scored 25 to 28 out of 30 and were bland. The one instrument that has ever separated
 * "impressive" from "fine" is the pairwise comparison against a library reference, and it bound
 * only on a high-intensity brief, in `gate-done.sh`, on the BUILT site, never on a board and
 * never on a calm commission.
 *
 * So every board is now judged against the one thing it has to answer to: the library reference
 * it was drawn from, whose hero is already beside it on the canvas. Both orderings, the lower
 * rung on disagreement, and a board judged clearly worse than its donor is REDRAWN rather than
 * shown. At every intensity, because a calm brand is not a reason to hand someone a weak
 * drawing.
 *
 * ================================ TWO PHASES ================================
 *
 *   node scripts/gate-board-judge.mjs <projectDir>
 *     States the comparisons. Writes `.palate/explore/judge-request.json` and prints its path.
 *     The caller dispatches each comparison to a FRESH subagent, one per ordering, because two
 *     orderings judged in one context is not the position-bias control, it is asking a judge to
 *     agree with itself.
 *
 *   node scripts/gate-board-judge.mjs <projectDir> --judgements <file>
 *     Reads `[{ id, candidate_is, verdict }]`, scores every pair, records
 *     `manifest.explore.board_judgements`, and refuses any board at `clearly_worse`.
 *
 * THE JUDGEMENTS ARE RECORDED EVEN WHEN THE GATE REFUSES. A refusal that leaves no trace gets
 * re-argued rather than fixed, and `gate-explore.mjs` reads exactly this record when it asks
 * whether every shown board was judged at all.
 *
 * Exit 0 = pass, 2 = skip (first stderr line `gate-board-judge: skipped (<reason>)`) or refusal.
 * The caller separates the two on that first line, the way gate-done.sh does.
 * `PALATE_GATE_JUDGE=0` releases it.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { invokedDirectly } from "./lib/invoked-directly.mjs";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";
import { parseRegistry } from "./boards-render.mjs";
import { buildBoardPair, scoreBoardPair, BOARD_QUESTION, RUNGS } from "./reference-capture/ladder-local.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const skip = (reason) => {
  process.stderr.write(`gate-board-judge: skipped (${reason})\n`);
  process.exitCode = 2;
};

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * Written through manifest-merge, never by read-modify-write: the hook writes this file too.
 *
 * A FAILED MERGE IS A FAILED RUN. It used to be swallowed, and then the gate printed "Board
 * judge passed" over a manifest holding no judgements at all, which is the one state
 * `gate-explore` reads to decide whether the boards were ever compared with anything. The pass
 * would have been undone by the next gate with nothing saying why.
 *
 * Returns an error string, or null when the record landed.
 */
function record(projectDir, judgements) {
  const merge = join(HERE, "manifest-merge.mjs");
  const manifest = join(projectDir, "build-manifest.json");
  if (!existsSync(manifest) || !existsSync(merge)) return null; // not a tracked build; nothing owed
  const patch = { explore: { board_judgements: judgements } };
  try {
    execFileSync(process.execPath, [merge, "--manifest", manifest, "--set", JSON.stringify(patch)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    return `${manifest} was not updated (${e && e.message ? e.message.split("\n")[0] : e})`;
  }
  /**
   * READ IT BACK. manifest-merge always exits 0 on purpose (a merge failure must never wedge a
   * build), so its exit code cannot tell us whether the record landed: an unparseable manifest
   * is a no-op that reports success. The only honest check is whether the judgements are in the
   * file afterwards.
   */
  const back = readJSON(manifest);
  const got = Array.isArray(back?.explore?.board_judgements) ? back.explore.board_judgements.map((j) => j?.id) : null;
  if (!got || got.length !== judgements.length || got.some((id, i) => id !== judgements[i].id))
    return `${manifest} does not hold the judgements after the merge (is it valid JSON?)`;
  return null;
}

/** What the board hero WAS when the comparison was stated. A redraw has to invalidate it. */
const heroFingerprint = (p) => {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16); } catch { return null; }
};

export function main(argv = process.argv.slice(2)) {
  /**
   * A FLAG WITH NO VALUE IS A REFUSAL, never a silent fall-through. `--judgements` with nothing
   * after it used to return null, which is exactly what "no --judgements at all" returns, so the
   * run re-stated the comparisons and printed a phase 1 success over an operator who believed
   * they had just scored them.
   */
  const flagError = [];
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) { flagError.push(name); return null; }
    return v;
  };
  // A flag's VALUE is not a positional. Without this, `--judgements <file>` with no directory
  // named would resolve the project to the judgements file and then report it as not an Explore
  // build, which reads as "nothing to judge" rather than as the operator's slip that it is.
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

  // The release valve is read FIRST, so a build that has switched the judge off never has to
  // have its artefacts in order to get past it.
  if (process.env.PALATE_GATE_JUDGE === "0") return skip("PALATE_GATE_JUDGE=0");

  // Read BEFORE the project is resolved, so a slip in the command line cannot be reported as a
  // skip about the build ("not an Explore build") when it is a slip in the command line.
  const judgementsArg = flag("--judgements");
  if (flagError.length) {
    process.stderr.write(
      `gate-board-judge: ${flagError.join(", ")} was given with no value. Name the file: ` +
        `--judgements <projectDir>/.palate/explore/judgements.json. NOT a pass.\n`,
    );
    process.exitCode = 2;
    return;
  }

  const projectDir = resolve(positional[0] || ".");

  // NEVER JUDGE THE PLUGIN'S OWN FILES. The scaffold ships a template variants.ts, so a run from
  // a plugin checkout would state comparisons about the example entries.
  const refusal = pluginRootRefusal(projectDir);
  if (refusal) {
    process.stderr.write(`gate-board-judge: refused: ${refusal}. Name the site directory explicitly. NOT a pass.\n`);
    process.exitCode = 2;
    return;
  }

  const registryPath = join(projectDir, "src/lib/variants.ts");
  if (!existsSync(registryPath)) return skip("not an Explore build: no src/lib/variants.ts");
  const boards = parseRegistry(readFileSync(registryPath, "utf8"));
  if (!boards.length) return skip("no boards registered");

  const shotsDir = join(projectDir, ".palate/explore/shots");
  const requestPath = join(projectDir, ".palate/explore/judge-request.json");
  const judgementsFile = judgementsArg;

  // ------------------------------------------------------------------ phase 1
  if (!judgementsFile) {
    /**
     * A BOARD WITH NO EVIDENCE ON DISK IS A SKIP, NOT A PASS, and the skip names the command
     * that produces the evidence. There is nothing to compare, and quietly judging the boards
     * that happen to have their files would report a clean run over a partial one.
     */
    const missing = [];
    for (const b of boards) {
      if (!existsSync(join(shotsDir, b.id, "hero.png"))) missing.push(`${b.id}/hero.png`);
      if (!existsSync(join(shotsDir, b.id, "donor.jpg"))) missing.push(`${b.id}/donor.jpg`);
    }
    if (missing.length)
      return skip(
        `no board or donor hero for ${missing.join(", ")}: run node scripts/boards-render.mjs ${projectDir} ` +
          `(with .palate/explore/donor-heroes.json present, which is what fetches each donor hero) first`,
      );

    /**
     * ALREADY JUDGED IS NOT RE-JUDGED.
     *
     * A verifier round runs phase 1 every time, and it rewrote the request and asked for the
     * comparisons again on boards nobody had touched: six fresh subagents, on a set the manifest
     * already carried verdicts for, and the standing judgements were then thrown away with the
     * request they were bound to. The record is only good enough to skip on when it says WHICH
     * drawing was judged, so this is keyed on the hero fingerprint: a board redrawn since (the
     * one case where re-judging is the point) does not match and the request is restated.
     */
    const recorded = readJSON(join(projectDir, "build-manifest.json"))?.explore?.board_judgements;
    const held = new Map((Array.isArray(recorded) ? recorded : []).map((j) => [j?.id, j]));
    const stale = boards.filter((b) => {
      const j = held.get(b.id);
      return !j || !j.board_hero || j.board_hero !== heroFingerprint(join(shotsDir, b.id, "hero.png"));
    });
    if (!stale.length) {
      /**
       * A STANDING REFUSAL IS STILL A REFUSAL. A board read clearly worse and left alone is not
       * "already judged, nothing to do": the verdict stands, and re-stating the comparison would
       * ask a fresh subagent the same question about the same picture until one of them said
       * something kinder.
       */
      const worse = boards.filter((b) => held.get(b.id).rung === "clearly_worse");
      if (worse.length) {
        for (const b of worse)
          process.stderr.write(
            `gate-board-judge: ${b.id} (${held.get(b.id).donor ?? b.donor}) stands judged clearly worse than its donor ` +
              `and has not been redrawn. Redraw it from the donor's hero and re-render before judging again.\n`,
          );
        process.exitCode = 2;
        return;
      }
      process.stdout.write(
        `gate-board-judge: already judged: ${boards.map((b) => `${b.id} ${held.get(b.id).rung}`).join(", ")}. ` +
          `Every registered board carries a verdict for the drawing on disk, so no comparison is restated. ` +
          `Redraw a board to judge it again.\n`,
      );
      return;
    }

    const runToken = randomBytes(4).toString("hex");
    const pairs = boards.map((b) => ({
      ...buildBoardPair({
        id: b.id,
        boardPath: join(shotsDir, b.id, "hero.png"),
        donorPath: join(shotsDir, b.id, "donor.jpg"),
        donorSlug: b.donor,
        runToken,
      }),
      /**
       * THE DRAWING THE JUDGE SAW. A request stands on disk after it is written, so a board
       * redrawn in between (which is exactly what the refusal asks for) would otherwise have
       * the OLD judgements applied to the NEW hero, and the redraw would be blessed by a
       * verdict nobody gave it.
       */
      board_hero: heroFingerprint(join(shotsDir, b.id, "hero.png")),
    }));
    mkdirSync(dirname(requestPath), { recursive: true });
    writeFileSync(
      requestPath,
      JSON.stringify({ runToken, question: BOARD_QUESTION, rungs: RUNGS.map((r) => r.id), pairs }, null, 2) + "\n",
    );
    process.stdout.write(
      `gate-board-judge: ${pairs.length} board(s), ${pairs.length * 2} comparisons stated in ${requestPath}\n` +
        `  Dispatch each comparison to a FRESH subagent (one per ordering, never both in one context), then run\n` +
        `  node scripts/gate-board-judge.mjs ${projectDir} --judgements <file> with [{ id, candidate_is, verdict }] per comparison.\n`,
    );
    return;
  }

  // ------------------------------------------------------------------ phase 2
  const request = readJSON(requestPath);
  if (!request || !Array.isArray(request.pairs) || !request.pairs.length)
    return skip(`no comparisons stated yet: run node scripts/gate-board-judge.mjs ${projectDir} first`);

  /**
   * THE REQUEST MUST STILL DESCRIBE THIS SET OF BOARDS.
   *
   * Phase 2 scored `request.pairs` and never looked at the registry it had just parsed, so a
   * board registered after the request was written was never judged and never missed: the gate
   * printed "2 board(s) judged" on a three-board Explore and exited 0. Phase 1 refuses a board
   * with no evidence on disk for the same reason, and this is the same hole one phase along.
   */
  const registered = boards.map((b) => b.id);
  const judgedSet = request.pairs.map((p) => p.id);
  const same = registered.length === judgedSet.length && registered.every((id, i) => id === judgedSet[i]);
  if (!same)
    return skip(
      `the request is stale: registered boards ${registered.join(", ")} do not match the judged set ` +
        `${judgedSet.join(", ")}; re-run phase 1`,
    );

  /**
   * AND IT MUST STILL DESCRIBE THESE DRAWINGS. A refused board is redrawn, and the standing
   * request would then hand the old verdicts to a new hero.
   */
  for (const p of request.pairs) {
    if (!p.board_hero) continue; // a request from before the fingerprint existed claims nothing
    if (heroFingerprint(join(shotsDir, p.id, "hero.png")) !== p.board_hero)
      return skip(`hero.png for ${p.id} changed since the request was written; re-run phase 1`);
  }
  const judgements = readJSON(resolve(judgementsFile));
  if (!Array.isArray(judgements)) {
    process.stderr.write(`gate-board-judge: ${judgementsFile} must hold an array of { id, candidate_is, verdict }. NOT a pass.\n`);
    process.exitCode = 2;
    return;
  }

  /**
   * THE COUNT IS CHECKED BEFORE ANYTHING IS SCORED, so a partial file cannot pass by scoring
   * only the boards it happens to cover. A missing judgement has to look different from a
   * completed one, which is the failure the grader's own ladder sat dead through.
   */
  const want = request.pairs.length * 2;
  if (judgements.length !== want) {
    process.stderr.write(
      `gate-board-judge: ${judgements.length} judgement(s) returned for ${request.pairs.length} board(s), which needs ${want} ` +
        `(each board judged in both orders, by a fresh subagent each time). NOT a pass.\n`,
    );
    process.exitCode = 2;
    return;
  }

  const wantedIds = new Set(request.pairs.flatMap((p) => p.comparisons.map((c) => c.id)));
  const strays = judgements.filter((j) => !wantedIds.has(j?.id)).map((j) => j?.id ?? "(missing id)");
  if (strays.length) {
    process.stderr.write(
      `gate-board-judge: judgement(s) for comparison(s) nobody asked about: ${strays.join(", ")}. ` +
        `Copy each id verbatim from ${requestPath}. NOT a pass.\n`,
    );
    process.exitCode = 2;
    return;
  }

  const judgedAt = new Date().toISOString();
  const scored = [];
  for (const pair of request.pairs) {
    const mine = judgements.filter((j) => pair.comparisons.some((c) => c.id === j.id));
    let s;
    try {
      s = scoreBoardPair(pair, mine);
    } catch (e) {
      process.stderr.write(`gate-board-judge: ${e.message}. NOT a pass.\n`);
      process.exitCode = 2;
      return;
    }
    scored.push({ ...s, donor: pair.donor ?? null, run_token: request.runToken, judged_at: judgedAt });
  }

  const heroOf = new Map(request.pairs.map((p) => [p.id, p.board_hero ?? null]));
  const recordError = record(projectDir, scored.map((s) => ({
    id: s.id,
    donor: s.donor,
    rung: s.rung,
    consistent: s.consistent,
    run_token: s.run_token,
    judged_at: s.judged_at,
    // WHICH DRAWING THIS VERDICT IS ABOUT. Phase 1 re-stated every comparison on every round,
    // including the rounds where nothing had been redrawn, so a three-board Explore paid for six
    // fresh subagents again to be told what the manifest already held. It can only skip safely
    // if the record says which hero was judged, which is this.
    board_hero: heroOf.get(s.id) ?? null,
  })));
  if (recordError) {
    process.stderr.write(`gate-board-judge: the judgements were scored but not recorded: ${recordError}. NOT a pass.\n`);
    process.exitCode = 2;
    return;
  }

  const worse = scored.filter((s) => s.rung === "clearly_worse");
  if (worse.length) {
    for (const s of worse)
      process.stderr.write(
        `gate-board-judge: ${s.id} (${s.donor}) judged clearly worse than its donor: ${s.verdicts[0]} / ${s.verdicts[1]}. ` +
          `Redraw it from the donor's hero before the canvas is published.\n`,
      );
    process.exitCode = 2;
    return;
  }

  const shaky = scored.filter((s) => !s.consistent).map((s) => s.id);
  process.stdout.write(
    `Board judge passed: ${scored.length} board(s) judged against their own donors, both orders each ` +
      `(${scored.map((s) => `${s.id} ${s.rung}`).join(", ")}).` +
      (shaky.length ? ` Unstable across the swap, read at the lower rung: ${shaky.join(", ")}.` : "") +
      "\n",
  );
}

if (invokedDirectly(import.meta.url)) main();
