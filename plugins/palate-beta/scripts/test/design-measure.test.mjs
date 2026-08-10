/**
 * design-measure.mjs - the scoring half, which is pure and needs no browser.
 *
 * The assertions that matter are the ones about what this module REFUSES to score. Its first
 * version scored the count of accent hues, radii and shadow depths, and measured against real
 * sites that ranked Linear at 0.20 and Stripe at 0.40 while tailwindui.com scored 0.90 for
 * serving a page with no palette at all. Counting measures how rich a design system is, and
 * rich is not worse. Those tests exist so nobody re-adds it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deltaE, scoreDesignFacts, DESIGN_MEASURE_SHA } from '../reference-capture/design-measure.mjs';

const at = (r, id) => r.find((c) => c.id === id);
const facts = (over = {}, mOver = {}) => ({
  desktop: {
    viewport: { w: 1440, h: 900 },
    fonts: [{ v: 'simula', w: 1200 }, { v: 'satoshi', w: 4000 }],
    sizes: [{ v: '17', w: 4000 }, { v: '44', w: 400 }],
    colours: [{ v: '#f7f5ee', w: 90000 }, { v: '#0e0e12', w: 6000 }, { v: '#e2553d', w: 600 }],
    radii: [{ v: '2', w: 12 }], shadows: [], borders: [{ v: '1', w: 14 }],
    pads: [96, 96, 128, 64], lineHeightRatio: 1.62, measureChars: 68,
    maxIdenticalRun: 0, identicalUniform: false, ...over,
  },
  mobile: {
    viewport: { w: 390, h: 844 }, fonts: [], sizes: [{ v: '17', w: 3000 }], colours: [],
    radii: [], shadows: [], borders: [], pads: [], lineHeightRatio: 1.6, measureChars: 44,
    failAA: [], failAACount: 0, under44: 0, controlCount: 20, maxIdenticalRun: 0, ...mOver,
  },
});

test('CIEDE2000 is the real metric, which is the whole upgrade over exact-hex matching', () => {
  assert.ok(deltaE('#6366f1', '#6366f1') < 0.01, 'identity must be zero');
  assert.ok(Math.abs(deltaE('#ffffff', '#000000') - 100) < 0.5, 'white to black is the canonical 100');
  // The case the old detector missed: the same colour to a reader, a different string.
  assert.ok(deltaE('#6366f1', '#6265f0') < 2, 'a near-miss default must read as the default');
  assert.ok(deltaE('#6366f1', '#e2553d') > 20, 'a chosen accent must read as chosen');
});

test('a framework-default lead accent is caught and named', () => {
  const r = scoreDesignFacts(facts({ colours: [{ v: '#ffffff', w: 90000 }, { v: '#6265f0', w: 4000 }] }));
  const c = at(r, 'colour_accent_discipline');
  assert.equal(c.raw, 0.25);
  assert.match(c.detail, /Tailwind indigo/);
});

test('a chosen accent scores well however many other hues the page carries', () => {
  const rich = facts({ colours: [
    { v: '#f7f5ee', w: 90000 }, { v: '#e2553d', w: 4000 }, { v: '#2f6f4e', w: 3000 },
    { v: '#9aa088', w: 2500 }, { v: '#c8a02f', w: 2000 }, { v: '#7b4b8a', w: 1500 },
  ] });
  assert.equal(at(scoreDesignFacts(rich), 'colour_accent_discipline').raw, 0.9,
    'hue COUNT must never lower the score: it put Linear and Stripe below a page with no palette');
});

test('a page with no chromatic colour is unmeasured, not excellent', () => {
  const none = facts({ colours: [{ v: '#ffffff', w: 90000 }, { v: '#111111', w: 6000 }] });
  assert.equal(at(scoreDesignFacts(none), 'colour_accent_discipline').applicable, false);
});

test('component detail is reported as evidence and never scored', () => {
  const busy = facts({ radii: Array.from({ length: 12 }, (_, i) => ({ v: String(i), w: 3 })) });
  const c = at(scoreDesignFacts(busy), 'component_detail_craft');
  assert.equal(c.applicable, false, 'a count cannot tell a chosen vocabulary from an accidental one');
  assert.equal(c.measured.radii, 12, 'but the number still travels to the report');
});

test('mobile body size is the DOMINANT size, not the smallest', () => {
  // 14px sets the page; 12px is a handful of mono labels. Taking the smallest reported 12px
  // on our own homepage, which is both the wrong number and the wrong element to go fix.
  const r = scoreDesignFacts(facts({}, { sizes: [{ v: '14', w: 1357 }, { v: '12', w: 588 }] }));
  assert.equal(at(r, 'responsive_integrity').measured.mobileBody, 14);
});

test('tap targets are scored on WCAG 2.5.8 AA at 24px, not AAA at 44px', () => {
  const soft = scoreDesignFacts(facts({}, { failAACount: 0, under44: 30, controlCount: 40 }));
  assert.equal(at(soft, 'responsive_integrity').raw, 1,
    'a 44px miss must not lower the score: measured, it bottomed out Linear and our own homepage alike');
  const hard = scoreDesignFacts(facts({}, { failAACount: 10, controlCount: 40, failAA: [{ tag: 'a', w: 20, h: 20, text: 'Buy' }] }));
  assert.ok(at(hard, 'responsive_integrity').raw < 0.6, 'a 24px miss is a real conformance failure');
});

test('one padding value is consistency, not a missing ramp', () => {
  const c = at(scoreDesignFacts(facts({ pads: [157, 157, 157] })), 'spacing_rhythm');
  assert.ok(c.raw > 0.9, 'a single clamp() driving every section is discipline, and scored 0.35 before this');
});

test('what cannot be measured is unmeasured, never zero', () => {
  for (const c of scoreDesignFacts({})) assert.equal(c.applicable, false);
  assert.equal(at(scoreDesignFacts({ desktop: facts().desktop }), 'responsive_integrity').applicable, false,
    'no phone capture must not be charged to the site as a mobile failure');
});

test('the file matches its own declared hash, so a vendored copy cannot drift silently', () => {
  const src = readFileSync(new URL('../reference-capture/design-measure.mjs', import.meta.url), 'utf8');
  const bare = src.replace(/DESIGN_MEASURE_SHA = '[a-f0-9]{64}'/, `DESIGN_MEASURE_SHA = '${'0'.repeat(64)}'`);
  assert.equal(createHash('sha256').update(bare).digest('hex'), DESIGN_MEASURE_SHA,
    're-stamp the hash AND copy the file to palate-product/apps/grader/worker/src/design-measure.mjs');
});
