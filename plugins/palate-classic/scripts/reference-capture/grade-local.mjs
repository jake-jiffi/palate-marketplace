#!/usr/bin/env node
/**
 * grade-local.mjs - a full Palate grade, computed on your own machine, for free.
 *
 * ================================ WHAT THIS IS ================================
 *
 * A SELF-CHECK. It is not a certified grade and must never be presented as one.
 *
 * It runs on your machine, from inputs you control, so it can be faked. That does not matter
 * for the job it exists to do - gaming yourself is pointless - and it matters entirely the
 * moment a number is shared. The two are different objects with different jobs:
 *
 *   THIS (free, local, unlimited)      fix your own site. Run it after every iteration.
 *   palatemcp.com/grade (free, remote)  prove something to someone else. Submit the URL once, at done.
 *
 * You do not need certification to fix your own site. You need it to show a client, put a
 * number in a proposal, or compare against anyone else's.
 *
 * ============================== WHY IT CAN EXIST ==============================
 *
 * A certified grade costs us about US$1.06: roughly $0.95 of Fly machine for ~100 seconds of
 * Chromium, plus ~$0.11 of vision calls. That price is why the real grader is a done-time
 * check and could never be an inner-loop one. But almost none of that cost has to be ours,
 * because this runs where the customer already has the expensive parts:
 *
 *   capture         a real browser, which this plugin already drives at both viewports
 *   appearance head SigLIP via transformers.js, ~540ms once the model is cached
 *   the judge       the agent reading this IS a vision model
 *   the rubric      rubric.mjs, vendored here and byte-identical to the grader's
 *
 * What is left for the server is a row read and a dot product, both free: `palate_grade_pack`
 * for the references and the judging prompt, `palate_taste_score` to project the embedding onto
 * the learned taste head (which stays on our server, because this repo is public).
 *
 * ================================== HOW IT RUNS ==================================
 *
 * Two phases, because the judge is the agent and the agent has to be handed the question.
 *
 *   1. node grade-local.mjs --url https://example.com [--vertical health]
 *        Captures the hero at 1440x900, measures the page, embeds it, fetches the pack,
 *        downloads the reference screenshots, and writes a judgement request naming six
 *        comparisons. Prints what to do next.
 *
 *   2. (the agent judges the six comparisons and writes the answers to a JSON file)
 *
 *   3. node grade-local.mjs --judgements <file>
 *        Scores with the grader's own rubric and prints the grade.
 *
 * FIRST RUN DOWNLOADS ~356MB (the SigLIP vision tower), once, and says so before it starts.
 *
 * ================================= FAIL LOUD =================================
 *
 * Every part that does not run is NAMED and dropped from the denominator, never scored around.
 * `measuredWeight` reports how much of the grader's 100 weight the number actually rests on, so
 * a grade computed without the ladder cannot be mistaken for one computed with it. This product
 * has a long history of silent skips reporting clean results while measuring nothing.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { measurePage, scoreDesignFacts } from './design-measure.mjs';
import { measureVitals, scoreVitals } from './vitals.mjs';
import { score as scoreRubric } from './rubric.mjs';
import { embedHero, disposeTaste, HERO_VIEWPORT } from './taste-local.mjs';
import { buildLadderRequest, validateJudgements, scoreLadder, naChecks } from './ladder-local.mjs';
import { createClient, PalateMcpError, NO_TOKEN_REMEDY } from './palate-mcp.mjs';

// --------------------------------------------------------------------- args ----
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] != null) args[m[1]] = m[2];
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[m[1]] = argv[++i];
    else args[m[1]] = true;
  }
}

const OUT_DIR = resolve(args.out || '.palate-shots');
const STATE_FILE = join(OUT_DIR, 'local-grade-state.json');
const REQUEST_FILE = join(OUT_DIR, 'ladder-request.json');
const RESULT_FILE = join(OUT_DIR, 'local-grade.json');

const say = (s) => console.error(s);

/**
 * NEVER call process.exit() in this file.
 *
 * Once the SigLIP session is resident, process.exit() races the ONNX runtime's native teardown
 * and the process aborts:
 *
 *   libc++abi: terminating due to uncaught exception of type std::__1::system_error:
 *   mutex lock failed: Invalid argument
 *
 * It lands after every line of output, on a grade that completed perfectly, and turns exit 0
 * into 134. A git hook, the stop gate or a self-heal loop reading that status would treat a
 * good grade as a crash. Measured both ways on the same run: process.exit(0) -> 134, natural
 * exit -> 0. Disposing the session first does NOT help; only letting the event loop drain does.
 *
 * So failures set an exit code and unwind, and the process is allowed to end by itself.
 */
class GradeFailure extends Error {
  constructor(message, remedy) {
    super(message);
    this.remedy = remedy;
  }
}
const die = (msg, remedy) => {
  throw new GradeFailure(msg, remedy);
};

