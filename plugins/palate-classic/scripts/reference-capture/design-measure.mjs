/**
 * design-measure.mjs - computed-style design measurement, shared by the plugin and the grader.
 *
 * THIS FILE IS VENDORED IN TWO REPOSITORIES AND MUST BE BYTE-IDENTICAL IN BOTH:
 *   canonical  ~/dev/palate/skill/scripts/reference-capture/design-measure.mjs
 *   vendored   palate-product/apps/grader/worker/src/design-measure.mjs
 *
 * Each repo carries a test asserting the SHA-256 below against its own copy, so editing one
 * without the other fails immediately and names the file to fix. The grader worker is a
 * standalone Fly deployable that does not carry the monorepo, and the skill ships as a git
 * plugin, so neither can import from a shared package without a publish cycle in the critical
 * path. Vendoring is the honest option; undetected vendoring is not. (This morning cost twelve
 * WCAG-failing hexes that had been fixed in one copy and left live in five others.)
 *
 * WHY THIS EXISTS. The grader scored design from regex over served HTML. On one plumber site
 * that reported "20 distinct type stacks", on another "could not read the type stack" - the same
 * detector, one page noisy and one blind, because the CSS was in an external stylesheet. The
 * default-accent probe fired on 0 of 14 template sites. All three checks were withdrawn rather
 * than shipped dishonestly, which left the dimension we claim authority over resting almost
 * entirely on one vision call.
 *
 * The fix is not a better regex. It is reading the RENDERED page, which both sides already have
 * open in Playwright and neither was using.
 *
 * TWO HALVES, deliberately split:
 *   collectDesignFacts()  runs INSIDE the browser. Self-contained by necessity: it is serialised
 *                         and evaluated in the page, so it closes over nothing in this module.
 *   scoreDesignFacts()    runs in node. Pure, synchronous, unit-testable without a browser.
 *
 * The split is what lets the skill block a local build and the grader score a stranger's site
 * from one definition of what good looks like.
 */

export const DESIGN_MEASURE_VERSION = '1.0.0';
// SHA-256 of this file with the hash value below blanked. Both repos assert it, and
// palate-product additionally diffs the two copies. See the header.
export const DESIGN_MEASURE_SHA = '9f8c5e65c3b69592f76e6b1bae00e19d7e96fea805263f762643ce3e9fdf35c8';

// ---------------------------------------------------------------- defaults ----
// Framework and AI-default accents, matched by PERCEPTUAL DISTANCE rather than exact hex.
// The old check tested `hex === '#6366F1'`, so it caught Tailwind indigo and missed #6265F0,
// which is the same colour to a human (deltaE 1.1) and the same tell to a reader.
export const DEFAULT_ACCENTS = [
  { hex: '#6366f1', name: 'Tailwind indigo-500, the single commonest AI-build accent' },
  { hex: '#4f46e5', name: 'Tailwind indigo-600' },
  { hex: '#3b82f6', name: 'Tailwind blue-500' },
  { hex: '#2563eb', name: 'Tailwind blue-600' },
  { hex: '#8b5cf6', name: 'Tailwind violet-500' },
  { hex: '#a855f7', name: 'Tailwind purple-500' },
  { hex: '#ec4899', name: 'Tailwind pink-500' },
  { hex: '#06b6d4', name: 'Tailwind cyan-500, the cyan-on-dark tell' },
  { hex: '#22d3ee', name: 'Tailwind cyan-400' },
  { hex: '#10b981', name: 'Tailwind emerald-500' },
  { hex: '#14b8a6', name: 'Tailwind teal-500' },
  { hex: '#0d6efd', name: 'Bootstrap 5 primary' },
  { hex: '#007bff', name: 'Bootstrap 4 primary' },
  { hex: '#1976d2', name: 'Material Blue 700' },
];

// Faces that read as unconsidered when they are the ONLY thing on the page. Not banned: the
// house rule is fit over familiarity, and a chosen face is never the fault. A page whose entire
// type stack is one of these has made no type decision at all, which is what this detects.
export const DEFAULT_FACES = [
  'inter', 'roboto', 'arial', 'helvetica', 'open sans', 'system-ui', '-apple-system',
  'segoe ui', 'noto sans', 'lato', 'montserrat', 'poppins', 'space grotesk', 'nunito',
];

