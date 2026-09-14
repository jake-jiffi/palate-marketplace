#!/usr/bin/env node
import { refuseLegacy } from "./lib/workflow-route.mjs";
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
 * rung on disagreement, and THE BAR IS COMPARABLE OR BETTER ON EVERY SURFACE THE BOARD IS
 * JUDGED ON: a board read somewhat worse than its donor, on any one of them, is REDRAWN rather
 * than shown, exactly as one read clearly worse is. At every intensity, because a calm brand is
 * not a reason to hand someone a weak drawing.
 *
 * The bar moved on 2026-09-12 (Jake's ruling) from "not clearly worse". Somewhat worse than the
 * work a board was drawn FROM is the reading a bland board earns, and the whole point of the
 * comparison is that bland is what the hygiene rubric cannot see. Nothing about the ladder
 * changed: all four rungs are still stated, still judged and still recorded, and only what the
 * gate REFUSES is wider.
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
 *     `manifest.explore.board_judgements`, and refuses any board that does not read `comparable`
 *     or `better` on every surface it was judged on.
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
import { createRequire } from "node:module";
import { invokedDirectly } from "./lib/invoked-directly.mjs";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";
import { parseRegistry } from "./boards-render.mjs";
import {
  buildBoardPair, scoreBoardPair, BOARD_QUESTION, BOARD_FOOT_QUESTION, BOARD_INNER_QUESTION, RUNGS,
} from "./reference-capture/ladder-local.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const engineRequire = createRequire(new URL("./reference-capture/", import.meta.url));

/**
 * THE THREE SURFACES A DIRECTION IS READ ON.
 *
 * The entrance was the whole judge, and a verdict about the top of a page was recorded as a
 * verdict about the page. A client asks about the ending (the closing call to action and the
 * footer) before they ask about anything below the fold, and they spend most of their time on
 * an inner page, so both are compared too. The lowest reading stands, for the same reason the
 * lower of the two orderings stands: a direction is as good as its weakest surface, and
 * averaging is how a weak ending gets carried by a strong hero.
 *
 * `label` is what the refusal calls the surface, in the client's language rather than the
 * file's: "page ending", never "foot.png". Exported because gate-explore.mjs says the same
 * sentence about the same board at done-time.
 */
export const SURFACES = {
  entrance: { label: "entrance", question: BOARD_QUESTION, candidate: "hero.png", donor: "donor.jpg" },
  foot: { label: "page ending", question: BOARD_FOOT_QUESTION, candidate: "foot.png", donor: "donor-foot.png" },
  inner: { label: "inner page", question: BOARD_INNER_QUESTION, candidate: "inner.png", donor: "donor.jpg" },
};

/**
 * THE BAR A DIRECTION HAS TO CLEAR, and the words the refusal says it in.
 *
 * A board must read `comparable` or `better` than its donor on EVERY surface it is judged on.
 * The two lower rungs both refuse: `somewhat_worse` is the reading a competent-but-bland board
 * earns against the reference it was drawn from, and bland is precisely what the visual rubric
 * cannot see, so treating it as a pass left the judge unable to refuse the boards it exists for.
 * A surface that could not be judged at all reads `null` and refuses nothing (the library holds
 * no whole-page capture for some references), because absence of evidence is not a bad reading.
 *
 * Exported because `gate-explore.mjs` refuses the same boards at done-time, and the bar stated
 * twice is the bar that drifts.
 */
export const REFUSED_RUNGS = ["clearly_worse", "somewhat_worse"];
export const refusedRung = (rung) => REFUSED_RUNGS.includes(rung);
/** The reading in the client's language: "somewhat worse", never "somewhat_worse". */
export const WORSE_PHRASE = { clearly_worse: "clearly worse", somewhat_worse: "somewhat worse" };

/** How much of the bottom of a page is its ending. Enough for the CTA band and the footer. */
export const FOOT_PX = 900;

/** The stills every direction owes before it can be judged at all. */
const REQUIRED_SHOTS = ["hero.png", "full.png", "inner.png", "donor.jpg"];

const skip = (reason) => {
  process.stderr.write(`gate-board-judge: skipped (${reason})\n`);
  process.exitCode = 2;
};

export function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * Merge a patch into the manifest, then PROVE it landed.
 *
 * Written through manifest-merge, never by read-modify-write: the hook writes this file too.
 *
 * A FAILED MERGE IS A FAILED RUN. It used to be swallowed, and then the gate printed "Board
 * judge passed" over a manifest holding no judgements at all, which is the one state
 * `gate-explore` reads to decide whether the boards were ever compared with anything. The pass
 * would have been undone by the next gate with nothing saying why.
 *
 * `landed` is handed the manifest as it reads back and answers whether the patch is in it.
 * Exported because `gate-page-judge.mjs` owes the same proof about its own record, and a second
 * copy of the merge-then-verify dance is a second place for the swallow to come back.
 *
 * Returns an error string, or null when the record landed.
 */
export function mergeManifest(projectDir, patch, landed) {
  try { refuseLegacy([projectDir], "board-judge merge"); } catch (error) { return error.message; }
  const merge = join(HERE, "manifest-merge.mjs");
  const manifest = join(projectDir, "build-manifest.json");
  if (!existsSync(manifest) || !existsSync(merge)) return null; // not a tracked build; nothing owed
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
  return landed(back) ? null : `${manifest} does not hold the judgements after the merge (is it valid JSON?)`;
}

/**
 * The board judge's own record, written through the shared merge above.
 *
 * Returns an error string, or null when the record landed.
 */
function record(projectDir, judgements) {
  return mergeManifest(projectDir, { explore: { board_judgements: judgements } }, (back) => {
    const got = Array.isArray(back?.explore?.board_judgements) ? back.explore.board_judgements.map((j) => j?.id) : null;
    return Boolean(got) && got.length === judgements.length && got.every((id, i) => id === judgements[i].id);
  });
}

/**
 * What a file WAS when the comparison was stated. A redraw has to invalidate it.
 *
 * Exported because `gate-page-judge.mjs` binds its own comparisons the same way, to the built
 * stills AND to the HTML they were shot from. Two copies of a sixteen-character digest would
 * drift silently: the day one of them takes a different slice, judgements written for one gate
 * validate against the other's record and nothing says so.
 */
export const fingerprint = (p) => {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16); } catch { return null; }
};
/** The name this file has always called it. Kept so nothing below has to change. */
const heroFingerprint = fingerprint;

