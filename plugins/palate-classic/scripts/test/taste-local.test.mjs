/**
 * The local appearance head: its refusal contract, and its equivalence with the grader worker.
 *
 * Two things are being defended.
 *
 * 1. THE GATES ARE FREE AND THEY FIRE BEFORE THE MODEL LOADS. Every refusal below runs without
 *    touching the 356MB vision tower, so a customer never pays a download to be told their hero
 *    was blank. If a refactor ever reorders that, these tests hang or fail rather than passing
 *    quietly.
 *
 * 2. THE PIXEL STATISTICS MATCH SHARP. The worker measures with sharp and this measures straight
 *    off the decoded image, because sharp is a ~30MB native dependency and an install failure
 *    waiting to happen on a customer's machine. Those thresholds were CALIBRATED against sharp's
 *    numbers over all 2,194 library heroes, so if the two ever disagree the calibration is void.
 *    The three expectations are sharp's own output.
 *
 * Run: node --test scripts/test/taste-local.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { embedHero, __imageStatsForTest, REFUSE_MAX_STDEV, MIN_ASPECT, MAX_ASPECT, HERO_VIEWPORT } from '../reference-capture/taste-local.mjs';

const LIB = process.env.PALATE_LIBRARY ?? join(homedir(), 'dev/palate/library');
const hero = (slug) => join(LIB, 'catalog', slug, 'assets/screenshots/desktop.png');
const haveLibrary = existsSync(hero('linear'));
const TMP = mkdtempSync(join(tmpdir(), 'palate-taste-'));

/** A minimal, valid PNG of one solid colour, written without any image library. */
function solidPng(width, height, [r, g, b]) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

function writePng(name, width, height, colour) {
  const p = join(TMP, name);
  writeFileSync(p, solidPng(width, height, colour));
  return p;
}

// ------------------------------------------------------------------- the gates ----

test('a flat fill is REFUSED, not scored as top-decile taste', async () => {
  // 33 of 2,194 library heroes are mathematically single-colour because they never rendered,
  // and this head scores them at a MEDIAN percentile of 86.7. An ungated head reports a blank
  // capture as excellent design.
  const r = await embedHero(writePng('blank.png', HERO_VIEWPORT.width, HERO_VIEWPORT.height, [240, 240, 240]));
  assert.equal(r.applicable, false);
  assert.equal(r.reason, 'uniform-image');
  assert.match(r.detail, /p87/);
  assert.equal(r.embedding, undefined);
});

test('a full-page composite is refused as the wrong viewport', async () => {
  // The processor squashes to 384x384 without preserving aspect, so a tall composite becomes
  // something the head was never trained on, and it still returns a confident number.
  const r = await embedHero(writePng('tall.png', 1440, 9000, [10, 20, 30]));
  assert.equal(r.applicable, false);
  assert.equal(r.reason, 'not-a-desktop-viewport-still');
  assert.match(r.detail, /aspect/);
  // It must say how to fix it, not merely that it refused.
  assert.match(r.detail, /1440x900|fullPage/);
});

test('a mobile still is refused as the wrong viewport, not as "too small"', async () => {
  // Diagnosing a 390x844 still as "too small" would send someone hunting for a resolution
  // problem when the real fault is that they handed over the phone capture.
  const r = await embedHero(writePng('mobile.png', 390, 844, [10, 20, 30]));
  assert.equal(r.reason, 'not-a-desktop-viewport-still');
});

test('a too-small desktop-shaped still is refused on size', async () => {
  const r = await embedHero(writePng('small.png', 320, 200, [10, 20, 30]));
  assert.equal(r.applicable, false);
  assert.equal(r.reason, 'image-too-small');
});

test('an unreadable file is refused rather than throwing', async () => {
  const p = join(TMP, 'not-an-image.png');
  writeFileSync(p, 'this is not a png');
  const r = await embedHero(p);
  assert.equal(r.applicable, false);
  assert.equal(r.reason, 'unreadable-image');
});

test('a missing file is refused rather than throwing', async () => {
  const r = await embedHero(join(TMP, 'does-not-exist.png'));
  assert.equal(r.applicable, false);
  assert.equal(r.reason, 'unreadable-image');
});

