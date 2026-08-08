/**
 * ladder-local.mjs - the pairwise design ladder, judged by the agent that did the build.
 *
 * The public grader runs this ladder with paid vision calls on a Fly machine. The plugin cannot
 * call an API for it and does not need to: the agent running the build IS a vision model, and it
 * is already sitting in the loop. So this module does not judge. It STATES the comparison, then
 * scores what comes back, using the worker's arithmetic unchanged.
 *
 * Everything the worker's ladder.mjs learned the hard way is preserved here, because each rule
 * exists to fix a measured failure:
 *
 *   1. THREE COMPARISONS, ALWAYS. The pack once carried two per vertical and the ladder silently
 *      ran on two. Design craft is 40% of the grade and the ladder owns 45 of its 100 points, so
 *      a third less evidence measurably widened the spread: jiffi.co moved 40 points across three
 *      runs of an unchanged site.
 *
 *   2. EVERY COMPARISON JUDGED TWICE WITH THE POSITIONS SWAPPED, and on disagreement the LOWER
 *      rung wins. Position bias is the best-documented failure of pairwise VLM judging and
 *      swapping is the only control that detects it. An unstable verdict is not evidence of
 *      quality.
 *
 *   3. SCORE FROM THE MEAN, NOT THE MEDIAN RUNG. With n=3 and rung values 0.15/0.4/0.7/0.9 the
 *      median either does not move or moves a whole rung, which is 3.6 points of the final grade
 *      decided by two judges out of three landing on the other side of a near-tie. The mean
 *      bounds one judge's influence to a third of a rung. The reported rung is then the one
 *      NEAREST the mean, so the label a person reads and the number they are scored on cannot
 *      disagree.
 *
 *   4. THE SIGNATURE MOVE IS A FRACTION, NOT A VOTE. As a boolean it was a 4.2-point step in the
 *      final grade turning on one judge changing its mind about a borderline page - the largest
 *      single source of run-to-run movement in the rubric. The endpoints are unchanged: nobody
 *      saw one -> 0.15, everybody did -> 0.85.
 *
 * THE ONE THING THAT IS GENUINELY HARDER LOCALLY: independence. The worker fires its two swapped
 * comparisons as separate API calls, so neither can see the other's answer. An agent judging both
 * orderings in one context is not running the control, it is asking itself to agree with itself.
 * So the request tells the caller to dispatch each judgement to a FRESH subagent, and the
 * judgements file must declare whether that happened. A run that declares otherwise is scored,
 * and marked low-confidence with the reason stated. It is never silently accepted as if the
 * control had run.
 */

/** Must match mcp-server/lib/gradepack.ts LADDER_RUNGS and the worker's ladder.mjs RUNGS. */
export const RUNGS = [
  { id: 'clearly_worse', label: 'clearly worse than the reference', raw: 0.15 },
  { id: 'somewhat_worse', label: 'somewhat worse than the reference', raw: 0.4 },
  { id: 'comparable', label: 'comparable to the reference', raw: 0.7 },
  { id: 'better', label: 'better than the reference', raw: 0.9 },
];
const rungIndex = (id) => RUNGS.findIndex((r) => r.id === id);

/** The prior's bounds, identical to the worker's. */
const LIFT_AT = 85;
const PULL_AT = 10;
const RUNG_GAP = (RUNGS[RUNGS.length - 1].raw - RUNGS[0].raw) / (RUNGS.length - 1);

/**
 * Build the judgement request: one entry per (exemplar x position), so three exemplars produce
 * six independent questions.
 *
 * `heroPath` and each exemplar's `imagePath` are absolute so the caller can open them directly.
 */