/**
 * Crop the bottom of a page into its own still.
 *
 * A full-page capture is judged whole by nobody: it is thousands of pixels tall, and a judge
 * asked to compare two of them reads the top and answers about the entrance again. The ending
 * is cropped so the question can be about the ending. A page shorter than the crop keeps its
 * whole height rather than being padded, because a shorter page is a fact about the design.
 */
export async function cropFoot(sharp, src, dest) {
  const { width, height } = await sharp(src).metadata();
  if (!width || !height) throw new Error(`${src} has no readable dimensions`);
  const h = Math.min(FOOT_PX, height);
  await sharp(src).extract({ left: 0, top: height - h, width, height: h }).png().toFile(dest);
}

/** Why a donor has no full capture, as boards-render recorded it, or a plain statement of fact. */
function donorFullReason(dir) {
  try { return readFileSync(join(dir, "donor-full.missing"), "utf8").trim(); } catch { return ""; }
}

export async function main(argv = process.argv.slice(2)) {
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
  refuseLegacy([resolve(positional[0] || ".")], "board-judge");

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
      for (const f of REQUIRED_SHOTS) if (!existsSync(join(shotsDir, b.id, f))) missing.push(`${b.id}/${f}`);
    }
    if (missing.length)
      return skip(
        `no still on disk for ${missing.join(", ")}: run node scripts/boards-render.mjs ${projectDir} ` +
          `(with .palate/explore/donor-heroes.json present, which is what fetches each donor hero) first`,
      );

    /**
     * THE PAGE ENDINGS ARE CROPPED BEFORE ANYTHING IS FINGERPRINTED, because the crop IS the
     * candidate and a request naming a file nothing wrote is a comparison the subagent cannot
     * make. A direction whose donor has no full capture keeps its other two surfaces: the
     * library holds no `full.png` for some references, which is not the operator's fault and
     * not a reason to stop an Explore. It is said out loud rather than silently dropped, since
     * a missing surface and a surface that passed look identical in a record that does not
     * distinguish them.
     */
    let sharp = null;
    try { sharp = engineRequire("sharp"); } catch { sharp = null; }
    /**
     * NO SHARP IS A SKIP, not a two-surface pass. A library with no whole-page capture for a
     * reference is a fact about the library and the ending is dropped; sharp missing is a local
     * fault with a named fix, and judging every direction on two surfaces because of it would
     * quietly hand back the instrument this task exists to widen.
     */
    if (!sharp) return skip("sharp not installed: run scripts/reference-capture/setup.sh");
    const withFoot = new Set();
    for (const b of boards) {
      const dir = join(shotsDir, b.id);
      if (!existsSync(join(dir, "donor-full.png"))) {
        const why = donorFullReason(dir);
        process.stderr.write(
          `gate-board-judge: ${b.id} (${b.donor}): no donor-full.png on disk` +
            `${why ? ` (${why})` : ""}, so the page ending is judged on nothing and is left out of the request.\n`,
        );
        continue;
      }
      try {
        await cropFoot(sharp, join(dir, "full.png"), join(dir, "foot.png"));
        await cropFoot(sharp, join(dir, "donor-full.png"), join(dir, "donor-foot.png"));
        withFoot.add(b.id);
      } catch (e) {
        process.stderr.write(
          `gate-board-judge: ${b.id}: the page ending could not be cropped (${e.message}), so it is left out of the request.\n`,
        );
      }
    }

    /** Every surface's candidate still, as it is right now. A redraw of any one restates the set. */
    const fingerprints = (id) => ({
      board_hero: heroFingerprint(join(shotsDir, id, "hero.png")),
      board_foot: withFoot.has(id) ? heroFingerprint(join(shotsDir, id, "foot.png")) : null,
      board_inner: heroFingerprint(join(shotsDir, id, "inner.png")),
    });

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
      // A RECORD WITH NO READABLE RUNG IS NOT A VERDICT. One reached the shortcut and printed
      // "already judged: b1 undefined" over a drawing nothing had scored.
      if (!j || !j.board_hero || !RUNGS.some((r) => r.id === j.rung)) return true;
      const now = fingerprints(b.id);
      // EVERY SURFACE, not only the entrance. A direction redrawn at its ending or its inner
      // page and judged on the entrance alone would be waved through on verdicts nobody gave.
      return ["board_hero", "board_foot", "board_inner"].some((k) => (j[k] ?? null) !== now[k]);
    });
    if (!stale.length) {
      /**
       * A STANDING REFUSAL IS STILL A REFUSAL. A board read below the bar and left alone is not
       * "already judged, nothing to do": the verdict stands, and re-stating the comparison would
       * ask a fresh subagent the same question about the same picture until one of them said
       * something kinder.
       */
      const worse = boards.filter((b) => refusedRung(held.get(b.id).rung));
      if (worse.length) {
        for (const b of worse)
          process.stderr.write(
            `gate-board-judge: ${b.id} (${held.get(b.id).donor ?? b.donor}) stands judged ` +
              `${WORSE_PHRASE[held.get(b.id).rung]} than its donor and has not been redrawn. A board is shown only ` +
              `when it reads comparable or better on every surface it is judged on. Redraw it from the donor's ` +
              `hero and re-render before judging again.\n`,
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
    const pairs = [];
    for (const b of boards) {
      for (const surface of ["entrance", "foot", "inner"]) {
        if (surface === "foot" && !withFoot.has(b.id)) continue;
        const spec = SURFACES[surface];
        const candidate = join(shotsDir, b.id, spec.candidate);
        pairs.push({
          ...buildBoardPair({
            id: b.id,
            surface,
            question: spec.question,
            boardPath: candidate,
            donorPath: join(shotsDir, b.id, spec.donor),
            donorSlug: b.donor,
            runToken,
          }),
          /**
           * THE DRAWING THE JUDGE SAW. A request stands on disk after it is written, so a board
           * redrawn in between (which is exactly what the refusal asks for) would otherwise have
           * the OLD judgements applied to the NEW still, and the redraw would be blessed by a
           * verdict nobody gave it.
           */
          candidate,
          candidate_sha: heroFingerprint(candidate),
        });
      }
    }
    mkdirSync(dirname(requestPath), { recursive: true });
    writeFileSync(
      requestPath,
      JSON.stringify(
        {
          runToken,
          // NO TOP-LEVEL QUESTION. The surfaces ask three different things and the dispatching
          // doctrine says to pass "the question" verbatim, so one question beside three pairs
          // is an instruction to ask the entrance's question over a page ending, and the answer
          // would come back valid. Each pair carries its own; there is nothing else to pass.
          questions: "each pair carries its own question: dispatch that pair's `question` verbatim",
          rungs: RUNGS.map((r) => r.id),
          pairs,
        },
        null,
        2,
      ) + "\n",
    );
    process.stdout.write(
      `gate-board-judge: ${boards.length} direction(s) on ${pairs.length} surface(s), ${pairs.length * 2} comparisons ` +
        `stated in ${requestPath}\n` +
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
   * A REQUEST FROM BEFORE THE THREE SURFACES IS STALE, not a two-thirds pass. Its pairs are one
   * per direction with no `surface`, and its board set matches the registry exactly, so scoring
   * it would judge every direction on its entrance alone and report a clean run.
   */
  if (request.pairs.some((p) => !p.surface))
    return skip("the request was written before the page ending and the inner page were judged; re-run phase 1");

  /**
   * THE REQUEST MUST STILL DESCRIBE THIS SET OF BOARDS.
   *
   * Phase 2 scored `request.pairs` and never looked at the registry it had just parsed, so a
   * board registered after the request was written was never judged and never missed: the gate
   * printed "2 board(s) judged" on a three-board Explore and exited 0. Phase 1 refuses a board
   * with no evidence on disk for the same reason, and this is the same hole one phase along.
   */
  const registered = boards.map((b) => b.id);
  const judgedSet = [...new Set(request.pairs.map((p) => p.board))];
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
    if (!p.candidate_sha || !p.candidate) continue; // a request from before the fingerprint existed claims nothing
    if (heroFingerprint(p.candidate) !== p.candidate_sha)
      return skip(
        `${SURFACES[p.surface]?.candidate ?? "the still"} for ${p.board} changed since the request was written; re-run phase 1`,
      );
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
      `gate-board-judge: ${judgements.length} judgement(s) returned for ${request.pairs.length} comparison pair(s), which needs ${want} ` +
        `(each surface judged in both orders, by a fresh subagent each time). NOT a pass.\n`,
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
  const bySurface = new Map(); // pair id -> the scored reading
  for (const pair of request.pairs) {
    const mine = judgements.filter((j) => pair.comparisons.some((c) => c.id === j.id));
    try {
      bySurface.set(pair.id, scoreBoardPair(pair, mine));
    } catch (e) {
      process.stderr.write(`gate-board-judge: ${e.message}. NOT a pass.\n`);
      process.exitCode = 2;
      return;
    }
  }

  /**
   * ONE RECORD PER DIRECTION, carrying the three readings and the LOWEST of them.
   *
   * `rung` stays the field it always was, because `gate-explore.mjs` reads exactly that and a
   * direction is shown or not on it. The per-surface readings sit beside it: a null foot is a
   * surface that was never judged, and it has to look different from one that passed, or the
   * next reader takes silence for a clean bill.
   */
  const rungOrder = RUNGS.map((r) => r.id);
  const scored = [];
  for (const b of boards) {
    const surfaces = ["entrance", "foot", "inner"];
    const readings = new Map(
      surfaces.map((sf) => [sf, bySurface.get(`${b.id}:${sf}`) ?? null]),
    );
    const present = surfaces.filter((sf) => readings.get(sf));
    const lowest = present
      .map((sf) => readings.get(sf).rung)
      .reduce((a, r) => (rungOrder.indexOf(r) < rungOrder.indexOf(a) ? r : a));
    const donor = request.pairs.find((p) => p.board === b.id)?.donor ?? b.donor ?? null;
    scored.push({
      id: b.id,
      donor,
      rung: lowest,
      rungs: Object.fromEntries(surfaces.map((sf) => [sf, readings.get(sf)?.rung ?? null])),
      consistent: present.every((sf) => readings.get(sf).consistent),
      run_token: request.runToken,
      judged_at: judgedAt,
      // WHICH DRAWINGS THESE VERDICTS ARE ABOUT. Phase 1 re-stated every comparison on every
      // round, including the rounds where nothing had been redrawn, so a three-board Explore
      // paid for six fresh subagents again to be told what the manifest already held. It can
      // only skip safely if the record says which stills were judged, which is this.
      board_hero: request.pairs.find((p) => p.id === `${b.id}:entrance`)?.candidate_sha ?? null,
      board_foot: request.pairs.find((p) => p.id === `${b.id}:foot`)?.candidate_sha ?? null,
      board_inner: request.pairs.find((p) => p.id === `${b.id}:inner`)?.candidate_sha ?? null,
      // Not recorded: the surface readings themselves, which live in `rungs`. `verdicts` is kept
      // off the manifest for the same reason it always was, and used only for the refusal below.
      verdicts: Object.fromEntries(present.map((sf) => [sf, readings.get(sf).verdicts])),
    });
  }

  const recordError = record(projectDir, scored.map(({ verdicts, ...j }) => j));
  if (recordError) {
    process.stderr.write(`gate-board-judge: the judgements were scored but not recorded: ${recordError}. NOT a pass.\n`);
    process.exitCode = 2;
    return;
  }

  const worse = scored.filter((s) => refusedRung(s.rung));
  if (worse.length) {
    for (const s of worse)
      // NAMING THE SURFACE AND THE READING, because "redraw it" over a page whose entrance is
      // fine and whose ending is not sends the operator to the wrong half of the drawing, and
      // "somewhat worse" and "clearly worse" are different amounts of redrawing.
      for (const [surface, verdicts] of Object.entries(s.verdicts)) {
        // The SURFACE's own reading, which is the lower of its two orderings, is what refuses
        // it. Reading the raw verdicts here would name a surface the swap had already rescued.
        const rung = s.rungs[surface];
        if (!refusedRung(rung)) continue;
        process.stderr.write(
          `gate-board-judge: ${s.id} (${s.donor}) judged ${WORSE_PHRASE[rung]} than its donor at the ` +
            `${SURFACES[surface].label}: ${verdicts[0]} / ${verdicts[1]}. A board is shown only when it reads ` +
            `comparable or better on every surface it is judged on. Redraw it from the donor's hero before the ` +
            `canvas is published.\n`,
        );
      }
    process.exitCode = 2;
    return;
  }

  const shaky = scored.filter((s) => !s.consistent).map((s) => s.id);
  /**
   * THE PASS LINE NAMES THE SURFACES THAT WERE ACTUALLY JUDGED. It used to say "the entrance,
   * the page ending and the inner page" whatever happened, so a run where a donor had no
   * whole-page capture printed a claim about three surfaces over four comparisons. Phase 1's
   * warning is a different invocation and usually a different transcript; this is the sentence
   * an operator reads and reports.
   */
  const readOn = (s) => {
    const judged = Object.keys(s.verdicts).map((sf) => SURFACES[sf].label);
    const dropped = ["entrance", "foot", "inner"].filter((sf) => !(sf in s.verdicts)).map((sf) => SURFACES[sf].label);
    return `${s.id} ${s.rung} (${judged.join(", ")}` +
      (dropped.length ? `; no ${dropped.join(", no ")}, the donor has no whole-page capture` : "") + ")";
  };
  process.stdout.write(
    `Board judge passed: ${scored.length} direction(s) judged against their own donors, both orders each, ` +
      `read at the lowest surface: ${scored.map(readOn).join(", ")}.` +
      (shaky.length ? ` Unstable across the swap, read at the lower rung: ${shaky.join(", ")}.` : "") +
      "\n",
  );
}

/**
 * The run is asynchronous now (the page endings are cropped before the comparisons are stated),
 * so a rejection would otherwise print a stack and exit 1, which is neither the skip grammar nor
 * the refusal grammar the callers read. It is caught and said in the file's own words.
 */
if (invokedDirectly(import.meta.url))
  main().catch((e) => {
    process.stderr.write(`gate-board-judge: ${e && e.message ? e.message : e}. NOT a pass.\n`);
    process.exitCode = 2;
  });
