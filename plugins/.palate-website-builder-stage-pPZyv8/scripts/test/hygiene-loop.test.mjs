/**
 * hygiene-loop.mjs - the self-heal arithmetic, which is pure and needs no browser.
 *
 * The assertions that matter are the ones about what this loop REFUSES to call progress.
 * Run-to-run spread on an unchanged page is 2.3 points (measured over five consecutive
 * grades: 76, 78, 80, 81, 76), so a +2 move must read as UNCHANGED. If it ever reads as
 * IMPROVING, the loop starts teaching an agent that its last random edit worked, and every
 * iteration after that is chasing noise. The boundary is tested from both sides.
 *
 * The live end-to-end (does it actually block, does the message actually say the right
 * thing) is scripts/test/hygiene-loop.test.sh, which drives a real browser over a real page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NOISE_BAND, HISTORY_MAX, HISTORY_FILE, basisOf, entryFor, compare, comparableTail, detectStall,
  frozenChecks, readHistory, writeHistory, blockMessage, trendLine, summaryLine,
} from '../reference-capture/hygiene-loop.mjs';

const ON = { vitals: true, axe: true, routes: ['/'] };

/** A projection shaped like rubric.mjs `score()` output, at a chosen overall. */
const proj = (overall, checks = { colour_accent_discipline: 0.25 }, findings = []) => ({
  overall,
  band: { band: 'D' }, // on the rubric result; the loop must never PRINT it (these are GRADE bands)
  measuredWeight: 52,
  dimensions: [{ id: 'design', checks: Object.entries(checks).map(([id, raw]) => ({ id, raw })) }],
  findings,
});
const entry = (overall, checks, ctx = ON) => entryFor(proj(overall, checks), ctx);

// ------------------------------------------------------------- the band ----
test('the noise band is what the instrument actually does, tested from both sides', () => {
  // Asserted RELATIVE to the constant, not against a literal. The band is a measurement of the
  // instrument (range 0 locally, 1 against a real site over the network) and will change again if
  // the instrument does; a test that hard-codes it fails for the wrong reason when someone
  // correctly re-measures. What must hold is the BEHAVIOUR at the edges.
  const b = NOISE_BAND;
  const a = entry(78);
  assert.equal(compare(entry(78 + b), a).verdict, 'unchanged', 'a move of exactly the band is inside it');
  assert.equal(compare(entry(78 + b + 1), a).verdict, 'improved', 'one past the band is the first move worth reporting');
  assert.equal(compare(entry(78 - b), a).verdict, 'unchanged', 'a drop of exactly the band is inside it');
  assert.equal(compare(entry(78 - b - 1), a).verdict, 'regressed', 'one past the band is the first regression worth reporting');
  assert.equal(compare(entry(78), a).verdict, 'unchanged', 'an identical score is not progress');
});

test('an unchanged verdict still carries the real delta, so nothing is hidden', () => {
  const c = compare(entry(78 + NOISE_BAND), entry(78));
  assert.equal(c.delta, NOISE_BAND);
  assert.match(trendLine(c, 2), /UNCHANGED/);
  assert.match(trendLine(c, 2), /noise, not progress/);
});

test('the first run says so rather than inventing a baseline', () => {
  const c = compare(entry(61), null);
  assert.equal(c.verdict, 'first');
  assert.equal(c.delta, null);
  assert.match(trendLine(c, 1), /FIRST MEASUREMENT/);
});

// ------------------------------------------------------------ the basis ----
test('a different measurement configuration is NOT compared, it is refused', () => {
  const withVitals = entry(80, undefined, { ...ON, vitals: true });
  const without = entry(61, undefined, { ...ON, vitals: false });
  assert.notEqual(withVitals.basis, without.basis);
  const c = compare(without, withVitals);
  assert.equal(c.verdict, 'incomparable', '--no-vitals drops 14 of the 100 weight: not the same quantity');
  assert.equal(c.delta, null, 'a delta across configurations would be a number that means nothing');
  assert.match(trendLine(c, 2), /NO COMPARISON/);
});

