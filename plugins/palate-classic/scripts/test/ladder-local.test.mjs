/**
 * The local ladder must score identically to the grader worker's ladder.mjs.
 *
 * Every expectation below is a number the worker would produce for the same judgements. If one
 * of these fails, a local self-check and a certified grade have stopped being the same quantity
 * while both still print a number out of 100, which is the exact failure the convergence work
 * exists to prevent.
 *
 * Run: node --test scripts/test/ladder-local.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadderRequest, validateJudgements, scoreLadder, naChecks, RUNGS } from '../reference-capture/ladder-local.mjs';

const SYSTEM = 'system prompt from the MCP';

const ex = (slug) => ({ slug, name: slug, url: `https://${slug}.example`, taste: 70, rules: 'do this, not that', imagePath: `/tmp/${slug}.png` });
const EXEMPLARS = [ex('alpha'), ex('beta'), ex('gamma')];

const request = () =>
  buildLadderRequest({
    heroPath: '/tmp/hero.png',
    exemplars: EXEMPLARS,
    domain: 'candidate.example',
    vertical: 'health',
    measurements: '- lead colour #123456',
    system: SYSTEM,
  });

/**
 * Judgements where every exemplar gets the same verdict in both orderings.
 *
 * Ids are read from the REQUEST rather than reconstructed, which is also the discipline the
 * protocol asks of the caller: copy `comparisonId` verbatim. Reconstructing them here would
 * defeat the run-token binding these fixtures exist to exercise.
 */
const REQ = request();
function unanimous(verdict, { signature = false } = {}) {
  const out = [];
  for (const c of REQ.comparisons) {
    {
      const e = { slug: c.exemplar };
      const pos = c.candidateIs === 'A' ? 'candidate-first' : 'reference-first';
      out.push({
        comparisonId: c.id,
        verdict,
        candidate_is: c.candidateIs,
        evidence: 'the accent is #123456',
        signature_move: signature,
        signature_move_note: signature ? 'a real idea' : 'nothing qualifies',
        tells: [],
      });
    }
  }
  return out;
}

const scored = (judgements, opts = {}) => {
  const req = REQ;
  const v = validateJudgements(req, judgements);
  assert.equal(v.ok, true, 'fixture should validate: ' + v.errors.join('; '));
  return scoreLadder({ request: req, byComparison: v.byComparison, ...opts });
};
/** Find a judgement by exemplar + which image the candidate was, without knowing the token. */
const jFind = (j, slug, cand) => j.find((x) => x.comparisonId.startsWith(slug + ':') && x.candidate_is === cand);
const originality = (s) => s.checks.find((c) => c.id === 'originality_vs_template');
const signature = (s) => s.checks.find((c) => c.id === 'signature_move_present');

