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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'gate-board-judge.mjs');

/** A one-pixel PNG and a one-pixel JPEG. Nothing reads the pixels; existence is the point. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
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

/** A project with two registered boards, each with its hero and its donor hero on disk. */
function project({ donors = ['b1', 'b2'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'board-judge-'));
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib', 'variants.ts'), VARIANTS);
  writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify({ schema: 3, explore: { ran: true } }, null, 2));
  for (const id of ['b1', 'b2']) {
    const shots = join(dir, '.palate', 'explore', 'shots', id);
    mkdirSync(shots, { recursive: true });
    writeFileSync(join(shots, 'hero.png'), PNG);
    if (donors.includes(id)) writeFileSync(join(shots, 'donor.jpg'), JPEG);
  }
  return dir;
}

const run = (dir, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [GATE, dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const skipped = (r) => r.code === 2 && r.err.split('\n')[0].startsWith('gate-board-judge: skipped (');
const request = (dir) => JSON.parse(readFileSync(join(dir, '.palate', 'explore', 'judge-request.json'), 'utf8'));
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'build-manifest.json'), 'utf8'));

/** Every comparison answered the same way, which is what a healthy board set looks like. */
const answers = (req, verdicts = {}) =>
  req.pairs.flatMap((p) =>
    p.comparisons.map((c) => ({ id: c.id, verdict: verdicts[p.id] ?? 'comparable', candidate_is: c.candidate_is })),
  );

function judge(dir, judgements) {
  const file = join(dir, 'judgements.json');
  writeFileSync(file, JSON.stringify(judgements, null, 2));
  return run(dir, ['--judgements', file]);
}

test('phase 1 states one comparison per board per ordering, and says where it wrote them', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  const req = request(dir);
  assert.equal(req.pairs.length, 2);
  assert.equal(req.pairs.flatMap((p) => p.comparisons).length, 4, 'two boards, both orders each');
  assert.ok(req.runToken && /^[0-9a-f]{8}$/.test(req.runToken), `a per-run token, got ${req.runToken}`);
  assert.ok(req.question && req.rungs.includes('clearly_worse'));
  assert.match(r.out, /judge-request\.json/);
  // The paths handed to the judge must be the real files, not names it has to guess at.
  for (const c of req.pairs[0].comparisons) for (const k of ['A', 'B']) assert.ok(c[k].startsWith(dir), `${c[k]} must be absolute`);
});

test('every board comparable to its donor passes, and the verdicts are recorded', (t) => {
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
  for (const j of recorded) {
    assert.equal(j.run_token, req.runToken, 'a judgement is bound to the run it was written for');
    assert.ok(j.judged_at, 'a judgement says when it was made');
  }
});

test('a board judged clearly worse than its donor is REFUSED, and still recorded', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req, { b2: 'clearly_worse' }));
  assert.equal(r.code, 2, 'a board worse than the reference it was drawn from cannot pass');
  assert.ok(!skipped(r), 'a refusal is not a skip');
  assert.match(r.err, /b2 \(linear\) judged clearly worse than its donor: clearly_worse \/ clearly_worse/);
  assert.match(r.err, /Redraw it from the donor's hero before the canvas is published/);
  // RECORDED ANYWAY. A refusal that leaves no trace is re-run and re-argued rather than fixed,
  // and gate-explore has nothing to read when it asks whether every board was judged.
  const recorded = manifest(dir).explore.board_judgements;
  assert.equal(recorded.length, 2, 'both boards are recorded even though one failed');
  assert.equal(recorded.find((j) => j.id === 'b2').rung, 'clearly_worse');
});

test('the lower rung decides, so one flattering ordering cannot rescue a board', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const js = answers(req);
  // b2: clearly worse one way round, comparable the other. An unstable verdict is not evidence.
  for (const j of js) if (j.id.startsWith('b2:board-first')) j.verdict = 'clearly_worse';
  const r = judge(dir, js);
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /b2 \(linear\) judged clearly worse/);
  assert.equal(manifest(dir).explore.board_judgements.find((j) => j.id === 'b2').consistent, false);
});

test('a partial judgements file cannot pass: every comparison must come back', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req).slice(0, 3));
  assert.equal(r.code, 2);
  assert.ok(!skipped(r), 'an incomplete judgement set is a failure, not a skip');
  assert.match(r.err, /3 judgement\(s\) returned for 2 board\(s\), which needs 4/, 'it says how many judgements it wanted');
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