/* ---------------------------------------------------------------------------
 * THE FLATTERY BAND: where this instrument is known to over-score, it does not
 * publish a point estimate.
 *
 * Measured over seven sites against fresh certified grades. Sorted by the appearance head's
 * percentile, the error is not noise, it is a step:
 *
 *   taste p22  hightownpharmacy   certified 41   local 58   +17
 *   taste p43  properly.sg        certified 36   local 62   +26
 *   ------------------------------------------------- p50 -------
 *   taste p57  linear.app         certified 60   local 56    -4
 *   taste p73  palatemcp.com      certified 83   local 75    -8
 *   taste p92  nocturne-label     certified 90   local 95    +5
 *   taste p94  jiffi.co           certified 73   local 67    -6
 *   taste p99  web-design-mcp     certified 87   local 91    +4
 *
 * Above the corpus median the gap is never worse than 8. Below it, both sites were flattered,
 * by 17 and 26.
 *
 * WHY THE GATE IS ON TASTE AND NOT ON THE SCORE. The obvious guard - withhold below some local
 * score - cannot work here, because the failure IS that the local score is too high: those two
 * sites came out 58 and 62, comfortably mid-table. The appearance head is the only signal
 * available at grade time that separates them, and it does so cleanly. It earns that job:
 * across these seven, r(taste, certified) = 0.90, HIGHER than r(local grade, certified) = 0.83.
 * The head already knew.
 *
 * WHY THE ARITHMETIC IS NOT SIMPLY CHANGED INSTEAD. The prior lifts above p85 and pulls below
 * p10. hightownpharmacy at p22 and properly.sg at p43 sit in the dead zone: correctly ranked in
 * the bottom half and forbidden from being corrected. Widening the pull threshold would move
 * exactly these two numbers and prove nothing, so the asymmetry is REPORTED rather than tuned.
 *
 * WHY IT MATTERS MORE THAN A CALIBRATION ISSUE. This is a self-check for someone deciding
 * whether their site needs rebuilding. Flattering a bad site is the one error that costs them
 * the decision: they read 62, conclude they are mid-pack, and do nothing. A certified 36 never
 * gets the chance to change their mind.
 * ------------------------------------------------------------------------- */
const FLATTERY_TASTE_FLOOR = 50;
/** The observed over-score in that band, in points. n = 2, and the message says so. */
const FLATTERY_OVERSCORE = { min: 17, max: 26, n: 2 };

/** The line that must appear wherever this number does. */
const NOT_CERTIFIED =
  'THIS IS A SELF-CHECK, NOT A CERTIFIED GRADE. It is computed on this machine and can be faked, so it is ' +
  'for fixing your own site and must not be shared, published or compared against anyone else\'s score. ' +
  'For a number you can show someone, submit the URL at https://palatemcp.com/grade, which runs the ' +
  'grader on our infrastructure and is the same instrument a stranger would run against your site.';

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1440, height: 900 },
};

// Same rule list and grader-check mapping verify-rendered.mjs uses.
const AXE_RULES = {
  'color-contrast': 'text_contrast',
  'button-name': 'control_accessible_names',
  'link-name': 'control_accessible_names',
  'input-button-name': 'control_accessible_names',
  'select-name': 'control_accessible_names',
  label: 'forms_and_errors',
  'form-field-multiple-labels': 'forms_and_errors',
  'html-has-lang': 'structure_and_landmarks',
  'document-title': 'structure_and_landmarks',
  'image-alt': 'structure_and_landmarks',
  'landmark-one-main': 'structure_and_landmarks',
  'heading-order': 'quotable_chunk_structure',
};

// ------------------------------------------------------------------ phase 1 ----

/** Let the page finish arriving, without scrolling it. */
async function settleAtTop(page) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1400)));
}

/**
 * Wait until the first screen STOPS CHANGING, then say whether it did.
 *
 * A fixed delay is not a settle. linear.app was captured with its headline still blurred
 * mid-entrance, its subhead a ghost and its cards as empty outlines, because 1400ms is not long
 * enough for a reveal animation. Nothing downstream could catch it: the aspect was right and the
 * pixels were varied, so every gate in taste-local.mjs passed a frame of an animation and the
 * appearance head scored it (p41.3) as though it were the design.
 *
 * That failure mode targets exactly the sites this product exists to build. A Palate build has
 * entrance motion by design, so a grader that screenshots too early systematically scores the
 * best-built sites on their worst frame.
 *
 * So: shoot the viewport repeatedly and compare the encoded bytes. Two identical PNGs mean
 * nothing moved between them. `stable` is returned rather than assumed, because a page with a
 * looping background or a video hero will never settle, and the honest answer there is "this is
 * a frame of something moving", not a silent pass.
 */
async function waitForStillHero(page, { intervalMs = 450, maxMs = 9000 } = {}) {
  const t0 = Date.now();
  let previous = null;
  let stableFor = 0;
  while (Date.now() - t0 < maxMs) {
    const shot = await page.screenshot({ fullPage: false, timeout: 15000 });
    if (previous && shot.equals(previous)) {
      stableFor++;
      // Two consecutive identical frames. One pair is enough: the interval is longer than a
      // frame, so a moving page cannot produce two matching shots by chance.
      if (stableFor >= 1) return { stable: true, ms: Date.now() - t0 };
    } else {
      stableFor = 0;
    }
    previous = shot;
    await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), intervalMs);
  }
  return { stable: false, ms: Date.now() - t0 };
}

/**
 * Scroll to the bottom and back, so lazy content and scroll-triggered reveals have fired before
 * the design facts are read.
 *
 * `behavior: 'instant'` is load-bearing, and the default is not it. A page that sets
 * `scroll-behavior: smooth` in CSS turns window.scrollTo into an ANIMATION, so the return to the
 * top is still in flight when the next step runs.
 */
async function scrollThrough(page) {
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
}

