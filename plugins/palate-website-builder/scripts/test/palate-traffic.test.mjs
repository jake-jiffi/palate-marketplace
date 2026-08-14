/**
 * Attributing a traffic loss to a merge, and the four cases where it must
 * refuse to.
 *
 * Every fixture here is a REAL git repository with real commits at controlled
 * dates and a real Search Console export, because the two things most likely to
 * be wrong are the git plumbing (merge dates versus author dates, deletions,
 * name-status parsing) and the join between a URL and a route. A mocked commit
 * list would test neither.
 *
 * The three the brief asks for, plus the one that matters most in practice:
 *
 *   SINGLE CAUSE  one page falls, one merge touched only that page. It must
 *                 out-rank a layout merge that landed CLOSER to the onset,
 *                 because specificity beats timing: a merge touching all six
 *                 pages cannot explain why one of them fell.
 *   SITEWIDE      every page falls together. There is a tempting single-route
 *                 merge in the window and it must NOT be named. This is the
 *                 test that stops the tool costing someone a good revert.
 *   THIN DATA     a page on a click a day. No attribution at any confidence.
 *   DELETED PAGE  the loudest cause there is, and the one the index cannot see
 *                 because the route is gone from it.
 *
 * Run: node --test scripts/test/palate-traffic.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildIndex } from '../palate-index.mjs';
import {
  analyse, parseExport, mainline, toPath, routeMatches, routeOfPageFile,
  detectChangepoint, declineShape, orderComparisonColumns, zScore, DEFAULTS,
} from '../palate-traffic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const trash = [];
process.on('exit', () => { for (const d of trash) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ fixtures

function tmp(tag) {
  const d = mkdtempSync(join(tmpdir(), `palate-traffic-${tag}-`));
  trash.push(d);
  return d;
}

function sh(dir, args, date) {
  return execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=Tester',
    '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    env: date ? { ...process.env, GIT_AUTHOR_DATE: `${date}T10:00:00Z`, GIT_COMMITTER_DATE: `${date}T10:00:00Z` } : process.env,
  });
}

function write(dir, rel, body) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

const PAGES = ['index', 'pricing', 'about', 'contact'];

/** A minimal but real Astro-shaped site: every page reaches the shared layout. */
function scaffold(dir) {
  write(dir, 'src/lib/business.ts', 'export const business = { name: "Fixture Co" };\n');
  write(dir, 'src/layouts/BaseLayout.astro', '---\nimport { business } from "../lib/business";\n---\n<slot/>\n');
  for (const p of PAGES) {
    write(dir, `src/pages/${p}.astro`, `---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout><h1>${p}</h1></BaseLayout>\n`);
  }
  write(dir, 'src/pages/blog/index.astro', '---\nimport BaseLayout from "../../layouts/BaseLayout.astro";\n---\n<BaseLayout>blog</BaseLayout>\n');
  write(dir, 'src/pages/blog/[slug].astro', '---\nimport BaseLayout from "../../layouts/BaseLayout.astro";\n---\n<BaseLayout>post</BaseLayout>\n');
  write(dir, 'README.md', '# fixture\n');
}

function repo(tag, build) {
  const dir = tmp(tag);
  sh(dir, ['init', '-q', '-b', 'main']);
  scaffold(dir);
  sh(dir, ['add', '-A']);
  // Well outside the 30-day candidate window. The initial commit touches every
  // file in the repo, so dated near the onset it is a legitimate (weak)
  // candidate for everything, and that noise has nothing to do with what these
  // fixtures are testing.
  sh(dir, ['commit', '-qm', 'scaffold'], '2026-02-01');
  build(dir);
  return dir;
}

/** Commit a mutation at a fixed date and hand back its sha. */
function commitAt(dir, date, subject, mutate) {
  mutate(dir);
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', subject], date);
  return sh(dir, ['rev-parse', 'HEAD']).trim().slice(0, 8);
}

const day = (start, i) => new Date((Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10)) / 86400000 + i) * 86400000)
  .toISOString().slice(0, 10);

/**
 * A page-by-date export. `plan` is a function (dayIndex) -> {clicks,impressions}
 * or null to emit no row at all, which is what Search Console does on a day a
 * page had no impressions.
 */
