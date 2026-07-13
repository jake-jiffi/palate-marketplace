/**
 * Tests for the cross-section drift metric (measure-drift.mjs `aggregate`).
 *
 * Drift = CROSS-SECTION RECURRENCE: a value used in only one section is "local"
 * (drift); a value shared across sections is "the system". So a coherent system
 * scores ~0 however RICH, a piecemeal page scores high, and (the key property
 * this metric was healed to have) two pages with the SAME number of distinct
 * values but different SHARING score very differently. It stays a FLOOR: a
 * trivially-uniform / single-section page also scores 0 (consistent != good),
 * which is why it is read with Variety/Philosophy, never maximised. Run: node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './measure-drift.mjs';

// One system reused across 3 sections.
const COHERENT = [
  { padY: 80, fonts: [48, 18], radii: [8], borders: [1], accents: ['192,57,43'] },
  { padY: 80, fonts: [48, 18], radii: [8], borders: [1], accents: ['192,57,43'] },
  { padY: 80, fonts: [48, 18], radii: [8], borders: [1], accents: ['192,57,43'] },
];

// Generated piecemeal: every section invents its own scale, radius, border, accent.
const DRIFTED = [
  { padY: 40,  fonts: [52, 17], radii: [16], borders: [1], accents: ['192,57,43'] },
  { padY: 120, fonts: [33, 21], radii: [24], borders: [3], accents: ['41,128,185'] },
  { padY: 64,  fonts: [41, 15], radii: [8],  borders: [2], accents: ['39,174,96', '142,68,173'] },
];

test('coherent page: shared system => zero local drift', () => {
  const d = aggregate(COHERENT);
  assert.equal(d.sections, 3);
  assert.equal(d.typeScaleSteps, 2);   // 48, 18 page-wide
  assert.equal(d.typeLocal, 0);        // both shared across all 3 sections
  assert.equal(d.accentLocal, 0);
  assert.equal(d.spacingCV, 0);
  assert.equal(d.driftScore, 0);
});

test('drifted page: every section-local value counts as drift', () => {
  const d = aggregate(DRIFTED);
  assert.equal(d.typeLocal, 6);        // 52,17,33,21,41,15 each used by one section
  assert.equal(d.radiiLocal, 3);
  assert.equal(d.borderLocal, 3);
  assert.equal(d.accentLocal, 4);
  assert.ok(d.spacingCV > 0);
  assert.ok(d.driftScore >= 16);
});

test('drift strictly separates piecemeal from coherent', () => {
  assert.ok(aggregate(DRIFTED).driftScore > aggregate(COHERENT).driftScore);
});

// THE healed property: same richness (3 distinct sizes, 3 accents), opposite sharing.
test('same distinct count, opposite sharing => opposite drift (richness != drift)', () => {
  const richCoherent = [
    { padY: 96, fonts: [16, 40, 128], radii: [6], borders: [1], accents: ['200,40,80'] }, // hero flourish 128
    { padY: 96, fonts: [16, 40], radii: [6], borders: [1], accents: ['200,40,80'] },
    { padY: 96, fonts: [16, 40], radii: [6], borders: [1], accents: ['200,40,80'] },
  ];
  const piecemeal = [
    { padY: 96, fonts: [16], radii: [6], borders: [1], accents: ['200,40,80'] },
    { padY: 96, fonts: [40], radii: [6], borders: [1], accents: ['40,120,200'] },
    { padY: 96, fonts: [128], radii: [6], borders: [1], accents: ['40,180,90'] },
  ];
  const rc = aggregate(richCoherent), pm = aggregate(piecemeal);
  assert.equal(rc.typeScaleSteps, pm.typeScaleSteps);   // identical richness: 3 sizes each
  assert.equal(rc.typeLocal, 1);                        // only the hero 128 is section-local
  assert.equal(pm.typeLocal, 3);                        // none shared
  assert.ok(rc.driftScore < pm.driftScore);             // richness is NOT penalised; drift is
});

test('monotonic: a section-unique accent raises the score; a shared one does not', () => {
  const base = aggregate(COHERENT);                     // driftScore 0
  const oneLocalAccent = aggregate([
    ...COHERENT.slice(0, 2),                             // '192,57,43' now shared by 2 sections
    { padY: 80, fonts: [48, 18], radii: [8], borders: [1], accents: ['0,128,255'] }, // local
  ]);
  assert.equal(oneLocalAccent.accentColorsDistinct, 2);
  assert.equal(oneLocalAccent.accentLocal, 1);
  assert.ok(oneLocalAccent.driftScore > base.driftScore);
});

test('empty input is safe (no sections => zero drift, no throw)', () => {
  const d = aggregate([]);
  assert.equal(d.sections, 0);
  assert.equal(d.driftScore, 0);
});

test('FLOOR: a single section has no cross-section drift to measure (=> 0)', () => {
  // Drift is a CROSS-section concept; one section => 0 regardless of how rich or
  // boring it is. 0 means consistent-or-trivial, never "good" - hence a floor.
  const d = aggregate([{ padY: 80, fonts: [16, 32, 96], radii: [8], borders: [1], accents: ['200,40,80'] }]);
  assert.equal(d.sections, 1);
  assert.equal(d.driftScore, 0);
});
