/**
 * scripts/test/gate-page-judge.test.mjs - the judge on the BUILT pages, end to end as a command.
 *
 * The board judge asks whether a drawing is as good as the reference it was drawn from, and it
 * answers before the canvas is published. Nothing then asked the same question about the thing
 * the client actually receives. On the eastcoast v3 build the home page was lifted from the
 * picked board with six "safe" edits that between them inverted the pick, and eighteen inner
 * pages were kit assembly nobody held against anything: every mechanical gate passed, because
 * every mechanical gate measures whether a page rendered.
 *
 * So the same pairwise instrument runs on the built pages: the home against the board it was
 * composed from, every other page type against the library reference that page type was drawn
 * from, on the entrance AND on the ending, both orders each, and the bar is the board judge's.
 *
 * Run: node --test scripts/test/gate-page-judge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { routeSlug as pickSlug } from '../lib/route-kind.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'gate-page-judge.mjs');

/**
 * Phase 1 drives a real browser and crops with sharp. A checkout that has not run
 * `scripts/reference-capture/setup.sh` SKIPS those cases with the reason, the way
 * boards-render.test.mjs does: a suite that fails for a missing optional dependency teaches
 * people to ignore it.
 */
let engineReason = '';
try {
  const req = createRequire(join(HERE, '..', 'reference-capture', 'x.js'));
  req('sharp');
  req.resolve('playwright');
} catch {
  engineReason = 'playwright or sharp is not installed (scripts/reference-capture/setup.sh); the built pages cannot be shot.';
}

/** A one-pixel PNG and a one-pixel JPEG. Nothing reads the pixels; existence is the point. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** A built page tall enough that its ending is somewhere other than its entrance. */
const page = (title) =>
  `<!doctype html><html lang="en-au"><head><meta charset="utf-8"><title>${title}</title>` +
  '<style>body{margin:0;font-family:Georgia,serif}section{height:900px}footer{height:400px;background:#111;color:#fff}</style>' +
  `</head><body><section><h1>${title}</h1></section><section><p>A band.</p></section>` +
  '<footer><p>Get in touch</p></footer></body></html>';

const LOOK = (route, type, verdict) => ({
  route,
  page_type: type,
  shot: '.palate-shots/desktop-full.png',
  shot_sha256: 'a'.repeat(64),
  looked_at: '2026-09-12T00:10:00Z',
  verdict,
});

/**
 * A project past the pick: one board picked with every still the judge compares against, three
 * built routes, and a recorded look on each of the three page types.
 */
function project({ picks = true, looks = null, built = ['/', '/security-windows', '/contact'], overrides = [], stills = true, without = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'page-judge-'));
  for (const route of built) {
    const sub = route === '/' ? 'dist/client' : join('dist/client', route.replace(/^\//, ''));
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, 'index.html'), page(route === '/' ? 'Eastcoast Aluminium' : route));
  }
  const shots = join(dir, '.palate', 'explore', 'shots', 'b3');
  mkdirSync(shots, { recursive: true });
  if (stills) {
    // `without` drops one still, which is how the library really behaves: `donor-foot.png` is
    // cropped only when the reference has a whole-page capture, and some have none.
    const put = (name, bytes) => { if (!without.includes(name)) writeFileSync(join(shots, name), bytes); };
    put('hero.png', PNG);
    put('foot.png', PNG);
    put('inner.png', PNG);
    put('donor.jpg', JPEG);
    put('donor-foot.png', PNG);
  }
  const pages = looks ?? [
    LOOK('/', 'home', 'The hero bleeds like the board, the wordmark sits on the photo, the band keeps one baseline'),
    LOOK('/security-windows', 'service', 'The photo is inset rather than bled, the spec table reads down the page'),
    LOOK('/contact', 'contact', 'The form sits beside the map, the hours run under it, one action in the band'),
  ];
  writeFileSync(
    join(dir, 'build-manifest.json'),
    JSON.stringify(
      {
        schema: 3,
        explore: picks
          ? { ran: true, picks: [{ surface: 'hero', variant_id: 'b3', rung: 3, picked_at: '2026-09-12T00:00:00Z' }] }
          : { ran: true, picks: [] },
        compose: { pages, overrides },
      },
      null,
      2,
    ),
  );
  return dir;
}

