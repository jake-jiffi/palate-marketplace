#!/usr/bin/env node
/**
 * capture.mjs - Reference-site capture engine for the palate-website-builder skill.
 *
 * Drives a real headless Chromium over a top-tier website and extracts a deep,
 * structured, machine-readable record of how it is built: design tokens, the
 * type scale, motion specs, layout system, component anatomy, the DOM outline,
 * the framework/library stack, plus screenshots and a scroll filmstrip, and the
 * inline SVG assets. This is the raw material the curator (Claude) turns into
 * the human-readable reference notes.
 *
 * PHASES. The Cowork sandbox kills any process when its shell call returns, and
 * a shell call is capped near 45s, so a full multi-breakpoint capture cannot
 * run in one go. The capture is split into phases, each finishing inside one
 * call and writing its results to disk before exiting:
 *
 *   --phase desktop     (default) the analytical pass: desktop render, deep
 *                       extraction, all _capture/*.json, the digest, the SVG
 *                       assets, the desktop full-page shot + scroll filmstrip.
 *   --phase responsive  the mobile + tablet full-page screenshots; updates the
 *                       manifest written by the desktop phase.
 *   --phase full        everything in one process (use only off the sandbox).
 *
 * Built to run UNATTENDED: an unreachable URL produces a manifest with
 * status:"unreachable" and a clean exit 0; the deep extraction retries once if
 * the renderer crashes; so an overnight batch keeps going.
 *
 * Usage:
 *   node capture.mjs --slug <slug> --url <url> --out <dir> [--phase desktop|responsive|full] [--inner a,b]
 *
 * PLANNED EXTENSIONS (see references/reference-library/_meta/schema.md):
 * - Token confidence scoring. Each entry in _capture/tokens.raw.json should
 *   carry { value, confidence: "high"|"medium"|"low", context: "logo"|
 *   "primary-button"|"generic" } so the curator denoises faster. High =
 *   appears on a stable element (button bg, logo fill, body colour). Low =
 *   one-off background or decorative.
 * - Multi-page recurrence boosting. When --inner crawls additional pages,
 *   tokens that recur across pages get a "recurrence" count; the curator's
 *   tokens.json then prefers high-recurrence tokens for the canonical palette.
 * Both are additive (do not change the existing JSON shape, only extend it),
 * so older entries remain valid. Implement when there is time to validate
 * with real captures.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------- config ----
const VIEWPORTS = {
  mobile:  { width: 390,  height: 844  },
  tablet:  { width: 834,  height: 1112 },
  desktop: { width: 1440, height: 900  },
};
// The Chromium sandbox stays ON by default: this engine navigates to arbitrary
// external URLs, so disabling it is a real risk. Set PALATE_CAPTURE_NO_SANDBOX=1
// only in a contained environment that cannot run the sandbox (e.g. some CI),
// never against untrusted input on a workstation.
const LAUNCH_ARGS = ['--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer'];
if (process.env.PALATE_CAPTURE_NO_SANDBOX === '1') LAUNCH_ARGS.unshift('--no-sandbox');
const LAUNCH = {
  headless: true,
  channel: 'chromium', // the full Chromium build; the headless_shell segfaults in-sandbox
  args: LAUNCH_ARGS,
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NAV_TIMEOUT = 30000;
const ELEMENT_CAP = 2000;   // ceiling on the DOM walk - keeps the renderer inside memory
const SCHEMA_VERSION = 2;

// Injected before the screenshot pass: freezes all motion so a constantly
// animating page (e.g. a looping background) cannot crash the renderer
// mid-capture, and so screenshots show the settled state, not a blurred frame.
const FREEZE_CSS = '*,*::before,*::after{' +
  'animation:none !important;transition:none !important;' +
  'animation-play-state:paused !important;scroll-behavior:auto !important;' +
  'caret-color:transparent !important}';

// ------------------------------------------------------------------ args ----
function parseArgs(argv) {
  const a = { slug: '', url: '', out: '', inner: [], phase: 'desktop' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--slug') a.slug = argv[++i];
    else if (k === '--url') a.url = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--phase') a.phase = argv[++i];
    else if (k === '--inner') a.inner = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!a.slug || !a.url || !a.out) {
    console.error('usage: node capture.mjs --slug <slug> --url <url> --out <dir> [--phase desktop|responsive|full] [--inner a,b]');
    process.exit(2);
  }
  if (!/^https?:\/\//.test(a.url)) a.url = 'https://' + a.url;
  if (isInternalTarget(a.url)) {
    console.error('refusing to capture an internal / link-local / private target:', a.url);
    process.exit(2);
  }
  if (!['desktop', 'responsive', 'full'].includes(a.phase)) a.phase = 'desktop';
  return a;
}

// Block obvious SSRF-style targets (localhost, link-local, cloud metadata,
// RFC1918) before any navigation. Hostname-based: a best-effort guard against
// the easy cases, not a substitute for network isolation.
function isInternalTarget(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);    // strip IPv6 brackets
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) host = mapped[1];                                                // IPv4-mapped IPv6 -> re-check IPv4
  if (host.startsWith('::ffff:')) return true;                                 // hex IPv4-mapped IPv6 (e.g. ::ffff:7f00:1) the dotted regex above misses
  if (host === 'metadata.google.internal' || host === 'metadata' || host === 'metadata.goog') return true; // cloud metadata by DNS name (resolves to link-local)
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '169.254.169.254' || host.startsWith('169.254.')) return true; // link-local + metadata
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.startsWith('127.')) return true;                                    // loopback
  if (host.startsWith('10.')) return true;                                     // RFC1918
  if (host.startsWith('192.168.')) return true;                                // RFC1918
  const m = host.match(/^172\.(\d{1,3})\./);                                   // RFC1918 172.16-31
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (host.startsWith('fe80:')) return true;                                   // IPv6 link-local
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(host)) return true;                       // IPv6 unique-local fc00::/7
  return false;
}
const log = (...m) => console.log('[capture]', ...m);
const isUnreachable = msg => /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_INTERNET|ERR_ABORTED|ERR_SOCKET/i.test(msg);

// ------------------------------------------------------------- behaviours ----
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
  // Step down the page to trigger lazy content and motion, then return to top.
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

// ------------------------------------------------- in-page deep extraction ----
/* Runs INSIDE the browser. Returns a large plain-object snapshot of the page.
   Self-contained - it cannot see Node scope. `cap` bounds the DOM walk. */
