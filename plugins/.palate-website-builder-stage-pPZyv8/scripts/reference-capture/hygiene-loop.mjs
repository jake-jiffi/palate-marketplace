/**
 * hygiene-loop.mjs - the SELF-HEAL loop around the BUILD HYGIENE score.
 *
 * WHAT THIS NUMBER IS, AND WHAT IT IS NOT. It rolls up the checks measurable WITHOUT a model and
 * WITHOUT a judge: framework-default accents, default-only type stacks, WCAG 2.5.8 tap targets,
 * sub-16px mobile body, axe violations, Core Web Vitals. That is HYGIENE, and that boundary is
 * the point - it runs in seconds on every build, needing nothing downloaded and nobody's opinion.
 * It is NOT a prediction of the public grade, and this file used to call it one.
 *
 * The measurement that killed that name: across 23 fresh re-grades, the local number correlated
 * with the public grade at r = -0.074 like for like (16 domains in both), mean absolute gap 18.0
 * points, regression grader = 40.0 + 0.323 x local, residual sd 18.2. No predictive power.
 *
 * THE REFERENCE WAS BROKEN WHILE THAT WAS TAKEN. capture.mjs computed `out.design` per viewport
 * and then dropped it at the `viewportsOut` whitelist, so the worker read undefined and checks.mjs
 * sailed past its truthy guard: production grades stamped `2026-08-06.design-measured` were
 * scoring design on 4 of 11 checks. The five missing - type_system_discipline,
 * colour_accent_discipline, spacing_rhythm, component_detail_craft, responsive_integrity - are
 * EXACTLY the checks this score is built from.
 *
 * THAT BUG MAKES THE CAUSAL TEST CLEANER, NOT MURKIER, WHICH I HAD BACKWARDS. With those five
 * dropped, the certified design dimension is currently the VISION HALF ALONE (appearance head plus
 * pairwise ladder). So there are two local numbers measured against the same vision-only
 * reference: this one, carrying no vision, at r = -0.074 over 23; and local-grade's tier 2, which
 * adds a locally-run SigLIP head and ladder, at r = +0.83 / rho = +0.86, mean absolute gap 10.0,
 * over 7. The vision half is what tracks the grade. A number without it cannot, and that is this
 * one's permanent condition by construction.
 *
 * The sharpest version of that: on the same seven, the taste percentile ALONE tracks the certified
 * grade at r = 0.90, better than tier 2's whole composite at 0.83. The appearance head out-predicts
 * the thing it is a component of. So it is not "vision plus hygiene beats hygiene" - it is vision,
 * and mixing hygiene into it currently dilutes the signal.
 *
 * So my own retraction over-corrected. "The grade is mostly design" is now the better-supported
 * explanation rather than an unproven one. What HAS gone stale is the other half of the sentence:
 * design can no longer be called unrunnable locally, because local-grade runs both the head and
 * the ladder on the customer's machine.
 *
 * HOLD ALL OF IT LOOSELY UNTIL THE DEPLOY. n = 7 puts the 95% CI on r = +0.83 at roughly
 * [0.21, 0.97] - directionally strong, numerically vague. Both figures are pre-deploy, and once
 * the capture fix reaches Fly the certified design dimension gets those five computed checks back,
 * which should RAISE this number's correlation (it would share inputs with the reference again)
 * and may lower tier 2's. That is a prediction, recorded here so the re-measure can falsify it.
 * Re-run projected-vs-graded.mjs after the deploy.
 *
 * None of that rescues the old name. Whatever the cause, this number did not predict the number
 * customers were given, and calling it a "projected grade" told an agent, and through it a
 * customer, that clearing 80 here predicts scoring 80 publicly. The design half comes from the
 * LOCAL grade (grade-local.mjs), which runs on this machine for free; the only number that may be
 * SHARED is the one the website produces at palatemcp.com/grade.
 *
 * The gate and the loop are unchanged and still worth having. These are real faults and fixing
 * them is real work. Only the CLAIM was wrong.
 *
 * verify-rendered.mjs already computes the score and blocks below the floor, naming the gaps.
 * That is a gate, not a loop. Blocking tells an agent it failed; it does not tell it whether
 * the thing it just changed helped, and an agent that cannot see whether it is converging will
 * thrash: it will keep editing, keep re-running, and have no way to tell a real gain from the
 * noise floor.
 *
 * This module closes it. It persists each projection beside the build and turns the next run
 * into a comparison: up, down, or unchanged, with the gaps that moved and the ones that did
 * not. Four properties are load-bearing.
 *
 *   1. NOISE IS NOT PROGRESS. Five consecutive grades of an unchanged page returned
 *      76, 78, 80, 81, 76 - one sd of 2.3 points. So a move of +/-2 reads as UNCHANGED and
 *      never as improvement. A loop that celebrates noise teaches the agent that its last
 *      random edit worked, which is worse than no signal at all.
 *
 *   2. A COMPARISON MUST BE LIKE FOR LIKE. `--no-vitals` drops 14 of the 100 weight, and
 *      an unmeasurable dimension drops out of the denominator entirely, so two runs can
 *      report different numbers for an identical page. Every entry records the exact set of
 *      check ids it scored; a run against a different set reports NO COMPARISON and says why,
 *      rather than printing a delta that means nothing.
 *
 *   3. THE LOOP IS BOUNDED. Two iterations with no material gain is a stall, and a stall is
 *      reported as one: it names the checks that have not moved and tells the agent to stop
 *      and escalate rather than run a fourth pass. It does NOT release the gate - a stalled
 *      build still blocks - because "it stopped improving" is not the same fact as "it is
 *      good enough", and only a human gets to decide the second.
 *
 *   4. IT FAILS LOUD. An unreadable or unwritable history, or a run with no --out to persist
 *      to, is SAID rather than swallowed. Every silent skip in this product's history
 *      reported a clean result while measuring nothing.
 *
 * The history is bookkeeping, so nothing here is ever fatal to a build: the caller reports
 * the problem and carries on with the gate it already had.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DIMENSIONS } from './rubric.mjs';

export const HISTORY_FILE = 'hygiene-history.json';
export const HISTORY_VERSION = 1;
/** Keep the tail bounded; a build that has run 20 iterations has a different problem. */
export const HISTORY_MAX = 20;
/**
 * Run-to-run spread on an UNCHANGED page. Anything inside this band is the instrument, not the
 * build.
 *
 * MEASURED ON THIS INSTRUMENT, 2026-08-07. It previously read 2, inherited from five runs of the
 * PUBLIC GRADER (76, 78, 80, 81, 76) and applied here without being re-measured. That was the
 * wrong number for the wrong instrument: the public grade carries a vision ladder and an
 * appearance head, and their disagreement is most of its spread. The hygiene score makes no
 * model calls at all, so the only thing that can move it is timing.
 *
 *   no-vitals, local fixture   97 97 97 97 97      range 0
 *   vitals ON, local fixture   98 98 98 98 98      range 0
 *   vitals ON, palatemcp.com   60 61 60 60         range 1   (LCP 1620-1724ms)
 *
 * So 1, not 2. At 2 a real two-point repair reported as "unchanged", which is the one thing this
 * band must never do: it exists to stop the loop celebrating noise, not to stop it noticing
 * progress. At 1 the only observed jitter (a single point, from LCP variance on a real network)
 * still reads as unchanged.
 *
 * The remote case is the one that governs, because a build is graded on a preview URL. If a
 * future change adds a model call or a sampled measurement to this tier, re-measure: this
 * constant is only as good as the instrument it was taken on, which is the mistake it replaces.
 */
