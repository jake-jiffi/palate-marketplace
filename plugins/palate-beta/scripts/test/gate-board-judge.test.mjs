/**
 * scripts/test/gate-board-judge.test.mjs - the board judge, end to end as a command.
 *
 * The gate exists because the one instrument that separates "impressive" from "fine" is the
 * pairwise comparison against a library reference, and until now it bound only on a
 * high-intensity build and never on a board. These cases hold the two things that make it worth
 * having: a board can only be judged against evidence that is actually on disk, and a board
 * judged clearly worse than the reference it was drawn from is REFUSED rather than noted.
 *
 * Run: node --test scripts/test/gate-board-judge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';


const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'gate-board-judge.mjs');
/**
 * The gate crops the page endings with the vendored sharp, so most of these cases need it on
 * disk. A checkout that has not run `scripts/reference-capture/setup.sh` SKIPS them with the
 * reason, the way boards-render.test.mjs skips without playwright: a suite that fails for a
 * missing optional dependency teaches people to ignore it.
 */
let sharpReason = '';
try { createRequire(join(HERE, '..', 'reference-capture', 'x.js'))('sharp'); }
catch { sharpReason = 'sharp is not installed (scripts/reference-capture/setup.sh); the page endings cannot be cropped.'; }

/** A one-pixel PNG and a one-pixel JPEG. Nothing reads the pixels; existence is the point. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** A different picture, for a redraw: different PIXELS, since a crop of the same image is the same crop. */
const PNG2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IWdzQs6GAUIBACH2BIk4ffMZAAAAAElFTkSuQmCC',
  'base64',
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const VARIANTS = `
export interface Variant { id: string; name: string; artboard: string; ambition: number; what: string; why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[]; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    what: "One column and a great deal of air.", why: "People arriving are anxious.",
    feeling: "unhurried, private", donor: "aesop", section: "services",
    motion: "Nothing on load.", ctas: ["Book a visit", "Ask a question"] },
  { id: "b2", name: "The Folder", artboard: "B2.dc.html", ambition: 2,
    what: "The record becomes the interface.", why: "Their pitch is the evidence.",
    feeling: "purposeful, technical", donor: "linear", section: "proof",
    motion: "Layers lift under the pointer.", ctas: ["See the record", "Talk to us"] },
];
`;

/**
 * A project with two registered directions, each carrying every still the three surfaces are
 * judged on: the entrance, the whole board (the foot is cropped from it), the inner page, the
 * donor's hero and the donor's full capture (the donor's foot is cropped from that).
 */
function project({ donors = ['b1', 'b2'], donorFull = ['b1', 'b2'], stills = ['b1', 'b2'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'board-judge-'));
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib', 'variants.ts'), VARIANTS);
  writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify({ schema: 3, explore: { ran: true } }, null, 2));
  for (const id of ['b1', 'b2']) {
    const shots = join(dir, '.palate', 'explore', 'shots', id);
    mkdirSync(shots, { recursive: true });
    writeFileSync(join(shots, 'hero.png'), PNG);
    if (stills.includes(id)) {
      writeFileSync(join(shots, 'full.png'), PNG);
      writeFileSync(join(shots, 'inner.png'), PNG);
    }
    if (donors.includes(id)) writeFileSync(join(shots, 'donor.jpg'), JPEG);
    if (donorFull.includes(id)) writeFileSync(join(shots, 'donor-full.png'), PNG);
  }
  return dir;
}

const shot = (dir, id, name) => join(dir, '.palate', 'explore', 'shots', id, name);

const run = (dir, args = [], env = {}, nodeArgs = []) => {
  const r = spawnSync(process.execPath, [...nodeArgs, GATE, dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

/**
 * A preload that makes `require('sharp')` throw, so the no-sharp path can be exercised without
 * uninstalling anything. Nothing test-only lives in the gate itself for this.
 */
function noSharpShim(dir) {
  const p = join(dir, 'no-sharp.cjs');
  writeFileSync(p, `const M = require('module');\nconst load = M._load;\nM._load = function (r, ...rest) {\n  if (r === 'sharp') throw new Error('Cannot find module \\'sharp\\'');\n  return load.call(this, r, ...rest);\n};\n`);
  return ['--require', p];
}
const skipped = (r) => r.code === 2 && r.err.split('\n')[0].startsWith('gate-board-judge: skipped (');
const request = (dir) => JSON.parse(readFileSync(join(dir, '.palate', 'explore', 'judge-request.json'), 'utf8'));
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'build-manifest.json'), 'utf8'));

