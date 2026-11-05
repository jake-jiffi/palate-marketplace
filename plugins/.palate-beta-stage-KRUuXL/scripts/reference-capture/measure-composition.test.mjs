/**
 * Tests for the composition/attention floor (measure-composition.mjs `aggregate`).
 *
 * The contract is a FLOOR against BROKEN composition, not a centring rule. So the
 * load-bearing test is the false-positive guard: a bold, off-centre-but-resolved hero
 * must PASS (severity none), while a stranded-focal / weight-misaligned / bottom-heavy
 * hero must FAIL. Run: node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './measure-composition.mjs';

const ROWS = 16, COLS = 24;
// Build a luminance grid: a light field (200) with optional dark blobs (40) in
// normalised regions {x0,x1,y0,y1}. Dark-on-light = high local deviation = weight.
function grid(blobs = []) {
  const g = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 200));
  for (const b of blobs) for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const nx = (x + 0.5) / COLS, ny = (y + 0.5) / ROWS;
    if (nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1) g[y][x] = 40;
  }
  return g;
}

test('even field + focal top-left: clean, no findings', () => {
  const r = aggregate(grid([]), { cx: 0.25, cy: 0.25 });
  assert.equal(r.severity, 'none');
  assert.equal(r.flags.length, 0);
});

test('focal in the weak bottom-left fallow is a High, on position alone', () => {
  const r = aggregate(grid([]), { cx: 0.2, cy: 0.8 });
  assert.ok(r.flags.some((f) => f.id === 'focal-in-fallow' && f.severity === 'High'));
  assert.equal(r.severity, 'High');
});

test('stranded hero (dark headline bottom-left): High + bottom-heavy', () => {
  const r = aggregate(grid([{ x0: 0, x1: 0.4, y0: 0.6, y1: 1 }]), { cx: 0.2, cy: 0.8 });
  assert.ok(r.weightCentroid.y > 0.6, 'weight should sit low');
  assert.ok(r.weightCentroid.x < 0.45, 'weight should sit left');
  assert.ok(r.flags.some((f) => f.id === 'focal-in-fallow'));
  assert.ok(r.flags.some((f) => f.id === 'bottom-heavy'));
  assert.equal(r.severity, 'High');
});

test('weight misaligned: focal top-left but the heaviest blob is bottom-right', () => {
  const r = aggregate(grid([{ x0: 0.6, x1: 1, y0: 0.6, y1: 1 }]), { cx: 0.2, cy: 0.2 });
  assert.ok(r.flags.some((f) => f.id === 'weight-misaligned' && f.severity === 'Medium'));
  assert.ok(!r.flags.some((f) => f.id === 'focal-in-fallow'), 'top-left focal is not in the fallow');
});

// THE false-positive guard: a bold, deliberately off-centre hero where the eye still
// resolves to the focal must PASS. If this regresses, the gate is herding builds back
// to the generic centred stack - the exact slop Palate fights.
test('bold-but-resolved off-centre hero PASSES (no findings)', () => {
  // weight blob centre-left, upper half; focal sits right on it, off-centre, not in fallow.
  const r = aggregate(grid([{ x0: 0.15, x1: 0.55, y0: 0.2, y1: 0.58 }]), { cx: 0.35, cy: 0.4 });
  assert.equal(r.severity, 'none', `expected clean, got ${JSON.stringify(r.flags)}`);
});

test('no focal box given: still scores weight/balance, never focal-in-fallow', () => {
  const r = aggregate(grid([{ x0: 0, x1: 0.4, y0: 0.6, y1: 1 }]), null);
  assert.ok(!r.flags.some((f) => f.id === 'focal-in-fallow'));
  assert.ok(r.flags.some((f) => f.id === 'bottom-heavy'));
});