export const NOISE_BAND = 1;
/** Iterations with no material gain before the loop is called stalled. */
export const DEFAULT_STALL_ITERS = 2;
/** A check is "not moving" when its raw score sits inside this band across the window. */
const FROZEN_BAND = 0.05;

const CHECK_META = new Map(
  DIMENSIONS.flatMap((d) => d.checks.map((c) => [c.id, { label: c.label, fix: c.fix, dimension: d.id }])),
);

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * What the run MEASURED, as a stable string: the measurement configuration, not the outcome.
 *
 * The distinction is load-bearing and I got it wrong first. Keying the basis on the set of
 * scored checks looked rigorous and was self-defeating: an axe check only enters the
 * projection when it FIRES, so fixing the contrast violation removed `text_contrast` from
 * the set, changed the basis, and made the gate report NO COMPARISON on the run where the
 * agent had just done exactly what it was told. A trend that goes blind whenever a fix lands
 * is worse than no trend.
 *
 * So the basis is the configuration the caller controls: vitals on or off (14 of the 100
 * weight, so the number is genuinely a different quantity across it), axe available or not,
 * and the route set axe swept. Check-set changes WITHIN a basis still shift the denominator a
 * little; those are reported as a caveat on the delta rather than as a refusal to compare.
 */
export function basisOf(ctx = {}) {
  return [
    'vitals:' + (ctx.vitals === false ? 'off' : 'on'),
    'axe:' + (ctx.axe === false ? 'off' : 'on'),
    'routes:' + [...(ctx.routes ?? [])].sort().join('+'),
  ].join(' ');
}

