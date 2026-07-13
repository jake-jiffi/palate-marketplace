#!/usr/bin/env node
/**
 * screenshot-build.mjs - the local-preview screenshot driver for the VISUAL LOOP.
 *
 * Co-located under scripts/reference-capture/ so it reuses the SAME installed
 * Playwright as capture.mjs - no new npm dependency, no new install step. It is a
 * SEPARATE script (not a flag on capture.mjs) for exactly one reason: capture.mjs
 * refuses localhost (its SSRF guard), and this script's whole job is to shoot a
 * locally-served build at http://localhost:PORT. It does NOT import isInternalTarget.
 *
 * It drives a real headless Chromium over a served build and writes retina (2x)
 * full-page desktop + mobile PNGs, optional per-section clips keyed by
 * data-section-id (so a defect can be named precisely, e.g. "v1-hero mobile"),
 * a console-error log, and its OWN sibling artefact manifest. The palate-verifier
 * then Reads the PNGs and scores them against references/visual-rubric.md.
 *
 * It NEVER decides pass/fail and NEVER writes build-manifest.json - it only
 * captures artefacts. The pass/fail is computed downstream by the verifier + the
 * done-gate from these artefacts (anti-reward-hacking: no LLM boolean in the loop).
 *
 * Built to run UNATTENDED: any failure leaves a manifest with a status and a clean
 * exit 0, so the loop can read what happened rather than crashing the build.
 *
 * Usage:
 *   node screenshot-build.mjs --url <http://localhost:PORT> --out <dir> [--label v1] [--sections]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------- config ----
// Reused verbatim from capture.mjs: only desktop + mobile (the two the rubric
// judges - desktop reads, mobile is where the hero most often fails).
const VIEWPORTS = {
  mobile:  { width: 390,  height: 844 },
  desktop: { width: 1440, height: 900 },
};
// Same launch discipline as capture.mjs. The sandbox stays ON by default; this
// driver targets a trusted local server, but the flag exists for contained CI.
// GPU off is the FAST default (most builds have no WebGL); --disable-software-
// rasterizer also kills CPU WebGL, so a Three.js / R3F / WebGL hero paints blank
// here. main() detects a <canvas> hero and relaunches once under WEBGL_ARGS.
const GPU_OFF_ARGS = ['--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'];
// Software-WebGL (ANGLE + SwiftShader). --use-angle=swiftshader-webgl AND
// --enable-unsafe-swiftshader are BOTH required on current (post-Chrome-139)
// Chromium, where the automatic SwiftShader WebGL fallback was removed; the
// fast args above are dropped so a WebGL context can actually create.
const WEBGL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
function makeLaunch(webgl) {
  const args = (webgl ? WEBGL_ARGS : GPU_OFF_ARGS).slice();
  if (process.env.PALATE_CAPTURE_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  return {
    headless: true,
    channel: 'chromium', // the full Chromium build; the headless_shell segfaults in-sandbox
    args,
  };
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NAV_TIMEOUT = 30000;

// Freeze motion before the screenshot so the shot shows the settled state, not a
// blurred mid-animation frame. Verbatim from capture.mjs.
const FREEZE_CSS = '*,*::before,*::after{' +
  'animation:none !important;transition:none !important;' +
  'animation-play-state:paused !important;scroll-behavior:auto !important;' +
  'caret-color:transparent !important}';

const log = (...m) => console.log('[shot]', ...m);

// ------------------------------------------------------------------ args ----
function parseArgs(argv) {
  const a = { url: '', out: '', label: '', sections: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--label') a.label = argv[++i];
    else if (k === '--sections') a.sections = true;
  }
  if (!a.url || !a.out) {
    console.error('usage: node screenshot-build.mjs --url <http://localhost:PORT> --out <dir> [--label v1] [--sections]');
    process.exit(2);
  }
  if (!/^https?:\/\//.test(a.url)) a.url = 'http://' + a.url;
  // DELIBERATELY no isInternalTarget guard: this driver TARGETS localhost. That is
  // the single reason it is a separate script from capture.mjs.
  return a;
}

// ------------------------------------------------------------- behaviours ----
// dismissOverlays + autoScroll are reused verbatim from capture.mjs so a built
// site and a captured reference site behave identically under the lens.
async function dismissOverlays(page) {
  const labels = ['Accept all', 'Accept All', 'Accept', 'I agree', 'Agree',
    'Got it', 'Allow all', 'Allow cookies', 'OK', 'Close', 'No thanks'];
  for (const t of labels) {
    try {
      const el = await page.$(`button:has-text("${t}")`);
      if (el && await el.isVisible()) { await el.click({ timeout: 1000 }); await page.waitForTimeout(200); }
    } catch { /* ignore */ }
  }
}