/** Every comparison answered the same way, which is what a healthy board set looks like. */
const answers = (req, verdicts = {}) =>
  req.pairs.flatMap((p) =>
    p.comparisons.map((c) => ({
      id: c.id,
      verdict: verdicts[p.id] ?? verdicts[p.board] ?? 'comparable',
      candidate_is: c.candidate_is,
    })),
  );

function judge(dir, judgements) {
  const file = join(dir, 'judgements.json');
  writeFileSync(file, JSON.stringify(judgements, null, 2));
  return run(dir, ['--judgements', file]);
}

test('phase 1 states three surfaces per direction, both orders each, and says where it wrote them', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  const req = request(dir);
  assert.equal(req.pairs.length, 6, 'two directions, three surfaces each');
  assert.deepEqual(req.pairs.map((p) => p.id), [
    'b1:entrance', 'b1:foot', 'b1:inner', 'b2:entrance', 'b2:foot', 'b2:inner',
  ]);
  assert.deepEqual([...new Set(req.pairs.map((p) => p.surface))], ['entrance', 'foot', 'inner']);
  assert.equal(req.pairs.flatMap((p) => p.comparisons).length, 12, 'six pairs, both orders each');
  // Each surface asks its OWN question. One question over three pictures would have a judge
  // marking an inner page down for not being a home page.
  assert.equal(new Set(req.pairs.map((p) => p.question)).size, 3, 'the three surfaces share one question');
  assert.ok(req.runToken && /^[0-9a-f]{8}$/.test(req.runToken), `a per-run token, got ${req.runToken}`);
  assert.ok(req.rungs.includes('clearly_worse'));
  // NO TOP-LEVEL QUESTION. The doctrine tells the dispatching agent to pass "the question"
  // verbatim, so one question beside three pairs is an instruction to ask the ENTRANCE question
  // over a foot crop, and the answer would validate.
  assert.equal(req.question, undefined, 'a single question sits beside pairs that each ask their own');
  for (const p of req.pairs) assert.ok(p.question && p.question.length > 40, `${p.id} carries no question`);
  assert.match(r.out, /judge-request\.json/);
  // The paths handed to the judge must be the real files, not names it has to guess at.
  for (const p of req.pairs) for (const c of p.comparisons) for (const k of ['A', 'B'])
    assert.ok(c[k].startsWith(dir), `${c[k]} must be absolute`);
  // THE FOOT CROPS ARE ON DISK. The pair names them, and a path in a request that nothing wrote
  // is a comparison a subagent cannot make.
  for (const id of ['b1', 'b2']) {
    assert.ok(existsSync(shot(dir, id, 'foot.png')), `${id}'s page ending was never cropped from full.png`);
    assert.ok(existsSync(shot(dir, id, 'donor-foot.png')), `${id}'s donor page ending was never cropped`);
  }
  const foot = req.pairs.find((p) => p.id === 'b1:foot');
  assert.equal(foot.comparisons[0].A, shot(dir, 'b1', 'foot.png'));
  assert.equal(foot.comparisons[0].B, shot(dir, 'b1', 'donor-foot.png'));
  const inner = req.pairs.find((p) => p.id === 'b1:inner');
  assert.equal(inner.comparisons[0].A, shot(dir, 'b1', 'inner.png'));
  assert.equal(inner.comparisons[0].B, shot(dir, 'b1', 'donor.jpg'), 'the inner page is judged against the donor hero');
});

test('every board comparable to its donor passes, and the verdicts are recorded', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req));
  assert.equal(r.code, 0, r.err);
  const recorded = manifest(dir).explore.board_judgements;
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded.map((j) => [j.id, j.donor, j.rung, j.consistent]), [
    ['b1', 'aesop', 'comparable', true],
    ['b2', 'linear', 'comparable', true],
  ]);
  // ONE ENTRY PER DIRECTION, carrying the three surfaces it was read on. gate-explore reads
  // `rung` and nothing else, so the per-surface record has to sit beside it, not replace it.
  for (const j of recorded) {
    assert.deepEqual(j.rungs, { entrance: 'comparable', foot: 'comparable', inner: 'comparable' });
    for (const k of ['board_hero', 'board_foot', 'board_inner'])
      assert.ok(j[k], `${j.id} recorded no ${k}, so a redraw of that surface cannot invalidate the verdict`);
  }
  for (const j of recorded) {
    assert.equal(j.run_token, req.runToken, 'a judgement is bound to the run it was written for');
    assert.ok(j.judged_at, 'a judgement says when it was made');
  }
});