test('every refusal carries a reason and never a score', async () => {
  for (const p of [
    writePng('r1.png', 1440, 900, [128, 128, 128]),
    writePng('r2.png', 1440, 9000, [1, 2, 3]),
    writePng('r3.png', 100, 80, [1, 2, 3]),
  ]) {
    const r = await embedHero(p);
    assert.equal(r.applicable, false);
    assert.ok(r.reason, 'a refusal must name its reason');
    assert.ok(r.detail, 'a refusal must explain itself');
    assert.equal(r.embedding, undefined, 'a refusal must not carry a vector');
  }
});

// ------------------------------------------------------- the statistics contract ----

test('the aspect window is the one the corpus was captured in', () => {
  const heroAspect = HERO_VIEWPORT.height / HERO_VIEWPORT.width;
  assert.ok(heroAspect > MIN_ASPECT && heroAspect < MAX_ASPECT, '1440x900 must sit inside the window');
  assert.equal(Math.round(heroAspect * 1000) / 1000, 0.625);
});

test('alpha is ignored, not composited', () => {
  // A varying alpha channel over a flat RGB fill measures a stdev of 127.5 under sharp, so a
  // blank hero carrying a mask would sail straight through the uniform gate.
  const n = 16;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = 200;
    data[i * 4 + 1] = 200;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = i * 15; // wildly varying alpha over a flat fill
  }
  const s = __imageStatsForTest({ data, width: 4, height: 4, channels: 4 });
  assert.equal(s.maxStdev, 0, 'the fill is flat; only alpha varies');
  assert.ok(s.maxStdev < REFUSE_MAX_STDEV, 'so it must still be refused');
});

test("reproduces sharp's per-channel stdev on real library heroes", { skip: !haveLibrary && 'library clone not present' }, async () => {
  // Ground truth: sharp().stats() inside the grader worker, on these exact files. Asserted
  // through the public result rather than the internal helper, so this covers the path that
  // actually runs.
  const expected = { linear: 35.013, aesop: 89.834, gitbook: 50.835 };
  for (const [slug, sharpStdev] of Object.entries(expected)) {
    const r = await embedHero(hero(slug));
    assert.equal(r.applicable, true, `${slug}: ${r.detail}`);
    assert.ok(
      Math.abs(r.image.maxStdev - sharpStdev) < 0.01,
      `${slug}: sharp measured ${sharpStdev}, this measured ${r.image.maxStdev}. The gate thresholds ` +
        'were calibrated against sharp over 2,194 heroes; a divergence voids that calibration.',
    );
    // The 1440x900 corpus geometry, restated where it is checked.
    assert.equal(r.image.width, HERO_VIEWPORT.width);
    assert.equal(r.image.height, HERO_VIEWPORT.height);
  }
});

test('a real library hero embeds to a unit-length 768-vector', { skip: !haveLibrary && 'library clone not present' }, async () => {
  const r = await embedHero(hero('linear'));
  assert.equal(r.applicable, true, r.detail);
  assert.equal(r.embedding.length, 768);
  let norm = 0;
  for (const x of r.embedding) norm += x * x;
  // The server refuses anything outside 1e-3 of unit length, because the corpus mean and sd
  // were computed over L2-normalised embeddings.
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6, `norm was ${Math.sqrt(norm)}`);
});

/* ---------------------------------------------------------------------------
 * THE CONSENT GATE.
 *
 * A 356MB download onto someone else's machine, mid-build, is not something to
 * announce and proceed with. This asserts the refusal actually refuses: that it
 * throws the named code, and above all that NOTHING IS FETCHED. A gate that
 * warns and downloads anyway is worse than none, because it reads as consent.
 *
 * Run in a FRESH SUBPROCESS on purpose. warmTaste memoises its load promise at
 * module scope, so asserting first-run behaviour in-process would depend on
 * whichever test happened to touch it first.
 */
test('an unauthorised first run refuses and downloads nothing', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'taste-gate-'));
  try {
    const src = `import {warmTaste} from '${new URL('../reference-capture/taste-local.mjs', import.meta.url).pathname}';
      try { await warmTaste({cacheDir: process.argv[1]}); console.log('DOWNLOADED'); }
      catch (e) { console.log(e.code); }`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', src, dir], {
      encoding: 'utf8',
      env: { ...process.env, PALATE_TASTE: '' },
    }).trim();
    assert.equal(out, 'TASTE_NOT_AUTHORISED', `must refuse without PALATE_TASTE, got: ${out}`);
    assert.equal(readdirSync(dir).length, 0, 'the cache must be untouched: nothing may be fetched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