test('the basis is the configuration, NOT the outcome: fixing a fault must stay comparable', () => {
  // The bug this pins. Keying the basis on the scored check ids made a successful fix read
  // as NO COMPARISON, because an axe check only enters the projection when it FIRES: repair
  // the contrast violation and text_contrast disappears from the set.
  const before = entry(21, { colour_accent_discipline: 0.25, text_contrast: 0 });
  const after = entry(62, { colour_accent_discipline: 0.9 });
  assert.equal(before.basis, after.basis, 'the same flags and routes measured the same way');
  const c = compare(after, before);
  assert.equal(c.verdict, 'improved', 'the run where the agent did what it was told must report the gain');
  assert.match(c.denominatorNote, /no longer scored: text_contrast/,
    'but the denominator change is disclosed rather than pocketed as credit');
  assert.match(trendLine(c, 2), /part of this move is the denominator/);
});

test('a newly scored check is disclosed the same way', () => {
  const c = compare(entry(21, { colour_accent_discipline: 0.25, text_contrast: 0 }), entry(62, { colour_accent_discipline: 0.9 }));
  assert.match(c.denominatorNote, /newly scored: text_contrast/);
});

test('an identical check set carries no caveat', () => {
  assert.equal(compare(entry(70), entry(60)).denominatorNote, null);
});

test('comparableTail stops at the first configuration change', () => {
  const hist = [
    entry(50, undefined, { ...ON, vitals: false }),
    entry(60), entry(65), entry(66),
  ];
  const tail = comparableTail(hist, basisOf(ON));
  assert.equal(tail.length, 3, 'the run before the flags changed belongs to a different loop');
});

// ------------------------------------------------------------- the stall ----
test('a stall needs a full window before it will call one', () => {
  assert.equal(detectStall([entry(21)]).stalled, false);
  assert.equal(detectStall([entry(21), entry(21)]).stalled, false, 'one flat step is not a stall');
  assert.equal(detectStall([entry(21), entry(21), entry(21)]).stalled, true);
});

test('a stall is judged on the BEST since the anchor, not the last', () => {
  // 61 -> 75 -> 62 is an agent that found something real and then broke it again. Telling it
  // to stop iterating there would throw away the one lead it has.
  assert.equal(detectStall([entry(61), entry(75), entry(62)]).stalled, false);
  // Band-relative, for the same reason as the noise test above: what must hold is that a best
  // gain INSIDE the band is a stall and one PAST it is not, whatever the band currently is.
  const b = NOISE_BAND;
  assert.equal(
    detectStall([entry(61), entry(61), entry(61 + b)]).stalled, true,
    'a best gain of exactly the band is noise, not progress',
  );
  assert.equal(
    detectStall([entry(61), entry(61), entry(61 + b + 1)]).stalled, false,
    'one point past the band is a real lead and must not be called a stall',
  );
});

test('the stall window widens with PALATE_HYGIENE_STALL_ITERS', () => {
  const flat = [entry(21), entry(21), entry(21)];
  assert.equal(detectStall(flat, 3).stalled, false, 'three iterations is not yet four');
  assert.equal(detectStall([...flat, entry(21)], 3).stalled, true);
});

test('frozen checks are the ones under the floor that have not moved across the whole window', () => {
  const w = [
    entry(21, { colour_accent_discipline: 0.25, type_system_discipline: 0.2, cls: 0.9 }),
    entry(21, { colour_accent_discipline: 0.25, type_system_discipline: 0.5, cls: 0.9 }),
    entry(21, { colour_accent_discipline: 0.27, type_system_discipline: 0.7, cls: 0.9 }),
  ];
  const ids = frozenChecks(w).map((b) => b.id);
  assert.deepEqual(ids, ['colour_accent_discipline'],
    'a check that moved 0.2 -> 0.7 is being worked on; a passing check is not a blocker');
});