test('a board judged clearly worse than its donor is REFUSED, and still recorded', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req, { b2: 'clearly_worse' }));
  assert.equal(r.code, 2, 'a board worse than the reference it was drawn from cannot pass');
  assert.ok(!skipped(r), 'a refusal is not a skip');
  assert.match(r.err, /b2 \(linear\) judged clearly worse than its donor at the entrance: clearly_worse \/ clearly_worse/);
  assert.match(r.err, /Redraw it from the donor's hero before the canvas is published/);
  // RECORDED ANYWAY. A refusal that leaves no trace is re-run and re-argued rather than fixed,
  // and gate-explore has nothing to read when it asks whether every board was judged.
  const recorded = manifest(dir).explore.board_judgements;
  assert.equal(recorded.length, 2, 'both boards are recorded even though one failed');
  assert.equal(recorded.find((j) => j.id === 'b2').rung, 'clearly_worse');
});

test('the lower rung decides, so one flattering ordering cannot rescue a board', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const js = answers(req);
  // b2: clearly worse one way round, comparable the other. An unstable verdict is not evidence.
  for (const j of js) if (j.id.startsWith('b2:entrance:board-first')) j.verdict = 'clearly_worse';
  const r = judge(dir, js);
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /b2 \(linear\) judged clearly worse/);
  assert.equal(manifest(dir).explore.board_judgements.find((j) => j.id === 'b2').consistent, false);
});

test('a partial judgements file cannot pass: every comparison must come back', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req).slice(0, 3));
  assert.equal(r.code, 2);
  assert.ok(!skipped(r), 'an incomplete judgement set is a failure, not a skip');
  assert.match(r.err, /3 judgement\(s\) returned for 6 comparison pair\(s\), which needs 12/, 'it says how many judgements it wanted');
});