function inPageExtract(cap) {
  const clamp = (s, n) => (s || '').toString().replace(/\s+/g, ' ').trim().slice(0, n);
  const seen = (map, k) => { if (!k) return; map[k] = (map[k] || 0) + 1; };
  const sortFreq = (map, n = 24) =>
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([value, count]) => ({ value, count }));

  // -- CSS custom properties (design tokens the site itself declares) --------
  const customProps = {};
  for (const scopeEl of [document.documentElement, document.body]) {
    const cs = getComputedStyle(scopeEl);
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (p.startsWith('--')) {
        const v = cs.getPropertyValue(p).trim();
        if (v && !(p in customProps)) customProps[p] = v.slice(0, 200);
      }
    }
  }

  // -- walk the DOM once, tallying everything -------------------------------
  const all = Array.from(document.querySelectorAll('*')).slice(0, cap || 3000);
  const colorFreq = {}, bgFreq = {}, radiusFreq = {}, shadowFreq = {},
        fontSizeFreq = {}, fontFamilyFreq = {}, fontWeightFreq = {},
        gapFreq = {}, transitionFreq = {}, lineHeightFreq = {}, letterSpacingFreq = {};
  let animatedAttrCount = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.color) seen(colorFreq, cs.color);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') seen(bgFreq, cs.backgroundColor);
    if (cs.borderRadius && cs.borderRadius !== '0px') seen(radiusFreq, cs.borderRadius);
    if (cs.boxShadow && cs.boxShadow !== 'none') seen(shadowFreq, clamp(cs.boxShadow, 90));
    if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') seen(gapFreq, cs.gap);
    const txt = (el.textContent || '').trim();
    if (txt.length > 1 && el.children.length === 0) {
      seen(fontSizeFreq, cs.fontSize);
      seen(fontFamilyFreq, clamp(cs.fontFamily, 160));
      seen(fontWeightFreq, cs.fontWeight);
      seen(lineHeightFreq, cs.lineHeight);
      if (cs.letterSpacing && cs.letterSpacing !== 'normal') seen(letterSpacingFreq, cs.letterSpacing);
    }
    if (cs.transitionDuration && cs.transitionDuration !== '0s') {
      seen(transitionFreq, `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`);
    }
    if (el.hasAttribute('data-scroll') || el.hasAttribute('data-aos') ||
        el.hasAttribute('data-animate') || el.hasAttribute('data-framer-name') ||
        /(^|\s)(animate|reveal|fade|gsap)/i.test(el.className?.toString?.() || '')) {
      animatedAttrCount++;
    }
  }

  // -- a numeric, de-duplicated type scale ----------------------------------
  const typeScale = [...new Set(Object.keys(fontSizeFreq))]
    .map(s => ({ px: parseFloat(s), raw: s }))
    .filter(o => o.px > 0)
    .sort((a, b) => a.px - b.px);

  // -- computed styles of representative elements ---------------------------
  const ROLES = {
    body: 'body', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4',
    paragraph: 'p', link: 'a[href]', nav: 'nav, header nav, [role=navigation]',
    header: 'header, [role=banner]', footer: 'footer, [role=contentinfo]',
    button: 'button, .button, [class*="btn" i], a[class*="button" i]',
    card: '[class*="card" i], article',
    section: 'main section, section', input: 'input, textarea',
  };
  const pick = ['display', 'position', 'color', 'backgroundColor', 'backgroundImage',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform',
    'padding', 'margin', 'borderRadius', 'border', 'boxShadow', 'gap', 'maxWidth', 'width',
    'opacity', 'transitionProperty', 'transitionDuration', 'transitionTimingFunction',
    'transform', 'backdropFilter', 'mixBlendMode', 'gridTemplateColumns', 'textDecoration'];
  const computed = {};
  for (const [role, sel] of Object.entries(ROLES)) {
    let el = null;
    try { el = document.querySelector(sel); } catch {}
    if (!el) continue;
    const cs = getComputedStyle(el);
    const rec = { selectorTried: sel, tag: el.tagName.toLowerCase(),
      classes: clamp(el.className?.toString?.() || '', 140) };
    for (const p of pick) {
      const v = cs[p];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') rec[p] = clamp(v, 160);
    }
    const r = el.getBoundingClientRect();
    rec.box = { w: Math.round(r.width), h: Math.round(r.height) };
    computed[role] = rec;
  }

  // -- the DOM section outline ----------------------------------------------
  const main = document.querySelector('main') || document.body;
  const outline = [];
  const blocks = main.querySelectorAll(':scope > *, :scope > div > section, :scope > section');
  for (const b of Array.from(blocks).slice(0, 40)) {
    const heading = b.querySelector('h1, h2, h3');
    const r = b.getBoundingClientRect();
    outline.push({
      tag: b.tagName.toLowerCase(),
      classes: clamp(b.className?.toString?.() || '', 110),
      heading: heading ? clamp(heading.textContent, 90) : null,
      headingTag: heading ? heading.tagName.toLowerCase() : null,
      height: Math.round(r.height),
      childCount: b.children.length,
      hasImg: !!b.querySelector('img, picture, video, canvas, svg'),
    });
  }

  // -- @font-face and @keyframes from same-origin stylesheets ---------------
  const fontFaces = [];
  const keyframes = new Set();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        fontFaces.push({
          family: (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(),
          weight: rule.style.getPropertyValue('font-weight') || '',
          style: rule.style.getPropertyValue('font-style') || '',
          src: clamp(rule.style.getPropertyValue('src'), 240),
        });
      } else if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name) {
        keyframes.add(rule.name);
      }
    }
  }

  // -- animation / framework library detection ------------------------------
  const w = window;
  const libs = {
    gsap: !!w.gsap || !!w.TweenMax || !!w.ScrollTrigger,
    scrollTrigger: !!(w.ScrollTrigger || (w.gsap && w.gsap.plugins && w.gsap.plugins.scrollTrigger)),
    lenis: !!w.Lenis || !!document.querySelector('[data-lenis],.lenis,html.lenis'),
    locomotive: !!w.LocomotiveScroll || !!document.querySelector('[data-scroll-container],[data-scroll]'),
    framerMotion: !!document.querySelector('[data-framer-name],[data-projection-id]'),
    aos: !!w.AOS || !!document.querySelector('[data-aos]'),
    barba: !!w.barba,
    three: !!w.THREE,
    swiper: !!w.Swiper || !!document.querySelector('.swiper'),
    splitting: !!w.Splitting || !!document.querySelector('[data-splitting],.char,.word'),
  };
  const framework = {
    next: !!w.__NEXT_DATA__ || !!document.querySelector('#__next,script#__NEXT_DATA__'),
    nuxt: !!w.__NUXT__ || !!document.querySelector('#__nuxt'),
    astro: !!document.querySelector('astro-island,[astro-island]') ||
           Array.from(document.querySelectorAll('link,script')).some(n => /(_astro\/|astro)/.test(n.href || n.src || '')),
    sveltekit: !!document.querySelector('[data-sveltekit-preload-data]'),
    gatsby: !!w.___gatsby || !!document.querySelector('#___gatsby'),
    webflow: document.documentElement.classList.contains('w-mod-js') || !!document.querySelector('[data-wf-page]'),
    remix: !!w.__remixContext,
    react: !!(w.React || document.querySelector('[data-reactroot]') || w.__REACT_DEVTOOLS_GLOBAL_HOOK__),
    vue: !!w.Vue || !!document.querySelector('[data-v-app]'),
  };

  // -- meta -----------------------------------------------------------------
  const metaOf = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
  const ogOf = p => (document.querySelector(`meta[property="og:${p}"]`) || {}).content || '';
  const meta = {
    title: clamp(document.title, 200),
    description: clamp(metaOf('description'), 320),
    generator: clamp(metaOf('generator'), 120),
    themeColor: metaOf('theme-color'),
    lang: document.documentElement.lang || '',
    ogTitle: clamp(ogOf('title'), 200),
    ogImage: ogOf('image'),
    viewport: metaOf('viewport'),
    linkCount: document.querySelectorAll('a[href]').length,
    imgCount: document.querySelectorAll('img').length,
    videoCount: document.querySelectorAll('video').length,
    canvasCount: document.querySelectorAll('canvas').length,
    svgCount: document.querySelectorAll('svg').length,
    h1: clamp((document.querySelector('h1') || {}).textContent, 160),
  };

  // -- container widths (layout system) -------------------------------------
  const widthFreq = {};
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.maxWidth && cs.maxWidth !== 'none' && /px/.test(cs.maxWidth)) seen(widthFreq, cs.maxWidth);
  }

  // -- inline SVG assets ----------------------------------------------------
  const svgs = [];
  const svgHashes = new Set();
  for (const svg of Array.from(document.querySelectorAll('svg')).slice(0, 120)) {
    const html = svg.outerHTML;
    if (html.length < 40 || html.length > 26000) continue;
    let h = 0; for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
    if (svgHashes.has(h)) continue;
    svgHashes.add(h);
    const r = svg.getBoundingClientRect();
    svgs.push({ html, w: Math.round(r.width), h: Math.round(r.height),
      cls: clamp(svg.className?.baseVal || svg.getAttribute('class') || '', 60) });
    if (svgs.length >= 28) break;
  }

  // -- nav links (the primary IA) -------------------------------------------
  const navEl = document.querySelector('nav, header nav, header');
  const navLinks = navEl ? Array.from(navEl.querySelectorAll('a[href]')).slice(0, 16)
    .map(a => clamp(a.textContent, 40)).filter(Boolean) : [];

  return {
    pageHeight: document.body.scrollHeight,
    customProps,
    frequency: {
      color: sortFreq(colorFreq), background: sortFreq(bgFreq),
      borderRadius: sortFreq(radiusFreq), boxShadow: sortFreq(shadowFreq),
      fontSize: sortFreq(fontSizeFreq, 30), fontFamily: sortFreq(fontFamilyFreq, 10),
      fontWeight: sortFreq(fontWeightFreq), lineHeight: sortFreq(lineHeightFreq, 14),
      letterSpacing: sortFreq(letterSpacingFreq, 10), gap: sortFreq(gapFreq, 16),
      maxWidth: sortFreq(widthFreq, 12), transition: sortFreq(transitionFreq, 22),
    },
    typeScale,
    computed,
    outline,
    fontFaces,
    keyframes: [...keyframes].slice(0, 60),
    libs, framework,
    animatedAttrCount,
    meta,
    navLinks,
    svgs,
  };
}

