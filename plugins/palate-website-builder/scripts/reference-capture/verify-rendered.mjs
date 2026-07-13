#!/usr/bin/env node
/**
 * verify-rendered.mjs - the rendered, multi-viewport, real-motion gate for a BUILT site.
 *
 * The mechanical gate (ux-lint.sh) and the visual loop / reviewer pass read CODE / a
 * still. This one loads the RUNNING site in a real browser at phone / tablet / desktop
 * and asserts what only shows up when it renders. It extends the rendered gate
 * (no horizontal scroll, no console errors, no blank pages, a visible focus ring, a real
 * 404) with the BOLD-build bug-class checks from references/rendered-bug-classes.md:
 *
 *   (a) NO-JS / LCP-is-never-a-canvas: with JS disabled, the hero shows a FINISHED static
 *       state - no JS-dismissed preloader covering it, no blank <canvas> with no poster.
 *   (b) MOTION-ON reveal reaches the finished state: a REAL wheel scroll (JS on, motion
 *       on - NOT scrollTo, NOT reduced-motion) leaves 0 sections stuck at opacity:0.
 *       Reduced-motion forcing visibility MASKS this bug, so we test the default path.
 *   (c) PINNED scenes RELEASE: a pinned/fixed hero element does not overprint the footer.
 *   (f) HEAVY WebGL degrades on mobile: no above-the-fold <canvas> at 390 (the lazy-split
 *       in motion-and-3d.md Recipe 1b should serve a poster on touch/low-end).
 *
 * It lives beside capture.mjs so it reuses the same installed Playwright + Chromium.
 *
 * With --out set it also writes an ordered scroll-through FILMSTRIP for the home route at
 * mobile + desktop (<out>/filmstrip/<vp>-NN.png, viewport frames evenly spaced across the
 * scroll, captured from the SAME wheel-scroll pass - no second run). The verifier reads these
 * IN ORDER to judge motion choreography (purposeful vs absent / janky / gratuitous; restraint
 * counts) - the build-side analogue of the library's motionJudge, so the motion verdict rests
 * on the actual scroll, not a single still.
 *
 * Usage:
 *   node verify-rendered.mjs --url <base> [--routes /,/contact,/blog] [--out <dir>]
 *
 * Exit codes:
 *   0  clean (no finding at or above High)
 *   1  findings at or above High
 *   2  bad arguments
 *   3  a browser could not be launched - the gate is BLOCKED, never a pass
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

// ----------------------------------------------------------------- args ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const base = (args.url || '').replace(/\/+$/, '');
if (!base) { console.error('verify-rendered: --url <base> is required'); process.exit(2); }
const routes = (args.routes ? String(args.routes).split(',') : ['/', '/contact', '/blog'])
  .map((r) => r.trim()).filter(Boolean);
const outDir = args.out && args.out !== 'true' ? args.out : '';
if (outDir) mkdirSync(outDir, { recursive: true });

const VIEWPORTS = {
  mobile:  { width: 390,  height: 844  },
  tablet:  { width: 834,  height: 1112 },
  desktop: { width: 1440, height: 900  },
};
// Console / request noise that is not the build's fault (third-party, favicon).
const IGNORE = [/turnstile/i, /challenges\.cloudflare/i, /humblytics/i, /plausible/i, /google-analytics/i, /googletagmanager/i, /favicon/i];
const ignored = (s) => IGNORE.some((re) => re.test(s || ''));

const findings = [];
const add = (sev, route, vp, msg) => findings.push({ sev, route, vp, msg });
const RANK = { High: 3, Medium: 2, Cosmetic: 1 };
// OBJECTIVE, low-false-positive interaction failures for the enforce-on-evidence hook
// (hooks/palate-stop.mjs reads <proj>/.palate-shots/interaction.json and blocks on a
// non-empty list). Only the checks that rest on an explicit signal go here (a focusable
// visible control with no focus ring; an aria-expanded nav that never opens / won't dismiss);
// softer interaction signals stay advisory in findings[] for the verifier to judge.
const interactionFailures = [];

// --------------------------------------------------------------- launch ----
// GPU off is the FAST default. --disable-software-rasterizer also kills CPU
// WebGL, so a WebGL hero would render blank; the pre-detect below switches the
// audit to software WebGL only when the home route actually mounts a <canvas>.
const GPU_OFF_ARGS = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'];
// Software WebGL (ANGLE + SwiftShader). --use-angle=swiftshader-webgl AND
// --enable-unsafe-swiftshader are both required on current (post-Chrome-139)
// Chromium, where the automatic SwiftShader WebGL fallback was removed.
const WEBGL_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];

// One cheap pre-detect launch: does the home route mount a substantial <canvas>?
// If so the whole audit runs under software WebGL so its screenshots are truthful
// (the per-route assertions are GPU-agnostic). Detecting first keeps the slow
// software path off the many non-WebGL builds and the multi-route audit.
async function detectWebGL() {
  let b;
  try {
    b = await chromium.launch({ headless: true, channel: 'chromium', args: GPU_OFF_ARGS });
    const page = await (await b.newContext({ viewport: VIEWPORTS.desktop })).newPage();
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));
    return await page.evaluate(() => {
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.width > 200 && r.height > 160) return true;
      }
      return false;
    });
  } catch { return false; }
  finally { try { if (b) await b.close(); } catch {} }
}

let browser;
try {
  const webgl = await detectWebGL();
  if (webgl) console.error('verify-rendered: WebGL/canvas hero detected; running the audit under software WebGL (SwiftShader).');
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: webgl ? WEBGL_ARGS : GPU_OFF_ARGS,
  });
} catch (e) {
  console.error('verify-rendered: could not launch a browser (' + (e && e.message ? e.message : e) + ').');
  console.error('verify-rendered: run scripts/reference-capture/setup.sh, or run this gate where a browser is available. This is BLOCKED, not a pass.');
  process.exit(3);
}

// --------------------------------------------------------------- audit -----
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport: vp });
  for (const route of routes) {
    const page = await context.newPage();
    const errors = [];
    const webglChunkError = { hit: false };
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // "Failed to load resource" errors carry the URL in location(), not the text,
      // so check both before deciding it is the build's fault.
      const loc = (m.location && m.location().url) || '';
      if (ignored(m.text()) || ignored(loc)) return;
      errors.push('console error: ' + m.text());
    });
    page.on('pageerror', (e) => errors.push('page error: ' + (e && e.message ? e.message : e)));
    page.on('requestfailed', (r) => {
      if (ignored(r.url())) return;
      errors.push('request failed: ' + r.url());
      if (/three|webgl|r3f|fiber|drei/i.test(r.url())) webglChunkError.hit = true;
    });

    let status = 0;
    try {
      const resp = await page.goto(base + route, { waitUntil: 'load', timeout: 20000 });
      status = resp ? resp.status() : 0;
    } catch (e) {
      add('High', route, vpName, 'navigation failed: ' + (e && e.message ? e.message : e));
      await page.close();
      continue;
    }
    if (status >= 500) add('High', route, vpName, 'server returned ' + status);

    // Bug-class (b): a REAL wheel scroll down the page (JS on, motion on), then settle,
    // so reveal animations actually fire on the DEFAULT path - reduced-motion / scrollTo
    // both MASK a reveal stuck at opacity:0 (references/rendered-bug-classes.md).
    // On the home route at mobile + desktop, capture an ordered scroll-through filmstrip
    // from this SAME pass (no second run) so the verifier can judge motion CHOREOGRAPHY in
    // order, not from a single still (the motionJudge gap; see the header).
    let filmstrip = null;
    if (outDir && route === '/' && (vpName === 'mobile' || vpName === 'desktop')) {
      const fdir = outDir + '/filmstrip';
      mkdirSync(fdir, { recursive: true });
      filmstrip = { dir: fdir, prefix: vpName, max: 6 };
    }
    await realWheelScroll(page, filmstrip);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) add('High', route, vpName, 'horizontal scroll: content is ' + overflow + 'px wider than the viewport');

    const textLen = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0));
    if (textLen < 1) add('High', route, vpName, 'page renders blank (no text content)');

    // (b) MOTION-ON reveal reaches the finished state: count substantial elements still
    // fully transparent or hidden after the real wheel scroll. >0 = a reveal that never
    // fires for normal visitors (the 55-79%-hidden bug). Tested with JS ON + motion ON.
    const stuckHidden = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('section, main > *, [data-reveal], [data-animate], [class*="reveal"], article'));
      let stuck = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40) continue;            // ignore tiny nodes
        if ((el.innerText || '').trim().length < 8) continue;   // must carry content
        const s = getComputedStyle(el);
        const transparent = parseFloat(s.opacity || '1') < 0.02;
        const hidden = s.visibility === 'hidden';
        if (transparent || hidden) stuck++;
      }
      return stuck;
    });
    if (stuckHidden > 0) {
      add('High', route, vpName, 'motion-on reveal stuck: ' + stuckHidden + ' content section(s) remain at opacity:0 / visibility:hidden after a real wheel scroll (JS on, motion on). Reveal elements must REST at opacity:1 and animate FROM a transient state (references/rendered-bug-classes.md (b)).');
    }

    // (c) PINNED scene RELEASE: after scrolling to the bottom, no fixed/pinned element
    // that originated in the hero still covers the footer / last section.
    const overprint = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const vh = window.innerHeight, vw = window.innerWidth;
      // The footer / last content block, now in view at the bottom of the scroll.
      const last = document.querySelector('footer') || document.body.lastElementChild;
      const lr = last ? last.getBoundingClientRect() : null;
      if (!lr || lr.top >= vh || lr.bottom <= 0) return '';  // last block not in view => fine
      // rect-overlap test: is a fixed hero-scale element painting over the footer's box?
      const overlaps = (a, b) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      let culprit = '';
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed') continue;
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.02) continue;
        const r = el.getBoundingClientRect();
        if (r.height < vh * 0.25 || r.width < vw * 0.4) continue;     // must be hero-scale
        if ((el.innerText || '').trim().length < 8) continue;        // must carry content
        if (el.contains(last) || (last && last.contains(el))) continue; // not the footer itself
        if (overlaps(r, lr)) {
          culprit = (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          break;
        }
      }
      return culprit;
    });
    if (overprint) {
      add('High', route, vpName, 'pinned scene never releases: a fixed hero-scale element (' + overprint + ') overprints the footer / last section at the bottom of the page. A pinned ScrollTrigger must have a finite end + pinSpacing, or use position:sticky in a bounded container (references/rendered-bug-classes.md (c)).');
    }

    // (f) HEAVY WebGL must degrade on mobile: a <canvas> in the above-the-fold hero at
    // 390 means the lazy-split did not serve the poster on touch/low-end.
    if (vpName === 'mobile') {
      await page.evaluate(() => window.scrollTo(0, 0));
      const aboveFoldCanvas = await page.evaluate(() => {
        const vh = window.innerHeight;
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          if (r.top < vh && r.bottom > 0 && r.width > 64 && r.height > 64) return true;
        }
        return false;
      });
      if (aboveFoldCanvas) {
        add('High', route, vpName, 'heavy WebGL on mobile: an above-the-fold <canvas> renders at 390px. Gate the canvas to desktop + fine-pointer + motion and serve the static poster on touch/low-end (motion-and-3d.md Recipe 1b; references/rendered-bug-classes.md (f)).');
      }
      if (webglChunkError.hit) {
        add('High', route, vpName, 'a three.js / WebGL chunk failed to load on mobile - the heavy 3D bundle should not download on the mobile path at all.');
      }
    }

    for (const e of errors) add('High', route, vpName, e);

    // Focus ring: one real keyboard Tab should land on an element with a visible
    // outline (globals.css ships :focus-visible). Desktop only, heuristic -> Medium.
    if (vpName === 'desktop') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { focused: false };
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return { focused: true, visible };
      });
      if (ring.focused && !ring.visible) add('Medium', route, vpName, 'first tab-focused element has no visible focus ring');
    }

    if (outDir) {
      const name = vpName + (route === '/' ? '_home' : route.replace(/[^a-z0-9]+/gi, '_')) + '.png';
      await page.screenshot({ path: outDir + '/' + name, fullPage: true }).catch(() => {});
    }
    await page.close();
  }
  await context.close();
}

// (g) VIEW-TRANSITION navigation re-inits motion: client-side navigate by CLICKING an
// in-app link (Astro ClientRouter does a VT swap, not a fresh load), then assert the
// destination's scroll reveals fire. A not-VT-aware motion module (one that guards behind
// a boot-once flag) animates only the first page, so reveals on the swapped-in page stay
// stuck at opacity:0 - the "only the cinematic page animates" bug. Only fires when there
// is a second internal route to click; a site without client routing reloads and passes.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    const target = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href]')) {
        let u; try { u = new URL(a.href, location.href); } catch { continue; }
        if (u.origin === location.origin && u.pathname !== location.pathname && u.pathname !== '/' && !a.hash && !a.target) {
          a.setAttribute('data-vt-probe', '1'); // tag it so we click the right one regardless of href shape (relative / root-absolute / full)
          return u.pathname;
        }
      }
      return null;
    });
    if (target) {
      await page.click('a[data-vt-probe="1"]', { timeout: 5000 }).catch(() => {});
      await page.waitForFunction((p) => location.pathname === p, target, { timeout: 8000 }).catch(() => {});
      const navigated = await page.evaluate((p) => location.pathname === p, target);
      if (navigated) {
        await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
        await realWheelScroll(page);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
        const stuck = await page.evaluate(() => {
          let n = 0;
          for (const el of document.querySelectorAll('section, main > *, [data-reveal], [data-animate], [class*="reveal"], article')) {
            const r = el.getBoundingClientRect();
            if (r.width < 80 || r.height < 40) continue;
            if ((el.innerText || '').trim().length < 8) continue;
            const s = getComputedStyle(el);
            if (parseFloat(s.opacity || '1') < 0.02 || s.visibility === 'hidden') n++;
          }
          return n;
        });
        if (stuck > 0) add('High', target + ' (via client-nav)', 'desktop', stuck + ' reveal(s) stuck at opacity:0 / hidden after a View-Transition navigation (clicked an in-app link to ' + target + ', not a fresh load). Motion did not re-init on the swapped-in page: the motion module must re-arm its per-page recipes on astro:page-load, never guard behind a boot-once flag (src/lib/motion.ts setupPage; references/rendered-bug-classes.md).');
      }
    }
  } catch (e) {
    add('Medium', '(client-nav)', 'desktop', 'could not test View-Transition navigation: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

// (a) NO-JS / LCP-is-never-a-canvas: load the home route with JavaScript DISABLED and
// assert the hero shows a FINISHED static state - text is present, no fixed full-viewport
// overlay covers it (a JS-dismissed preloader), and the largest above-the-fold element is
// not a bare <canvas> with no sibling poster <img>. Desktop viewport.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    const nojs = await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const out = { text: 0, overlay: false, canvasHero: false, poster: false };
      out.text = (document.body && document.body.innerText ? document.body.innerText.trim().length : 0);
      // A fixed/absolute element covering most of the viewport with no JS to dismiss it
      // is a preloader stuck over the hero.
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.02) continue;
        if (s.position !== 'fixed' && s.position !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.width > vw * 0.9 && r.height > vh * 0.9 && r.top <= 1 && r.left <= 1) {
          // an opaque-ish full-screen cover near the top of the stack
          const bg = s.backgroundColor || '';
          const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
          if (opaque || parseFloat(s.opacity || '1') > 0.5) { out.overlay = true; break; }
        }
      }
      // A substantial above-the-fold <canvas> with no static poster <img> beside it:
      // with JS off the canvas is blank, so the hero LCP is blank unless a poster backs it.
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0 && r.width > 200 && r.height > 160) { out.canvasHero = true; break; }
      }
      if (out.canvasHero) {
        for (const img of document.querySelectorAll('img, picture img')) {
          const r = img.getBoundingClientRect();
          if (r.top < vh && r.bottom > 0 && r.width > 120 && r.height > 80) { out.poster = true; break; }
        }
      }
      return out;
    });
    if (nojs.text < 1) add('High', '/', 'no-js', 'with JavaScript disabled the page renders blank - the hero / LCP must be a finished static state (text + a static image/poster), never JS-dependent (references/rendered-bug-classes.md (a)).');
    if (nojs.overlay) add('High', '/', 'no-js', 'a full-viewport overlay (a preloader) covers the hero with JS disabled - preloaders must default HIDDEN and be SHOWN by JS (or guarded by html:not(.js)), never default-visible + JS-dismissed (references/rendered-bug-classes.md (a)).');
    if (nojs.canvasHero && !nojs.poster) add('High', '/', 'no-js', 'the hero LCP is a <canvas> with no static poster <img> - every WebGL hero ships a static poster behind the canvas as the LCP / no-JS / reduced-motion state (references/motion-and-3d.md; rendered-bug-classes.md (a)).');
  } catch (e) {
    add('Medium', '/', 'no-js', 'could not load the page with JS disabled: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

// 404: an unknown route must serve the branded 404 (a real state), not a 200 and not a
// blank host default.
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  let status = 0, textLen = 0;
  try {
    const resp = await page.goto(base + '/__verify_rendered_nonexistent', { waitUntil: 'load', timeout: 20000 });
    status = resp ? resp.status() : 0;
    textLen = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0));
  } catch { /* navigation issue is reported as the wrong-status finding below */ }
  if (status !== 404) add('High', '(unknown route)', 'desktop', 'unknown routes return ' + status + ', not 404 - add a custom src/pages/404.astro');
  else if (textLen < 20) add('Medium', '/404', 'desktop', '404 page is near-empty; give it on-brand copy and a link home');
  await context.close();
}

