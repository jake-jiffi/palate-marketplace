#!/usr/bin/env node
/**
 * measure-composition.mjs - the deterministic "squint" / attention floor for a built
 * SECTION (references/composition-and-attention.md). Catches a BROKEN composition: the
 * single most important element stranded in the dead bottom-left fallow, the visual
 * weight piled away from it, dead corners. It is a FLOOR against broken composition,
 * never a prescription for centring - a bold, off-centre hero where the eye still
 * resolves to the action PASSES (only the genuinely-dead fallow + clear misalignment fire).
 *
 * The "squint": ffmpeg downscales + blurs the section screenshot to a small grid; a cell's
 * WEIGHT is how far its blurred luminance deviates from the section mean (deviation
 * approximates Itti-Koch bottom-up contrast salience - where the eye is pulled before
 * meaning). From the grid + the focal element's box we compute, with no LLM verdict, where
 * the weight lands vs where the focal element sits.
 *
 * Reuses ffmpeg (already required by the clip pipeline); no image-decode dependency.
 *
 * Usage:
 *   node measure-composition.mjs --shot <section.png> [--focal "cx,cy"] [--out <file.json>]
 *   --focal is the focal element's normalised centre (0..1) from screenshot-build.mjs.
 * Exit: 0 always (report-only; the gate reads the JSON). 2 = bad args / no ffmpeg.
 */
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const COLS = 24, ROWS = 16; // ~3:2, the squint resolution

function parseArgs(argv) {
  const a = { shot: '', focal: '', out: '', manifest: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--shot') a.shot = argv[++i];
    else if (argv[i] === '--focal') a.focal = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--manifest') a.manifest = argv[++i];
  }
  if (!a.shot && !a.manifest) { console.error('usage: measure-composition.mjs (--shot <png> [--focal "cx,cy"] | --manifest <screenshot manifest.json>) [--out <json>]'); process.exit(2); }
  return a;
}

// Gate mode: score every per-section clip a screenshot-build manifest lists, write
// composition.json beside it, and exit 2 if any section is a High (a stranded focal),
// so gate-done can block. Sections without a focal box still get weight/balance flags.
function runManifest(manifestPath) {
  let man;
  try { man = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { console.error('measure-composition: cannot read manifest:', e.message || String(e)); process.exit(2); }
  const dir = dirname(manifestPath);
  const sections = Array.isArray(man.sections) ? man.sections : [];
  const results = [];
  for (const s of sections) {
    if (!s.file) continue;
    const grid = squintGrid(join(dir, s.file));
    if (!grid) continue;
    const r = aggregate(grid, s.focal || null);
    results.push({ viewport: s.viewport, sid: s.sid, severity: r.severity, flags: r.flags, weightCentroid: r.weightCentroid, bottomWeight: r.bottomWeight, focal: r.focal });
  }
  const rank = { none: 0, Cosmetic: 1, Medium: 2, High: 3 };
  const worst = results.reduce((m, r) => (rank[r.severity] > rank[m] ? r.severity : m), 'none');
  const highs = results.filter((r) => r.severity === 'High');
  const report = { tool: 'measure-composition.mjs', mode: 'manifest', note: 'FLOOR against broken composition; read with Variety/Philosophy', sectionsScored: results.length, severity: worst, highCount: highs.length, sections: results };
  console.log(JSON.stringify(report, null, 2));
  try { writeFileSync(join(dir, 'composition.json'), JSON.stringify(report, null, 2) + '\n'); } catch {}
  if (highs.length > 0) {
    console.error(`composition: ${highs.length} High finding(s): ` + highs.map((h) => `${h.viewport}/${h.sid} [${h.flags.filter((f) => f.severity === 'High').map((f) => f.id).join(',')}]`).join('; '));
    process.exit(2);
  }
  process.exit(0);
}

// ffmpeg: downscale + blur the screenshot to a COLSxROWS grayscale grid (the squint).
function squintGrid(shotPath) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', shotPath, '-vf', `scale=${COLS}:${ROWS},boxblur=2:1`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 20, encoding: 'buffer' });
  if (r.status !== 0 || !r.stdout || r.stdout.length < COLS * ROWS) return null;
  const bytes = r.stdout;
  const grid = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(bytes[y * COLS + x]); grid.push(row); }
  return grid;
}