/**
 * The mean of three 0.7s is 0.6999999999999998, and the check's `raw` is deliberately NOT
 * rounded, because the worker's ladder.mjs does not round it either. Rounding here to make an
 * assertion tidy would be a real divergence from the instrument this module has to match, so
 * the tolerance lives in the test instead. It is far below anything that could move a score
 * out of 100.
 */
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} expected ~${expected}, got ${actual}`);

// --------------------------------------------------------------- the request ----

test('always asks for three exemplars judged twice each', () => {
  const r = request();
  assert.equal(r.comparisons.length, 6);
  assert.equal(new Set(r.comparisons.map((c) => c.exemplar)).size, 3);
});

test('the swap really swaps: A and B change places and candidateIs follows', () => {
  const r = request();
  const first = r.comparisons.find((c) => c.exemplar === 'alpha' && c.candidateIs === 'A');
  const second = r.comparisons.find((c) => c.exemplar === 'alpha' && c.candidateIs === 'B');
  assert.equal(first.imageA, '/tmp/hero.png');
  assert.equal(first.imageB, '/tmp/alpha.png');
  assert.equal(second.imageA, '/tmp/alpha.png');
  assert.equal(second.imageB, '/tmp/hero.png');
  assert.equal(first.candidateIs, 'A');
  assert.equal(second.candidateIs, 'B');
});

test('refuses to build a request with no system prompt, rather than inventing one', () => {
  // The prompt is served by the MCP so the local judge and the public grader read the same
  // instructions. A locally invented prompt would silently make the two incomparable.
  assert.throws(
    () => buildLadderRequest({ heroPath: '/tmp/h.png', exemplars: EXEMPLARS, domain: 'x', measurements: 'm' }),
    /system prompt/,
  );
});

test('the reference rules and the measurements reach the judge', () => {
  const p = request().comparisons[0].prompt;
  assert.match(p, /do this, not that/);
  assert.match(p, /#123456/);
});

// ------------------------------------------------------------- the validator ----

test('a missing judgement is a hard failure, not a shorter ladder', () => {
  const j = unanimous('comparable').slice(0, 5);
  const v = validateJudgements(REQ, j);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /no judgement returned for comparison "gamma:reference-first@/);
});

test('an unknown comparison id is rejected', () => {
  const j = unanimous('comparable');
  j.push({ comparisonId: 'delta:candidate-first', verdict: 'better', candidate_is: 'A' });
  const v = validateJudgements(REQ, j);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /unknown comparison/);
});

test('an invalid verdict is rejected rather than coerced', () => {
  const j = unanimous('comparable');
  j[0].verdict = 'quite good actually';
  const v = validateJudgements(REQ, j);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /is not one of/);
});

test('a judge that answered about the wrong image is caught', () => {
  // If candidate_is comes back copied rather than following the swap, the position-bias control
  // did not actually run.
  const j = unanimous('comparable');
  jFind(j, 'alpha', 'B').candidate_is = 'A';
  const v = validateJudgements(REQ, j);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /candidate_is is "A" but the candidate was image B/);
});

test('duplicate judgements for one comparison are rejected', () => {
  const j = unanimous('comparable');
  j.push({ ...j[0] });
  const v = validateJudgements(REQ, j);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /two judgements returned/);
});

// ---------------------------------------------------------------- the scoring ----

test('unanimous verdicts score exactly the rung value', () => {
  for (const r of RUNGS) {
    const s = scored(unanimous(r.id));
    near(originality(s).raw, r.raw, `${r.id}:`);
    assert.equal(s.rung, r.id);
  }
});

test('scores from the MEAN of the comparisons, not the median rung', () => {
  // Two "comparable" (0.7) and one "somewhat_worse" (0.4). The median rung is comparable, which
  // would score 0.7; the mean is 0.6. The mean is what bounds one judge's influence to a third
  // of a rung instead of a whole one.
  const j = [
    ...unanimous('comparable').filter((x) => !x.comparisonId.startsWith('gamma')),
    ...unanimous('somewhat_worse').filter((x) => x.comparisonId.startsWith('gamma')),
  ];
  const s = scored(j);
  assert.equal(originality(s).raw, 0.6);
  // The reported label is the rung NEAREST the mean, so the words and the number agree.
  assert.equal(s.rung, 'comparable');
});

test('swapped judgements that disagree collapse to the LOWER rung', () => {
  const j = unanimous('comparable');
  jFind(j, 'alpha', 'B').verdict = 'clearly_worse';
  const s = scored(j);
  // alpha collapses to 0.15, beta and gamma stay 0.7 -> mean 0.5166..
  assert.equal(Math.round(originality(s).raw * 1e4) / 1e4, 0.5167);
});

test('a two-rung disagreement marks the check low confidence', () => {
  const j = unanimous('comparable');
  jFind(j, 'alpha', 'B').verdict = 'clearly_worse';
  const s = scored(j);
  assert.equal(originality(s).lowConfidence, true);
  assert.equal(signature(s).lowConfidence, true);
});

test('a one-rung disagreement takes the lower rung but is NOT called unstable', () => {
  const j = unanimous('comparable');
  jFind(j, 'alpha', 'B').verdict = 'somewhat_worse';
  const s = scored(j);
  assert.equal(originality(s).lowConfidence, false);
  assert.equal(Math.round(originality(s).raw * 1e4) / 1e4, 0.6);
});

// -------------------------------------------------------------------- the prior ----

test('a top-decile taste percentile lifts by exactly one rung gap', () => {
  const base = scored(unanimous('somewhat_worse')).checks.find((c) => c.id === 'originality_vs_template').raw;
  const s = scored(unanimous('somewhat_worse'), { tastePercentile: 96 });
  assert.equal(Math.round((originality(s).raw - base) * 1e4) / 1e4, 0.25);
  assert.match(originality(s).detail, /lifted the verdict one rung/);
});

test('a bottom-decile taste percentile pulls by exactly one rung gap', () => {
  const base = scored(unanimous('comparable')).checks.find((c) => c.id === 'originality_vs_template').raw;
  const s = scored(unanimous('comparable'), { tastePercentile: 4 });
  assert.equal(Math.round((base - originality(s).raw) * 1e4) / 1e4, 0.25);
  assert.match(originality(s).detail, /pulled the verdict down one rung/);
});

test('the prior never pushes past the ends of the ladder', () => {
  assert.equal(originality(scored(unanimous('better'), { tastePercentile: 99 })).raw, 0.9);
  assert.equal(originality(scored(unanimous('clearly_worse'), { tastePercentile: 1 })).raw, 0.15);
});

test('the prior does nothing in the middle of the distribution', () => {
  const mid = originality(scored(unanimous('comparable'), { tastePercentile: 50 })).raw;
  assert.equal(mid, originality(scored(unanimous('comparable'))).raw);
});

test('a missing taste percentile simply means no prior, not a penalty', () => {
  near(originality(scored(unanimous('comparable'), { tastePercentile: null })).raw, 0.7);
});

// ---------------------------------------------------------- the signature move ----

test('the signature move is a fraction with the old endpoints intact', () => {
  assert.equal(signature(scored(unanimous('comparable', { signature: false }))).raw, 0.15);
  assert.equal(signature(scored(unanimous('comparable', { signature: true }))).raw, 0.85);
});

test('a split vote lands in between instead of stepping a whole 4.2 points', () => {
  const j = unanimous('comparable', { signature: false });
  for (const x of j) if (x.comparisonId.startsWith('alpha:')) x.signature_move = true;
  const s = scored(j);
  // 1 of 3 -> 0.15 + (1/3)(0.7) = 0.3833
  assert.equal(Math.round(signature(s).raw * 1e4) / 1e4, 0.3833);
  assert.match(signature(s).detail, /1 of 3 comparisons saw one/);
});

test('one ordering seeing a move and the other not does not count as one', () => {
  const j = unanimous('comparable', { signature: false });
  jFind(j, 'alpha', 'A').signature_move = true;
  const s = scored(j);
  assert.equal(signature(s).raw, 0.15);
});

test('the note never argues with the score', () => {
  // A report that scores "nothing a template could not have produced" and then quotes a judge
  // describing a signature move is one a reader stops trusting.
  const j = unanimous('comparable', { signature: false });
  for (const x of j) if (x.comparisonId.startsWith('alpha:')) { x.signature_move = true; x.signature_move_note = 'THE POSITIVE NOTE'; }
  const s = scored(j);
  assert.match(signature(s).detail, /^Nothing here a template could not have produced/);
  assert.ok(!signature(s).detail.includes('THE POSITIVE NOTE'), 'a negative verdict must not quote a positive note');
});

// -------------------------------------------------------------- fail-loud paths ----

test('judgements that were not independent are scored but marked low confidence', () => {
  const s = scored(unanimous('comparable'), { independent: false });
  assert.equal(originality(s).lowConfidence, true);
  assert.match(originality(s).detail, /position-bias control did not run/);
});

test('no complete pairs leaves both checks UNMEASURED rather than scoring zero', () => {
  const req = request();
  const s = scoreLadder({ request: req, byComparison: new Map() });
  assert.equal(s.applicable, false);
  for (const c of s.checks) {
    assert.equal(c.applicable, false, `${c.id} must leave the denominator`);
  }
});

test('naChecks drop out of the denominator, so a missing ladder never charges the site for it', () => {
  for (const c of naChecks('because reasons')) {
    assert.equal(c.applicable, false);
    assert.match(c.detail, /because reasons/);
  }
});

test('the rung scale matches the grader exactly', () => {
  assert.deepEqual(
    RUNGS.map((r) => [r.id, r.raw]),
    [
      ['clearly_worse', 0.15],
      ['somewhat_worse', 0.4],
      ['comparable', 0.7],
      ['better', 0.9],
    ],
  );
});

// ------------------------------------------------------------ the flattery band ----
//
// Where the instrument is measured to over-score, it must not publish a point estimate.
// These pin the one piece of judgement in grade-local.mjs that is not the rubric's.
import { flatteryOf, FLATTERY_TASTE_FLOOR, FLATTERY_OVERSCORE } from '../reference-capture/grade-local.mjs';

test('withholds the number below the corpus median, where it is known to flatter', () => {
  // hightownpharmacy: taste p21.6, local 58, certified 41.
  const f = flatteryOf({ applicable: true, percentile: 21.6 }, 58);
  assert.ok(f, 'a below-median site must be flagged');
  assert.equal(f.risk, true);
  // The certified 41 has to fall inside the range we publish, or the range is decoration.
  assert.ok(f.honestRange[0] <= 41 && 41 <= f.honestRange[1], `41 must sit inside ${JSON.stringify(f.honestRange)}`);
});

test('the published range contained the certified score on BOTH measured sites', () => {
  // properly.sg: taste p42.9, local 62, certified 36.
  const p = flatteryOf({ applicable: true, percentile: 42.9 }, 62);
  assert.ok(p.honestRange[0] <= 36 && 36 <= p.honestRange[1], `36 must sit inside ${JSON.stringify(p.honestRange)}`);
});

test('states the number normally above the median', () => {
  // linear.app at p56.6 was within 4 points; nothing to withhold.
  assert.equal(flatteryOf({ applicable: true, percentile: 56.6 }, 56), null);
  assert.equal(flatteryOf({ applicable: true, percentile: 99.3 }, 91), null);
  assert.equal(flatteryOf({ applicable: true, percentile: FLATTERY_TASTE_FLOOR }, 70), null, 'the floor itself is safe');
});

test('does NOT withhold when the appearance head could not run', () => {
  // Without the head there is no evidence either way, and inventing a caveat is its own lie.
  // The grade already reports the head as unmeasured in that case.
  assert.equal(flatteryOf({ applicable: false, reason: 'taste-lookup-failed' }, 58), null);
  assert.equal(flatteryOf(null, 58), null);
  assert.equal(flatteryOf({ applicable: true, percentile: null }, 58), null);
});

test('the range is stated as a range, with its sample size', () => {
  const f = flatteryOf({ applicable: true, percentile: 10 }, 60);
  assert.equal(f.honestRange[0], 60 - FLATTERY_OVERSCORE.max);
  assert.equal(f.honestRange[1], 60 - FLATTERY_OVERSCORE.min);
  assert.equal(FLATTERY_OVERSCORE.n, 2, 'n must travel with the correction, it is two observations');
});

test('the pass path is where the caveat goes, and the measurement says why', () => {
  // Measured above the corpus median: gaps -4, -8, +5, -6, +4, mean signed -1.8. The number is
  // CONSERVATIVE up here, so no correction is applied and none should be. What is NOT earned is
  // "safe to stop on": 34 of the 100 weight is unmeasured. flatteryOf must stay null so the
  // high-score path renders the number plus the done-signal warning, not a withholding.
  for (const p of [56.6, 73.4, 92.4, 99.3]) {
    assert.equal(flatteryOf({ applicable: true, percentile: p }, 91), null, `p${p} must state its number`);
  }
});

test('judgements written for a DIFFERENT run cannot be scored against this one', () => {
  // Two runs in the same vertical produce the same exemplar slugs and the same positions. Without
  // the per-run token their ids are identical, so yesterday's judgements would validate cleanly
  // against today's request and be scored as though they described this page - a complete,
  // well-formed ladder describing the wrong site. That is the worst way for it to be wrong.
  const other = buildLadderRequest({
    heroPath: '/tmp/hero.png', exemplars: EXEMPLARS, domain: 'candidate.example',
    vertical: 'health', measurements: '- lead colour #123456', system: SYSTEM,
  });
  assert.notEqual(other.runToken, REQ.runToken, 'each run must mint its own token');
  const v = validateJudgements(other, unanimous('comparable'));
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /unknown comparison/);
});

test('a request carries its token, and every comparison id is bound to it', () => {
  assert.ok(REQ.runToken, 'the request must record its token');
  for (const c of REQ.comparisons) assert.ok(c.id.endsWith("@" + REQ.runToken), `${c.id} must carry the token`);
});