function csv(start, days, plans) {
  const rows = ['page,date,clicks,impressions'];
  for (let i = 0; i < days; i++) {
    for (const [page, plan] of Object.entries(plans)) {
      const v = plan(i);
      if (!v) continue;
      rows.push(`https://fixture.test${page},${day(start, i)},${v.clicks},${v.impressions}`);
    }
  }
  return rows.join('\n') + '\n';
}

const flat = (clicks, impressions) => () => ({ clicks, impressions });
const stepAt = (i0, a, b) => (i) => (i < i0 ? a : b);

// The export is written with the last day well in the past so the default
// three-day freshness trim never eats the fixture's own signal.
const START = '2026-04-02';
const DAYS = 56;                 // 2026-04-02 .. 2026-05-27
const ONSET_INDEX = 28;          // 2026-04-30
const ONSET = day(START, ONSET_INDEX);

function run(dir, exportText, opt = {}) {
  const index = buildIndex(dir);
  assert.ok(index, 'fixture is not a site');
  const parsed = parseExport(exportText, 'fixture.csv');
  assert.ok(parsed.ok, parsed.error);
  const ml = mainline(dir, {});
  assert.ok(ml.ok, ml.error);
  return analyse({ index, parsed, commits: ml.commits, opt: { ...DEFAULTS, ...opt } });
}

const find = (a, page) => a.findings.find((f) => f.page === page);

// ------------------------------------------------------------------- units

test('a Search Console URL becomes a route path', () => {
  assert.equal(toPath('https://fixture.test/pricing'), '/pricing');
  assert.equal(toPath('https://fixture.test/pricing/'), '/pricing');
  assert.equal(toPath('https://fixture.test/'), '/');
  assert.equal(toPath('https://fixture.test/blog/a-post?utm=x#frag'), '/blog/a-post');
});

test('a dynamic route serves one segment, not a whole subtree', () => {
  assert.ok(routeMatches('/blog/[slug]', '/blog/hello'));
  assert.ok(!routeMatches('/blog/[slug]', '/blog/hello/deeper'));
  assert.ok(!routeMatches('/blog/[slug]', '/pricing'));
  assert.ok(routeMatches('/pricing', '/pricing'));
});

test('a deleted page file still resolves to the route it used to serve', () => {
  // The index cannot answer this: the file is gone from the worktree, so
  // blastRadius fails wide to every route and the most specific change there is
  // would score as the least specific.
  assert.equal(routeOfPageFile('src/pages/pricing.astro'), '/pricing');
  assert.equal(routeOfPageFile('src/pages/index.astro'), '/');
  assert.equal(routeOfPageFile('src/pages/blog/index.astro'), '/blog');
  assert.equal(routeOfPageFile('src/lib/business.ts'), null);
});

test('the rate test does not call a coin flip a decline', () => {
  // A click a day halving is a 50% "drop" and nothing at all. Both floors have
  // to hold it: the z screen because 14 clicks cannot distinguish itself from 7,
  // and the volume floor because at this size nothing ever will.
  assert.ok(zScore(14, 14, 7, 14) < DEFAULTS.minZ, `z=${zScore(14, 14, 7, 14)} cleared the floor on 14 clicks`);
  assert.ok(14 < DEFAULTS.minClicks);
  // The same 50% on real volume is unmistakable, and must not be suppressed.
  assert.ok(zScore(1400, 14, 700, 14) > DEFAULTS.minZ);
});

test('the shape of a decline separates a snippet change from a ranking change', () => {
  assert.equal(declineShape(0.6, 0.02, 10000, 9800), 'ctr');
  assert.equal(declineShape(0.6, 0.58, 10000, 4200), 'visibility');
  assert.equal(declineShape(1, 1, 10000, 0), 'deindexed');
  // An export with no impressions column has no impressions signal. Reading
  // that as "deindexed" is the most alarming claim available here, made on
  // nothing at all.
  assert.equal(declineShape(0.7, 0, 0, 0), 'unknown');
});