// ------------------------------------------------------------ browser half ----
/**
 * Runs in the page. Returns raw, un-judged numbers; every threshold lives in scoreDesignFacts
 * so the two sides can never disagree about what a measurement MEANS.
 *
 * Area-weighting is the reason this beats counting declarations. A palette with fourteen
 * declared colours where one covers 92% of the page is disciplined; four colours at 25% each
 * is not. Declarations cannot tell those apart and pixels can.
 */
export function collectDesignFacts() {
  const seen = { fonts: new Map(), sizes: new Map(), colours: new Map(), radii: new Map(), shadows: new Map(), borders: new Map() };
  const bump = (m, k, by) => { if (k) m.set(k, (m.get(k) || 0) + (by || 1)); };

  const toHex = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length > 3 && p[3] < 0.06) return null;              // effectively invisible
    return '#' + p.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  };

  const vw = window.innerWidth, vh = window.innerHeight;
  let textArea = 0, bodyTextChars = 0, bodyLineSum = 0, bodyLineN = 0;
  const failAA = []; let under44 = 0, controlCount = 0;
  let measureSum = 0, measureN = 0;

  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.06) continue;
    const area = r.width * r.height;

    // Own text only: counting a wrapper's innerText would attribute a whole section's
    // characters to its outermost div and drown the elements actually setting type.
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();

    if (own.length > 1) {
      const fam = (s.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      const px = Math.round(parseFloat(s.fontSize) || 0);
      bump(seen.fonts, fam, own.length);
      if (px) bump(seen.sizes, String(px), own.length);
      const col = toHex(s.color);
      if (col) bump(seen.colours, col, own.length * px);        // text weighted by ink, not box
      textArea += area;

      // Body copy: the 14-20px band, which is where measure and line-height actually matter.
      // Headings legitimately run tight and short and would poison both averages.
      if (px >= 14 && px <= 20 && own.length > 40) {
        const lh = parseFloat(s.lineHeight);
        if (lh && !Number.isNaN(lh)) { bodyLineSum += lh / px; bodyLineN++; }
        bodyTextChars += own.length;
        // Characters per line, from the rendered box and the real average glyph width.
        const perLine = r.width / (px * 0.5);
        if (perLine > 5 && perLine < 400) { measureSum += perLine; measureN++; }
      }
    }

    // Backgrounds carry the palette's weight. Capped at the viewport so one tall section
    // cannot outvote everything above the fold.
    const bg = toHex(s.backgroundColor);
    if (bg) bump(seen.colours, bg, Math.min(area, vw * vh) * 0.25);

    const rad = parseFloat(s.borderTopLeftRadius);
    if (rad > 0 && area > 400) bump(seen.radii, String(Math.round(rad)), 1);
    if (s.boxShadow && s.boxShadow !== 'none' && area > 400) bump(seen.shadows, s.boxShadow.slice(0, 60), 1);
    const bw = parseFloat(s.borderTopWidth);
    if (bw > 0 && area > 400) bump(seen.borders, String(Math.round(bw * 100) / 100), 1);

    // Tap targets. Only genuinely interactive, genuinely visible controls, and only the
    // element itself - a small <a> wrapping a large image is fine and must not fire.
    //
    // display:inline is EXEMPT, and this is WCAG 2.5.8's own exemption, not a softening: a
    // link inside a sentence is sized by the text around it, and demanding 44px there would
    // mean setting body copy at 44px or padding links until the paragraph falls apart.
    // Measured on our own homepage the distinction is the whole difference between a real
    // finding and noise - "See how it installs" is inline prose, the 41x29 inline-block nav
    // items beside it are real faults.
    const tag = el.tagName.toLowerCase();
    const interactive = tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || el.getAttribute('role') === 'button';
    if (interactive && s.display !== 'inline' && r.width > 0 && r.height > 0) {
      const hasBlockChild = Array.from(el.children).some((c) => { const cr = c.getBoundingClientRect(); return cr.height >= 44; });
      if (!hasBlockChild) {
        controlCount++;
        // TWO TIERS, because one produced no separation. 44px is WCAG 2.5.5 AAA and almost
        // every good site misses it: measured, Linear and our own homepage both bottomed out
        // at 0.10, which is the LCP-cap mistake again - a threshold that fires on everything
        // ranks nothing. 24px is 2.5.8 AA, the bar a site actually has to clear, so that is
        // what is scored and 44 is reported as the target it is.
        if (r.height < 24 || r.width < 24) failAA.push({ tag, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || '').trim().slice(0, 30) });
        else if (r.height < 44) under44++;
      }
    }
  }

  // Section padding, for the spacing ramp. Direct children of main/body are the real sections;
  // every nested div's padding would flood the sample with component-level values.
  const pads = [];
  // Widened after measuring: the original selector found nothing on our own Astro homepage,
  // where sections sit inside a wrapper rather than directly under main. Unreadable spacing
  // scores NA, so a too-narrow selector silently withdraws the check instead of failing it.
  const roots = document.querySelectorAll('main > *, main > * > section, body > section, body > div > section, section, [class*="section"]');
  for (const el of roots) {
    const s = getComputedStyle(el);
    for (const v of [s.paddingTop, s.paddingBottom]) {
      const n = Math.round(parseFloat(v) || 0);
      if (n >= 16) pads.push(n);
    }
  }

  // Sibling repetition: the row-of-identical-cards the doctrine has only ever described in
  // prose. Structural identity ALONE is not the fault, and measuring only that produced a
  // false positive on our own homepage against a legitimate four-item content grid.
  //
  // The tell is uniform structure carrying uniform, SHORT content: the icon-heading-sentence
  // card repeated because a template repeated it. A real content grid (products, articles,
  // case studies) shares structure by design and varies in what it says. So the run is only
  // recorded when its members are also close in text length and none of them says much.
  let maxIdenticalRun = 0, identicalWhere = '', identicalUniform = false;
  const sig = (el) => el.tagName + ':' + Array.from(el.children).map((c) => c.tagName).join(',');
  for (const parent of document.querySelectorAll('main *, body > *')) {
    const kids = Array.from(parent.children).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 60 && r.height > 60; });
    if (kids.length < 3) continue;
    let run = 1, best = 1, bestStart = 0, prev = sig(kids[0]), start = 0;
    for (let i = 1; i < kids.length; i++) {
      const cur = sig(kids[i]);
      if (cur === prev && cur.includes(',')) { run++; if (run > best) { best = run; bestStart = start; } }
      else { run = 1; start = i; }
      prev = cur;
    }
    if (best >= 3 && best > maxIdenticalRun) {
      const lens = kids.slice(bestStart, bestStart + best).map((c) => (c.innerText || '').trim().length);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const spread = mean > 0 ? Math.max(...lens.map((l) => Math.abs(l - mean))) / mean : 0;
      maxIdenticalRun = best;
      identicalWhere = (parent.className || parent.tagName || '').toString().slice(0, 60);
      identicalUniform = mean < 220 && spread < 0.45;   // short AND alike = template row
    }
  }

  // ---- AI-BUILD TELLS -------------------------------------------------------
  // The population arriving at the grader is increasingly coming off AI builders, and these
  // are the marks those tools leave. Measured across our own submissions against our own
  // builds: 90% carry the icon-card row, 50% a two-tone heading, 20% gradient text.
  //
  // REPORTED, NOT SCORED. A false positive here tells a real business its site looks
  // machine-made, which is the most damaging thing this report can get wrong, so these travel
  // as named evidence rather than as points.
  const tells = [];
  const shortT = (x) => x.length > 1 && x.length < 40;
  for (const h of document.querySelectorAll('h1, h2')) {
    const prev = h.previousElementSibling;
    if (prev) {
      const pt = (prev.innerText || '').trim(), ps = getComputedStyle(prev);
      if (shortT(pt) && !/\n/.test(pt) && parseFloat(ps.fontSize) < parseFloat(getComputedStyle(h).fontSize) * 0.6
          && (ps.textTransform === 'uppercase' || pt === pt.toUpperCase()) && /[a-z]/i.test(pt))
        tells.push({ rule: 'eyebrow-label', detail: `"${pt.slice(0, 32)}" above a heading` });
    }
    const hc = getComputedStyle(h).color;
    for (const sp of h.querySelectorAll('span, em, strong')) {
      if ((sp.innerText || '').trim() && getComputedStyle(sp).color !== hc) {
        tells.push({ rule: 'two-tone-heading', detail: `"${(h.innerText || '').trim().slice(0, 40)}"` }); break;
      }
    }
  }
  for (const el of document.querySelectorAll('*')) {
    const st = getComputedStyle(el), r = el.getBoundingClientRect();
    if (/gradient/.test(st.backgroundImage || '') && (st.webkitBackgroundClip === 'text' || st.backgroundClip === 'text') && (el.innerText || '').trim())
      tells.push({ rule: 'gradient-text', detail: `"${(el.innerText || '').trim().slice(0, 32)}" filled with a gradient` });
    if (r.top < 900 && r.height > 16 && r.height < 46 && r.width < 340
        && parseFloat(st.borderTopLeftRadius) >= r.height / 2 - 1 && shortT((el.innerText || '').trim())
        && [...el.children].some((c) => { const cr = c.getBoundingClientRect(); return cr.width > 3 && cr.width < 14 && Math.abs(cr.width - cr.height) < 3; }))
      tells.push({ rule: 'status-pill', detail: `"${(el.innerText || '').trim().slice(0, 32)}"` });

    // THE ICON-CARD ROW. Tightened from "3+ equal-width siblings", which matched every
    // legitimate grid and fired on 6 of 6 of our own builds. The actual tell is uniform
    // structure carrying an ICON, a SHORT heading and a SHORT body, repeated. A product or
    // article grid shares width but carries images and text of real and varying length.
    const kids = [...el.children].filter((c) => { const cr = c.getBoundingClientRect(); return cr.width > 150 && cr.height > 120; });
    if (kids.length >= 3) {
      const w = kids.map((c) => c.getBoundingClientRect().width);
      const uniform = Math.max(...w) - Math.min(...w) < 8;
      const card = (c) => {
        const icon = [...c.querySelectorAll('svg, i, [class*="icon"]')].some((g) => {
          const gr = g.getBoundingClientRect();
          return gr.width >= 14 && gr.width <= 72 && Math.abs(gr.width - gr.height) <= 8;
        });
        const heads = c.querySelectorAll('h2, h3, h4, h5');
        const txt = (c.innerText || '').trim();
        return icon && heads.length >= 1 && txt.length > 10 && txt.length < 260;
      };
      const cards = kids.filter(card);
      if (uniform && cards.length >= 3) {
        const lens = cards.map((c) => (c.innerText || '').trim().length);
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
        // Interchangeable, not merely aligned: the copy is the same length in every card.
        if (mean > 0 && Math.max(...lens.map((l) => Math.abs(l - mean))) / mean < 0.6)
          tells.push({ rule: 'icon-card-row', detail: `${cards.length} cards, each an icon with a heading and ~${Math.round(mean)} characters` });
      }
    }
  }
  const seenT = new Set();
  const tellsOut = tells.filter((t) => { const k = t.rule + '|' + t.detail; if (seenT.has(k)) return false; seenT.add(k); return true; }).slice(0, 10);

  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ v: k, w: Math.round(v) }));
  return {
    viewport: { w: vw, h: vh },
    fonts: top(seen.fonts, 12),
    sizes: top(seen.sizes, 20),
    colours: top(seen.colours, 24),
    radii: top(seen.radii, 12),
    shadows: top(seen.shadows, 12),
    borders: top(seen.borders, 10),
    pads,
    textArea: Math.round(textArea),
    bodyTextChars,
    lineHeightRatio: bodyLineN ? bodyLineSum / bodyLineN : null,
    measureChars: measureN ? measureSum / measureN : null,
    failAA: failAA.slice(0, 20),
    failAACount: failAA.length,
    under44,
    controlCount,
    maxIdenticalRun,
    identicalWhere,
    identicalUniform,
    tells: tellsOut,
  };
}