// ------------------------------------------------------------------ digest ----
function buildDigest(slug, url, snap, net) {
  const f = snap.desktop.frequency;
  const top = (arr, n = 6) => arr.slice(0, n).map(x => `${x.value} (${x.count})`).join(', ');
  const ts = snap.desktop.typeScale.map(t => t.raw).join(', ');
  const libsOn = Object.entries(snap.desktop.libs).filter(([, v]) => v).map(([k]) => k);
  const fwOn = Object.entries(snap.desktop.framework).filter(([, v]) => v).map(([k]) => k);
  return `# Capture digest - ${slug}

Source: ${url}
Captured: ${new Date().toISOString()}

## Stack
Framework signals: ${fwOn.join(', ') || 'none detected'}
Animation libraries: ${libsOn.join(', ') || 'none detected (likely CSS-native or bespoke)'}
Generator meta: ${snap.desktop.meta.generator || '(none)'}
Elements flagged as animated (data-attr / class): ${snap.desktop.animatedAttrCount}
CSS @keyframes defined: ${snap.desktop.keyframes.length} -> ${snap.desktop.keyframes.slice(0, 16).join(', ')}

## Colour
Most-used text colours: ${top(f.color)}
Most-used backgrounds: ${top(f.background)}
Declared CSS custom properties: ${Object.keys(snap.desktop.customProps).length}

## Typography
Font families in use: ${f.fontFamily.map(x => x.value).slice(0, 5).join(' | ')}
Observed type scale (px): ${ts}
Font weights: ${f.fontWeight.map(x => x.value).join(', ')}
Line-heights: ${top(f.lineHeight, 6)}
@font-face declarations: ${snap.desktop.fontFaces.length}

## Space & shape
Border-radius values: ${top(f.borderRadius, 8)}
Box-shadow values: ${snap.desktop.frequency.boxShadow.length} distinct
Flex/grid gap values: ${top(f.gap, 8)}
Container max-widths: ${top(f.maxWidth, 8)}

## Motion
Distinct CSS transitions: ${f.transition.length}
Top transitions: ${f.transition.slice(0, 6).map(x => x.value).join(' || ')}

## Structure
Section blocks in <main>: ${snap.desktop.outline.length}
Section headings: ${snap.desktop.outline.filter(o => o.heading).map(o => o.heading).slice(0, 14).join(' / ')}
Primary nav: ${snap.desktop.navLinks.join(', ')}

## Network
Total requests: ${net.total}; scripts: ${net.byType.script || 0}; stylesheets: ${net.byType.stylesheet || 0}; fonts: ${net.byType.font || 0}; images: ${net.byType.image || 0}
Third-party domains: ${net.domains.slice(0, 12).join(', ')}

## Assets captured
Inline SVGs saved: ${snap.desktop.svgs.length}
`;
}