test('a check that was not measured throughout is not evidence of a stall', () => {
  const w = [entry(21, { a: 0.2 }), entry(21, { a: 0.2, b: 0.1 }), entry(21, { a: 0.2, b: 0.1 })];
  assert.deepEqual(frozenChecks(w).map((x) => x.id), ['a'], 'b has only two readings, not three');
});

test('frozen checks carry the rubric label and fix, not a bare id', () => {
  const w = Array(3).fill(0).map(() => entry(21, { colour_accent_discipline: 0.25 }));
  const b = frozenChecks(w)[0];
  assert.equal(b.label, 'Colour discipline');
  assert.match(b.fix, /accent/);
});

// -------------------------------------------------------------- the io ----
test('a missing history is a first run; a corrupt one is an error that must be spoken', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gl-'));
  try {
    const f = path.join(dir, HISTORY_FILE);
    const missing = readHistory(f);
    assert.equal(missing.error, null);
    assert.equal(missing.fresh, true);

    writeFileSync(f, 'not json{');
    assert.match(readHistory(f).error, /not valid JSON/, 'a lost trend must never read as a clean one');

    writeFileSync(f, JSON.stringify({ version: 1, other: [] }));
    assert.match(readHistory(f).error, /no `entries` array/);

    writeFileSync(f, JSON.stringify({ version: 1, entries: [entry(61)] }));
    assert.equal(readHistory(f).entries.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unwritable history reports the failure instead of throwing', () => {
  const r = writeHistory('/definitely/not/a/path/' + HISTORY_FILE, [], entry(61));
  assert.match(r.error, /could not be written/);
});

test('the history is bounded', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gl-'));
  try {
    const f = path.join(dir, 'h.json');
    let entries = [];
    for (let i = 0; i < HISTORY_MAX + 5; i++) entries = writeHistory(f, entries, entry(i)).entries;
    const on = JSON.parse(readFileSync(f, 'utf8')).entries;
    assert.equal(on.length, HISTORY_MAX);
    assert.equal(on[on.length - 1].overall, HISTORY_MAX + 4, 'the tail is kept, not the head');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --------------------------------------------------------- the message ----
const FINDINGS = [
  { id: 'colour_accent_discipline', label: 'Colour discipline', raw: 0.25, recoverable: 2.1, detail: 'the accent is Tailwind indigo-500', fix: 'Replace the inherited accent' },
  { id: 'type_system_discipline', label: 'Type system', raw: 0.2, recoverable: 2.0, detail: 'every face is a default', fix: 'Two faces and one scale' },
];
const RERUN = 'node verify-rendered.mjs --url http://localhost:4321 --routes / --out .palate-shots';

test('the block message carries all four things an agent needs to close the loop', () => {
  const p = proj(61, { colour_accent_discipline: 0.25, type_system_discipline: 0.2 }, FINDINGS);
  const cur = entryFor(p, ON);
  const prev = entry(52, { colour_accent_discipline: 0.25, type_system_discipline: 0.1 });
  const cmp = compare(cur, prev);
  const msg = blockMessage({ scored: p, cmp, stall: detectStall([prev, cur]), minScore: 80, rerun: RERUN });

  assert.match(msg, /build hygiene 61\/100/, '1. the score, named for what it is');
  assert.match(msg, /below the 80 floor/, '1. the floor');
  assert.match(msg, /Colour discipline \(worth 2\.1 pts of the hygiene score\)/, '2. the ranked gaps');
  assert.match(msg, /FIX: Replace the inherited accent/, '2. the fix for each');
  assert.match(msg, /RE-RUN THIS EXACT COMMAND/, '3. that it should re-run');
  assert.ok(msg.includes(RERUN), '3. the exact command');
  assert.match(msg, /IMPROVING: 52 -> 61, UP 9/, '4. whether the last iteration helped');
  assert.match(msg, /It is NOT the public grade/, '5. and that it is NOT a predicted grade');
  assert.match(msg, /measured to disagree with it substantially/, 'and that the disagreement is measured, not asserted');
  // The r-value deliberately does NOT travel in the agent-facing message. It was measured against
  // a grader that was dropping the five design checks this score is built from, so quoting it on
  // every failing build would assert more precision than we have. It lives in the module comment
  // with its caveat instead.
  assert.doesNotMatch(msg, /r = -0\.074/, 'a confounded statistic must not be quoted as settled');
  assert.match(
    msg,
    /palatemcp\.com\/grade/,
    'and where a SHAREABLE number actually comes from. It must not name palate_grade: the MCP tool is\n     internal-only now, so pointing a customer at it sends them to a refusal.',
  );
  assert.doesNotMatch(msg, /mcp__palate__palate_grade/, 'never routes a customer to a tool they cannot call');
  assert.doesNotMatch(msg, /projected grade/, 'the retired claim must survive nowhere in the message');
});

test('each gap reports its OWN movement, so a fix that helped is distinguishable from one that did not', () => {
  const p = proj(61, { colour_accent_discipline: 0.25, type_system_discipline: 0.2 }, FINDINGS);
  const prev = entry(52, { colour_accent_discipline: 0.25, type_system_discipline: 0.1 });
  const msg = blockMessage({
    scored: p, cmp: compare(entryFor(p, ON), prev),
    stall: detectStall([prev, entryFor(p, ON)]), minScore: 80, rerun: RERUN,
  });
  assert.match(msg, /Colour discipline \(worth 2\.1 pts of the hygiene score\) \[unchanged since last run\]/);
  assert.match(msg, /Type system \(worth 2\.0 pts of the hygiene score\) \[up from 0\.1 last run\]/);
});

test('a stalled loop tells the agent to STOP, and does not call mechanical checks a judgement', () => {
  const p = proj(21, { colour_accent_discipline: 0.25 }, FINDINGS.slice(0, 1));
  const window = Array(3).fill(0).map(() => entryFor(p, ON));
  const stall = detectStall(window);
  assert.equal(stall.stalled, true);
  const msg = blockMessage({ scored: p, cmp: compare(window[2], window[1]), stall, minScore: 80, rerun: RERUN });

  assert.match(msg, /STALLED: 3 iterations, 21 -> 21 -> 21/);
  assert.match(msg, /STOP ITERATING/);
  assert.match(msg, /Colour discipline .*stuck at 0\.25 across all 3 runs/);
  assert.match(msg, /MECHANICAL/, 'every check here is measured, not judged: a frozen one means the edit never landed');
  assert.match(msg, /the site was REBUILT/);
  assert.match(msg, /hand it to the human/, 'the loop is bounded, not infinite');
  assert.match(msg, /PALATE_MIN_HYGIENE=21/, 'and there is a recorded way out');
  assert.ok(msg.includes(RERUN), 'stop repeating the same pass, not stop measuring');
  assert.doesNotMatch(msg, /design judgement/);
});

test('a bookkeeping failure travels INTO the message, not just the console', () => {
  const p = proj(61, undefined, FINDINGS);
  const cur = entryFor(p, ON);
  const msg = blockMessage({
    scored: p, cmp: compare(cur, null), stall: detectStall([cur]), minScore: 80, rerun: RERUN,
    notes: ['NOTE: the grade history at x is not valid JSON, so this run is treated as a first measurement. The trend is LOST, not clean.'],
  });
  assert.match(msg, /The trend is LOST, not clean/);
});

test('with the gate off, nothing is reported as having passed anything', () => {
  const p = proj(41);
  const cur = entryFor(p, ON);
  const line = summaryLine({ scored: p, cmp: compare(cur, null), stall: detectStall([cur]), minScore: 0 });
  assert.match(line, /UNGATED/);
  assert.doesNotMatch(line, /CLEARS/, '"CLEARS the 0 floor" reads as an endorsement of a build nothing judged');
});

test('the rubric BAND never reaches a message or the history', () => {
  // The bands are GRADE bands ("B Strong", "G Broken"). Stamping one on a hygiene score puts
  // back the exact claim 23 re-grades retired, and it is the part a reader would quote.
  const p = proj(61, { colour_accent_discipline: 0.25 }, FINDINGS);
  const cur = entryFor(p, ON);
  assert.equal(cur.band, undefined, 'the history row must not carry a band');
  const stall = detectStall([cur]);
  const msg = blockMessage({ scored: p, cmp: compare(cur, null), stall, minScore: 80, rerun: RERUN });
  const line = summaryLine({ scored: p, cmp: compare(cur, null), stall, minScore: 80 });
  for (const [name, text] of [['block message', msg], ['summary line', line]]) {
    assert.doesNotMatch(text, /\(D\)|\bband\b/i, name + ' must not print a grade band');
    assert.doesNotMatch(text, /projected grade/i, name + ' must not use the retired name');
  }
  // "predicted grade" may appear ONLY inside the prohibition, never as a label for the number.
  assert.match(msg, /must never be reported as a predicted grade/);
  assert.equal((msg.match(/predicted grade/gi) ?? []).length, 1, 'the only mention is the prohibition');
});

test('clearing the floor is NOT reported as a quality verdict', () => {
  // The block path is not where this number is dangerous; an agent reading a block is still
  // working. The PASS is. `originality_vs_template` (30) and `signature_move_present` (15) are 45
  // of the design dimension and neither is computable here, so the score is structurally blind to
  // templating and the rubric's design ceiling never binds. Measured: this repo's own tidy-template
  // fixture scores 97. If that sentence ever leaves the pass message, an agent can read 80 as
  // "good" and stop exactly where the remaining work is design.
  const p = proj(97);
  const cur = entryFor(p, ON);
  const pass = summaryLine({ scored: p, cmp: compare(cur, null), stall: detectStall([cur]), minScore: 80 });
  assert.match(pass, /CLEARS the 80 floor/);
  assert.match(pass, /NOT A QUALITY VERDICT/);
  assert.match(pass, /cannot see whether the page is a template/);
  assert.match(pass, /A tidy template with no idea in it scores 97/);
  assert.match(pass, /the remaining work is DESIGN/);
  // The thinness half. Repairing a page REMOVES the accessibility dimension from the
  // denominator (axe checks only enter the roll-up when they fire), so the basis shrinks as the
  // score rises: 52 -> 40 across this repo's own two fixtures. The live weight is quoted so the
  // message cannot drift from what the run actually measured.
  assert.match(pass, /rests on LESS evidence, not more/);
  assert.match(pass, /this run rests on 52 of the rubric's 100 weight/);
  assert.match(pass, /resting on 52 of the rubric's 100 weight/, 'and the headline says it too');
  assert.doesNotMatch(pass, /weight measurable locally/, 'measuredWeight is this run, not the local ceiling');

  // And it must NOT appear on the block path, where it would be noise on top of a list of fixes.
  const fail = summaryLine({ scored: proj(61), cmp: compare(entry(61), null), stall: detectStall([entry(61)]), minScore: 80 });
  assert.match(fail, /is BELOW the 80 floor/);
  assert.doesNotMatch(fail, /NOT A QUALITY VERDICT/);
});

test('the summary line is printed on a PASS too, so a lucky pass is still visible as one', () => {
  const p = proj(84);
  const cur = entryFor(p, ON);
  const line = summaryLine({ scored: p, cmp: compare(cur, entry(83)), stall: detectStall([entry(83), cur]), minScore: 80 });
  assert.match(line, /build hygiene 84\/100 CLEARS the 80 floor/);
  assert.match(line, /UNCHANGED/, 'passing by one point on a flat trend is not the same as converging');
  assert.match(line, /HYGIENE ONLY: measured to disagree substantially with the public grade/);
});