export function buildLadderRequest({ heroPath, exemplars, domain, vertical, measurements, system, runToken }) {
  if (!heroPath) throw new Error('buildLadderRequest: no hero screenshot');
  if (!Array.isArray(exemplars) || !exemplars.length) throw new Error('buildLadderRequest: no exemplars');
  if (!system) throw new Error('buildLadderRequest: no judging system prompt (it comes from palate_grade_pack, never invented locally)');

  /**
   * EVERY COMPARISON ID CARRIES A PER-RUN TOKEN, so a judgement set cannot be validated against
   * a request it was not written for.
   *
   * Without it the ids are just `<slug>:<position>`, and two runs in the same vertical produce
   * IDENTICAL ids. Judgements written for yesterday's site would then validate cleanly against
   * today's request and be scored as though they described this page. The validator would report
   * a complete, well-formed ladder, which is the worst possible way for it to be wrong.
   *
   * It costs the caller nothing: the instruction already says to copy `comparisonId` verbatim
   * from the request, so the binding enforces itself through validation that already exists.
   */
  const token = runToken ?? Math.random().toString(36).slice(2, 8);

  const comparisons = [];
  for (const ex of exemplars.slice(0, 3)) {
    for (const candidateIsA of [true, false]) {
      const id = `${ex.slug}:${candidateIsA ? 'candidate-first' : 'reference-first'}@${token}`;
      comparisons.push({
        id,
        exemplar: ex.slug,
        candidateIs: candidateIsA ? 'A' : 'B',
        imageA: candidateIsA ? heroPath : ex.imagePath,
        imageB: candidateIsA ? ex.imagePath : heroPath,
        labelA: candidateIsA ? `the candidate site, ${domain}` : `a Palate library reference, ${ex.name}`,
        labelB: candidateIsA ? `a Palate library reference, ${ex.name}` : `the candidate site, ${domain}`,
        prompt: comparisonPrompt({ ex, candidateIsA, domain, measurements }),
      });
    }
  }

  return {
    version: 1,
    runToken: token,
    domain,
    vertical: vertical ?? null,
    heroPath,
    system,
    exemplars: exemplars.map((e) => ({ slug: e.slug, name: e.name, url: e.url, taste: e.taste, imagePath: e.imagePath })),
    comparisons,
    answerSchema: {
      comparisonId: 'the id from the comparison you judged',
      verdict: RUNGS.map((r) => r.id),
      candidate_is: 'A or B, copied from the comparison',
      evidence: 'one sentence naming something specific you can SEE in the candidate, quoting a colour, a face, a spacing or a component',
      signature_move: 'true or false',
      signature_move_note: 'if true, the one considered idea a template would not have produced; if false, why nothing qualifies',
      tells: 'array of any anti-patterns from the system prompt that you can actually see',
    },
  };
}

/** The per-comparison user prompt, mirroring the worker's askOnce() body. */
function comparisonPrompt({ ex, candidateIsA, domain, measurements }) {
  return [
    `IMAGE A is ${candidateIsA ? `the candidate site, ${domain}` : `a Palate library reference, ${ex.name}`}.`,
    `IMAGE B is ${candidateIsA ? `a Palate library reference, ${ex.name}` : `the candidate site, ${domain}`}.`,
    '',
    "The library reference in this pair has do/don't rules, written when we analysed it, which are the standard for this kind of site:",
    ex.rules || '(no rules recorded for this reference)',
    '',
    `Measured facts about the CANDIDATE site (${candidateIsA ? 'IMAGE A' : 'IMAGE B'}), so you are reasoning about numbers rather than impressions:`,
    measurements || '(no measurements available)',
    '',
    'Answer this JSON exactly:',
    '{',
    `  "verdict": one of ${RUNGS.map((r) => `"${r.id}"`).join(' | ')},`,
    `  "candidate_is": "${candidateIsA ? 'A' : 'B'}",`,
    '  "evidence": "one sentence naming something specific you can SEE in the candidate, quoting a colour, a face, a spacing or a component",',
    '  "signature_move": true or false,',
    '  "signature_move_note": "if true, the one considered idea a template would not have produced; if false, why nothing qualifies",',
    '  "tells": ["any anti-patterns from the list above that you can actually see"]',
    '}',
    '',
    '"verdict" compares the CANDIDATE against the library reference on craft.',
  ].join('\n');
}