// -------------------------------------------------------------- colour maths ----
// CIEDE2000. Needed because perceptual distance is the whole upgrade: exact-hex matching is
// what made the old detector fire on 0 of 14 template sites.
function hexToLab(hex) {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
  r = lin(r); g = lin(g); b = lin(b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(hexA, hexB) {
  const [L1, a1, b1] = hexToLab(hexA), [L2, a2, b2] = hexToLab(hexB);
  const avgL = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2), avgCp = (C1p + C2p) / 2;
  const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
  let h1p = deg(Math.atan2(b1, a1p)); if (h1p < 0) h1p += 360;
  let h2p = deg(Math.atan2(b2, a2p)); if (h2p < 0) h2p += 360;
  const dhp = Math.abs(h1p - h2p) <= 180 ? h2p - h1p : h2p <= h1p ? h2p - h1p + 360 : h2p - h1p - 360;
  const avgHp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const dLp = L2 - L1, dCp = C2p - C1p, dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
  const T = 1 - 0.17 * Math.cos(rad(avgHp - 30)) + 0.24 * Math.cos(rad(2 * avgHp))
          + 0.32 * Math.cos(rad(3 * avgHp + 6)) - 0.2 * Math.cos(rad(4 * avgHp - 63));
  const SL = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCp, SH = 1 + 0.015 * avgCp * T;
  const RT = -2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)))
           * Math.sin(rad(60 * Math.exp(-Math.pow((avgHp - 275) / 25, 2))));
  return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
}