// ----------------------------------------------------------- manifest io ----
function loadManifest(outDir, args) {
  const p = join(outDir, 'manifest.json');
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch {} }
  return {
    schemaVersion: SCHEMA_VERSION, slug: args.slug, url: args.url,
    capturedAt: new Date().toISOString(), status: 'pending',
    tool: 'reference-capture/capture.mjs', phasesRun: [],
    viewports: [], innerPages: args.inner, notes: [],
  };
}
const saveManifest = (outDir, m) =>
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(m, null, 2));

// ------------------------------------------------------- phase: desktop ----
async function runDesktop(browser, args, outDir, manifest) {
  const capDir = join(outDir, '_capture');
  const shotDir = join(outDir, 'assets', 'screenshots');
  const svgDir = join(outDir, 'assets', 'svg');
  for (const d of [capDir, shotDir, svgDir]) mkdirSync(d, { recursive: true });

  // Two passes in SEPARATE browser contexts. The deep extraction is the
  // crash-prone step on heavy animated pages, so it is isolated: a renderer
  // crash during extraction can never cost us the screenshots, and vice versa.
  let net = { total: 0, byType: {}, domains: new Set(), resources: [] };
  const netHandler = res => {
    try {
      net.total++;
      const t = res.request().resourceType();
      net.byType[t] = (net.byType[t] || 0) + 1;
      const host = new URL(res.url()).host;
      if (host && host !== new URL(args.url).host) net.domains.add(host);
      if (['script', 'stylesheet', 'font'].includes(t) && net.resources.length < 160)
        net.resources.push({ type: t, url: res.url().slice(0, 240), status: res.status() });
    } catch {}
  };

  // open a fresh desktop page at the URL and lazy-load it
  async function openDesktop(scrollMs, onResponse, reduceMotion) {
    const ctx = await browser.newContext({
      viewport: VIEWPORTS.desktop, userAgent: UA,
      reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    if (onResponse) page.on('response', onResponse);
    let unreachable = false;
    try {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (e) {
      const m = (e.message || String(e)).split('\n')[0];
      if (isUnreachable(m)) unreachable = true;
      else manifest.notes.push('desktop nav warning: ' + m);
    }
    await page.waitForTimeout(1400);
    await dismissOverlays(page);
    await autoScroll(page, scrollMs);
    return { ctx, page, unreachable };
  }

  const snap = { desktop: null, filmstripFrames: 0 };

  // ---- pass 1: screenshots ------------------------------------------------
  // Own context, reduced-motion + an animation-freeze stylesheet so a
  // constantly-animating page cannot crash the renderer mid-capture and the
  // shots show the settled state. One retry if the renderer dies anyway.
  for (let attempt = 1; attempt <= 2 && snap.filmstripFrames === 0; attempt++) {
    const a = await openDesktop(6500, null, true);
    if (a.unreachable) {
      manifest.status = 'unreachable';
      manifest.notes.push('desktop navigation failed (host unreachable)');
      saveManifest(outDir, manifest);
      try { await a.ctx.close(); } catch {}
      log('unreachable:', args.url);
      return false;
    }
    try { await a.page.addStyleTag({ content: FREEZE_CSS }); } catch {}
    await a.page.waitForTimeout(350);
    try {
      // viewport hero shot only - a full-page capture of a tall page is the
      // memory spike that crashes the renderer; the filmstrip covers the rest.
      await a.page.screenshot({ path: join(shotDir, 'desktop.png'), timeout: 9000 });
      let ph = VIEWPORTS.desktop.height * 4;
      try { ph = await a.page.evaluate(() => document.body.scrollHeight); } catch {}
      let frames = 0;
      for (let i = 0; i < 6; i++) {
        const y = Math.max(0, Math.round((ph - VIEWPORTS.desktop.height) * (i / 5)));
        await a.page.evaluate(yy => window.scrollTo(0, yy), y);
        await a.page.waitForTimeout(360);
        await a.page.screenshot({ path: join(shotDir, `scroll-${String(i).padStart(2, '0')}.png`), timeout: 8000 });
        frames++;
      }
      snap.filmstripFrames = frames;
    } catch (e) {
      manifest.notes.push(`screenshot pass attempt ${attempt} failed: ` + (e.message || String(e)).split('\n')[0]);
    }
    try { await a.ctx.close(); } catch {}
    if (snap.filmstripFrames === 0 && attempt < 2) await new Promise(r => setTimeout(r, 1200));
  }

  // ---- pass 2: deep extraction, fresh context, one retry ------------------
  let desktop = null;
  const innerOutlines = [];
  for (let attempt = 1; attempt <= 2 && !desktop; attempt++) {
    net = { total: 0, byType: {}, domains: new Set(), resources: [] };
    const b = await openDesktop(attempt === 1 ? 6000 : 4000, netHandler);
    if (b.unreachable) { try { await b.ctx.close(); } catch {} break; }
    try {
      log(`deep extraction (attempt ${attempt})...`);
      desktop = await b.page.evaluate(inPageExtract, ELEMENT_CAP);
    } catch (e) {
      manifest.notes.push(`extraction attempt ${attempt} failed: ` + (e.message || String(e)).split('\n')[0]);
    }
    if (desktop) {
      for (const path of args.inner.slice(0, 2)) {
        try {
          const ip = await b.ctx.newPage();
          const innerUrl = new URL(path, args.url).href;
          if (isInternalTarget(innerUrl)) { manifest.notes.push(`inner ${path} refused (internal target)`); await ip.close(); continue; }
          await ip.goto(innerUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
          await ip.waitForTimeout(1100);
          await dismissOverlays(ip);
          await autoScroll(ip, 3000);
          const slugPath = path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'page';
          await ip.screenshot({ path: join(shotDir, `inner-${slugPath}.png`), timeout: 9000 }).catch(() => {});
          const data = await ip.evaluate(inPageExtract, ELEMENT_CAP);
          innerOutlines.push({ path, url: innerUrl, outline: data.outline, meta: data.meta });
          await ip.close();
        } catch (e) {
          manifest.notes.push(`inner ${path} failed: ` + e.message.split('\n')[0]);
        }
      }
    }
    try { await b.ctx.close(); } catch {}
    if (!desktop && attempt < 2) await new Promise(r => setTimeout(r, 1500));
  }

  if (!desktop) {
    manifest.status = 'error';
    saveManifest(outDir, manifest);
    log('extraction failed after retry');
    return false;
  }
  snap.desktop = desktop;

  // write SVG assets
  desktop.svgs.forEach((s, i) => {
    const tag = (s.cls || 'svg').split(/\s+/)[0].replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'svg';
    writeFileSync(join(svgDir, `${String(i).padStart(2, '0')}-${tag}.svg`), s.html);
  });

  // write raw capture files
  const d = desktop;
  const netOut = { total: net.total, byType: net.byType,
    domains: [...net.domains].sort(), resources: net.resources };

  writeFileSync(join(capDir, 'tokens.raw.json'), JSON.stringify({
    customProperties: d.customProps,
    colour: d.frequency.color, background: d.frequency.background,
    borderRadius: d.frequency.borderRadius, boxShadow: d.frequency.boxShadow,
    gap: d.frequency.gap, maxWidth: d.frequency.maxWidth,
  }, null, 2));
  writeFileSync(join(capDir, 'typography.raw.json'), JSON.stringify({
    families: d.frequency.fontFamily, weights: d.frequency.fontWeight,
    sizes: d.frequency.fontSize, typeScale: d.typeScale,
    lineHeights: d.frequency.lineHeight, letterSpacing: d.frequency.letterSpacing,
    fontFaces: d.fontFaces,
  }, null, 2));
  writeFileSync(join(capDir, 'motion.raw.json'), JSON.stringify({
    libraries: d.libs, keyframes: d.keyframes,
    transitions: d.frequency.transition, animatedElementCount: d.animatedAttrCount,
  }, null, 2));
  writeFileSync(join(capDir, 'computed.json'), JSON.stringify(d.computed, null, 2));
  writeFileSync(join(capDir, 'layout.raw.json'), JSON.stringify({
    containerMaxWidths: d.frequency.maxWidth, gaps: d.frequency.gap,
    pageHeight: d.pageHeight,
    gridUsage: Object.values(d.computed).filter(c => c.gridTemplateColumns).length,
  }, null, 2));
  writeFileSync(join(capDir, 'structure.json'), JSON.stringify({
    home: { outline: d.outline, navLinks: d.navLinks, meta: d.meta },
    inner: innerOutlines,
  }, null, 2));
  writeFileSync(join(capDir, 'stack.json'), JSON.stringify({
    framework: d.framework, libraries: d.libs, network: netOut,
  }, null, 2));
  writeFileSync(join(capDir, 'digest.md'), buildDigest(args.slug, args.url, snap, netOut));

  manifest.status = 'captured';
  manifest.pageHeight = d.pageHeight;
  manifest.svgCount = desktop.svgs.length;
  manifest.filmstripFrames = snap.filmstripFrames;
  if (!manifest.viewports.includes('desktop')) manifest.viewports.push('desktop');
  manifest.detected = {
    framework: Object.entries(d.framework).filter(([, v]) => v).map(([k]) => k),
    libraries: Object.entries(d.libs).filter(([, v]) => v).map(([k]) => k),
  };
  saveManifest(outDir, manifest);
  log('desktop phase done ->', outDir);
  return true;
}

// ---------------------------------------------------- phase: responsive ----
async function runResponsive(browser, args, outDir, manifest) {
  const shotDir = join(outDir, 'assets', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  for (const name of ['mobile', 'tablet']) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[name], userAgent: UA });
    const page = await ctx.newPage();
    try {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await page.waitForTimeout(1300);
      await dismissOverlays(page);
      try { await page.addStyleTag({ content: FREEZE_CSS }); } catch {}
      await autoScroll(page, 4000);
      await page.screenshot({ path: join(shotDir, `${name}.png`), timeout: 9000 });
      if (!manifest.viewports.includes(name)) manifest.viewports.push(name);
      log(`${name} screenshot done`);
    } catch (e) {
      manifest.notes.push(`${name} failed: ` + e.message.split('\n')[0]);
    }
    await ctx.close();
  }
  if (manifest.status === 'pending') manifest.status = 'captured';
  saveManifest(outDir, manifest);
  return true;
}

// -------------------------------------------------------------------- main ----
async function main() {
  const args = parseArgs(process.argv);
  mkdirSync(args.out, { recursive: true });
  const manifest = loadManifest(args.out, args);
  if (!manifest.phasesRun) manifest.phasesRun = [];
  if (!manifest.notes) manifest.notes = [];
  if (!manifest.viewports) manifest.viewports = [];
  // the desktop phase starts a fresh run record; responsive appends to it
  if (args.phase === 'desktop' || args.phase === 'full') manifest.notes = [];

  let browser;
  try {
    browser = await chromium.launch(LAUNCH);
  } catch (e) {
    manifest.status = 'error';
    manifest.notes.push('browser launch failed: ' + e.message);
    saveManifest(args.out, manifest);
    console.error('[capture] launch failed:', e.message);
    process.exit(0);
  }

  try {
    if (args.phase === 'desktop' || args.phase === 'full') {
      const ok = await runDesktop(browser, args, args.out, manifest);
      if (ok && !manifest.phasesRun.includes('desktop')) manifest.phasesRun.push('desktop');
    }
    if ((args.phase === 'responsive' || args.phase === 'full') && manifest.status !== 'unreachable') {
      await runResponsive(browser, args, args.out, manifest);
      if (!manifest.phasesRun.includes('responsive')) manifest.phasesRun.push('responsive');
    }
    manifest.lastPhaseAt = new Date().toISOString();
    saveManifest(args.out, manifest);
  } catch (e) {
    manifest.status = manifest.status === 'captured' ? 'captured' : 'error';
    manifest.notes.push('capture exception: ' + (e.message || String(e)).split('\n')[0]);
    saveManifest(args.out, manifest);
    console.error('[capture] error:', e.message);
  } finally {
    try { await browser.close(); } catch {}
  }
  process.exit(0);
}

main();