test('an export with no impressions column says so instead of crying deindexed', () => {
  const dir = repo('noimpr', (d) => {
    commitAt(d, '2026-04-26', 'pricing: rewrite', (x) => write(x, 'src/pages/pricing.astro', '<p>v2</p>\n'));
  });
  const rows = ['page,date,clicks'];
  for (let i = 0; i < DAYS; i++) {
    for (const [p, c] of [['/', 30], ['/about', 25], ['/contact', 22]]) rows.push(`https://fixture.test${p},${day(START, i)},${c}`);
    rows.push(`https://fixture.test/pricing,${day(START, i)},${stepAt(ONSET_INDEX, 30, 8)(i)}`);
  }
  const f = find(run(dir, rows.join('\n') + '\n'), '/pricing');
  assert.equal(f.shape, 'unknown', 'zero impressions everywhere is missing data, not a deindexing');
  assert.match(f.shapeNote, /no impressions/);
  assert.equal(f.verdict, 'attributable', 'the decline itself is still real and still attributable');
});

test('a comparison export whose columns cannot be ordered is refused, not guessed', () => {
  assert.deepEqual(orderComparisonColumns(['Previous 28 days Clicks', 'Last 28 days Clicks']),
    { before: 'Previous 28 days Clicks', after: 'Last 28 days Clicks' });
  assert.deepEqual(orderComparisonColumns(['Clicks 2026-02-01', 'Clicks 2026-03-01']),
    { before: 'Clicks 2026-02-01', after: 'Clicks 2026-03-01' });
  // Reversing these two silently reports every rise as a fall.
  assert.equal(orderComparisonColumns(['Clicks A', 'Clicks B']), null);
});

test('a one-period totals export is rejected with the reason, not half-analysed', () => {
  const r = parseExport('Top pages,Clicks,Impressions,CTR,Position\nhttps://x.test/,900,40000,2.2%,11\n');
  assert.equal(r.ok, false);
  assert.match(r.error, /never when it changed/);
});

test('the raw Search Analytics API shape is read without a header row', () => {
  const r = parseExport(JSON.stringify({ rows: [
    { keys: ['https://x.test/a', '2026-05-01'], clicks: 10, impressions: 100 },
    { keys: ['https://x.test/a', '2026-05-02'], clicks: 8, impressions: 90 },
  ] }));
  assert.equal(r.ok, true);
  assert.equal(r.shape, 'series');
  assert.equal(r.series.get('/a').size, 2);
});

test('the changepoint refuses a series too short to have two clean sides', () => {
  const days = Array.from({ length: 20 }, (_, i) => ({ date: day(START, i), clicks: 10, impressions: 100 }));
  const cp = detectChangepoint(days, { minDays: 14 });
  assert.equal(cp.ok, false);
  assert.equal(cp.reason, 'too-few-days');
});

// -------------------------------------------------------- 1. a single cause