// A colour is "neutral" when it carries almost no chroma: greys, near-blacks, papers. Accent
// discipline is about the CHROMATIC colours, so counting neutrals would punish a page for
// having a text colour, a border and a background.
function isNeutral(hex) {
  const [, a, b] = hexToLab(hex);
  return Math.hypot(a, b) < 12;
}

// ----------------------------------------------------------------- node half ----
const clamp01 = (n) => Math.max(0, Math.min(1, n));
// Linear score between a good and a bad threshold, in either direction.
const band = (v, good, bad) => (good < bad ? clamp01((bad - v) / (bad - good)) : clamp01((v - bad) / (good - bad)));

/**
 * Turns raw facts into rubric check results. Returns the SAME shape the grader's runChecks
 * produces ({ id, raw, detail, lowConfidence }), so the grader can merge them straight in and
 * the plugin can gate on the identical numbers.
 *
 * `facts` is keyed by viewport: { desktop: {...}, mobile: {...} }. Mobile is required for the
 * responsive checks and, where both exist, desktop is the reference for palette and type.
 */
export function scoreDesignFacts(facts) {
  const d = facts.desktop || facts.mobile || null;
  const m = facts.mobile || null;
  const out = [];
  const put = (id, raw, detail, extra) => out.push({ id, raw: clamp01(raw), detail, lowConfidence: false, ...(extra || {}) });
  const na = (id, why) => out.push({ id, raw: null, applicable: false, detail: why, lowConfidence: true });

  if (!d) {
    for (const id of ['type_system_discipline', 'colour_accent_discipline', 'spacing_rhythm', 'component_detail_craft', 'responsive_integrity'])
      na(id, 'The rendered page could not be measured.');
    return out;
  }

  // ---- colour_accent_discipline -------------------------------------------
  // Two failures, scored separately then combined: reaching for a framework default, and
  // spreading the accent so wide that nothing is emphasised. Our own library doctrine states
  // it plainly (gitbook, 99.8): let the accent be punctuation, not atmosphere.
  const chromatic = d.colours.filter((c) => !isNeutral(c.v));
  const totalW = d.colours.reduce((a, c) => a + c.w, 0) || 1;
  // ONLY THE DOMINANT ACCENT IS TESTED AGAINST THE DEFAULTS, and that restraint is load-bearing.
  // Scanning the top eight chromatic colours against fourteen defaults is 112 comparisons at a
  // deltaE 8 radius, and on a rich palette something lands inside one by chance: it called
  // Linear's #02b8cc "Tailwind cyan-500" off a secondary gradient stop, when Linear's actual
  // brand blue is #5E6AD2 and Linear is a flagship in our own library. The claim we can defend
  // is about the colour a page LEADS with, so that is the only one we test.
  const lead = chromatic[0] || null;
  let defaultHit = null, defaultDist = 99;
  if (lead) {
    for (const def of DEFAULT_ACCENTS) {
      const dist = deltaE(lead.v, def.hex);
      if (dist < defaultDist) { defaultDist = dist; if (dist < 8) defaultHit = { used: lead.v, ...def, dist }; }
    }
  }
  // Distinct accent FAMILIES: two shades of one hue are one decision, not two.
  const families = [];
  for (const c of chromatic) if (!families.some((f) => deltaE(f.v, c.v) < 15)) families.push(c);
  const accentShare = chromatic.slice(0, 3).reduce((a, c) => a + c.w, 0) / totalW;

  // ONLY THE FRAMEWORK-DEFAULT HIT IS SCORED. Hue COUNT was scored in the first version of
  // this file and had to come out: measured against real sites it put Linear at 0.20 and
  // Stripe at 0.40, two of the best-designed pages on the web, while tailwindui.com scored
  // 0.90 for serving a page with no palette at all. Counting hues measures how RICH a palette
  // is, and rich is not worse. That is the same fault as the served-HTML detector this file
  // replaces, pointed in the opposite direction, and shipping it would have taught every
  // Palate build to flatten its palette to win a point.
  //
  // The hue count, the accent's share of the page and the nearest-default distance are all
  // still MEASURED and still travel to the report, where a reader can weigh them. They are
  // facts. They are not a verdict.
  if (!lead) {
    na('colour_accent_discipline', 'No chromatic colour carried meaningful area, so there is no accent to judge. A page with no palette is not a disciplined palette.');
  } else if (defaultHit) {
    put('colour_accent_discipline', 0.25,
      `The accent ${defaultHit.used} is ${defaultHit.name} (deltaE ${defaultHit.dist.toFixed(1)}, indistinguishable to a reader). It is the commonest single tell of a palette nobody chose.`,
      { measured: { lead: lead.v, families: families.length, accentShare: Math.round(accentShare * 100) / 100, nearestDefault: Math.round(defaultDist * 10) / 10 } });
  } else {
    put('colour_accent_discipline', 0.9,
      `The lead accent ${lead.v} sits deltaE ${defaultDist.toFixed(1)} from the nearest framework default, so it was chosen rather than inherited. ${families.length} accent ${families.length === 1 ? 'hue carries' : 'hues carry'} real area across ${Math.round(accentShare * 100)}% of the weighted page.`,
      { measured: { lead: lead.v, families: families.length, accentShare: Math.round(accentShare * 100) / 100, nearestDefault: Math.round(defaultDist * 10) / 10 } });
  }

  // ---- type_system_discipline ---------------------------------------------
  // Rendered faces, weighted by how much text each actually sets, so a face used once in a
  // footer does not count equally with the one setting every heading.
  const famsUsed = d.fonts.filter((f) => f.w > 40);
  const defaultOnly = famsUsed.length > 0 && famsUsed.every((f) => DEFAULT_FACES.some((x) => f.v.includes(x)));

  // THE SCALE IS HOW FEW SIZES CARRY THE PAGE, not how many exist anywhere on it.
  // A raw count punishes two things that are not faults: a fluid clamp() scale, which is the
  // technique the doctrine recommends, and the handful of one-off labels every real page has.
  // Counting the sizes needed to set 90% of the text is robust to both - a disciplined scale
  // covers it in four to six, and a page with no scale needs a dozen. Measured on our own
  // homepage the raw count said 17 (which read as damning) and the 90% figure says 6.
  const sizesRanked = [...d.sizes].sort((a, b) => b.w - a.w);
  const sizeTotal = sizesRanked.reduce((a, s) => a + s.w, 0) || 1;
  let acc = 0, sizeCount = 0;
  for (const s of sizesRanked) { acc += s.w; sizeCount++; if (acc / sizeTotal >= 0.9) break; }

  const lh = d.lineHeightRatio, measure = d.measureChars;
  // The DOMINANT mobile size, not the smallest. Taking the smallest reported 12px on our own
  // homepage off a handful of mono labels while 14px set 1,357 characters, which is both the
  // wrong number and the wrong element to send someone to fix.
  const mobileBody = m && m.sizes.length
    ? Number([...m.sizes].sort((a, b) => b.w - a.w)[0].v)
    : null;

  let tRaw = 1; const tNotes = [];
  if (defaultOnly) { tRaw -= 0.45; tNotes.push(`every face that sets real text is a system or framework default (${famsUsed.slice(0, 2).map((f) => f.v).join(', ')})`); }
  if (famsUsed.length > 3) { tRaw -= 0.2; tNotes.push(`${famsUsed.length} faces carry text where two is the discipline`); }
  if (sizeCount > 7) { tRaw -= 0.2; tNotes.push(`${sizeCount} sizes are needed to set 90% of the text, which is a scale nobody chose`); }
  if (lh != null && (lh < 1.35 || lh > 1.85)) { tRaw -= 0.15; tNotes.push(`body line-height is ${lh.toFixed(2)} (1.5 to 1.7 reads comfortably)`); }
  if (measure != null && (measure < 42 || measure > 96)) { tRaw -= 0.15; tNotes.push(`body measure averages ${Math.round(measure)} characters per line (50 to 80 is the readable band)`); }
  if (mobileBody != null && mobileBody < 16) { tRaw -= 0.2; tNotes.push(`body text renders at ${mobileBody}px on a phone, below the 16px floor`); }
  put('type_system_discipline', tRaw, tNotes.length
    ? `Measured on the rendered page: ${tNotes.join('; ')}.`
    : `${famsUsed.length} faces, ${sizeCount} sizes, line-height ${lh ? lh.toFixed(2) : 'n/a'}, measure ${measure ? Math.round(measure) : 'n/a'} characters. A type system somebody chose.`,
    { measured: { faces: famsUsed.length, sizes: sizeCount, lineHeight: lh, measure, mobileBody } });

  // ---- spacing_rhythm ------------------------------------------------------
  // A ramp, not a count. Twelve values that are all multiples of 8 is a system; four that
  // share no base is not, and the old check could not tell those apart.
  const pads = (d.pads || []).filter((p) => p >= 16);
  if (!pads.length) {
    na('spacing_rhythm', 'No section padding was readable on the rendered page.');
  } else {
    const uniq = [...new Set(pads)];
    if (uniq.length < 3) {
      // One or two values IS the ramp. Asking which base they sit on is meaningless, and the
      // arithmetic got it backwards: our own homepage sets every section from one clamp(), so
      // it reported "1 distinct value, 0% on a 0px ramp" and scored 0.35 for being consistent.
      put('spacing_rhythm', 0.95,
        `${uniq.length} section padding value${uniq.length === 1 ? '' : 's'} across the page (${uniq.join('px, ')}px). Consistent by construction.`,
        { measured: { distinct: uniq.length, base: null, onRamp: 100 } });
    } else {
      let bestBase = 0, bestFit = 0;
      for (const base of [4, 6, 8, 10, 12, 16]) {
        const fit = uniq.filter((p) => p % base === 0).length / uniq.length;
        if (fit > bestFit) { bestFit = fit; bestBase = base; }
      }
      const raw = clamp01(bestFit * 0.65 + band(uniq.length, 4, 14) * 0.35);
      put('spacing_rhythm', raw,
        bestBase
          ? `${uniq.length} distinct section padding values; ${Math.round(bestFit * 100)}% sit on a ${bestBase}px ramp.`
          : `${uniq.length} distinct section padding values sharing no common base, so the spacing was set per section rather than from a scale.`,
        { measured: { distinct: uniq.length, base: bestBase || null, onRamp: Math.round(bestFit * 100) } });
    }
  }

  // ---- component_detail_craft ---------------------------------------------
  // REPORTED, NOT SCORED, and this is the honest call rather than a gap.
  //
  // Counting radii and shadow depths ranks a rich component system below a plain one: Linear
  // uses twelve of each deliberately and scored 0.20 for it, behind a login page that had
  // none. The doctrine's actual claim is that the vocabulary should be CHOSEN and REUSED, and
  // a count cannot see the difference between twelve arbitrary radii and twelve deliberate
  // ones. The vision pass can, so it keeps this check and gets these numbers as evidence.
  //
  // The sibling-run measurement travels with it. A run of interchangeable cards is a real
  // tell our own anti-patterns name, but it fired on Linear's fifteen-item logo wall, and a
  // detector that cannot tell a logo wall from a template row must inform rather than judge.
  const radii = d.radii.length, shadows = d.shadows.length, borders = d.borders.length;
  const run = d.maxIdenticalRun || 0;
  // RECURRING LAYOUT PATTERNS, reported as evidence rather than as a verdict.
  //
  // These began as "AI-build tells" and the calibration killed that framing. Across 10 real
  // submissions, 8 Palate builds and 4 library flagships the same rules fire at similar rates
  // on all three populations, and the flagships are the proof: Linear trips two-tone-heading
  // and gradient-text, Stripe trips two-tone-heading and an icon-card row. Printing "your site
  // carries AI-build tells" on a page that shares a pattern with Stripe would discredit the
  // whole report the first time anyone checked.
  //
  // The separation that DOES work is appearance-level, not rule-level: the SigLIP taste head
  // cleared calibration at 46.5 points of separation. So these travel to the vision pass as
  // observations, and it decides whether the pattern was chosen or defaulted into.
  if (d.tells && d.tells.length) {
    const byRule = [...new Set(d.tells.map((t) => t.rule))];
    na('ai_build_tells',
      `Recurring layout patterns on the rendered page: `
      + d.tells.slice(0, 6).map((t) => `${t.rule} (${t.detail})`).join('; ')
      + `. NEUTRAL EVIDENCE FOR THE VISION PASS, NOT AN ACCUSATION. Measured 2026-08-06 across `
      + `10 real submissions, 8 Palate builds and 4 library flagships, these patterns fire at `
      + `similar rates on all three: Linear carries two-tone-heading and gradient-text, Stripe `
      + `carries two-tone-heading and an icon-card row. They are common web patterns that AI `
      + `builders also use, not marks that identify one. Only a vision judgement can tell a `
      + `considered use from a defaulted one, so this is handed to it rather than scored.`);
    out[out.length - 1].measured = { tells: d.tells, rules: byRule };
  }

  na('component_detail_craft',
    `Measured, for the vision pass to weigh: ${radii} corner radi${radii === 1 ? 'us' : 'i'}, ${shadows} shadow depth${shadows === 1 ? '' : 's'}, ${borders} border weight${borders === 1 ? '' : 's'}` +
    (run >= 3 ? `, and a run of ${run} structurally identical siblings${d.identicalUniform ? ' carrying short, near-identical text' : ' carrying varied content'}${d.identicalWhere ? ` in "${d.identicalWhere}"` : ''}` : ', no repeated sibling run') +
    '. A count cannot tell a chosen vocabulary from an accidental one, so this is evidence rather than a score.');
  out[out.length - 1].measured = { radii, shadows, borders, identicalRun: run, identicalUniform: !!d.identicalUniform };

  // ---- responsive_integrity ------------------------------------------------
  if (!m) {
    na('responsive_integrity', 'The page was not captured at a phone viewport.');
  } else {
    const aa = m.failAACount || 0, ctrls = m.controlCount || 0, soft = m.under44 || 0;
    // Scored on the SHARE of controls that miss the AA bar, not the raw count: a footer with a
    // hundred links is not worse than a landing page with four just for having more of them.
    const aaShare = ctrls ? aa / ctrls : 0;
    let rRaw = 1; const rNotes = [];
    if (aa > 0) {
      rRaw -= clamp01(aaShare / 0.25) * 0.55;
      const first = m.failAA && m.failAA[0];
      rNotes.push(`${aa} of ${ctrls} controls are under 24px, missing WCAG 2.5.8 AA${first ? ` (first: ${first.text || first.tag} at ${first.w}x${first.h})` : ''}`);
    }
    if (mobileBody != null && mobileBody < 16) { rRaw -= 0.25; rNotes.push(`body text sets at ${mobileBody}px, below the 16px floor`); }
    if (m.measureChars != null && m.measureChars > 60) { rRaw -= 0.15; rNotes.push(`${Math.round(m.measureChars)} characters per line, which is a desktop measure on a phone`); }
    // Reported, never scored: 44px is 2.5.5 AAA and most sites we admire miss it, so it is
    // guidance in the report rather than a number that ranks anything.
    const softNote = soft > 0 ? ` A further ${soft} clear 24px but sit under the 44px comfortable-target guideline.` : '';
    put('responsive_integrity', rRaw, rNotes.length
      ? `On a 390px phone: ${rNotes.join('; ')}. Mobile wants its own layout, not the desktop one reflowed.${softNote}`
      : `On a 390px phone: every control clears 24px, body text is 16px or larger, and the measure stays readable.${softNote}`,
      { measured: { failAA: aa, controls: ctrls, under44: soft, mobileBody, mobileMeasure: m.measureChars } });
  }

  return out;
}

/**
 * Convenience for a Playwright page: evaluate the collector in the page and return its facts.
 * Both callers use this so the serialisation is identical on each side.
 */
export async function measurePage(page) {
  return page.evaluate(`(${collectDesignFacts.toString()})()`);
}