const run = (dir, args = [], env = {}, nodeArgs = []) => {
  const r = spawnSync(process.execPath, [...nodeArgs, GATE, dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

/** Makes `require('sharp')` throw, so the no-sharp path runs without uninstalling anything. */
function noSharpShim(dir) {
  const p = join(dir, 'no-sharp.cjs');
  writeFileSync(
    p,
    "const M = require('module');\nconst load = M._load;\nM._load = function (r, ...rest) {\n  if (r === 'sharp') throw new Error('Cannot find module \\'sharp\\'');\n  return load.call(this, r, ...rest);\n};\n",
  );
  return ['--require', p];
}

const skipped = (r) => r.code === 2 && r.err.split('\n')[0].startsWith('gate-page-judge: skipped (');
const request = (dir) => JSON.parse(readFileSync(join(dir, '.palate', 'compose', 'judge-request.json'), 'utf8'));
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'build-manifest.json'), 'utf8'));
const shot = (dir, slug, name) => join(dir, '.palate-shots', 'compose', slug, name);
const board = (dir, name) => join(dir, '.palate', 'explore', 'shots', 'b3', name);

/** Every comparison answered the same way, which is what a healthy build looks like. */
const answers = (req, verdicts = {}) =>
  req.pairs.flatMap((p) =>
    p.comparisons.map((c) => ({
      id: c.id,
      verdict: verdicts[p.id] ?? verdicts[p.route] ?? 'comparable',
      candidate_is: c.candidate_is,
    })),
  );

function judge(dir, judgements) {
  const file = join(dir, 'judgements.json');
  writeFileSync(file, JSON.stringify(judgements, null, 2));
  return run(dir, ['--judgements', file]);
}

test('phase 1 shoots the entrance and the ending of every looked route and states both orders', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  const req = request(dir);

  // THREE ROUTES, TWO SURFACES EACH. An entrance-only judge carries a verdict about the top of
  // a page as though it were about the page, which is exactly what the board judge stopped
  // doing in beta.18.
  assert.equal(req.pairs.length, 6, 'three routes, entrance and ending each');
  assert.deepEqual(req.pairs.map((p) => p.id.split('@')[0]), [
    'home:entrance', 'home:foot',
    'security-windows:entrance', 'security-windows:foot',
    'contact:entrance', 'contact:foot',
  ]);
  assert.equal(req.pairs.flatMap((p) => p.comparisons).length, 12, 'six pairs, both orders each');
  for (const p of req.pairs) {
    assert.equal(p.comparisons.length, 2, `${p.id} is not judged in both orders`);
    assert.deepEqual(p.comparisons.map((c) => c.candidate_is), ['A', 'B'], `${p.id} does not swap the candidate`);
    assert.ok(p.question && p.question.length > 40, `${p.id} carries no question`);
  }
  // The two surfaces ask DIFFERENT questions: an ending judged on the entrance's question is a
  // reading of a question nobody asked.
  assert.equal(new Set(req.pairs.map((p) => p.question)).size, 2);
  assert.ok(/^[0-9a-f]{8}$/.test(req.runToken), `a per-run token, got ${req.runToken}`);

  // THE HOME IS JUDGED AGAINST THE BOARD IT WAS COMPOSED FROM; every other page type against
  // the donor, because no board ever drew a service page.
  const by = (id) => req.pairs.find((p) => p.id.startsWith(`${id}@`) || p.id.startsWith(`${id}:`) || p.id.split('@')[0] === id);
  assert.equal(by('home:entrance').comparisons[0].B, board(dir, 'hero.png'));
  assert.equal(by('home:foot').comparisons[0].B, board(dir, 'foot.png'));
  assert.equal(by('security-windows:entrance').comparisons[0].B, board(dir, 'donor.jpg'));
  assert.equal(by('security-windows:foot').comparisons[0].B, board(dir, 'donor-foot.png'));
  assert.equal(by('contact:entrance').comparisons[0].B, board(dir, 'donor.jpg'));
  assert.equal(by('contact:foot').comparisons[0].B, board(dir, 'donor-foot.png'));

  // THE STILLS EXIST. A path in a request that nothing wrote is a comparison a subagent cannot
  // make, and the foot is a crop rather than a whole-page capture so the question can be about
  // the ending.
  for (const slug of ['home', 'security-windows', 'contact']) {
    assert.ok(existsSync(shot(dir, slug, 'entrance.png')), `${slug} has no entrance still`);
    assert.ok(existsSync(shot(dir, slug, 'foot.png')), `${slug} has no ending still`);
  }
  assert.equal(by('home:entrance').comparisons[0].A, shot(dir, 'home', 'entrance.png'));
  // Every pair is bound to the pixels AND to the HTML they came from.
  for (const p of req.pairs) {
    assert.ok(p.candidate_sha, `${p.id} records no candidate fingerprint`);
    assert.ok(p.html_sha, `${p.id} records no page fingerprint`);
  }
  assert.match(r.out, /judge-request\.json/);
});