/** id -> raw, for every check the projection actually scored. */
export function checksOf(projected) {
  const out = {};
  for (const d of projected?.dimensions ?? []) {
    for (const c of d.checks ?? []) out[c.id] = round3(c.raw ?? 0);
  }
  return out;
}

/** id -> points recoverable across the whole rubric, for the checks scoring under the floor. */
export function recoverableOf(projected) {
  const out = {};
  for (const f of projected?.findings ?? []) out[f.id] = round3(f.recoverable ?? 0);
  return out;
}

/**
 * One history row.
 *
 * No `band`. The rubric's bands are GRADE bands ("B Strong", "G Broken"); recording one against
 * a hygiene score would put the retired claim straight back into the artefact, where the next
 * reader would quote it.
 */
export function entryFor(scored, ctx = {}) {
  const projected = scored;
  return {
    at: ctx.at ?? new Date().toISOString(),
    url: ctx.url ?? null,
    routes: ctx.routes ?? null,
    vitals: ctx.vitals !== false,
    axe: ctx.axe !== false,
    overall: projected.overall,
    measuredWeight: projected.measuredWeight ?? null,
    minScore: ctx.minScore ?? null,
    blocked: !!ctx.blocked,
    basis: basisOf(ctx),
    checks: checksOf(projected),
    recoverable: recoverableOf(projected),
  };
}

// ------------------------------------------------------------------ io ----
/**
 * Read the history. Returns `{ entries, error }`: a MISSING file is a first run and carries
 * no error, but a file that exists and will not parse is an error the caller must speak.
 * Losing the trend silently is exactly the failure this module exists to prevent.
 */
export function readHistory(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { entries: [], error: null, fresh: true };
    return { entries: [], error: 'could not be read: ' + (e?.message ?? e), fresh: false };
  }
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries.filter((e) => e && Number.isFinite(e.overall)) : null;
    if (!entries) return { entries: [], error: 'is not a grade history (no `entries` array)', fresh: false };
    return { entries, error: null, fresh: false };
  } catch (e) {
    return { entries: [], error: 'is not valid JSON: ' + (e?.message ?? e), fresh: false };
  }
}

/** Append and truncate. Returns `{ error }`; a write failure is reported, never thrown. */
export function writeHistory(file, entries, entry) {
  const next = [...entries, entry].slice(-HISTORY_MAX);
  try {
    writeFileSync(file, JSON.stringify({ version: HISTORY_VERSION, entries: next }, null, 2) + '\n');
    return { error: null, entries: next };
  } catch (e) {
    return { error: 'could not be written: ' + (e?.message ?? e), entries: next };
  }
}

// ------------------------------------------------------------ analysis ----
/**
 * The trailing run of entries measured on the SAME basis as `basis`. That run is "this loop":
 * changing the measurement basis mid-way starts a new one, because the numbers either side of
 * the change are not the same quantity.
 */
export function comparableTail(entries, basis) {
  const out = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].basis !== basis) break;
    out.unshift(entries[i]);
  }
  return out;
}

/**
 * improved / regressed / unchanged / incomparable / first.
 *
 * `denominatorNote` is set when the two runs scored a different SET of checks inside the same
 * basis: an axe check that fired last time and not this time, or a check that went
 * inapplicable. Part of the move is then the denominator rather than the page, and the
 * message says so instead of taking full credit.
 */
export function compare(current, previous) {
  if (!previous) return { verdict: 'first', delta: null, previous: null, denominatorNote: null };
  if (previous.basis !== current.basis) {
    return { verdict: 'incomparable', delta: null, previous, denominatorNote: null };
  }
  const now = Object.keys(current.checks ?? {});
  const then = Object.keys(previous.checks ?? {});
  const gone = then.filter((id) => !now.includes(id));
  const added = now.filter((id) => !then.includes(id));
  const denominatorNote = gone.length || added.length
    ? `the scored set also changed (${[
        gone.length ? 'no longer scored: ' + gone.join(', ') : '',
        added.length ? 'newly scored: ' + added.join(', ') : '',
      ].filter(Boolean).join('; ')}), so part of this move is the denominator, not the page`
    : null;
  const delta = current.overall - previous.overall;
  const verdict = Math.abs(delta) <= NOISE_BAND ? 'unchanged' : delta > 0 ? 'improved' : 'regressed';
  return { verdict, delta, previous, denominatorNote };
}