async function runAxe(page, axeSource) {
  try {
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(
      (rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }),
      Object.keys(AXE_RULES),
    );
    const hits = [];
    for (const v of res.violations || []) if (AXE_RULES[v.id]) hits.push({ rule: v.id, check: AXE_RULES[v.id], nodes: v.nodes.length });
    return { hits, error: null };
  } catch (e) {
    return { hits: null, error: String(e?.message ?? e).slice(0, 160) };
  }
}

/**
 * Is this file actually a decodable image, by its magic bytes and a sane floor on size?
 *
 * Cheap on purpose: the point is to catch a truncated write, an HTML error body saved under a
 * .png name, or a zero-byte file, not to fully validate a codec. A 1KB floor is well under any
 * real 1440x900 screenshot and well over any error page. Measured across all cached library
 * heroes, the smallest is 5.7KB. (An earlier version of this comment said 16KB, which was the
 * smallest of the five files I happened to list, stated as though it were the corpus minimum.
 * The floor is unaffected, but the claim was not one I had made.)
 */
function looksLikeImage(path) {
  try {
    if (statSync(path).size < 1024) return false;
    const head = Buffer.alloc(4);
    // `require` does not exist in an ESM module. Reaching for it here would have thrown a
    // ReferenceError that this function's own catch swallowed, declaring EVERY image invalid,
    // dropping all three exemplars and taking the ladder down - while reporting only "could not
    // be fetched". A catch-all around a provenance check is its own silent-skip risk.
    const fd = openSync(path, 'r');
    try {
      readSync(fd, head, 0, 4, 0);
    } finally {
      closeSync(fd);
    }
    const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    return png || jpeg;
  } catch {
    return false;
  }
}

/** A compact, factual brief for the judge, so it reasons about numbers rather than impressions. */
function measurementsText(designFacts, vitals) {
  const d = designFacts.desktop || designFacts.mobile;
  const lines = [];
  if (d) {
    const lead = (d.colours || []).find((c) => c && c.v) ?? null;
    if (lead) lines.push(`- lead colour ${lead.v}`);
    if (d.families?.length) lines.push(`- type families in use: ${d.families.slice(0, 4).map((f) => f.v ?? f).join(', ')}`);
    if (d.sizes?.length) lines.push(`- ${d.sizes.length} distinct type sizes on the page`);
    if (d.radii?.length) lines.push(`- ${d.radii.length} distinct corner radii`);
    if (d.shadows?.length) lines.push(`- ${d.shadows.length} distinct shadow depths`);
    if (d.nodes) lines.push(`- ${d.nodes} DOM nodes`);
  }
  const m = designFacts.mobile;
  if (m?.controls != null) lines.push(`- ${m.controls} interactive controls at 390px`);
  if (vitals?.applicable) {
    lines.push(`- LCP ${Math.round(vitals.lcpMs)}ms and CLS ${vitals.clsScore?.toFixed?.(3) ?? vitals.clsScore} under slow-4G + 4x CPU emulation`);
  }
  return lines.length ? lines.join('\n') : '(no measurements available)';
}