test('a single-cause decline names the merge that touched only that page', () => {
  let pricingSha, layoutSha, aboutSha, readmeSha;
  const dir = repo('single', (d) => {
    aboutSha = commitAt(d, '2026-04-14', 'about: tidy copy',
      (x) => write(x, 'src/pages/about.astro', '---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout>about v2</BaseLayout>\n'));
    pricingSha = commitAt(d, '2026-04-26', 'pricing: new headline and title',
      (x) => write(x, 'src/pages/pricing.astro', '---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout>pricing v2</BaseLayout>\n'));
    // Lands CLOSER to the onset than the real cause, and touches every page.
    layoutSha = commitAt(d, '2026-04-28', 'layout: spacing pass',
      (x) => write(x, 'src/layouts/BaseLayout.astro', '---\nimport { business } from "../lib/business";\n---\n<div class="pad"><slot/></div>\n'));
    readmeSha = commitAt(d, '2026-04-29', 'docs: readme', (x) => write(x, 'README.md', '# fixture v2\n'));
  });

  // Impressions hold while clicks collapse: a snippet-shaped loss.
  const text = csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 30, 8)(i), impressions: 950 }),
  });
  const a = run(dir, text);

  assert.equal(a.sitewide.declining, false, 'one page of six falling is not a sitewide move');

  const f = find(a, '/pricing');
  assert.equal(f.verdict, 'attributable', JSON.stringify(f, null, 2));
  assert.equal(f.onset, ONSET, `onset detected at ${f.onset}, expected ${ONSET}`);
  assert.equal(f.shape, 'ctr', 'impressions held, so this is a snippet-shaped loss');
  assert.ok(f.drop > 0.6, `drop ${f.drop}`);

  assert.equal(f.suspects[0].short, pricingSha,
    `top suspect ${f.suspects[0].short} (${f.suspects[0].subject}), expected the pricing merge ${pricingSha}`);
  assert.equal(f.suspects[0].confidence, 'strong');

  // Specificity must beat timing. The layout merge is two days nearer the onset
  // and still loses, because it touched six trafficked pages and one fell.
  const layout = f.suspects.find((s) => s.short === layoutSha);
  assert.ok(layout, 'the layout merge should still be listed as a candidate');
  assert.ok(layout.score < f.suspects[0].score, 'a whole-site merge must not out-rank a single-route one');
  assert.equal(layout.pagesTouched, 6);
  assert.equal(layout.pagesTouchedThatFell, 1);
  assert.ok(layout.daysBeforeOnset < f.suspects[0].daysBeforeOnset, 'fixture is wrong: the layout merge should be nearer');

  // A merge touching nothing the route depends on is not a suspect at any rank.
  assert.ok(!f.suspects.some((s) => s.short === readmeSha), 'README must never be a candidate');
  assert.ok(!f.suspects.some((s) => s.short === aboutSha), 'an unrelated page merge must not be a candidate');

  // The pages that did not move must not acquire suspects.
  for (const p of ['/', '/about', '/contact', '/blog']) {
    assert.equal(find(a, p).verdict, 'stable', `${p} should be stable`);
  }
  assert.equal(a.counts.attributable, 1);

  // Every candidate carries what would settle it, and the report never claims cause.
  assert.ok(f.suspects[0].evidence.some((e) => e.startsWith('confirm:')));
  assert.ok(f.suspects[0].evidence.some((e) => e.startsWith('rule out:')));
  assert.match(a.caveat, /suspects, not a cause/);
});

test('a merge dated AFTER the onset cannot be the cause', () => {
  const dir = repo('lag', (d) => {
    commitAt(d, '2026-05-20', 'pricing: much later change',
      (x) => write(x, 'src/pages/pricing.astro', '<p>later</p>\n'));
  });
  const text = csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 30, 8)(i), impressions: 950 }),
  });
  const f = find(run(dir, text), '/pricing');
  // Google's effect lags the merge; a merge three weeks after the drop began
  // cannot have caused it, so the page is a real decline with no explanation.
  assert.equal(f.verdict, 'declined');
  assert.equal(f.suspects.length, 0);
  assert.match(f.reason, /NO merge in the 30 days before/);
  assert.match(f.reason, /Look outside the repo/);
});

// ---------------------------------------------------------- 2. sitewide drop

test('a sitewide decline is not pinned on any one merge', () => {
  let pricingSha;
  const dir = repo('sitewide', (d) => {
    // A perfectly timed, perfectly specific-looking suspect. It must not be named.
    pricingSha = commitAt(d, '2026-04-27', 'pricing: rewrite',
      (x) => write(x, 'src/pages/pricing.astro', '<p>rewritten</p>\n'));
  });

  const halve = (c, im) => (i) => (i < ONSET_INDEX ? { clicks: c, impressions: im } : { clicks: Math.round(c / 2), impressions: Math.round(im / 2) });
  const a = run(dir, csv(START, DAYS, {
    '/': halve(30, 900), '/about': halve(25, 800), '/contact': halve(22, 700),
    '/blog': halve(28, 850), '/blog/hello': halve(26, 820), '/pricing': halve(30, 950),
  }));

  assert.equal(a.sitewide.declining, true, 'the whole site halved and that must be detected first');
  assert.ok(a.sitewide.drop > 0.4, `sitewide drop ${a.sitewide.drop}`);
  assert.equal(a.counts.attributable, 0, 'nothing may be attributed when the whole site moved');

  const f = find(a, '/pricing');
  assert.equal(f.verdict, 'sitewide');
  assert.deepEqual(f.suspects, []);
  assert.match(f.reason, /moved with the site/);
  assert.match(a.sitewide.note, /core update, seasonality or a reporting change/);
  // The tempting suspect is nowhere in the output as a cause.
  assert.ok(!JSON.stringify(a.findings).includes(pricingSha), 'the single-route merge must not be named');
});