test('no donor hero on disk is a SKIP naming what to run first, never a pass', (t) => {
  const dir = project({ donors: ['b1'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.ok(skipped(r), `expected a skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /b2/);
  assert.match(r.err, /boards-render/);
});

test('no Explore registry at all is a skip: the judge has nothing to say', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'board-judge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.ok(skipped(run(dir)));
});

test('PALATE_GATE_JUDGE=0 releases it, and says that is why', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, [], { PALATE_GATE_JUDGE: '0' });
  assert.ok(skipped(r));
  assert.match(r.err, /PALATE_GATE_JUDGE=0/);
});

test('a board registered after the request was written is a STALE request, not a silent pass', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const js = answers(req);
  // The third board arrives after the comparisons were stated, which is what an ordinary Explore
  // round looks like. Scoring the request alone would report "2 board(s) judged" over three.
  writeFileSync(
    join(dir, 'src', 'lib', 'variants.ts'),
    VARIANTS.replace('\n];', `,
  { id: "b3", name: "The Third", artboard: "B3.dc.html", ambition: 3, what: "w", why: "y", feeling: "f", donor: "aesop", section: "s", motion: "m", ctas: ["a", "b"] },
];`),
  );
  const shots = join(dir, '.palate', 'explore', 'shots', 'b3');
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, 'hero.png'), PNG);
  writeFileSync(join(shots, 'donor.jpg'), JPEG);
  const r = judge(dir, js);
  assert.ok(skipped(r), `expected a stale-request skip, got ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /the request is stale: registered boards b1, b2, b3 do not match the judged set b1, b2; re-run phase 1/);
});

test('a board REDRAWN after the request cannot be blessed by the old judgements', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const js = answers(req);
  // Exactly what a refusal asks for: b2 is redrawn. The standing request would otherwise apply
  // verdicts nobody gave to a drawing nobody judged.
  writeFileSync(join(dir, '.palate', 'explore', 'shots', 'b2', 'hero.png'), Buffer.concat([PNG, Buffer.from('redrawn')]));
  const r = judge(dir, js);
  assert.ok(skipped(r), `expected a redraw skip, got ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /hero\.png for b2 changed since the request was written; re-run phase 1/);
});

/**
 * Phase 1 ran on every verifier round and restated every comparison, so a three-board Explore
 * with nothing redrawn paid for six fresh subagents again to be told what the manifest already
 * held, and the standing judgements went out with the request they were bound to.
 */
test('phase 1 does not restate comparisons for boards already judged on this drawing', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  assert.equal(judge(dir, answers(request(dir))).code, 0);
  const first = request(dir);

  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /already judged: b1 comparable, b2 comparable/);
  assert.deepEqual(request(dir), first, 'the standing request was rewritten over an unchanged board set');
  // And the record says WHICH drawing each verdict is about, which is the only thing that makes
  // the skip safe.
  for (const j of manifest(dir).explore.board_judgements) assert.ok(j.board_hero, `${j.id} recorded no board_hero`);
});

test('a board redrawn since it was judged is stated again', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  assert.equal(judge(dir, answers(request(dir))).code, 0);
  const before = request(dir).runToken;
  writeFileSync(join(dir, '.palate', 'explore', 'shots', 'b2', 'hero.png'), Buffer.concat([PNG, Buffer.from('redrawn')]));
  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /judge-request\.json/, 'a redrawn board was passed over as already judged');
  assert.notEqual(request(dir).runToken, before, 'the request was not restated for the redrawn board');
});

test('a board standing at clearly_worse is not quietly "already judged"', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  assert.equal(judge(dir, answers(request(dir), { b2: 'clearly_worse' })).code, 2);
  const again = run(dir);
  assert.equal(again.code, 2, 'a standing refusal reported itself as a clean phase 1');
  assert.match(again.err, /b2/);
  assert.match(again.err, /clearly worse/);
});

test('--judgements with no file named is refused, not read as phase 1', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--judgements']);
  assert.equal(r.code, 2);
  assert.ok(!skipped(r), 'a slip in the command line was reported as a skip about the build');
  assert.match(r.err, /--judgements was given with no value/);
});

test('judgements that could not be recorded are not a pass', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  // A manifest the merge cannot write is the one state where "Board judge passed" used to be
  // printed over a record gate-explore would then read as "never judged".
  writeFileSync(join(dir, 'build-manifest.json'), '{ not json at all');
  const r = judge(dir, answers(req));
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /scored but not recorded/);
  assert.match(r.err, /build-manifest\.json/);
});

// --------------------------------------------------------- the three surfaces ----
//
// One entrance still carried a verdict about the top of a page as though it were about the
// page. These cases hold the widening: the lowest reading across the three surfaces decides,
// a direction whose donor has no full capture is read on two surfaces rather than refused, and
// a surface redrawn after the request cannot be blessed by the old verdicts.

test('the LOWEST of the three surfaces decides the direction, and every reading is recorded', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  // A fine entrance, a fine inner page, and a page ending that is not up to it. The direction
  // is read at the ending, because that is the half of the page the client asks about.
  const r = judge(dir, answers(req, { 'b1:foot': 'somewhat_worse' }));
  assert.equal(r.code, 0, r.err);
  const b1 = manifest(dir).explore.board_judgements.find((j) => j.id === 'b1');
  assert.deepEqual(b1.rungs, { entrance: 'comparable', foot: 'somewhat_worse', inner: 'comparable' });
  assert.equal(b1.rung, 'somewhat_worse', 'a weak page ending was averaged away by two good surfaces');
  assert.equal(b1.consistent, true);
});

test('a page ending judged clearly worse refuses the direction, naming the surface', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const r = judge(dir, answers(request(dir), { 'b2:foot': 'clearly_worse' }));
  assert.equal(r.code, 2, 'a direction whose page ending is clearly worse than its donor passed');
  assert.match(r.err, /b2 \(linear\) judged clearly worse than its donor at the page ending/);
  assert.equal(manifest(dir).explore.board_judgements.find((j) => j.id === 'b2').rungs.foot, 'clearly_worse');
});

test('an inner page judged clearly worse refuses the direction, naming the surface', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const r = judge(dir, answers(request(dir), { 'b1:inner': 'clearly_worse' }));
  assert.equal(r.code, 2);
  assert.match(r.err, /b1 \(aesop\) judged clearly worse than its donor at the inner page/);
});

/**
 * A reference with no `full.png` in the library is not the operator's fault and not a reason to
 * stop an Explore. The direction is read on the two surfaces there IS evidence for, and the
 * record says so, so nobody later reads a null as "the ending was fine".
 */
test('a donor with no full capture is judged on two surfaces, said out loud, never refused', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project({ donorFull: ['b1'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  const req = request(dir);
  assert.deepEqual(req.pairs.map((p) => p.id), ['b1:entrance', 'b1:foot', 'b1:inner', 'b2:entrance', 'b2:inner']);
  assert.match(r.err, /b2/, 'nothing said the page ending went unjudged for b2');
  assert.match(r.err, /donor-full\.png/);
  const j = judge(dir, answers(req));
  assert.equal(j.code, 0, j.err);
  // THE PASS LINE IS THE SENTENCE AN OPERATOR READS AND REPORTS, and phase 1's warning is a
  // different invocation and usually a different transcript. A static "on the entrance, the page
  // ending and the inner page" over a run that judged four comparisons is a false claim in the
  // one place it will be quoted.
  assert.match(j.out, /b1 comparable \(entrance, page ending, inner page\)/);
  assert.match(j.out, /b2 comparable \(entrance, inner page; no page ending/);
  const b2 = manifest(dir).explore.board_judgements.find((j2) => j2.id === 'b2');
  assert.equal(b2.rungs.foot, null, 'an unjudged page ending was recorded as though it had been judged');
  assert.equal(b2.board_foot, null);
  assert.equal(b2.rung, 'comparable');
});

test('no inner page or full board on disk is a SKIP naming what to run first, never a pass', (t) => {
  const dir = project({ stills: ['b1'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.ok(skipped(r), `expected a skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /b2\/full\.png/);
  assert.match(r.err, /b2\/inner\.png/);
  assert.match(r.err, /boards-render/);
});

test('an inner page REDRAWN after the request cannot be blessed by the old judgements', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const js = answers(request(dir));
  // The entrance is untouched, so a check keyed on hero.png alone would hand the old verdicts to
  // a drawing nobody judged.
  writeFileSync(shot(dir, 'b2', 'inner.png'), Buffer.concat([PNG, Buffer.from('redrawn')]));
  const r = judge(dir, js);
  assert.ok(skipped(r), `expected a redraw skip, got ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /inner\.png for b2 changed since the request was written; re-run phase 1/);
});

test('a direction redrawn on any surface is stated again rather than passed over as judged', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  assert.equal(judge(dir, answers(request(dir))).code, 0);
  const before = request(dir).runToken;
  // A REAL redraw: different pixels. The fingerprint is of the CROP the judge was shown, so
  // appending bytes to the source would leave the crop, and therefore the verdict, untouched.
  writeFileSync(shot(dir, 'b1', 'full.png'), PNG2);
  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  assert.notEqual(request(dir).runToken, before, 'a redrawn page ending was passed over as already judged');
});

/**
 * A MACHINE WITH NO SHARP CANNOT CROP A PAGE ENDING AT ALL, which is a different thing from a
 * library with no capture: it is a local fault with a named fix, so the gate SKIPS rather than
 * quietly reverting the instrument to the entrance-and-inner it was before this surface existed.
 */
test('sharp missing altogether is a SKIP naming the setup script, never a two-surface pass', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, [], {}, noSharpShim(dir));
  assert.ok(skipped(r), `expected a skip, got ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /sharp not installed/);
  assert.match(r.err, /setup\.sh/);
});

/**
 * A record with no rung reached the already-judged shortcut and printed "already judged: b1
 * undefined" over a build nothing had scored. A verdict that cannot be read is not a verdict.
 */
test('a judgement record with no rung is judged again, not read as a pass', (t) => {
  if (sharpReason) return t.skip(sharpReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  assert.equal(judge(dir, answers(request(dir))).code, 0);
  const m = manifest(dir);
  for (const j of m.explore.board_judgements) delete j.rung;
  writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify(m, null, 2));
  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  assert.doesNotMatch(again.out, /undefined/, 'a rungless record was printed as a verdict');
  assert.match(again.out, /judge-request\.json/, 'a rungless record was passed over as already judged');
});