/**
 * Has the loop stopped converging? The window is the last `stallIters + 1` comparable runs;
 * the loop is stalled when the BEST score since the anchor is no better than the anchor by
 * more than the noise band. Best, not last, so an agent that goes 61 -> 75 -> 62 is not told
 * it is stalled when it clearly found something and then broke it again.
 */
export function detectStall(tail, stallIters = DEFAULT_STALL_ITERS) {
  const need = Math.max(2, stallIters + 1);
  if (tail.length < need) return { stalled: false, iterations: tail.length, window: tail, blockers: [] };
  const window = tail.slice(-need);
  const anchor = window[0];
  const best = Math.max(...window.slice(1).map((e) => e.overall));
  if (best - anchor.overall > NOISE_BAND) {
    return { stalled: false, iterations: tail.length, window, blockers: [] };
  }
  return { stalled: true, iterations: tail.length, window, blockers: frozenChecks(window) };
}

/**
 * The checks that are under the floor in EVERY run of the window and have not moved across it.
 * These are what is structurally blocking: the agent has had `n` attempts and none of them
 * touched these, which usually means they are design judgements rather than defects to patch.
 */
export function frozenChecks(window) {
  const last = window[window.length - 1];
  const out = [];
  for (const [id, raw] of Object.entries(last.checks ?? {})) {
    if (raw >= 0.75) continue;
    const series = window.map((e) => e.checks?.[id]);
    if (series.some((v) => !Number.isFinite(v))) continue; // not measured throughout: not evidence
    if (Math.max(...series) - Math.min(...series) > FROZEN_BAND) continue;
    out.push({ id, raw, series, recoverable: last.recoverable?.[id] ?? 0, ...(CHECK_META.get(id) ?? {}) });
  }
  return out.sort((a, b) => b.recoverable - a.recoverable);
}

// ------------------------------------------------------------- message ----
const pts = (n) => (n ?? 0).toFixed(1);
const signed = (n) => (n > 0 ? '+' + n : String(n));

/** The trend sentence: the answer to "did what I just did help?". */
export function trendLine(cmp, iterations) {
  const it = ` (iteration ${iterations} of this loop)`;
  const caveat = cmp.denominatorNote ? ` NOTE: ${cmp.denominatorNote}.` : '';
  switch (cmp.verdict) {
    case 'first':
      return 'FIRST MEASUREMENT: there is no previous run to compare against, so there is no trend yet. The next run will report whether your changes moved it.';
    case 'incomparable':
      return `NO COMPARISON: the previous run measured a different configuration (${cmp.previous.basis}), so the two numbers are not the same quantity. Re-run with the same flags and routes to get a trend.`;
    case 'improved':
      return `IMPROVING: ${cmp.previous.overall} -> ${cmp.previous.overall + cmp.delta}, UP ${cmp.delta}${it}. Keep going in the same direction.${caveat}`;
    case 'regressed':
      return `REGRESSED: ${cmp.previous.overall} -> ${cmp.previous.overall + cmp.delta}, DOWN ${Math.abs(cmp.delta)}${it}. The last change made it WORSE - revert it before trying something else.${caveat}`;
    default:
      return `UNCHANGED: ${cmp.previous.overall} -> ${cmp.previous.overall + cmp.delta}, a move of ${signed(cmp.delta)}${it}. Run-to-run spread on an unchanged page is about ${NOISE_BAND} points, so this is noise, not progress: what you changed did not move the score.${caveat}`;
  }
}

/** The per-gap list, with each gap's own movement since the previous comparable run. */
export function gapLines(projected, previous, limit = 5) {
  return (projected.findings ?? [])
    .filter((f) => (f.recoverable ?? 0) > 0.05)
    .slice(0, limit)
    .map((f) => {
      const was = previous?.checks?.[f.id];
      let moved = '';
      if (Number.isFinite(was)) {
        const d = round3((f.raw ?? 0) - was);
        moved = Math.abs(d) < 0.01 ? ' [unchanged since last run]' : ` [${d > 0 ? 'up' : 'down'} from ${was} last run]`;
      }
      return `  - ${f.label ?? f.id} (worth ${pts(f.recoverable)} pts of the hygiene score)${moved}: ${f.detail ?? ''} FIX: ${f.fix ?? ''}`;
    })
    .join('\n');
}