test('one page falling much harder than the site is still attributed', () => {
  // The sitewide guard must not swallow a genuine per-route loss just because
  // the site drifted down at the same time.
  let sha;
  const dir = repo('excess', (d) => {
    sha = commitAt(d, '2026-04-26', 'pricing: rewrite', (x) => write(x, 'src/pages/pricing.astro', '<p>v2</p>\n'));
  });
  const drift = (c, im) => (i) => (i < ONSET_INDEX ? { clicks: c, impressions: im } : { clicks: Math.round(c * 0.6), impressions: Math.round(im * 0.6) });
  const a = run(dir, csv(START, DAYS, {
    '/': drift(30, 900), '/about': drift(25, 800), '/contact': drift(22, 700),
    '/blog': drift(28, 850), '/blog/hello': drift(26, 820),
    '/pricing': (i) => (i < ONSET_INDEX ? { clicks: 30, impressions: 950 } : { clicks: 2, impressions: 200 }),
  }));
  assert.equal(a.sitewide.declining, true, 'every page fell, so this really is sitewide');
  assert.equal(a.sitewide.breadth, 1);
  const f = find(a, '/pricing');
  assert.equal(f.verdict, 'attributable', `${f.verdict}: ${f.reason}`);
  assert.ok(f.excessOverSite > DEFAULTS.minExcess);
  assert.equal(f.suspects[0].short, sha);
});

test('one page dragging the site total down is not a sitewide decline', () => {
  // Found by running this against a real repo: on a small site a single
  // collapsing page moves the aggregate past the sitewide threshold, and the
  // report announced "the whole site fell together" over one page. Aggregate
  // size is not breadth.
  let sha;
  const dir = repo('breadth', (d) => {
    sha = commitAt(d, '2026-04-26', 'pricing: rewrite', (x) => write(x, 'src/pages/pricing.astro', '<p>v2</p>\n'));
  });
  const a = run(dir, csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 40, 2)(i), impressions: 1200 }),
  }));
  assert.ok(a.sitewide.drop > DEFAULTS.sitewideDrop, `site total fell ${a.sitewide.drop}, the fixture needs it above the threshold`);
  assert.equal(a.sitewide.declining, false, 'one page of three is not the whole site');
  assert.equal(a.sitewide.pagesThatFell, 1);
  assert.equal(a.sitewide.pagesWithVolume, 3);
  assert.equal(find(a, '/pricing').suspects[0].short, sha);
});

// --------------------------------------------------------- 3. too little data

test('a page with too little data is not attributed at any confidence', () => {
  const dir = repo('thin', (d) => {
    commitAt(d, '2026-04-26', 'tiny: rewrite', (x) => write(x, 'src/pages/about.astro', '<p>v2</p>\n'));
  });
  // Roughly one click every third day, then nothing. A 100% "drop" on 9 clicks.
  const a = run(dir, csv(START, DAYS, {
    '/': flat(30, 900), '/contact': flat(22, 700), '/blog': flat(28, 850),
    '/blog/hello': flat(26, 820), '/pricing': flat(30, 950),
    '/about': (i) => (i % 3 === 0 && i < ONSET_INDEX ? { clicks: 1, impressions: 40 } : null),
  }));

  const f = find(a, '/about');
  assert.equal(f.verdict, 'insufficient-data', JSON.stringify(f, null, 2));
  assert.deepEqual(f.suspects, []);
  assert.equal(f.attributable, false);
  assert.ok(f.clicksBefore < DEFAULTS.minClicks);
  assert.match(f.reason, /floor is 30/);
  assert.equal(a.counts.attributable, 0);
});

