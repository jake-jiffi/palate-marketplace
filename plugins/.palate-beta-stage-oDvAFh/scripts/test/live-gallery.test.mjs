import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exec = promisify(execFile);
const require = createRequire(join(root, 'scripts/reference-capture/package.json'));
const { chromium } = require('playwright');
const fixture = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<BaseLayout title="Window study"><main><nav><a href="#windows">Windows</a><a href="tel:0266866667">Call the showroom</a></nav><h1>Open your home to the coast.</h1><p id="windows">Explore our sliding windows.</p><details><summary>Open the window</summary><p>The sash moves aside while the view stays clear.</p></details><div class="sash" aria-hidden="true"></div></main></BaseLayout>
<style>main{padding:24px;max-width:900px}nav{display:flex;gap:24px;flex-wrap:wrap}.sash{width:90px;height:90px;background:#285842;transform:translateX(0);transition:transform .6s}details[open]+.sash{transform:translateX(130px)}summary{min-height:48px;padding:12px;cursor:pointer}@media(prefers-reduced-motion:reduce){.sash{transition:none}}</style>`;

test('real Astro gallery progresses, isolates failures, preserves motion and stays out of production', { timeout: 240000 }, async () => {
  const area = mkdtempSync(join(tmpdir(), 'palate-live-gallery-'));
  // macOS aliases /var and /tmp, but the runtime deliberately accepts only canonical targets.
  const { realpathSync } = await import('node:fs');
  const project = join(realpathSync(area), 'site');
  let browser;
  let server;
  let preview;
  const refresh = async page => {
    for (let attempt = 0; ; attempt++) {
      try { await page.reload(); return; }
      catch (error) {
        if (attempt >= 2 || !String(error).includes('ERR_ABORTED')) throw error;
        await page.waitForTimeout(250); // Vite may replace the document after a source edit.
      }
    }
  };
  const command = async (args, cwd = project) => (await exec(process.execPath, args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 60000 })).stdout;
  const call = async (operation, input) => {
    const state = JSON.parse(readFileSync(join(project, 'palate.project.json'), 'utf8'));
    const inputPath = join(project, '.palate', 'input.json');
    writeFileSync(inputPath, JSON.stringify(input));
    return JSON.parse(await command(['scripts/palate.mjs', operation, '--input', inputPath, '--expect', String(state.revision), '--op', `test-${operation}-${state.revision}`]));
  };
  try {
    await command([join(root, 'scripts/palate.mjs'), 'init', '--project', project, '--expect', '0', '--op', 'gallery-init'], realpathSync(area));
    const initial = JSON.parse(readFileSync(join(project, 'palate.project.json'), 'utf8'));
    assert.equal(initial.profile, null);
    assert.deepEqual(initial.directions, []);
    assert.equal(initial.selection, null);
    assert.equal(initial.stage, 'initialising');
    assert.doesNotMatch(readFileSync(join(project, 'src/pages/index.astro'), 'utf8'), /window|shopify|motion|animation|brand/i);
    await exec('npm', ['ci', '--no-fund'], { cwd: project, maxBuffer: 5 * 1024 * 1024, timeout: 120000 });

    // Occupied ports belong to other work. A preview must move, without stopping them.
    server = createServer((_req, res) => res.end('unrelated process'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const occupied = server.address().port;
    const starts = await Promise.all([0, 1].map(() => command(['scripts/palate-preview.mjs', '--port', String(occupied)])));
    preview = JSON.parse(starts[0]);
    assert.equal(JSON.parse(starts[1]).pid, preview.pid, 'concurrent starts share one owned server');
    assert.notEqual(preview.port, occupied);
    assert.equal(await (await fetch(`http://127.0.0.1:${occupied}`)).text(), 'unrelated process');
    assert.equal(JSON.parse(await command(['scripts/palate-preview.mjs', 'status'])).running, true, 'preview survives the launching CLI exit');
    const reused = JSON.parse(await command(['scripts/palate-preview.mjs']));
    assert.equal(reused.pid, preview.pid);
    assert.equal(reused.reused, true);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await page.goto(preview.gallery);
    await page.getByText('Your first direction is being prepared.').waitFor();
    assert.equal(await page.locator('iframe').count(), 0);

    await call('source', { productKind: 'service', platform: 'WordPress', facts: ['Windows and doors'], journeys: ['enquiry'], assets: [], routes: ['/'] });
    for (const id of ['a', 'b', 'c']) {
      mkdirSync(join(project, 'src/directions', id), { recursive: true });
      writeFileSync(join(project, 'src/directions', id, 'index.astro'), fixture.replace('Window study', `Window study ${id}`));
    }
    await call('option', { id: 'a', label: 'Coastal opening', status: 'pending', rationale: 'Sliding panels reveal the outlook.' });
    await call('option', { id: 'b', label: 'Workshop detail', status: 'pending', rationale: 'Start with material and making.' });
    await call('option', { id: 'c', label: 'Frame study', status: 'failed', error: 'Synthetic failure with PRIVATE_INTERNAL_DETAIL' });
    await refresh(page);
    assert.equal(await page.locator('[data-status="pending"]').count(), 2);
    assert.equal(await page.locator('[data-status="failed"]').count(), 1);
    assert.equal(await page.locator('a.open').count(), 0);
    assert.doesNotMatch(await page.content(), /PRIVATE_INTERNAL_DETAIL/);
    const marker = join(project, 'palate.project.json');
    const validState = readFileSync(marker, 'utf8');
    writeFileSync(marker, JSON.stringify({ ...JSON.parse(validState), schema: 999 }));
    await refresh(page);
    await page.getByRole('alert').getByText('Project state could not be read.', { exact: false }).waitFor();
    const privateBefore = readdirSync(join(project, '.palate')).sort();
    await assert.rejects(command(['scripts/palate-preview.mjs', 'status']));
    assert.equal(readFileSync(marker, 'utf8'), JSON.stringify({ ...JSON.parse(validState), schema: 999 }));
    assert.deepEqual(readdirSync(join(project, '.palate')).sort(), privateBefore, 'unknown schema creates no preview artefacts');
    writeFileSync(marker, validState);

    mkdirSync(join(project, '.palate/previews'), { recursive: true });
    const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Gz8AAAAASUVORK5CYII=', 'base64');
    const sha256 = createHash('sha256').update(pixels).digest('hex');
    writeFileSync(join(project, '.palate/previews/a.png'), pixels);
    writeFileSync(join(project, '.palate/previews/unrecorded.png'), pixels);
    await call('option', { id: 'a', status: 'ready', previewUrl: `${preview.url}/_palate/directions/a`, thumbnail: { path: '.palate/previews/a.png', sha256 } });
    const beforeTraversal = readFileSync(marker, 'utf8');
    const tampered = JSON.parse(beforeTraversal);
    tampered.directions.find(direction => direction.id === 'a').thumbnail.path = '.palate/previews/../previews/unrecorded.png';
    writeFileSync(marker, JSON.stringify(tampered));
    assert.equal((await fetch(`${preview.url}/_palate/thumbnails/a`)).status, 404, 'path traversal is refused even with matching image bytes');
    writeFileSync(marker, beforeTraversal);
    await refresh(page);
    await page.getByRole('link', { name: 'Open Coastal opening' }).waitFor();
    assert.equal(await page.locator('a.open').count(), 1, 'first ready option appears while another remains pending');
    assert.equal((await fetch(`${preview.url}/_palate/thumbnails/a`)).status, 200);
    assert.equal((await fetch(`${preview.url}/_palate/thumbnails/unrecorded`)).status, 404);
    assert.equal((await fetch(`${preview.url}/.palate/previews/unrecorded.png`)).status, 404);
    assert.equal((await fetch(`${preview.url}/palate.project.json`)).status, 404);
    assert.equal((await fetch(`${preview.url}/_palate/directions/missing`)).status, 404);
    assert.equal((await fetch(`${preview.url}/_palate/directions/c`)).status, 503);

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `gallery fits ${width}px`);
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to options');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Refresh options');
    assert.equal(await page.locator('button').count(), 0, 'selection is in chat, not a fake button');

    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const nojsPage = await nojs.newPage();
    await nojsPage.goto(preview.gallery);
    await nojsPage.getByRole('link', { name: 'Open Coastal opening' }).click();
    await nojsPage.getByText('Open your home to the coast.').waitFor();
    await nojsPage.getByText('Open the window', { exact: true }).click();
    assert.equal(await nojsPage.locator('details').getAttribute('open'), '');
    await nojs.close();

    await page.goto(`${preview.url}/_palate/directions/a`);
    const before = await page.locator('.sash').evaluate(el => getComputedStyle(el).transform);
    await page.getByText('Open the window', { exact: true }).click();
    await page.waitForTimeout(220);
    const during = await page.locator('.sash').evaluate(el => getComputedStyle(el).transform);
    assert.notEqual(during, before, 'normal motion visibly responds');
    assert.notEqual(during, 'matrix(1, 0, 0, 1, 130, 0)', 'normal motion has a transition, not reduced-motion default');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.sash').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
    const mobile = await touch.newPage();
    await mobile.goto(`${preview.url}/_palate/directions/a`);
    await mobile.getByText('Open the window', { exact: true }).tap();
    await mobile.waitForTimeout(220);
    assert.notEqual(await mobile.locator('.sash').evaluate(el => getComputedStyle(el).transform), before);
    await touch.close();

    await call('select', { optionId: 'a' });
    await page.goto(preview.gallery);
    assert.match(await page.locator('[data-option="a"] .status').textContent(), /Selected/);
    writeFileSync(join(project, 'src/directions/a/index.astro'), `${fixture}\n<!-- Updated composition -->`);
    await refresh(page);
    assert.match(await page.locator('[data-option="a"] .status').textContent(), /Changed since review/);

    // An invalid or substituted image is not displayed merely because it has a recorded path.
    writeFileSync(join(project, '.palate/previews/a.png'), 'changed bytes');
    await refresh(page);
    assert.equal(await page.locator('[data-option="a"] img').count(), 0);
    assert.equal((await fetch(`${preview.url}/_palate/thumbnails/a`)).status, 404);
    rmSync(join(project, '.palate/previews/a.png'));
    symlinkSync(join(project, '.palate/previews/unrecorded.png'), join(project, '.palate/previews/a.png'));
    assert.equal((await fetch(`${preview.url}/_palate/thumbnails/a`)).status, 404);
    rmSync(join(project, '.palate/previews/a.png'));
    writeFileSync(join(project, '.palate/previews/a.png'), pixels);

    writeFileSync(join(project, 'src/pages/index.astro'), "---\nimport Selected from '../directions/a/index.astro';\n---\n<Selected />\n");
    await exec('npm', ['run', 'check'], { cwd: project, maxBuffer: 5 * 1024 * 1024, timeout: 60000 });
    await exec('npm', ['run', 'build'], { cwd: project, maxBuffer: 5 * 1024 * 1024, timeout: 60000 });
    await exec('npm', ['audit', '--omit=dev'], { cwd: project, maxBuffer: 5 * 1024 * 1024, timeout: 60000 });
    const built = [];
    const walk = dir => { for (const file of readdirSync(dir, { withFileTypes: true })) file.isDirectory() ? walk(join(dir, file.name)) : built.push(join(dir, file.name)); };
    walk(join(project, 'dist'));
    assert.ok(built.some(file => file.endsWith('index.html')));
    for (const file of built) {
      assert.doesNotMatch(file.slice(project.length), /_palate|\.palate|palate\.project/);
      assert.doesNotMatch(readFileSync(file, 'utf8'), /PRIVATE_INTERNAL_DETAIL|Design options|Workshop detail|Frame study|preview-server/);
    }
    assert.match(readFileSync(join(project, 'dist/index.html'), 'utf8'), /Open your home to the coast/);

    await command(['scripts/palate-preview.mjs', 'stop']);
    await assert.rejects(command(['scripts/palate-preview.mjs', 'status']));
    const restarted = JSON.parse(await command(['scripts/palate-preview.mjs', '--port', String(preview.port)]));
    assert.notEqual(restarted.instance, preview.instance);
    assert.equal(restarted.running, true);
    assert.equal(JSON.parse(await command(['scripts/palate-preview.mjs', 'status'])).running, true);
    assert.equal(await (await fetch(`http://127.0.0.1:${occupied}`)).text(), 'unrelated process');
  } catch (error) {
    try { error.message += `\nPreview log:\n${readFileSync(join(project, '.palate/preview.log'), 'utf8').slice(-12000)}`; } catch {}
    throw error;
  } finally {
    if (browser) await browser.close();
    if (preview) await command(['scripts/palate-preview.mjs', 'stop']).catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(area, { recursive: true, force: true });
  }
});