async function autoScroll(page, maxMs) {
  // Step down the page to trigger lazy content, data-animate reveals and Lenis,
  // then return to top. Verbatim from capture.mjs.
  try {
    await page.evaluate(async (cap) => {
      await new Promise(resolve => {
        let total = 0; const step = Math.round(window.innerHeight * 0.9);
        const timer = setInterval(() => {
          window.scrollBy(0, step); total += step;
          if (total >= document.body.scrollHeight + window.innerHeight) { clearInterval(timer); resolve(); }
        }, 110);
        setTimeout(() => { clearInterval(timer); resolve(); }, cap);
      });
    }, maxMs);
  } catch { /* ignore */ }
  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch {}
  await page.waitForTimeout(450);
}

// Find every section + its data-section-id (emitted by SectionMark.astro in
// Explore mode). Falls back to the element index when no id is present, so a
// composed (non-Explore) page is still clipped per section.
// Tag each section in-page with a stable, unique data-ss-shot id (deduped) and
// return the ids. We then screenshot each element by handle, which Playwright
// scrolls into view and clips to, so below-fold sections capture correctly (the
// old clip-rect approach clipped against the viewport and failed past the fold).
async function tagSections(page) {
  try {
    return await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('main > section, [data-section-id], main > div > section'));
      const seen = new Set();
      const ids = [];
      let idx = -1;
      for (const el of els) {
        idx++;
        if (seen.has(el)) continue;
        seen.add(el);
        const mark = el.querySelector('[data-section-id]') || (el.matches('[data-section-id]') ? el : null);
        let sid = (mark && mark.getAttribute('data-section-id')) || el.getAttribute('data-section-id') || String(idx);
        sid = sid.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || String(idx);
        let uniq = sid, n = 1;
        while (ids.includes(uniq)) uniq = `${sid}-${n++}`;
        el.setAttribute('data-ss-shot', uniq);
        ids.push(uniq);
      }
      return ids;
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------- one viewport, one shot ----
async function shootViewport(browser, args, manifest, name) {
  const vp = VIEWPORTS[name];
  // deviceScaleFactor: 2 for retina PNGs (capture.mjs omits this) - so the
  // verifier reads crisp pixels and a ~2880px-wide desktop shot proves the 2x.
  const ctx = await browser.newContext({ viewport: vp, userAgent: UA, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // Console + page-error capture BEFORE goto. A thrown build is an automatic
  // visual fail downstream; the loop reads errors.json + manifest.console_errors.
  page.on('console', m => { if (m.type() === 'error') manifest.console_errors_list.push({ viewport: name, text: m.text() }); });
  page.on('pageerror', e => manifest.console_errors_list.push({ viewport: name, text: String(e) }));

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  } catch (e) {
    manifest.notes.push(`${name} nav warning: ` + (e.message || String(e)).split('\n')[0]);
  }
  await page.waitForTimeout(1200);
  await dismissOverlays(page);
  await autoScroll(page, 6000); // triggers data-animate reveals + Lenis, then returns to top

  // Detect a WebGL / canvas hero (a substantial <canvas>), mirroring the rendered
  // gate's signal (verify-rendered.mjs). When present the GPU-off shot is blank,
  // so main() relaunches once under software WebGL and re-shoots. The health read
  // (renderer string) lets the verifier tell a software-rendered hero from a
  // genuinely broken one rather than just "blank".
  const glProbe = await page.evaluate(() => {
    let hero = false, renderer = '';
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width > 200 && r.height > 160) {
        hero = true;
        try {
          const ctx = c.getContext('webgl2') || c.getContext('webgl');
          const dbg = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
          if (dbg) renderer = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        } catch { /* context already owned by the app */ }
        break;
      }
    }
    return { hero, renderer };
  }).catch(() => ({ hero: false, renderer: '' }));
  if (glProbe.hero) {
    manifest.webgl = { detected: true, viewport: name, renderer: glProbe.renderer || null,
      software: /swiftshader|angle/i.test(glProbe.renderer) };
  }

  // Tag the sections from the settled, scrolled state BEFORE freezing.
  let sids = [];
  if (args.sections) sids = await tagSections(page);

  // Page-level horizontal overflow: the whole document wider than the viewport means
  // something spilled (a too-wide row, an uncapped element). Almost never intentional at
  // the document level (intentional horizontal scroll is a CONTAINED element with its own
  // overflow), so it is a low-FP deterministic "broken layout" signal the done gate reads.
  try {
    manifest.overflow[name] = await page.evaluate(() => Math.max(0,
      Math.round(document.documentElement.scrollWidth - window.innerWidth)));
  } catch { /* a probe failure is not fatal; absence reads as "could not verify" downstream */ }

  // Freeze motion, then shoot the full page.
  try { await page.addStyleTag({ content: FREEZE_CSS }); } catch {}
  await page.waitForTimeout(350);

  const fullPath = join(args.out, `${name}-full.png`);
  try {
    await page.screenshot({ fullPage: true, path: fullPath, timeout: 15000 });
    manifest.shots[`${name}_full`] = `${name}-full.png`;
    if (!manifest.viewports.includes(name)) manifest.viewports.push(name);
  } catch (e) {
    manifest.notes.push(`${name} full-page shot failed: ` + (e.message || String(e)).split('\n')[0]);
  }

  // Per-section clips, keyed by data-section-id (or index). A defect can then
  // name "v1-hero mobile" precisely.
  if (args.sections && sids.length) {
    const secDir = join(args.out, name);
    mkdirSync(secDir, { recursive: true });
    for (const sid of sids) {
      try {
        const h = await page.$(`[data-ss-shot="${sid}"]`);
        if (!h) continue;
        const bb = await h.boundingBox();
        if (!bb || bb.width < 8 || bb.height < 8) continue;
        // Element screenshot scrolls the element into view and clips to it, so it
        // works for sections below the fold (a viewport clip rect does not).
        await h.screenshot({ path: join(secDir, `${sid}.png`), timeout: 12000 });
        // The section's focal element (largest heading, else the largest CTA) as a
        // normalised centre WITHIN the section box, for the composition floor
        // (measure-composition.mjs): is the most important thing where attention lands?
        const focal = await h.evaluate((el) => {
          const er = el.getBoundingClientRect();
          if (er.width < 1 || er.height < 1) return null;
          let best = null, bestA = 0;
          const pick = (sel) => { for (const c of el.querySelectorAll(sel)) { const r = c.getBoundingClientRect(); const a = r.width * r.height; if (a > bestA && r.width > 0 && r.height > 0) { bestA = a; best = r; } } };
          pick('h1,h2,h3');
          if (!best) pick('a,button,[role="button"]');
          if (!best) return null;
          return {
            cx: Math.round((((best.left + best.width / 2) - er.left) / er.width) * 1000) / 1000,
            cy: Math.round((((best.top + best.height / 2) - er.top) / er.height) * 1000) / 1000,
          };
        }).catch(() => null);
        // The section's own horizontal overflow (content wider than its box), excluding a
        // deliberate scroller (overflow-x:auto/scroll). Catches a row too wide for its
        // column even when the page itself does not scroll. Sub-pixel noise ignored downstream.
        const overflow = await h.evaluate((el) => {
          const cs = getComputedStyle(el);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return 0;
          return Math.max(0, Math.round(el.scrollWidth - el.clientWidth));
        }).catch(() => 0);
        manifest.sections.push({ viewport: name, sid, file: `${name}/${sid}.png`, focal, overflow });
      } catch (e) {
        manifest.notes.push(`${name} section ${sid} clip failed: ` + (e.message || String(e)).split('\n')[0]);
      }
    }
  }

  try { await ctx.close(); } catch {}
  return { webglDetected: glProbe.hero };
}