// INTERACTION states (home route, desktop): the rest of this gate reads a scroll + a settled
// still; this DRIVES a real pointer + keyboard the way a human triggers a state, so a deleted
// focus ring or a hover/expand nav that never opens is caught, not just described in the
// rubric. Two OBJECTIVE checks enforce (they rest on an explicit signal, so false positives
// are low): keyboard focus-visible traversal (WCAG 2.4.7) and an aria-expanded hover/expand
// nav (WCAG 1.4.13 open + Dismissible). Hover feedback stays ADVISORY (a hover can legitimately
// change a child element or only the cursor, so it cannot safely block).
{
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));

    // (1) Keyboard focus-visible. Snapshot each interactive element's RESTING style, Tab to it
    // with a REAL key (programmatic .focus() does not reliably match :focus-visible), and
    // assert the focused style DIFFERS from resting. ANY change counts as an indicator, so a
    // site that shows focus with a border or a background shift is NOT false-flagged; only an
    // element whose focused style is identical to resting has no indicator at all. A systematic
    // miss (>=2) is a deleted focus ring (WCAG 2.4.7), so it enforces.
    const SK = 'outlineStyle,outlineWidth,outlineColor,boxShadow,borderTopColor,borderTopWidth,borderBottomColor,backgroundColor,color,textDecorationLine';
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(2, 2); // park the pointer so hover does not contaminate the resting snapshot
    await page.evaluate((keysCsv) => {
      const keys = keysCsv.split(',');
      const els = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex],[role="button"]')).filter((el) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.01;
      }).slice(0, 40);
      window.__ixBase = {};
      els.forEach((el, i) => { el.setAttribute('data-ixf', String(i)); const s = getComputedStyle(el); window.__ixBase[i] = keys.map((k) => s[k]).join('|'); });
    }, SK);
    let noRing = 0, checked = 0; const noRingEg = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate((keysCsv) => {
        const keys = keysCsv.split(',');
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement || !el.getAttribute) return null;
        const id = el.getAttribute('data-ixf');
        if (id == null || !(window.__ixBase && id in window.__ixBase)) return { known: false };
        const s = getComputedStyle(el);
        const changed = keys.map((k) => s[k]).join('|') !== window.__ixBase[id];
        const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/)[0] : '';
        return { known: true, changed, label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls) };
      }, SK);
      if (!r || !r.known) continue;
      checked++;
      if (!r.changed) { noRing++; if (noRingEg.length < 3) noRingEg.push(r.label); }
    }
    if (noRing >= 2) {
      const msg = noRing + ' of ' + checked + ' keyboard-focusable elements show no visible change on focus (no outline, ring, border or background shift on :focus-visible), e.g. ' + noRingEg.join(', ') + '. Give focus a visible indicator (WCAG 2.4.7).';
      add('High', '/', 'desktop', 'focus indicator missing on keyboard traversal: ' + msg);
      interactionFailures.push({ route: '/', vp: 'desktop', check: 'focus-visible', msg });
    }

    // (2) Hover/expand nav dismissibility (WCAG 1.4.13). An aria-expanded control can be
    // click-triggered (the common case), so a hover that does not open it proves nothing and
    // is NOT flagged. We act only once hover has CONFIRMED opened it (aria-expanded flips
    // true): then it must be dismissible with Escape, without moving the pointer (1.4.13
    // Dismissible). A hover-opened disclosure Escape cannot close -> enforce. Low false
    // positive: it fires only on a genuinely hover-opened, non-dismissible menu.
    const navTrigger = await page.evaluate(() => {
      const t = document.querySelector('nav [aria-expanded="false"], header [aria-expanded="false"], [aria-haspopup="true"][aria-expanded="false"]');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      t.setAttribute('data-ix-nav', '1');
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (navTrigger) {
      await page.mouse.move(navTrigger.x, navTrigger.y, { steps: 12 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
      const openedOnHover = await page.evaluate(() => {
        const t = document.querySelector('[data-ix-nav="1"]');
        return !!t && t.getAttribute('aria-expanded') === 'true';
      });
      if (openedOnHover) {
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
        const dismissed = await page.evaluate(() => {
          const t = document.querySelector('[data-ix-nav="1"]');
          return !t || t.getAttribute('aria-expanded') !== 'true';
        });
        if (!dismissed) {
          const msg = 'a nav disclosure that opens on hover cannot be dismissed with Escape (WCAG 1.4.13 Dismissible: content shown on hover or focus must be dismissible without moving the pointer).';
          add('High', '/', 'desktop', 'hover nav not dismissible: ' + msg);
          interactionFailures.push({ route: '/', vp: 'desktop', check: 'nav-escape-dismiss', msg });
        }
      }
    }

    // (3) ADVISORY hover feedback: sample primary buttons / links, drive a REAL pointer to
    // each (CSS :hover only fires for a real pointer, not a synthetic event), and see if the
    // computed style shifts. Only flag when the WHOLE sample is dead - hover feedback via a
    // child element or the cursor is legitimate and not caught here, so this never enforces.
    const sample = await page.evaluate(() => {
      const pick = Array.from(document.querySelectorAll('button, a[href]')).filter((el) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 40 && r.height > 20 && r.top >= 0 && r.top < window.innerHeight && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.5 && (el.innerText || '').trim().length > 0;
      }).slice(0, 6);
      pick.forEach((el, i) => el.setAttribute('data-ix-h', String(i)));
      return pick.map((el) => { const r = el.getBoundingClientRect(); return { i: el.getAttribute('data-ix-h'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    });
    const snap = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null; const c = getComputedStyle(el);
      return [c.color, c.backgroundColor, c.borderColor, c.boxShadow, c.opacity, c.textDecorationLine, c.transform, c.filter, c.scale].join('|');
    }, sel);
    let deadHover = 0, hoverChecked = 0;
    for (const el of sample) {
      const sel = '[data-ix-h="' + el.i + '"]';
      await page.mouse.move(4, 4); // park the pointer off the element
      const before = await snap(sel);
      if (before == null) continue;
      await page.mouse.move(el.x, el.y, { steps: 8 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
      const after = await snap(sel);
      hoverChecked++;
      if (after === before) deadHover++;
    }
    if (hoverChecked >= 4 && deadHover === hoverChecked) {
      add('Medium', '/', 'desktop', 'no hover feedback: none of ' + hoverChecked + ' sampled buttons/links changed under a real hover (colour, shadow, transform). Give interactive elements hover feedback (advisory: feedback via a child element or the cursor is not detected here).');
    }
  } catch (e) {
    add('Medium', '(interaction)', 'desktop', 'interaction pass could not complete: ' + (e && e.message ? e.message : e));
  }
  await context.close();
}

await browser.close();

// Write the objective interaction failures for the enforce-on-evidence hook (palate-stop.mjs
// reads <proj>/.palate-shots/interaction.json). Only with --out; best-effort - the findings
// and the exit code below still stand without the artefact.
if (outDir) {
  try { writeFileSync(`${outDir}/interaction.json`, JSON.stringify({ interaction_failures: interactionFailures }, null, 2)); }
  catch { /* artefact is a convenience for the deterministic hook, never fatal */ }
}

// ------------------------------------------------------------- helpers -----
// A REAL wheel scroll to the bottom of the page (NOT scrollTo): this is what fires
// scroll-reveal / ScrollTrigger on the default motion path. scrollTo and reduced-motion
// both bypass the very code path the reveal bug lives in. When `capture` is set it also
// shoots an ordered viewport filmstrip across the scroll (up to capture.max frames, evenly
// spaced and including the top), so the SAME pass yields the motion-choreography evidence.
async function realWheelScroll(page, capture = null) {
  try {
    const total = await page.evaluate(() => document.body.scrollHeight);
    const vh = await page.evaluate(() => window.innerHeight);
    const steps = Math.max(4, Math.ceil(total / Math.max(200, vh * 0.7)));
    const stops = capture ? frameStops(steps, capture.max) : null; // scroll positions 0..steps to shoot
    let fi = 0;
    if (stops && stops.has(0)) await snapFrame(page, capture, fi++); // the top, before any scroll
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, Math.max(200, vh * 0.7));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 80)));
      if (stops && stops.has(i + 1)) await snapFrame(page, capture, fi++);
    }
  } catch { /* a page with no scroll is fine */ }
}