test('a build with no pick has no direction to hold a page against, and skips saying so', (t) => {
  const dir = project({ picks: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.ok(skipped(r), `expected a named skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /skipped \(no pick recorded\)/);
});

test('a looked route with no built page is refused, naming the route', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project({
    looks: [
      LOOK('/', 'home', 'The hero bleeds like the board, the wordmark sits on the photo, the band keeps one baseline'),
      LOOK('/gallery', 'service', 'The grid runs three wide and the captions sit under the frames, never over them'),
    ],
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 1, `a look at a page that was never built cannot pass: ${r.err}`);
  assert.match(r.err, /\/gallery/);
  assert.ok(!existsSync(join(dir, '.palate', 'compose', 'judge-request.json')), 'a partial request was written anyway');
});

test('every built page comparable to its picture passes, and the readings are recorded', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const r = judge(dir, answers(req));
  assert.equal(r.code, 0, r.err);
  const recorded = manifest(dir).compose.page_judgements;
  assert.equal(recorded.length, 3, 'one record per judged route');
  for (const j of recorded) {
    assert.deepEqual(j.surfaces, ['entrance', 'foot']);
    assert.deepEqual(j.rungs, { entrance: 'comparable', foot: 'comparable' });
    assert.equal(j.rung, 'comparable', 'the route reads at its lowest surface');
    assert.ok(j.against.entrance && j.against.foot, 'a record says what it was judged against');
    assert.ok(j.fingerprints.entrance_sha && j.fingerprints.foot_sha && j.fingerprints.html_sha);
    assert.equal(j.run_token, req.runToken, 'a judgement is bound to the run it was written for');
    assert.ok(j.judged_at);
  }
  assert.deepEqual(recorded.map((j) => [j.route, j.page_type]), [
    ['/', 'home'], ['/security-windows', 'service'], ['/contact', 'contact'],
  ]);
});

test('one surface somewhat worse refuses the build, names the surface, and prints the override', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project({
    overrides: [{
      route: '/security-windows',
      section: 'hero',
      what: 'photo inset instead of bleed',
      reason: 'the only photo under 900px wide is soft at full bleed',
      recorded_at: '2026-09-12T00:20:00Z',
    }],
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const footId = req.pairs.find((p) => p.id.startsWith('security-windows:foot')).id;
  const r = judge(dir, answers(req, { [footId]: 'somewhat_worse' }));
  assert.equal(r.code, 1, `a page worse than its picture cannot pass: ${r.out}`);
  assert.match(r.err, /\/security-windows foot: somewhat worse than the donor's ending/);
  // THE OVERRIDE IS PRINTED BESIDE THE REFUSAL, because a deliberate departure is the first
  // thing the reader needs in order to tell drift from a decision.
  assert.match(r.err, /override on \/security-windows, hero: the only photo under 900px wide is soft at full bleed/);
  // A REFUSAL IS STILL RECORDED. A verdict that leaves no trace gets re-argued rather than fixed.
  const recorded = manifest(dir).compose.page_judgements;
  assert.equal(recorded.find((j) => j.route === '/security-windows').rung, 'somewhat_worse');
  assert.equal(recorded.find((j) => j.route === '/').rung, 'comparable');
});

test('a judgement that does not echo which image was the candidate is refused', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  const all = answers(req);
  all[0] = { ...all[0], candidate_is: all[0].candidate_is === 'A' ? 'B' : 'A' };
  const r = judge(dir, all);
  assert.equal(r.code, 1, `a judgement of the other ordering cannot be scored: ${r.out}`);
  assert.match(r.err, /candidate_is/);
});

test('a page rebuilt after the comparisons were stated is refused as stale', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const req = request(dir);
  // The build ran again between the request and the answers: the verdicts describe pixels that
  // are no longer on disk, and applying them would bless a page nobody judged.
  writeFileSync(join(dir, 'dist/client/index.html'), page('Eastcoast Aluminium, rebuilt'));
  const r = judge(dir, answers(req));
  assert.notEqual(r.code, 0, 'a rebuilt page cannot be blessed by a verdict about the old one');
  assert.match(r.err, /rebuilt|stale/);
  assert.match(r.err, /\//);
});

test('PALATE_GATE_JUDGE=0 releases the gate and says which release it took', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, [], { PALATE_GATE_JUDGE: '0' });
  assert.ok(skipped(r), `expected a named skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /PALATE_GATE_JUDGE=0/);
});

test('no sharp is a loud skip naming the command that installs it, never a one-surface pass', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, [], {}, noSharpShim(dir));
  assert.ok(skipped(r), `expected a named skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /sharp/);
  assert.match(r.err, /reference-capture\/setup\.sh/);
});

test('--check reads the record alone: a page type with no judgement blocks, a complete set passes', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Nothing judged yet.
  const before = run(dir, ['--check']);
  assert.equal(before.code, 1, `an unjudged build cannot pass the done-time check: ${before.out}`);
  assert.match(before.err, /\/security-windows|\/contact|\//);
  run(dir);
  judge(dir, answers(request(dir)));
  const after = run(dir, ['--check']);
  assert.equal(after.code, 0, after.err);
  // AND THE CHECK IS NOT A ONE-OFF: rebuild a page and the standing verdict stops describing it.
  writeFileSync(join(dir, 'dist/client/contact/index.html'), page('/contact, rebuilt'));
  const stale = run(dir, ['--check']);
  assert.equal(stale.code, 1, 'a rebuilt page keeps its old verdict without this');
  assert.match(stale.err, /\/contact/);
});

test('the route marked primary is judged at its entrance against the DRAWN INNER PAGE', (t) => {
  if (engineReason) return t.skip(engineReason);
  const primary = LOOK('/security-windows', 'service', 'The photo is inset rather than bled, the spec table reads down the page');
  primary.primary = true;
  const dir = project({
    looks: [
      LOOK('/', 'home', 'The hero bleeds like the board, the wordmark sits on the photo, the band keeps one baseline'),
      primary,
      LOOK('/contact', 'contact', 'The form sits beside the map, the hours run under it, one action in the band'),
    ],
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  const req = request(dir);
  const at = (id) => req.pairs.find((p) => p.id.split('@')[0] === id);
  // THE ONE COMPARISON THE DIRECTION ACTUALLY DREW for an inner page. Without the mark this
  // page answers to the donor's HOME page, which is not the picture the client was shown.
  assert.equal(at('security-windows:entrance').comparisons[0].B, board(dir, 'inner.png'));
  // Its ending still answers to the donor: no inner artboard carries a footer.
  assert.equal(at('security-windows:foot').comparisons[0].B, board(dir, 'donor-foot.png'));
  // Nothing else moves: the home keeps its board, the other inner page keeps the donor.
  assert.equal(at('home:entrance').comparisons[0].B, board(dir, 'hero.png'));
  assert.equal(at('contact:entrance').comparisons[0].B, board(dir, 'donor.jpg'));
  // And it asks its own question, which names both standards.
  assert.match(at('security-windows:entrance').question, /drawn for the direction they picked/);
  assert.notEqual(at('security-windows:entrance').question, at('contact:entrance').question);
  // The refusal has to say what it was held against, in those words.
  const r2 = judge(dir, answers(request(dir), { [at('security-windows:entrance').id]: 'somewhat_worse' }));
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.err, /\/security-windows entrance: somewhat worse than the drawn inner page/);
});

test('with a drawn inner page and no route marked, phase 1 says so and judges against the donor anyway', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  // A NOTE, NEVER A REFUSAL. Refusing would switch the judge off on every build made before the
  // flag existed, which is worse than the weaker comparison it is warning about.
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /--primary/);
  assert.equal(request(dir).pairs.find((p) => p.id.startsWith('security-windows:entrance')).comparisons[0].B, board(dir, 'donor.jpg'));
});

test('an unchanged route keeps its verdict while a rebuilt one re-states only its own pairs', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  const first = judge(dir, answers(request(dir)));
  assert.equal(first.code, 0, first.err);

  // ONE PAGE MOVES. Keyed on the whole build this bought twelve fresh comparisons for a typo
  // fixed on one inner page; keyed per route it buys four.
  writeFileSync(join(dir, 'dist/client/security-windows/index.html'), page('/security-windows, revised'));
  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  const req = request(dir);
  assert.deepEqual(req.pairs.map((p) => p.id.split('@')[0]), ['security-windows:entrance', 'security-windows:foot']);
  assert.match(again.out, /unchanged page\(s\) keep the verdict they already hold \(\/, \/contact\)/);
  // AND THE STANDING VERDICTS SURVIVE the record of the new ones.
  const r2 = judge(dir, answers(req));
  assert.equal(r2.code, 0, r2.err);
  assert.deepEqual(manifest(dir).compose.page_judgements.map((j) => j.route).sort(), ['/', '/contact', '/security-windows']);
});

test('a build with nothing rebuilt is not re-judged, and a standing refusal still refuses', (t) => {
  if (engineReason) return t.skip(engineReason);
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir);
  judge(dir, answers(request(dir)));
  // THE CLEAN BRANCH: every page carries a verdict for the HTML on disk, so nothing is restated.
  const again = run(dir);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /already judged/);

  // THE REFUSED BRANCH: re-stating the comparison would ask a fresh subagent the same question
  // about the same page until one of them said something kinder.
  const dir2 = project();
  t.after(() => rmSync(dir2, { recursive: true, force: true }));
  run(dir2);
  const req2 = request(dir2);
  judge(dir2, answers(req2, { [req2.pairs.find((p) => p.id.startsWith('security-windows:foot')).id]: 'somewhat_worse' }));
  const stands = run(dir2);
  assert.equal(stands.code, 1, `a standing refusal cannot read as "nothing to do": ${stands.out}`);
  assert.match(stands.err, /stands judged somewhat worse/);
});

test('--check tells unjudged from unjudgeable: no rendered stills SKIPS naming the board judge', (t) => {
  const dir = project({ stills: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--check']);
  assert.ok(skipped(r), `a direction with no stills cannot be judged from here: ${r.code} ${r.err}`);
  assert.match(r.err, /gate-board-judge\.mjs/);
  // And an unjudged build whose stills ARE on disk is a finding, not a skip: the comparison is
  // available and nobody made it.
  const dir2 = project();
  t.after(() => rmSync(dir2, { recursive: true, force: true }));
  const r2 = run(dir2, ['--check']);
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.err, /gate-page-judge\.mjs/);
});

test('a boolean flag before the project directory does not swallow it', (t) => {
  const dir = project({ picks: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // `--check <dir>` used to judge the current working directory, which is a gate reporting on
  // files nobody named.
  const r = spawnSync(process.execPath, [GATE, '--check', dir], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /skipped \(no pick recorded\)/);
});

test('a donor with no whole-page capture drops the ending for that route, never the whole run', (t) => {
  if (engineReason) return t.skip(engineReason);
  // THE FAULT: this used to skip the entire gate, entrance comparisons included, on a condition
  // `gate-board-judge.mjs` documents as ordinary (the library holds no `full.png` for some
  // references, so no `donor-foot.png` is ever cropped). The new instrument switched itself off
  // and read as `page-judge=skipped` in the roll-call, which is the shape it exists to end.
  const dir = project({ without: ['donor-foot.png'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, `the entrance comparisons are unaffected by a missing ending: ${r.err}`);
  const req = request(dir);
  // The home keeps BOTH surfaces: it answers to the board, which has its own `foot.png`.
  assert.deepEqual(req.pairs.map((p) => p.id.split('@')[0]), [
    'home:entrance', 'home:foot', 'security-windows:entrance', 'contact:entrance',
  ]);
  // AND IT IS SAID OUT LOUD, naming the route and the file, because a dropped surface and a
  // surface that passed look identical in a record that does not distinguish them.
  assert.match(r.err, /\/security-windows: b3 has no donor-foot\.png on disk/);
  assert.match(r.err, /\/contact: b3 has no donor-foot\.png on disk/);
  assert.match(r.err, /ending is judged on nothing/);

  // AND THE RECORD SAYS null RATHER THAN LEAVING THE KEY OUT, so a reader can tell a page
  // judged on its entrance alone from one judged on both.
  const j = judge(dir, answers(req));
  assert.equal(j.code, 0, j.err);
  const recorded = manifest(dir).compose.page_judgements;
  const service = recorded.find((x) => x.route === '/security-windows');
  assert.deepEqual(service.surfaces, ['entrance']);
  assert.deepEqual(service.rungs, { entrance: 'comparable', foot: null });
  assert.equal(service.rung, 'comparable');
  assert.equal(recorded.find((x) => x.route === '/').surfaces.length, 2);

  // AND --check READS IT AS JUDGED. A route judged on the one surface it had a picture for is
  // judged; refusing it would block every build whose donor has no whole-page capture.
  const check = run(dir, ['--check']);
  assert.equal(check.code, 0, check.err);
});

test('a route with no picture at all is what stops the run, and the skip names the route', (t) => {
  // Nothing to hold this page against on either surface, so there is genuinely no comparison to
  // make: a skip, naming the board judge, exactly as before the per-surface degrade.
  const dir = project({ without: ['donor.jpg', 'donor-foot.png'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--check']);
  assert.ok(skipped(r), `expected a named skip, got ${r.code}: ${r.err}`);
  assert.match(r.err, /\/security-windows/);
  assert.match(r.err, /gate-board-judge\.mjs/);
});

test('a nested route keeps a still directory of its own, so it cannot collide', (t) => {
  if (engineReason) return t.skip(engineReason);
  // `/a/b` and `/a-b` both used to slug as `a-b`, and the slug names
  // `.palate-shots/compose/<slug>/`, so the two pages would have shared one directory and the
  // second's shots would have overwritten the first's between the write and the fingerprint.
  assert.equal(pickSlug('/a/b'), 'a--b');
  assert.notEqual(pickSlug('/a/b'), pickSlug('/a-b'));
  const dir = project({
    built: ['/', '/a/b'],
    looks: [
      LOOK('/', 'home', 'The hero bleeds like the board, the wordmark sits on the photo, the band keeps one baseline'),
      LOOK('/a/b', 'service', 'The photo is inset rather than bled, the spec table reads down the page'),
    ],
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(shot(dir, 'a--b', 'entrance.png')), 'a nested route keeps a directory of its own');
});