/**
 * The disclosure, on every message. It is long because the short version is the lie: an agent
 * that reads "80" and infers "will score 80 publicly" stops working at exactly the point where
 * the remaining gap is design, which is the half this cannot see.
 */
const WHAT_THIS_IS =
  'WHAT THIS NUMBER IS: a BUILD HYGIENE score over the checks measurable with no model and no ' +
  'judge (accents, type stack, tap targets, mobile body size, axe violations, Core Web Vitals). ' +
  'It is NOT the public grade at palatemcp.com/grade, it has been measured to disagree with it ' +
  'substantially, and it must never be reported as a predicted grade. Most of the design ' +
  'dimension (weight 40) is a vision judgement that is not included in THIS number. Clearing this ' +
  'floor means no measurable hygiene faults are left, nothing more. For the design half, run the ' +
  'LOCAL grade (scripts/reference-capture/grade-local.mjs), which is free and runs entirely on this ' +
  'machine. For a number you can SHOW someone, submit the URL at https://palatemcp.com/grade.';

/**
 * The whole message an agent sees when the score is under the floor. It has to carry four
 * things in terms it can act on: the score and the floor, the ranked gaps with fixes, the fact
 * that it should fix and RE-RUN plus the exact command, and whether the last iteration helped.
 *
 * NOTE what the head deliberately does NOT print: the rubric's BAND letter. The bands are grade
 * bands ("B Strong", "G Broken"), and stamping one on a hygiene score re-imports the whole claim
 * the measurement just retired. The number is reported bare.
 */
export function blockMessage({ scored, cmp, stall, minScore, rerun, notes = [] }) {
  const projected = scored;
  const head =
    `build hygiene ${projected.overall}/100 is below the ${minScore} floor, ` +
    `measured on ${projected.measuredWeight} of the rubric's 100 weight.`;

  if (stall.stalled) {
    const path = stall.window.map((e) => e.overall).join(' -> ');
    const blockers = stall.blockers.length
      ? stall.blockers
          .slice(0, 5)
          .map((b) => `  - ${b.label ?? b.id} (worth ${pts(b.recoverable)} pts of the hygiene score): stuck at ${b.raw} across all ${stall.window.length} runs. FIX: ${b.fix ?? ''}`)
          .join('\n')
      : '  (no single check is frozen: the score is moving around without net gain, which usually means the edits are cosmetic)';
    return [
      head,
      `STALLED: ${stall.iterations} iterations, ${path}, no material gain (best since the anchor is within the ${NOISE_BAND}-point noise band).`,
      'STOP ITERATING. Another pass of the same kind will not clear the floor. These have not moved at all across the loop:',
      blockers,
      // Precision matters here. Every check this projection scores is measured off the rendered
      // page - a hex, a font stack, a control height, a paint time. None of them is a matter of
      // taste, so a frozen check is never "the judge disagreed": it means the edit did not reach
      // the served page. Telling an agent these are design judgements would send it to rewrite a
      // hero when the real fault is that it never rebuilt.
      'Every check above is MECHANICAL: it is measured off the rendered page, not judged. A check that has not moved in ' +
        `${stall.window.length} runs means the edit is not reaching it. Confirm in order: (1) the change is in the source, ` +
        '(2) the site was REBUILT, (3) the URL you are measuring is serving the rebuilt page. Read the `detail` for each ' +
        'check in .palate-shots/design.json - it names the exact measured value.',
      'If all three hold and the number still will not move, stop and hand it to the human with .palate-shots/design.json and ' +
        `.palate-shots/${HISTORY_FILE}. To accept the build at this score deliberately, set PALATE_MIN_HYGIENE=${projected.overall} ` +
        'for the run; it is recorded in the history, never silent.',
      // The command is printed here too. The instruction is to stop repeating the same kind of
      // pass, not to stop measuring: an agent that makes one deliberate structural change still
      // needs to re-measure it, and should not have to reconstruct the invocation to do it.
      'After ONE deliberate change of a different kind, this is the command that re-measures it:\n  ' + rerun,
      WHAT_THIS_IS,
      ...notes,
    ].join('\n');
  }

  const gaps = gapLines(projected, cmp.previous);
  return [
    head,
    trendLine(cmp, stall.iterations),
    `${(projected.findings ?? []).filter((f) => (f.recoverable ?? 0) > 0.05).length} gap(s) left, ranked by hygiene points recoverable:`,
    gaps || '  (no single gap is worth more than 0.05 points: the deficit is spread thin)',
    'NOW: fix the gaps above, rebuild, then RE-RUN THIS EXACT COMMAND to re-measure and see whether it moved:',
    '  ' + rerun,
    WHAT_THIS_IS,
    ...notes,
  ].join('\n');
}