// -------------------------------------------------------------------- main ----
async function main() {
  const args = parseArgs(process.argv);
  mkdirSync(args.out, { recursive: true });

  const manifest = {
    tool: 'reference-capture/screenshot-build.mjs',
    url: args.url,
    label: args.label || null,
    capturedAt: new Date().toISOString(),
    status: 'pending',
    viewports: [],
    shots: {},          // { desktop_full, mobile_full }
    sections: [],       // [{ viewport, sid, file, overflow }]
    overflow: {},       // { [viewport]: page-level horizontal overflow px (content wider than the viewport) }
    console_errors: 0,
    console_errors_list: [],
    notes: [],
  };

  let webgl = false;
  let browser;
  try {
    browser = await chromium.launch(makeLaunch(webgl));
  } catch (e) {
    manifest.status = 'error';
    manifest.notes.push('browser launch failed: ' + (e.message || String(e)).split('\n')[0]);
    writeManifest(args.out, manifest);
    console.error('[shot] launch failed:', e.message);
    process.exit(0); // exit-0-always: the loop reads the manifest, never crashes the build
  }

  try {
    // Desktop first (it reads). If it carries a WebGL/canvas hero, the GPU-off
    // shot is blank, so relaunch ONCE under software WebGL and re-shoot desktop.
    // Detecting first keeps the slow SwiftShader path off the many non-WebGL builds.
    const det = await shootViewport(browser, args, manifest, 'desktop');
    if (det.webglDetected && !webgl) {
      manifest.notes.push('WebGL/canvas hero detected; re-capturing desktop under software WebGL (SwiftShader)');
      try { await browser.close(); } catch {}
      // The GPU-off desktop pass is thrown away; drop its console noise so it is
      // not double-counted (it ran before mobile, so the list is desktop-only here).
      manifest.console_errors_list.length = 0;
      webgl = true;
      browser = await chromium.launch(makeLaunch(webgl));
      await shootViewport(browser, args, manifest, 'desktop');
    }
    await shootViewport(browser, args, manifest, 'mobile');
    manifest.console_errors = manifest.console_errors_list.length;
    manifest.status = (manifest.shots.desktop_full || manifest.shots.mobile_full) ? 'captured' : 'error';
  } catch (e) {
    manifest.notes.push('capture exception: ' + (e.message || String(e)).split('\n')[0]);
    manifest.console_errors = manifest.console_errors_list.length;
    if (manifest.status === 'pending') manifest.status = 'error';
  } finally {
    try { await browser.close(); } catch {}
  }

  // errors.json is the loop's automatic-fail signal: any console error here =
  // visual fail, checked directly by the verifier and the done-gate.
  writeFileSync(join(args.out, 'errors.json'), JSON.stringify(manifest.console_errors_list, null, 2) + '\n');
  writeManifest(args.out, manifest);
  log(`done -> ${args.out} (${manifest.status}, ${manifest.console_errors} console error(s))`);
  process.exit(0); // always exit 0: never wedge a build over a screenshot
}

function writeManifest(outDir, m) {
  // Write the sibling artefact manifest the verifier reads. Drop the verbose
  // raw list from the persisted file's top level (it lives in errors.json).
  const persisted = { ...m };
  delete persisted.console_errors_list;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(persisted, null, 2) + '\n');
}

main();