async function phaseRequest() {
  const url = String(args.url || '').trim();
  if (!url) die('pass --url <the live or preview URL to grade>');
  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    die(`--url "${url}" is not a URL`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

  const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const designFacts = {};
  const axeByViewport = {};
  const errors = [];
  const heroPath = join(OUT_DIR, 'local-grade-hero.png');
  let heroSettle = null;

  /**
   * DELETE ANY PREVIOUS HERO BEFORE CAPTURING, so the existence check below can only be
   * satisfied by THIS run.
   *
   * `if (!existsSync(heroPath)) die(...)` looks like a guard and is not one when a stale file
   * sits at that path. A capture that timed out would leave the previous run's hero in place,
   * the guard would pass, and the appearance head would score yesterday's page while every
   * number in the report described today's. The taste head cannot tell you it was handed the
   * wrong page - that is precisely why the check has to be about provenance, not existence.
   */
  if (existsSync(heroPath)) rmSync(heroPath, { force: true });

  try {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      let ctx;
      try {
        // deviceScaleFactor 1 on purpose: all 2,194 corpus heroes were captured at exactly
        // 1440x900 at DPR 1, and the appearance head is a comparison against that corpus.
        ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load', timeout: 40000 });
        await settleAtTop(page);

        // THE HERO IS CAPTURED BEFORE ANYTHING SCROLLS THE PAGE.
        //
        // The first version measured first and screenshotted after, restoring the scroll
        // position in between. On a site with `scroll-behavior: smooth` that restore is an
        // animation that had not finished, and the "hero" came back as a mid-page section with
        // the cookie banner across it. Nothing detected it: the aspect was right, the pixels
        // were varied, so every gate in taste-local.mjs passed and the appearance head scored a
        // section it was never meant to see. Found by LOOKING at the PNG.
        //
        // So the order is now: arrive, capture, then scroll for the measurements.
        if (name === 'desktop') {
          const atTop = await page.evaluate(() => window.scrollY);
          if (atTop > 2) {
            // Loud rather than a quietly wrong hero. The head is a hero model; a scrolled frame
            // is a different question with a confident-looking answer.
            errors.push(`desktop: the page was at scrollY ${atTop} when the hero was captured, so it is NOT the hero`);
          }
          heroSettle = await waitForStillHero(page);
          if (!heroSettle.stable) {
            errors.push(
              `desktop: the first screen was still moving after ${Math.round(heroSettle.ms / 1000)}s, so the hero is a ` +
                'FRAME OF AN ANIMATION rather than a settled design. Treat its appearance score with suspicion.',
            );
          }
          // fullPage FALSE: the head is a viewport model and a full-page composite (aspect ~5)
          // is squashed to 384x384 into something it never saw. taste-local.mjs refuses one.
          await page.screenshot({ path: heroPath, fullPage: false, timeout: 15000 });
        }

        await scrollThrough(page);
        if (name === 'desktop' || name === 'mobile') designFacts[name] = await measurePage(page);
        axeByViewport[name] = await runAxe(page, axeSource);
      } catch (e) {
        errors.push(`${name}: ${String(e?.message ?? e).slice(0, 160)}`);
      } finally {
        try {
          if (ctx) await ctx.close();
        } catch {}
      }
    }

    if (!designFacts.desktop && !designFacts.mobile) die(`could not load ${url} at any viewport`, errors.join('\n'));

    var vitals = null;
    if (args['no-vitals'] !== 'true' && args['no-vitals'] !== true) {
      try {
        const vctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
        vitals = await measureVitals(await vctx.newPage(), url);
        await vctx.close();
      } catch (e) {
        errors.push(`vitals: ${String(e?.message ?? e).slice(0, 160)}`);
      }
    } else {
      say('grade-local: --no-vitals set, performance is UNMEASURED (14 of the grader\'s 100 weight).');
    }
  } finally {
    await browser.close();
  }

  if (!existsSync(heroPath)) die('the desktop hero screenshot was not captured, so neither the appearance head nor the ladder can run');

  // --- the appearance head, locally -----------------------------------------
  let taste = { applicable: false, reason: 'not attempted', detail: null };
  const embedded = await embedHero(heroPath, {
    onFirstDownload: () =>
      say(
        '\ngrade-local: FIRST RUN - downloading the SigLIP vision tower (~356MB), once.\n' +
          '  It is cached afterwards and every later grade loads it in about a second.\n' +
          '  Set PALATE_MODEL_CACHE to keep it outside node_modules so a dependency bump does not re-download it.\n',
      ),
  }).catch((e) => ({
    applicable: false,
    reason:
      e?.code === 'TASTE_DEPENDENCY_MISSING' ? 'dependency-missing'
      : e?.code === 'TASTE_NOT_AUTHORISED' ? 'not-authorised'
      : 'embed-threw',
    detail: String(e?.message ?? e).slice(0, 300),
  }));
  // NOT AUTHORISED IS NOT AN ERROR, it is a choice the operator has not made yet, so it reads
  // as a named cost rather than a failure. Say what it cost: without the appearance head the
  // local grade loses its single best predictor (0.738 concordance against founder labels) and
  // the correlation with the certified grade falls from 0.83 to 0.76.
  if (taste?.reason === 'not-authorised' || embedded?.reason === 'not-authorised') {
    say(
      '\ngrade-local: RUNNING WITHOUT THE APPEARANCE HEAD - it needs a one-off ~356MB model and\n' +
        '  has not been authorised. This grade will use the design ladder alone, which measured\n' +
        '  r = 0.76 against certified rather than 0.83, and it CANNOT apply the flattery gate that\n' +
        '  withholds a number on weak pages, so read a mid-table score here with suspicion.\n' +
        '  Authorise once: scripts/reference-capture/setup.sh --with-taste   (or PALATE_TASTE=1)\n',
    );
  }

  if (!embedded.applicable) {
    say(`grade-local: the appearance head did NOT run (${embedded.reason}): ${embedded.detail}`);
    taste = { applicable: false, reason: embedded.reason, detail: embedded.detail };
  }

  // --- the two free MCP lookups ---------------------------------------------
  let pack = null;
  let mcpError = null;
  let client = null;
  try {
    client = createClient({ projectDir: process.cwd() });
  } catch (e) {
    mcpError = e;
  }

  if (args.pack) {
    pack = JSON.parse(readFileSync(resolve(args.pack), 'utf8'));
    say(`grade-local: judging pack read from ${args.pack}`);
  } else if (client) {
    try {
      pack = await client.callTool('palate_grade_pack', { vertical: args.vertical || undefined, excludeDomain: domain });
    } catch (e) {
      mcpError = e;
    }
  }

  if (args.taste) {
    // VALIDATED, not trusted. This file is hand-supplied (it is the OAuth fallback: the caller
    // ran palate_taste_score themselves), so it can just as easily be an error payload or the
    // wrong tool's output. Stamping applicable:true on whatever is in it would put an undefined
    // percentile into the report and silently drop the prior while claiming the head had run.
    const raw = JSON.parse(readFileSync(resolve(args.taste), 'utf8'));
    if (typeof raw?.percentile === 'number' && Number.isFinite(raw.percentile) && raw.percentile >= 0 && raw.percentile <= 100) {
      taste = { ...raw, applicable: true };
      say(`grade-local: taste score read from ${args.taste} (percentile ${raw.percentile})`);
    } else {
      taste = { applicable: false, reason: 'taste-file-invalid', detail: `${args.taste} has no usable numeric \`percentile\`; it is not a palate_taste_score result.` };
      say(`grade-local: the taste file was REJECTED: ${taste.detail}`);
    }
  } else if (client && embedded.applicable) {
    try {
      const t = await client.callTool('palate_taste_score', { embedding: embedded.embedding });
      taste = { applicable: true, ...t, image: embedded.image, flags: embedded.flags, localMs: embedded.ms };
    } catch (e) {
      taste = { applicable: false, reason: 'taste-lookup-failed', detail: String(e?.message ?? e).slice(0, 300) };
      say(`grade-local: the taste head projection failed: ${taste.detail}`);
    }
  }

  if (mcpError) {
    say(`\ngrade-local: could not reach the Palate MCP: ${mcpError.message}`);
    if (mcpError.remedy) say(mcpError.remedy);
  }

  // --- the exemplar screenshots, straight from the public CDN ---------------
  const exemplars = [];
  if (pack?.exemplars?.length) {
    const exDir = join(OUT_DIR, 'exemplars');
    mkdirSync(exDir, { recursive: true });
    for (const ex of pack.exemplars) {
      const imagePath = join(exDir, `${ex.slug}.png`);
      try {
        // THE CACHE IS VALIDATED, NOT TRUSTED. `existsSync` alone means a truncated download
        // from an interrupted run, or a file the disk filled up on, is accepted forever: the
        // judge is then handed a broken image and still returns a verdict on it. A cached file
        // that is not a decodable image is deleted and re-fetched rather than reused.
        if (existsSync(imagePath) && !looksLikeImage(imagePath)) {
          say(`grade-local: cached exemplar "${ex.slug}" is not a valid image; re-fetching.`);
          rmSync(imagePath, { force: true });
        }
        if (!existsSync(imagePath)) {
          const res = await fetch(ex.image, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          writeFileSync(imagePath, bytes);
          // Re-read from disk rather than trusting the buffer: this is what the judge will open.
          if (!looksLikeImage(imagePath)) throw new Error('the fetched bytes are not a PNG or JPEG');
        }
        exemplars.push({ ...ex, imagePath });
      } catch (e) {
        // Named, not swallowed. A missing reference silently shrinks the ladder from three
        // comparisons to two, which is precisely the regression that widened the grader's spread.
        say(`grade-local: exemplar "${ex.slug}" could not be fetched (${String(e?.message ?? e).slice(0, 80)}); it is DROPPED from the ladder.`);
      }
    }
  }

  // --- write the state and the judgement request ----------------------------
  const state = {
    version: 1,
    at: new Date().toISOString(),
    url,
    domain,
    vertical: pack?.verticalUsed ?? args.vertical ?? null,
    heroPath,
    heroSettle,
    designFacts,
    axeByViewport,
    vitals: vitals ?? null,
    vitalsRequested: args['no-vitals'] !== 'true' && args['no-vitals'] !== true,
    taste,
    errors,
    isCertified: false,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

  let request = null;
  if (exemplars.length >= 1) {
    request = buildLadderRequest({
      heroPath,
      exemplars,
      domain,
      vertical: state.vertical,
      measurements: measurementsText(designFacts, vitals),
      system: pack.judging?.system,
    });
    writeFileSync(REQUEST_FILE, JSON.stringify(request, null, 1));
  }

  // --- tell the agent exactly what to do ------------------------------------
  console.log(renderRequestInstructions({ state, request, exemplars, mcpError }));
  await disposeTaste();
}

function renderRequestInstructions({ state, request, exemplars, mcpError }) {
  const L = [];
  L.push('');
  L.push(`LOCAL GRADE, PHASE 1 of 2 - measured ${state.url}`);
  L.push('');
  L.push(
    `  hero            ${state.heroPath} (${HERO_VIEWPORT.width}x${HERO_VIEWPORT.height})` +
      (state.heroSettle ? (state.heroSettle.stable ? ` settled in ${state.heroSettle.ms}ms` : ` STILL MOVING after ${state.heroSettle.ms}ms - this is a frame of an animation`) : ''),
  );
  L.push(
    `  appearance head ${
      state.taste.applicable
        ? `taste percentile ${state.taste.percentile} against ${state.taste.corpus?.n ?? '?'} library references`
        : `DID NOT RUN (${state.taste.reason})`
    }`,
  );
  L.push(`  vitals          ${state.vitals?.applicable ? `LCP ${Math.round(state.vitals.lcpMs)}ms` : state.vitalsRequested ? 'DID NOT RUN' : 'skipped (--no-vitals)'}`);
  L.push(`  references      ${exemplars.length ? exemplars.map((e) => e.slug).join(', ') : 'NONE'}`);
  L.push('');

  if (!request) {
    L.push('THE DESIGN LADDER CANNOT RUN: no library references were available.');
    if (mcpError?.remedy) L.push(mcpError.remedy);
    L.push('');
    L.push('You can still score what was measured, and the result will say so:');
    L.push(`  node ${relSelf()} --judgements none`);
    return L.join('\n');
  }

  L.push(`NOW JUDGE ${request.comparisons.length} COMPARISONS. This is the part only you can do.`);
  L.push('');
  L.push('Each comparison shows the candidate site against one library reference. Every reference is');
  L.push('judged TWICE with the images swapped, because position bias is the best-documented failure of');
  L.push('pairwise visual judging and swapping is the only control that detects it.');
  L.push('');
  L.push('DISPATCH EACH COMPARISON TO A FRESH SUBAGENT. The two swapped runs must not see each other, or');
  L.push('the control has not run: an agent that judged both orderings in one context is asking itself to');
  L.push('agree with itself. Give each subagent the system prompt, the two images, and the one prompt.');
  L.push('');
  L.push(`  request         ${REQUEST_FILE}`);
  L.push('  system prompt   the `system` field of that file (use it verbatim; it is served by the MCP so');
  L.push('                  your judgement and the public grader\'s are reading the same instructions)');
  L.push('');
  for (const c of request.comparisons) {
    L.push(`  ${c.id}`);
    L.push(`     A: ${c.imageA}`);
    L.push(`     B: ${c.imageB}`);
  }
  L.push('');
  L.push('Write the answers as a JSON array to a file, one object per comparison:');
  L.push('  [{ "comparisonId": "...", "verdict": "clearly_worse|somewhat_worse|comparable|better",');
  L.push('     "candidate_is": "A|B", "evidence": "...", "signature_move": true|false,');
  L.push('     "signature_move_note": "...", "tells": ["..."] }]');
  L.push('');
  L.push('Be blunt. Most real websites are clearly worse than a library reference and saying so is the job.');
  L.push('Do not soften a verdict because you built the site.');
  L.push('');
  L.push('THEN SCORE IT:');
  L.push(`  node ${relSelf()} --judgements <that file>`);
  L.push(`  (add --not-independent if you could not judge them in separate contexts, so the result says so)`);
  L.push('');
  L.push(NOT_CERTIFIED);
  return L.join('\n');
}

function relSelf() {
  return join(dirname(new URL(import.meta.url).pathname).replace(process.cwd() + '/', ''), 'grade-local.mjs');
}

// ------------------------------------------------------------------ phase 2 ----

async function phaseScore() {
  if (!existsSync(STATE_FILE)) die(`no measurement state at ${STATE_FILE}`, 'Run phase 1 first: node grade-local.mjs --url <url>');
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

  const noLadder = args.judgements === 'none';
  let ladder;

  if (noLadder) {
    ladder = { applicable: false, reason: 'The design ladder was not run for this grade.', checks: naChecks('The design ladder was not run for this grade.') };
  } else {
    if (!existsSync(REQUEST_FILE)) die(`no judgement request at ${REQUEST_FILE}`, 'Run phase 1 first.');
    const request = JSON.parse(readFileSync(REQUEST_FILE, 'utf8'));
    const path = resolve(String(args.judgements));
    if (!existsSync(path)) die(`no judgements file at ${path}`);
    let judgements;
    try {
      judgements = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      die(`the judgements file is not valid JSON: ${e?.message ?? e}`);
    }
    if (judgements && !Array.isArray(judgements) && Array.isArray(judgements.judgements)) judgements = judgements.judgements;

    const v = validateJudgements(request, judgements);
    if (!v.ok) {
      // Refusing here is the whole discipline. A partially judged ladder scored as a complete one
      // is a number that looks the same and means something else.
      die('the judgements do not match the request:\n  - ' + v.errors.join('\n  - '), 'Re-judge the missing or malformed comparisons and run again.');
    }
    const independent = !(args['not-independent'] === true || args['not-independent'] === 'true');
    ladder = scoreLadder({ request, byComparison: v.byComparison, tastePercentile: state.taste?.applicable ? state.taste.percentile : null, independent });
  }

  // --- assemble exactly as verify-rendered.mjs does, plus the ladder --------
  const designScored = state.designFacts.desktop || state.designFacts.mobile ? scoreDesignFacts(state.designFacts) : [];
  const vitalsScored = state.vitals ? scoreVitals(state.vitals) : [];

  const m = new Map();
  for (const c of [...designScored, ...vitalsScored, ...ladder.checks]) {
    if (c.raw === null || c.applicable === false) continue;
    m.set(c.id, { id: c.id, raw: c.raw, detail: c.detail, lowConfidence: !!c.lowConfidence });
  }
  /**
   * THE AXE WIRING IS SYMMETRIC: a clean sweep SCORES, it does not vanish.
   *
   * The obvious wiring only ever penalises - set the check to 0 when axe fires, and otherwise
   * leave it alone. That is silently biased, and the bias runs the wrong way for us. A page with
   * a contrast violation puts accessibility in the denominator at 0; a page with none drops the
   * whole 12-weight dimension out of the grade entirely. Measured on palatemcp.com/web-design-mcp:
   * the certified grade scored accessibility 96, and the local grade reported it NOT MEASURED,
   * so the two numbers were computed over different halves of the rubric.
   *
   * Axe running clean IS a measurement. So a successful sweep credits the four checks it covers
   * and a violation zeroes them, exactly as the grader treats them.
   *
   * Only these four. `heading-order` also maps to a check, but to a CONTENT check, and crediting
   * one check out of that dimension's five would let content score 100 off a single signal.
   */
  const axeRan = Object.values(state.axeByViewport || {}).some((a) => a && Array.isArray(a.hits));
  const allHits = Object.values(state.axeByViewport || {}).flatMap((a) => (a && a.hits) || []);
  const axeHit = (check) => allHits.some((h) => h.check === check);
  for (const id of ['text_contrast', 'control_accessible_names', 'forms_and_errors', 'structure_and_landmarks']) {
    if (axeHit(id)) m.set(id, { id, raw: 0, detail: 'An axe violation was found on the rendered page.', lowConfidence: false });
    else if (axeRan) m.set(id, { id, raw: 1, detail: 'No axe violation for this check at 390, 834 or 1440.', lowConfidence: false });
  }
  if (!m.size) die('nothing could be measured, so there is no grade');

  const graded = scoreRubric(m);

  const out = {
    version: 1,
    at: new Date().toISOString(),
    url: state.url,
    domain: state.domain,
    vertical: state.vertical,
    isCertified: false,
    kind: 'local-self-check',
    overall: graded.overall,
    /**
     * Set when the appearance head puts this site below the library median, i.e. where this
     * instrument is measured to flatter. `overall` is still carried, because a self-heal loop
     * needs SOMETHING to track iteration to iteration and the findings underneath it are sound.
     * What it must not do is travel as the answer, so everything that renders this reads
     * `flattery` first.
     */
    flattery: flatteryOf(state.taste, graded.overall),
    /**
     * NO BAND LETTER. Measured, not assumed.
     *
     * Against three fresh certified grades this scores a mean absolute 9 points out, and the
     * rubric's bands are 10 points wide. palatemcp.com/web-design-mcp came back 91 here and 87
     * certified: same page, same rubric, and "A Exceptional" against "B Strong". A band is the
     * part a reader quotes and the part that travels into a proposal, so publishing one off a
     * number this wide would manufacture a disagreement between our own two instruments.
     *
     * The number and its margin are reported instead. `bandFor` is deliberately not called.
     */
    measuredWeight: graded.measuredWeight,
    confidence: graded.confidence,
    caps: graded.caps,
    dimensions: graded.dimensions.map((d) => ({ id: d.id, label: d.label, weight: d.weight, score: d.score, measured: d.measured, total: d.total })),
    findings: graded.findings.slice(0, 12).map((f) => ({ id: f.id, label: f.label, raw: Math.round(f.raw * 1000) / 1000, recoverable: Math.round(f.recoverable * 100) / 100, detail: f.detail, fix: f.fix })),
    taste: state.taste,
    ladder: { applicable: ladder.applicable, reason: ladder.reason ?? null, rung: ladder.rung ?? null, meanRaw: ladder.meanRaw ?? null, results: ladder.results ?? [] },
    heroSettle: state.heroSettle ?? null,
    unmeasured: unmeasuredNote({ ladder, taste: state.taste, vitals: state.vitals, vitalsRequested: state.vitalsRequested, graded, heroSettle: state.heroSettle }),
    notCertified: NOT_CERTIFIED,
  };
  writeFileSync(RESULT_FILE, JSON.stringify(out, null, 1));

  console.log(renderResult(out));
}

/**
 * Everything that did NOT contribute, named. Silence here is how a partial grade passes as whole.
 *
 * The dimension list is not decoration. This tool measures design, performance and the axe-backed
 * half of accessibility; it does NOT measure content, technical foundations or AI readiness, which
 * the public grader reads from the fetched HTML, robots.txt and sitemap. That is 34 of the 100
 * weight absent, and leaving it unsaid would let a number computed on 66 weight be compared
 * against one computed on 100 as though they were the same quantity.
 */
function unmeasuredNote({ ladder, taste, vitals, vitalsRequested, graded, heroSettle }) {
  const gaps = [];
  if (heroSettle && !heroSettle.stable)
    gaps.push(
      `the hero was STILL MOVING after ${Math.round(heroSettle.ms / 1000)}s, so both the appearance head and the ` +
        'ladder judged a frame of an animation rather than the settled design. Both are suspect on this run.',
    );
  if (!ladder.applicable) gaps.push(`the design ladder (45 of design's 100 points): ${ladder.reason}`);
  if (!taste?.applicable) gaps.push(`the SigLIP appearance head (the prior on the ladder's verdict): ${taste?.reason ?? 'did not run'}`);
  if (vitalsRequested && !vitals?.applicable) gaps.push("performance (14 of the grader's 100 weight): vitals did not run");
  if (!vitalsRequested) gaps.push("performance (14 of the grader's 100 weight): skipped with --no-vitals");
  for (const d of graded?.dimensions ?? []) {
    if (d.measured === 0)
      gaps.push(
        `${d.label} (weight ${d.weight}): not measured here at all. The public grader reads it from the ` +
          'fetched HTML, robots.txt and sitemap; this tool does not.',
      );
  }
  return gaps;
}

/** `null` when the score is safe to state; otherwise the reason it is not, and the honest range. */
function flatteryOf(taste, overall) {
  if (!taste?.applicable || typeof taste.percentile !== 'number') return null;
  if (taste.percentile >= FLATTERY_TASTE_FLOOR) return null;
  return {
    risk: true,
    tastePercentile: taste.percentile,
    floor: FLATTERY_TASTE_FLOOR,
    observedOverscore: FLATTERY_OVERSCORE,
    // Subtracting the measured over-score. Presented as a range because it IS a range: two
    // observations, 17 and 26 points.
    honestRange: [overall - FLATTERY_OVERSCORE.max, overall - FLATTERY_OVERSCORE.min],
  };
}

function renderResult(o) {
  const L = [];
  L.push('');
  if (o.flattery) {
    L.push(`LOCAL GRADE  ${o.url}`);
    L.push(`  THE NUMBER IS WITHHELD ON THIS SITE. It computed ${o.overall}/100 and that is very likely too kind.`);
    L.push(
      `  The appearance head puts this page at percentile ${o.flattery.tastePercentile} of the library, below the median. ` +
        `On the ${o.flattery.observedOverscore.n} sites measured in that band this instrument over-scored the certified`,
    );
    L.push(
      `  grade by ${o.flattery.observedOverscore.min} and ${o.flattery.observedOverscore.max} points, so the honest range here is ` +
        `roughly ${o.flattery.honestRange[0]} to ${o.flattery.honestRange[1]}.`,
    );
    L.push('  Fix the gaps below, then get the certified grade before concluding anything about this site.');
  } else {
    L.push(`LOCAL GRADE  ${o.overall}/100   ${o.url}`);
    // No band. It runs about 10 points from the certified grade and the bands are 10 wide, so a
    // letter here would contradict the certified one on the same page. See the note in the payload.
    L.push('This is not a band and not a certified score. Bands come from the certified grade only.');
  }
  L.push(`measured on ${o.measuredWeight} of the grader's 100 weight, margin about +/-${o.confidence} points`);

  /**
   * THE PASS IS WHERE A SCORE IS DANGEROUS, NOT THE FAIL.
   *
   * An agent reading a low number is still working. An agent reading a high one stops, and
   * stopping on this number is the failure the whole loop exists to prevent arriving through
   * the front door. So the caveat goes HERE, next to a score that reads as permission, rather
   * than in a footer under a list of gaps.
   *
   * Measured first, so this is not a reflex. Above the corpus median the local grade is
   * CONSERVATIVE, not flattering: gaps of -4, -8, +5, -6, +4, mean signed -1.8. So the number
   * itself is defensible up here and no correction is applied. "Defensible number" and "safe to
   * stop on" are different claims, and only the first one is earned.
   *
   * What makes it unsafe to stop on is coverage, not accuracy: content, technical foundations
   * and AI answer-engine readiness are 34 of the 100 weight and are not measured here at all.
   * On the certified grades to hand they run 75 to 100 even on a template, so they are usually
   * fine - which is exactly why an agent would never think to check them.
   */
  if (!o.flattery && o.overall >= 80) {
    L.push('');
    L.push('A HIGH NUMBER HERE IS NOT A DONE SIGNAL.');
    L.push('  It is uncertified, it leaves out 34 of the 100 weight (content, technical foundations and AI');
    L.push('  readiness are not measured here at all), and its design half was judged by a model grading a');
    L.push('  build it was part of. Run the certified grade before calling the site finished.');
  }
  L.push('');
  for (const d of o.dimensions) {
    // A dimension nothing was measured in scores 0 in the roll-up and is correctly EXCLUDED
    // from the denominator, but printing that 0 next to its label reads as "you scored zero on
    // content" when the truth is "nobody looked". Say which it is.
    const cell = d.measured === 0 ? '  -' : String(d.score).padStart(3);
    const of = d.measured === 0 ? 'NOT MEASURED' : `${d.measured} of ${d.total} checks`;
    L.push(`  ${cell}  ${d.label} (weight ${d.weight}, ${of})`);
  }
  if (o.caps.length) {
    L.push('');
    for (const c of o.caps) L.push(`  CAPPED at ${c.cap}: ${c.reason}`);
  }
  if (o.taste?.applicable) {
    L.push('');
    L.push(`  appearance head: percentile ${o.taste.percentile} of ${o.taste.corpus?.n ?? '?'} library references (raw ${o.taste.raw})`);
  }
  if (o.ladder.applicable) L.push(`  design ladder:   ${o.ladder.rung} against ${o.ladder.results.map((r) => r.slug).join(', ')}`);
  L.push('');
  L.push('TOP GAPS, ranked by points recoverable:');
  for (const f of o.findings.slice(0, 6)) L.push(`  - ${f.label} (worth ${f.recoverable} pts): ${String(f.detail ?? '').slice(0, 160)}`);
  if (o.unmeasured.length) {
    L.push('');
    L.push('NOT MEASURED (dropped from the denominator, not scored zero):');
    for (const u of o.unmeasured) L.push(`  - ${u}`);
  }
  L.push('');
  L.push(`written to ${RESULT_FILE}`);
  L.push('');
  L.push(NOT_CERTIFIED);
  return L.join('\n');
}

// Exported for the test suite. The flattery band is the one piece of judgement in this file
// that is not the rubric's, so it is the one piece that has to be pinned by tests.
export { flatteryOf, FLATTERY_TASTE_FLOOR, FLATTERY_OVERSCORE };

// --------------------------------------------------------------------- main ----
// Only when run directly, so the module can be imported for testing without grading anything.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Sets process.exitCode and unwinds; it never calls process.exit(). See GradeFailure above.
if (isMain) try {
  if (args.judgements != null) await phaseScore();
  else if (args.url) await phaseRequest();
  else {
    console.error(
      [
        'grade-local.mjs - a full Palate grade on your own machine, free. A SELF-CHECK, not a certified grade.',
        '',
        '  Phase 1:  node grade-local.mjs --url https://example.com [--vertical health] [--no-vitals true]',
        '  Phase 2:  node grade-local.mjs --judgements <file>   (or --judgements none to score without the ladder)',
        '',
        'Options:',
        '  --out <dir>          where to write artefacts (default .palate-shots)',
        '  --pack <file>        a palate_grade_pack result, if you called the tool yourself',
        '  --taste <file>       a palate_taste_score result, if you called the tool yourself',
        '  --not-independent    declare the swapped comparisons were judged in one context',
        '',
        NO_TOKEN_REMEDY,
      ].join('\n'),
    );
    process.exitCode = 2;
  }
} catch (e) {
  if (e instanceof GradeFailure) {
    console.error(`\nLOCAL GRADE FAILED: ${e.message}`);
    if (e.remedy) console.error(e.remedy);
  } else {
    console.error(`\nLOCAL GRADE FAILED: ${e?.stack ?? e}`);
  }
  process.exitCode = 1;
} finally {
  await disposeTaste();
}