// ---- pure scoring (unit-tested without ffmpeg) ----
// grid: number[ROWS][COLS] of 0..255 luminance. focal: {cx,cy} normalised centre or null.
// Weight = |lum - mean| per cell (deviation ~ contrast salience). Returns the attention
// signals + flags. Bottom-left weak fallow = cx<0.42 && cy>0.58 (y down).
export function aggregate(grid, focal) {
  const rows = grid.length, cols = grid[0].length;
  let sum = 0, n = 0;
  for (const row of grid) for (const v of row) { sum += v; n++; }
  const mean = sum / n;

  let total = 0, wx = 0, wy = 0;
  const quad = { tl: 0, tr: 0, bl: 0, br: 0 };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const w = Math.abs(grid[y][x] - mean);
    total += w;
    const nx = (x + 0.5) / cols, ny = (y + 0.5) / rows;
    wx += w * nx; wy += w * ny;
    const k = (nx < 0.5 ? 'l' : 'r'), v = (ny < 0.5 ? 't' : 'b');
    quad[v + k] += w;
  }
  const centroid = total > 0 ? { x: round(wx / total), y: round(wy / total) } : { x: 0.5, y: 0.5 };
  const qf = total > 0
    ? { tl: round(quad.tl / total), tr: round(quad.tr / total), bl: round(quad.bl / total), br: round(quad.br / total) }
    : { tl: 0.25, tr: 0.25, bl: 0.25, br: 0.25 };

  const deadQuadrants = Object.values(qf).filter((f) => f < 0.10).length; // <10% (even = 25%)
  const maxQuad = Math.max(...Object.values(qf));

  const flags = [];
  if (focal) {
    const inFallow = focal.cx < 0.42 && focal.cy > 0.58;
    if (inFallow) flags.push({ id: 'focal-in-fallow', severity: 'High', detail: `focal element centred in the weak bottom-left fallow (${focal.cx},${focal.cy}); the page's most important element is where the eye goes last` });
    const dist = Math.hypot(centroid.x - focal.cx, centroid.y - focal.cy);
    if (dist > 0.45) flags.push({ id: 'weight-misaligned', severity: 'Medium', detail: `the visual-weight centroid (${centroid.x},${centroid.y}) sits far from the focal element (dist ${round(dist)}); the heaviest blob is not the thing that matters` });
  }
  const bottomWeight = round(qf.bl + qf.br);
  if (bottomWeight > 0.62) flags.push({ id: 'bottom-heavy', severity: 'Medium', detail: `most visual weight (${bottomWeight}) sits below the centre line; the section reads bottom-heavy / sinking rather than anchored where the eye enters` });

  const rank = { none: 0, Cosmetic: 1, Medium: 2, High: 3 };
  const severity = flags.reduce((m, f) => (rank[f.severity] > rank[m] ? f.severity : m), 'none');
  return { meanLum: round(mean), weightCentroid: centroid, quadrants: qf, bottomWeight, deadQuadrants, maxQuad: round(maxQuad), focal: focal || null, flags, severity };
}

function round(n) { return Number(n.toFixed(3)); }

function main() {
  const args = parseArgs(process.argv);
  if (args.manifest) return runManifest(args.manifest);
  const grid = squintGrid(args.shot);
  if (!grid) { console.error('measure-composition: ffmpeg could not read the shot (need ffmpeg + a valid PNG).'); process.exit(2); }
  let focal = null;
  if (args.focal) { const [cx, cy] = args.focal.split(',').map(Number); if (Number.isFinite(cx) && Number.isFinite(cy)) focal = { cx: round(cx), cy: round(cy) }; }
  const report = { tool: 'measure-composition.mjs', shot: args.shot, note: 'FLOOR against broken composition; read with Variety/Philosophy, never centre-by-default', ...aggregate(grid, focal) };
  console.log(JSON.stringify(report, null, 2));
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