/**
 * What clearing the floor does NOT mean, stated at the one moment it matters.
 *
 * The block path is not where this number is dangerous. An agent reading a block is still
 * working. The danger is the PASS: it clears 80, reads that as quality, and stops - which is
 * the exact failure the loop was built to prevent, arriving through the front door.
 *
 * And the gap is not vague. `originality_vs_template` (30 points) and `signature_move_present`
 * (15) are 45 of the design dimension's 100, and both are judgements no local computation can
 * make, so the projection scores design over 32 points of denominator and is structurally blind
 * to whether the page is a template. The design ceiling in rubric.mjs (overall <= design + 15)
 * therefore never binds here. Measured on this repo's own tidy-template fixture - three
 * identical bordered card grids, stock marketing copy, no idea in it anywhere - build hygiene
 * scores 97/100 with a design dimension of 97 on 3 of 11 checks. That number is the honest
 * summary of what this instrument is, so it is quoted rather than paraphrased.
 *
 * THE SECOND HALF IS WORSE AND LESS OBVIOUS: A CLEAN PAGE RESTS ON LESS EVIDENCE, NOT MORE.
 * The axe checks only enter the roll-up when they FIRE, so repairing them removes the entire
 * accessibility dimension from the denominator. Measured across the same two fixtures under
 * --no-vitals, the generic page scored 21 on 52 weight (design + accessibility) and the repaired
 * one scored 97 on 40 (design alone, 3 of its 11 checks). With vitals on it is 66 -> 54, the same
 * 12-point drop. So the basis THINS exactly as the score rises, which is the worst possible
 * pairing: the number is at its most flattering and least supported at the moment an agent is
 * most likely to stop. Hence the live `measuredWeight` in the message rather than a fixed claim.
 */
const notAQualityVerdict = (weight) =>
  'CLEARING THIS FLOOR IS NOT A QUALITY VERDICT. "Designed, not templated" (30 pts) and "One ' +
  'considered idea" (15) are 45 of the design dimension and neither is measurable here, so this ' +
  'score cannot see whether the page is a template. A tidy template with no idea in it scores 97. ' +
  `And a clean page rests on LESS evidence, not more: this run rests on ${weight} of the rubric's ` +
  '100 weight, because the axe checks only enter the roll-up when they FIRE, so repairing them ' +
  'drops the whole accessibility dimension out of the denominator. If nothing is left to fix ' +
  'here, the remaining work is DESIGN, and it is judged elsewhere.';

/** The one-line summary printed on every run, pass or fail, so the trend is never invisible. */
export function summaryLine({ scored, cmp, stall, minScore }) {
  const projected = scored;
  // With the gate off there is no floor to clear, and saying "CLEARS the 0 floor" would read as
  // an endorsement of a build nothing judged.
  const clears = minScore > 0 && projected.overall >= minScore;
  const state = minScore > 0
    ? `${clears ? 'CLEARS' : 'is BELOW'} the ${minScore} floor`
    : 'is UNGATED (PALATE_MIN_HYGIENE=0), so nothing here passed or failed';
  return (
    `verify-rendered: build hygiene ${projected.overall}/100 ${state}, ` +
    // "of the 100 weight measurable locally" was wrong and flattering: measuredWeight is what
    // THIS run scored, and it moves (40 clean, 52 with axe firing, +14 with vitals). Calling it
    // the local ceiling implied the number rests on everything available.
    `resting on ${projected.measuredWeight} of the rubric's 100 weight. ${trendLine(cmp, stall.iterations)} ` +
    'HYGIENE ONLY: measured to disagree substantially with the public grade. ' +
    (clears
      ? notAQualityVerdict(projected.measuredWeight) + ' '
      : 'Most of the design dimension is a vision judgement not included here. ') +
    'Design half: grade-local.mjs, free and local. Shareable number: palatemcp.com/grade.'
  );
}