/**
 * Validate returned judgements against the request.
 *
 * Returns `{ ok, errors, byComparison }`. This is strict on purpose: a judgement that did not
 * happen, or that came back for a comparison nobody asked about, must be a loud failure. The
 * grader's own ladder sat dead through an entire calibration run precisely because a missing
 * judgement looked the same as a completed one.
 */
export function validateJudgements(request, judgements) {
  const errors = [];
  const wanted = new Map(request.comparisons.map((c) => [c.id, c]));
  const byComparison = new Map();

  if (!Array.isArray(judgements)) return { ok: false, errors: ['the judgements file must contain an array of judgements'], byComparison };

  for (const j of judgements) {
    const id = j?.comparisonId;
    if (!id || !wanted.has(id)) {
      errors.push(`judgement for unknown comparison "${id ?? '(missing comparisonId)'}"`);
      continue;
    }
    if (byComparison.has(id)) {
      errors.push(`two judgements returned for comparison "${id}"`);
      continue;
    }
    if (rungIndex(j.verdict) < 0) {
      errors.push(`comparison "${id}": verdict "${j.verdict}" is not one of ${RUNGS.map((r) => r.id).join(', ')}`);
      continue;
    }
    // A judge that answered about the wrong image has answered a different question. Catching it
    // matters more than it looks: the whole point of the swap is that the two runs see opposite
    // orderings, so a copied candidate_is means the control did not actually run.
    const expect = wanted.get(id).candidateIs;
    if (j.candidate_is && j.candidate_is !== expect)
      errors.push(`comparison "${id}": candidate_is is "${j.candidate_is}" but the candidate was image ${expect}`);
    byComparison.set(id, j);
  }

  for (const id of wanted.keys()) if (!byComparison.has(id)) errors.push(`no judgement returned for comparison "${id}"`);

  return { ok: errors.length === 0, errors, byComparison };
}

/**
 * Score validated judgements into the two rubric checks the ladder owns.
 *
 * `tastePercentile` is the SigLIP prior. It is SYMMETRIC here exactly as it is in the worker: it
 * may lift as well as pull, bounded to one rung gap, and only at the extremes where the head is
 * confident. That is a deliberate departure from the original spec, made because our own
 * held-out founder labels put the head (0.738 concordance) ABOVE the pairwise ladder (0.716);
 * letting the better signal only ever say "worse than you think" made the grade structurally
 * pessimistic. Pass null when the head could not run, and the prior simply does not apply.
 */