test('a route with no history has not declined, it has started', () => {
  const dir = repo('new', (d) => {
    commitAt(d, '2026-04-26', 'launch', (x) => write(x, 'src/pages/contact.astro', '<p>v2</p>\n'));
  });
  const a = run(dir, csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/blog': flat(28, 850),
    '/blog/hello': flat(26, 820), '/pricing': flat(30, 950),
    // Nothing at all, then a launch spike, then a settle. Its "before" is empty
    // by construction, so the settle is not a decline anyone caused. Read as a
    // decline it is down 91% at z=17, which is why the guard has to exist.
    '/contact': (i) => (i < 30 ? null : i < 35 ? { clicks: 80, impressions: 1600 } : { clicks: 1, impressions: 60 }),
  }));
  const f = find(a, '/contact');
  assert.equal(f.verdict, 'too-new', JSON.stringify(f, null, 2));
  assert.deepEqual(f.suspects, []);
});

// ------------------------------------------------------------ 4. deleted page

test('a merge that deleted the page is named, and the index alone could not see it', () => {
  let sha;
  const dir = repo('deleted', (d) => {
    sha = commitAt(d, '2026-04-26', 'remove the pricing page',
      (x) => unlinkSync(join(x, 'src/pages/pricing.astro')));
  });
  const a = run(dir, csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => (i < ONSET_INDEX ? { clicks: 30, impressions: 950 } : { clicks: 0, impressions: 0 }),
  }));

  const f = find(a, '/pricing');
  assert.equal(f.route, null, 'the route is gone from the index, which is the whole difficulty');
  assert.equal(f.shape, 'deindexed');
  assert.equal(f.verdict, 'attributable');
  assert.equal(f.suspects[0].short, sha);
  assert.equal(f.suspects[0].confidence, 'near-certain');
  assert.equal(f.suspects[0].removedRoute, true);
  assert.ok(f.suspects[0].evidence.some((e) => /deleted in it/.test(e)));
  // And it is not filed as a page this repo simply never served.
  assert.ok(!a.unmatched.includes('/pricing'));
});

// ---------------------------------------------------------------- the merge

test('a merge is credited with its branch, on the date it landed', () => {
  // The branch commit is dated three weeks before the merge. Ranked by author
  // date it sits outside the window and the real cause is never listed.
  const dir = repo('mergedate', (d) => {
    sh(d, ['checkout', '-qb', 'feat']);
    commitAt(d, '2026-04-05', 'wip: pricing rewrite', (x) => write(x, 'src/pages/pricing.astro', '<p>branch</p>\n'));
    sh(d, ['checkout', '-q', 'main']);
    sh(d, ['merge', '--no-ff', '-q', 'feat', '-m', 'Merge pull request #12: pricing rewrite'], '2026-04-27');
  });
  const ml = mainline(dir, {});
  const merge = ml.commits.find((c) => c.subject.startsWith('Merge pull request'));
  assert.ok(merge, 'the merge commit is missing from the first-parent walk');
  assert.equal(merge.date, '2026-04-27', 'a merge must carry the date it landed, not the branch date');
  assert.deepEqual(merge.files, ['src/pages/pricing.astro'], 'a merge must be credited with what its branch changed');
  assert.ok(!ml.commits.some((c) => c.subject.startsWith('wip:')),
    'the branch commit must not appear separately: it would be dated three weeks early and rank last');

  const a = run(dir, csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 30, 8)(i), impressions: 950 }),
  }));
  assert.equal(find(a, '/pricing').suspects[0].short, merge.short);
});

// -------------------------------------------------------------- degradations

test('the freshest days are dropped, so backfill does not read as a decline', () => {
  const dir = repo('fresh', () => {});
  // A three-week export, flat all the way, except Search Console has not
  // finished filling the last three days. That is three dead days inside a
  // one-week after-window, which is exactly how a healthy page reads as a 43%
  // collapse that started last Tuesday.
  const SHORT = 21;
  const text = csv(START, SHORT, {
    '/': (i) => ({ clicks: i >= SHORT - 3 ? 0 : 30, impressions: i >= SHORT - 3 ? 0 : 900 }),
    '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820), '/pricing': flat(30, 950),
  });
  const trimmed = run(dir, text, { minDays: 7 });
  assert.equal(find(trimmed, '/').verdict, 'stable');
  assert.ok(trimmed.notes.some((n) => /backfills those/.test(n)));

  const raw = run(dir, text, { minDays: 7, ignoreLastDays: 0 });
  assert.notEqual(find(raw, '/').verdict, 'stable',
    'fixture is wrong: with the fresh days left in this must look like a decline');
});

