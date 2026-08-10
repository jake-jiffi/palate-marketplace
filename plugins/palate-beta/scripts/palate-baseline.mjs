#!/usr/bin/env node
/**
 * palate-baseline.mjs - record what each route looks like now, so the next change has something
 * to be measured against.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * The contract can compute drift and could not, until this shipped, obtain the thing it compares
 * against. `writeBaseline` was exported and called by nothing outside a test and a 69-line script
 * pasted inside a markdown file, so `.palate/baselines/` was empty on every real site and every
 * contribution looked like the first one. A drift mechanism with no baseline is not a cautious
 * drift mechanism; it is an inert one that reports "no prior measurement" forever and quietly
 * teaches people the check does nothing.
 *
 * Extracting it here also removes a duplicate: the same capture loop lived inline in
 * `commands/adopt.md`, where it could not be syntax-checked, tested or fixed once.
 *
 * ========================= NUMBERS, NOT PIXELS, AGAIN =========================
 *
 * A baseline is throttled vitals, the appearance embedding, axe counts and the design facts. A
 * few KB of diffable JSON per route, committed, because it records what cannot be recomputed from
 * source: what this site looked like last time. Screenshots are deliberately NOT stored. Every
 * superseded image would be permanent, and history cannot be un-fattened without a rewrite, which
 * is how github/docs became a 574MiB checkout inside a 2.23GiB repository. Stills are regenerated
 * on demand for a before-and-after; they are an output, not a record.
 *
 * Usage:
 *   node palate-baseline.mjs <project-dir> --base <url> [--routes /,/blog] [--all]
 *   node palate-baseline.mjs <project-dir> --base <url> --all --dry-run
 *
 * Exit: 0 every requested route baselined, 1 one or more routes failed (named on stderr),
 *       2 bad args or not a site, 3 no browser available (BLOCKED, never a silent pass).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { buildIndex } from './palate-index.mjs';
import { writeBaseline, readBaseline } from './palate-contract.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const mod = (rel) => import(pathToFileURL(join(HERE, rel)).href);

function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (flag) => { const i = a.indexOf(flag); return i === -1 ? null : a[i + 1]; };
  return {
    projectDir: resolve(a[0] && !a[0].startsWith('--') ? a[0] : '.'),
    base: get('--base'),
    routes: (get('--routes') || '').split(',').map((s) => s.trim()).filter(Boolean),
    all: a.includes('--all'),
    dryRun: a.includes('--dry-run'),
  };
}

/**
 * Which routes to baseline.
 *
 * Dynamic routes are skipped: `/blog/[slug]` is not a page, it is a template, and baselining the
 * literal bracket path would store a 404 as the thing every future post is compared against.
 * Endpoints are skipped for the same reason: robots.txt has no appearance to drift.
 */
export function routesToCapture(index, { routes, all }) {
  if (routes.length) return routes;
  if (!all) return [];
  return index.routes.filter((r) => r.kind === 'static').map((r) => r.path);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.base && !args.dryRun) {
    console.error('palate-baseline: --base <url> is required (the running preview, e.g. from serve-preview.sh)');
    process.exit(2);
  }
  const index = buildIndex(args.projectDir);
  if (!index) { console.error(`palate-baseline: no site at ${args.projectDir}`); process.exit(2); }

  const routes = routesToCapture(index, args);
  if (!routes.length) {
    console.error('palate-baseline: no routes selected. Pass --routes /,/blog or --all.');
    process.exit(2);
  }

  if (args.dryRun) {
    for (const r of routes) {
      const prior = readBaseline(args.projectDir, r);
      console.log(`${r.padEnd(24)} ${prior ? 'would REPLACE (taken ' + (prior.takenAt || 'unknown') + ')' : 'would CREATE'}`);
    }
    return;
  }

  // Load the capture stack lazily and separately, so a missing browser is reported as BLOCKED
  // (exit 3) rather than surfacing as a generic module error that reads like a bad argument.
  let chromium;
  try {
    ({ chromium } = createRequire(join(HERE, 'reference-capture/package.json'))('playwright'));
  } catch {
    console.error('palate-baseline: playwright is not installed, so nothing can be captured. ' +
      'Run scripts/reference-capture/setup.sh. This is BLOCKED, not a pass.');
    process.exit(3);
  }
  const { measurePage } = await mod('reference-capture/design-measure.mjs');
  const { measureVitals } = await mod('reference-capture/vitals.mjs');
  const { embedHero, disposeTaste } = await mod('reference-capture/taste-local.mjs');

  const tmp = join(args.projectDir, '.palate', 'tmp');
  mkdirSync(tmp, { recursive: true });

  let browser;
  try {
    // channel: 'chromium' is not optional anywhere in this repo: the headless_shell segfaults
    // in-sandbox, and this script runs on machines nobody here has seen.
    browser = await chromium.launch({
      channel: 'chromium', headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    console.error(`palate-baseline: could not launch a browser (${e?.message ?? e}). BLOCKED, not a pass.`);
    process.exit(3);
  }

  const failed = [];
  try {
    for (const route of routes) {
      const url = new URL(route, args.base).href;
      try {
        // Vitals in their own context: measureVitals installs observers BEFORE navigating and
        // applies mobile throttling to that context, so nothing else may share it.
        const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const vitals = await measureVitals(await vctx.newPage(), url);
        await vctx.close();

        // Design facts and the hero still, unthrottled, at the desktop viewport the head expects.
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        const design = await measurePage(page);
        const shot = join(tmp, 'hero.png');
        await page.screenshot({ path: shot }); // viewport only: a full-page composite is refused
        await ctx.close();

        // embedHero THROWS on TASTE_DEPENDENCY_MISSING and TASTE_NOT_AUTHORISED, the two
        // commonest first-run paths. A route still deserves a baseline without an embedding;
        // losing the whole run because the optional half was unavailable is the wrong trade.
        let taste;
        try {
          taste = await embedHero(shot);
        } catch (e) {
          taste = { applicable: false, reason: e?.code || 'embed-unavailable' };
        }

        writeBaseline(args.projectDir, route, {
          takenAt: new Date().toISOString(),
          source: args.base,
          vitals,
          axe: { failAA: design.failAACount, under44: design.under44, controls: design.controlCount },
          design: {
            fonts: design.fonts, sizes: design.sizes, colours: design.colours,
            radii: design.radii, borders: design.borders,
          },
          embedding: taste.applicable ? taste.embedding : null,
          embeddingRefused: taste.applicable ? null : taste.reason,
        });
        console.log(`${route.padEnd(24)} baselined${taste.applicable ? '' : ` (appearance refused: ${taste.reason})`}`);
      } catch (e) {
        // One bad route must not cost the other nineteen. Name it, keep going, exit 1 at the end.
        failed.push({ route, why: String(e?.message ?? e).slice(0, 160) });
        console.error(`${route.padEnd(24)} FAILED: ${failed.at(-1).why}`);
      }
    }
  } finally {
    await disposeTaste().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failed.length) {
    console.error(`\npalate-baseline: ${failed.length} of ${routes.length} route(s) failed.`);
    process.exit(1);
  }
  console.log(`\npalate-baseline: ${routes.length} route(s) baselined into .palate/baselines/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