export function scoreLadder({ request, byComparison, tastePercentile = null, independent = true }) {
  const results = [];

  for (const ex of request.exemplars.slice(0, 3)) {
    // Rebuilt with the request's own token, so this can only ever pair up judgements that were
    // written for THIS request. A request from before the token existed has none, and the
    // suffix collapses to empty, which keeps old artefacts readable.
    const suffix = request.runToken ? `@${request.runToken}` : '';
    const a = byComparison.get(`${ex.slug}:candidate-first${suffix}`);
    const b = byComparison.get(`${ex.slug}:reference-first${suffix}`);
    if (!a || !b) continue;
    const i1 = rungIndex(a.verdict);
    const i2 = rungIndex(b.verdict);
    // Disagreement of more than one rung is instability, not a reading. Either way the LOWER
    // rung is taken: an unstable verdict is not evidence of quality.
    const disagreed = Math.abs(i1 - i2) > 1;
    const idx = Math.max(0, Math.min(i1, i2));
    results.push({
      ex,
      rung: RUNGS[idx],
      disagreed,
      evidence: (i1 <= i2 ? a : b).evidence ?? '',
      // BOTH orderings must have seen it. One judge spotting a signature move that the other,
      // looking at the same two images the other way round, did not, is not a signature move.
      signatureMove: Boolean(a.signature_move && b.signature_move),
      signatureNote: a.signature_move_note ?? b.signature_move_note ?? '',
      tells: [...new Set([...(a.tells ?? []), ...(b.tells ?? [])])].slice(0, 6),
    });
  }

  if (!results.length) {
    const why = 'No complete pairs of judgements were returned, so the design ladder did not run.';
    return { applicable: false, reason: why, results: [], checks: naChecks(why) };
  }

  const meanRaw = results.reduce((a, r) => a + r.rung.raw, 0) / results.length;
  const pulled = tastePercentile != null && tastePercentile < PULL_AT;
  const lifted = tastePercentile != null && tastePercentile >= LIFT_AT;
  const adjusted = pulled ? meanRaw - RUNG_GAP : lifted ? meanRaw + RUNG_GAP : meanRaw;
  const raw = Math.max(RUNGS[0].raw, Math.min(RUNGS[RUNGS.length - 1].raw, adjusted));

  const idx = RUNGS.reduce((bestI, r, i) => (Math.abs(r.raw - raw) < Math.abs(RUNGS[bestI].raw - raw) ? i : bestI), 0);
  const rung = RUNGS[idx];
  const shaky = results.some((r) => r.disagreed) || !independent;
  const best = results.find((r) => rungIndex(r.rung.id) === idx) ?? results[0];
  const tells = [...new Set(results.flatMap((r) => r.tells))].slice(0, 5);

  const sigSeen = results.filter((r) => r.signatureMove).length;
  const sigRaw = RUNGS[0].raw + (sigSeen / results.length) * (0.85 - RUNGS[0].raw);
  const anySig = sigSeen * 2 >= results.length;

  const priorNote = pulled
    ? ` The appearance head put this in the bottom ${PULL_AT}% of the library, which pulled the verdict down one rung.`
    : lifted
      ? ` The appearance head put this in the top ${100 - LIFT_AT}% of the library, which lifted the verdict one rung.`
      : '';
  const independenceNote = independent
    ? ''
    : ' Marked low confidence: the swapped comparisons were NOT judged independently, so the position-bias control did not run.';

  return {
    applicable: true,
    reason: null,
    results: results.map((r) => ({ slug: r.ex.slug, name: r.ex.name, rung: r.rung.id, disagreed: r.disagreed, signatureMove: r.signatureMove })),
    meanRaw: Math.round(meanRaw * 1e4) / 1e4,
    raw: Math.round(raw * 1e4) / 1e4,
    rung: rung.id,
    checks: [
      {
        id: 'originality_vs_template',
        raw,
        detail:
          `Judged ${rung.label} against ${results.length} Palate reference${results.length > 1 ? 's' : ''} ` +
          `${request.vertical ? `in ${request.vertical} ` : 'from across the library '}` +
          `(${results.map((r) => r.ex.name).join(', ')}). ${best.evidence}` +
          (tells.length ? ` Tells seen: ${tells.join(', ')}.` : '') +
          priorNote +
          independenceNote,
        lowConfidence: shaky,
      },
      {
        id: 'signature_move_present',
        raw: sigRaw,
        // The note must not argue with the score: it is taken from a judgement that AGREES with
        // the verdict, or dropped. A report that scores 0.15 ("nothing a template could not have
        // produced") and then quotes a judge describing a signature move is a report a reader
        // stops trusting, and they are right to.
        detail: (() => {
          const agreeing = results.find((r) => Boolean(r.signatureMove) === anySig);
          const note = agreeing?.signatureNote ? ` ${agreeing.signatureNote}` : '';
          const split = results.length > 1 && sigSeen > 0 && sigSeen < results.length ? ` (${sigSeen} of ${results.length} comparisons saw one)` : '';
          return (anySig ? `One considered idea found${split}.${note}` : `Nothing here a template could not have produced${split}.${note}`) + independenceNote;
        })(),
        lowConfidence: shaky,
      },
    ],
  };
}

/** The two checks, left UNMEASURED. They leave the denominator; they are never scored zero. */
export function naChecks(why) {
  return [
    { id: 'originality_vs_template', raw: 0, detail: why, applicable: false },
    { id: 'signature_move_present', raw: 0, detail: why, applicable: false },
  ];
}