test('a real decline is still reported when the history cannot be read', () => {
  const dir = repo('nogit', () => {});
  const parsed = parseExport(csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 30, 8)(i), impressions: 950 }),
  }), 'fixture.csv');
  const a = analyse({ index: buildIndex(dir), parsed, commits: [], gitError: 'not a git repository' });
  const f = find(a, '/pricing');
  // The loss is real whether or not git is available. Reporting nothing because
  // one input is missing would hide the finding, not the uncertainty.
  assert.equal(f.verdict, 'declined');
  assert.match(f.reason, /history could not be read/);
});

test('a comparison export ranks candidates but never calls one strong', () => {
  // The fixture must be capable of reaching the strong band, or this test proves
  // nothing. It previously touched src/pages/pricing.astro, which matches no
  // SURFACE pattern, so surface pinned at 0.5 and the score could not exceed
  // 0.555 however well everything else lined up: the assertion passed on a
  // fixture structurally incapable of failing it, while the bug it names was
  // live. A test that cannot fail is not evidence, it is decoration.
  const dir = repo('compare', (d) => {
    commitAt(d, '2026-04-26', 'pricing: rewrite', (x) => write(x, 'src/layouts/BaseLayout.astro', '<slot />\n'));
  });
  const text = [
    'Top pages,Previous 28 days Clicks,Last 28 days Clicks,Previous 28 days Impressions,Last 28 days Impressions',
    'https://fixture.test/pricing,840,224,26600,26400',
    'https://fixture.test/,840,850,25200,25300',
    'https://fixture.test/about,700,690,22400,22300',
  ].join('\n');
  const parsed = parseExport(text, 'compare.csv');
  assert.equal(parsed.shape, 'compare');
  const ml = mainline(dir, {});
  const a = analyse({ index: buildIndex(dir), parsed, commits: ml.commits, opt: { ...DEFAULTS, onset: '2026-04-30' } });

  const f = find(a, '/pricing');
  assert.equal(f.verdict, 'attributable');
  assert.equal(f.onset, null, 'a comparison export has no onset date and must not invent one');
  assert.ok(f.suspects.length >= 1);
  assert.ok(f.suspects.every((s) => s.confidence !== 'strong'),
    'without an onset date nothing can be called a strong candidate');
  assert.ok(a.notes.some((n) => /cannot say WHICH DAY/.test(n)));
});

test('the CLI runs end to end and exits 0', () => {
  const dir = repo('cli', (d) => {
    commitAt(d, '2026-04-26', 'pricing: rewrite', (x) => write(x, 'src/pages/pricing.astro', '<p>v2</p>\n'));
  });
  const exp = join(dir, 'gsc.csv');
  writeFileSync(exp, csv(START, DAYS, {
    '/': flat(30, 900), '/about': flat(25, 800), '/contact': flat(22, 700),
    '/blog': flat(28, 850), '/blog/hello': flat(26, 820),
    '/pricing': (i) => ({ clicks: stepAt(ONSET_INDEX, 30, 8)(i), impressions: 950 }),
  }));
  const out = execFileSync('node', [join(HERE, '..', 'palate-traffic.mjs'), dir, '--export', exp], { encoding: 'utf8' });
  assert.match(out, /\/pricing/);
  assert.match(out, /suspects, not a cause/);
  assert.match(out, /confirm:/);

  const json = JSON.parse(execFileSync('node', [join(HERE, '..', 'palate-traffic.mjs'), dir, '--export', exp, '--json'], { encoding: 'utf8' }));
  assert.equal(json.counts.attributable, 1);
});

test('a missing export and a directory that is not a site both exit 2', () => {
  const bin = join(HERE, '..', 'palate-traffic.mjs');
  for (const args of [[tmp('args')], [tmp('args2'), '--export', '/nope/nothing.csv']]) {
    assert.throws(() => execFileSync('node', [bin, ...args], { encoding: 'utf8', stdio: 'pipe' }),
      (e) => e.status === 2, `expected exit 2 for ${args.join(' ')}`);
  }
});