// Up to `max` evenly-spaced scroll positions in [0, steps] (inclusive of the top), so a
// long page is sampled across its whole descent and a short one just gets fewer distinct
// frames. Returns a Set of position indices.
function frameStops(steps, max) {
  const n = Math.min(max, steps + 1);
  const set = new Set();
  for (let i = 0; i < n; i++) set.add(Math.round((i * steps) / Math.max(1, n - 1)));
  return set;
}
// One ordered viewport frame (<prefix>-00.png, -01.png, ...). Viewport, NOT full-page: a
// filmstrip is what is ON SCREEN as you scroll, so the judge reads the choreography in order.
async function snapFrame(page, cap, i) {
  try { await page.screenshot({ path: `${cap.dir}/${cap.prefix}-${String(i).padStart(2, '0')}.png` }); }
  catch { /* a dropped frame is not fatal */ }
}

// --------------------------------------------------------------- report ----
findings.sort((a, b) => (RANK[b.sev] || 0) - (RANK[a.sev] || 0));
for (const f of findings) console.log(`${f.route} @${f.vp}  [${f.sev}]  ${f.msg}`);
const highest = findings.reduce((m, f) => Math.max(m, RANK[f.sev] || 0), 0);
console.error(`verify-rendered: ${findings.length} finding(s) across ${routes.length} route(s) x 3 viewports + the no-JS + 404 probes`);
process.exit(highest >= RANK.High ? 1 : 0);
