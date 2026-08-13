/**
 * palate-crawl.test.mjs - the parts of a crawler that can be wrong SILENTLY.
 *
 * A crawler that errors is fine; someone reads the error. The dangerous outputs are the plausible
 * ones, so these are the cases under test:
 *
 *   A WALL REPORTED AS A SMALL SITE. Basic auth, a Shopify password page and an SSO redirect all
 *   return one page, which is indistinguishable from a genuine one-page site by count alone.
 *
 *   A DIMENSION TAKEN FROM A CDN QUERY PARAM. `?w=1200` says what the CDN was asked for. A 2:3
 *   portrait served through it is still a 2:3 portrait, and believing the param is how a photo
 *   ends up in a 3:1 slot showing 22% of the frame.
 *
 *   A srcset SPLIT ON COMMAS. Cloudinary and Imgix put commas inside their transform segments, so
 *   naive splitting silently measures a URL that does not exist.
 *
 * The last block runs the real CLI against a real HTTP server on a high port (nothing in the repo
 * uses 8871), so the range request, the header parse and the written file are all exercised end to
 * end rather than asserted about.
 *
 * Run: node --test scripts/test/palate-crawl.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  imageSize, parseRobots, rulesFor, isAllowed, parseSrcset, parseSitemap,
  extractImages, extractLinks, extractTitle, normaliseUrl, detectBlock,
} from '../palate-crawl.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'palate-crawl.mjs');
const PORT = 8871; // above 8850: 8791/8796/8797 are taken by other suites and collide in parallel

/**
 * Run the CLI and hand back status plus both streams.
 *
 * ASYNC ON PURPOSE. The first version used `execFileSync`, which blocks this process's event loop
 * while the child runs, so the fixture server living in this same process could never answer and
 * every request died on the crawler's 20s timeout. The tests still "failed", but for the wrong
 * reason entirely, which is the kind of green-adjacent noise that gets a suite ignored.
 */
const run = async (args) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

// ------------------------------------------------------------ image fixtures

function png(w, h) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

function jpeg(w, h, { padBytes = 0 } = {}) {
  // SOI, optional oversized APP1 padding (the real reason a 64KB read can miss the frame), SOF0.
  // A single JPEG segment cannot exceed 65535 bytes, which is exactly why a real camera file
  // carries SEVERAL of them and why the header can sit well past the first 64KB.
  const parts = [Buffer.from([0xff, 0xd8])];
  let left = padBytes;
  while (left > 0) {
    const payload = Math.min(left, 65533);
    const app1 = Buffer.alloc(4 + payload);
    app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(payload + 2, 2);
    parts.push(app1);
    left -= payload;
  }
  const sof = Buffer.alloc(2 + 17);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  parts.push(sof);
  return Buffer.concat(parts);
}

function gif(w, h) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8);
  return b;
}

function webpLossy(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28);
  return b;
}

function avif(w, h) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(32, 0); b.write('ftyp', 4, 'latin1'); b.write('avif', 8, 'latin1');
  b.write('ispe', 32, 'latin1');
  b.writeUInt32BE(0, 36);           // version + flags
  b.writeUInt32BE(w, 40); b.writeUInt32BE(h, 44);
  return b;
}

// ------------------------------------------------------------------ unit tests

test('a header read gives the real dimensions for every format we claim to support', () => {
  assert.deepEqual(imageSize(png(2000, 3000)), { width: 2000, height: 3000, format: 'png' });
  assert.deepEqual(imageSize(jpeg(1600, 900)), { width: 1600, height: 900, format: 'jpeg' });
  assert.deepEqual(imageSize(gif(48, 48)), { width: 48, height: 48, format: 'gif' });
  assert.deepEqual(imageSize(webpLossy(1200, 800)), { width: 1200, height: 800, format: 'webp' });
  assert.deepEqual(imageSize(avif(4000, 2250)), { width: 4000, height: 2250, format: 'avif' });
});

test('an SVG reports its viewBox when width is a percentage', () => {
  const s = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 240 60"></svg>');
  assert.deepEqual(imageSize(s), { width: 240, height: 60, format: 'svg' });
});

test('an unrecognised header returns null, never a guess', () => {
  assert.equal(imageSize(Buffer.from('not an image at all')), null);
  assert.equal(imageSize(Buffer.alloc(0)), null);
});

test('the AVIF thumbnail does not win over the primary image', () => {
  // A real AVIF often carries a small thumbnail item first. Taking the first ispe would report a
  // 320px thumb as the photograph and pass it as too small for a hero.
  const b = Buffer.alloc(96);
  b.writeUInt32BE(32, 0); b.write('ftyp', 4, 'latin1'); b.write('avif', 8, 'latin1');
  b.write('ispe', 32, 'latin1'); b.writeUInt32BE(320, 40); b.writeUInt32BE(240, 44);
  b.write('ispe', 64, 'latin1'); b.writeUInt32BE(3000, 72); b.writeUInt32BE(2000, 76);
  assert.deepEqual(imageSize(b), { width: 3000, height: 2000, format: 'avif' });
});

test('srcset survives Cloudinary commas', () => {
  const v = 'https://res.cloudinary.com/d/image/upload/w_400,h_300/a.jpg 400w, ' +
            'https://res.cloudinary.com/d/image/upload/w_800,h_600/a.jpg 800w';
  assert.deepEqual(parseSrcset(v), [
    'https://res.cloudinary.com/d/image/upload/w_400,h_300/a.jpg',
    'https://res.cloudinary.com/d/image/upload/w_800,h_600/a.jpg',
  ]);
});

test('srcset with no descriptors still yields both candidates', () => {
  assert.deepEqual(parseSrcset('/a.png, /b.png'), ['/a.png', '/b.png']);
});

test('robots: a named group wins over the wildcard group entirely', () => {
  const r = parseRobots([
    'User-agent: *', 'Disallow: /',
    '', 'User-agent: PalateCrawl', 'Disallow: /cart', 'Allow: /',
  ].join('\n'));
  const rules = rulesFor(r, 'PalateCrawl/1');
  assert.equal(isAllowed(rules, '/about'), true);
  assert.equal(isAllowed(rules, '/cart'), false);
});

test('robots: the longest matching rule wins, so the admin-ajax exception works', () => {
  const r = parseRobots('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php');
  const rules = rulesFor(r, 'PalateCrawl/1');
  assert.equal(isAllowed(rules, '/wp-admin/options.php'), false);
  assert.equal(isAllowed(rules, '/wp-admin/admin-ajax.php'), true);
  assert.equal(isAllowed(rules, '/'), true);
});

test('robots: a path is escaped, not treated as a regex', () => {
  // `Disallow: /a.b` must not match `/axb`. An unescaped dot silently over-blocks.
  const rules = rulesFor(parseRobots('User-agent: *\nDisallow: /a.b'), 'PalateCrawl/1');
  assert.equal(isAllowed(rules, '/a.b'), false);
  assert.equal(isAllowed(rules, '/axb'), true);
});

test('robots: Sitemap lines are collected even with no groups', () => {
  const r = parseRobots('Sitemap: https://x.test/sitemap_index.xml\nSitemap: https://x.test/news.xml');
  assert.deepEqual(r.sitemaps, ['https://x.test/sitemap_index.xml', 'https://x.test/news.xml']);
});

test('a sitemap index is told apart from a page list', () => {
  const idx = '<sitemapindex><sitemap><loc>https://x.test/a.xml</loc></sitemap></sitemapindex>';
  assert.deepEqual(parseSitemap(idx), { sitemaps: ['https://x.test/a.xml'], urls: [] });
  const set = '<urlset><url><loc>https://x.test/about</loc></url></urlset>';
  assert.deepEqual(parseSitemap(set), { sitemaps: [], urls: ['https://x.test/about'] });
});

test('a wall is never reported as a small site', () => {
  assert.equal(detectBlock({ status: 401, requestedUrl: 'https://x.test/' }).reason, 'auth');
  assert.equal(
    detectBlock({ status: 200, requestedUrl: 'https://shop.test/', finalUrl: 'https://shop.test/password' }).reason,
    'password-gate');
  assert.equal(
    detectBlock({ status: 200, requestedUrl: 'https://app.test/', finalUrl: 'https://acme.okta.com/login' }).reason,
    'sso-redirect');
  assert.equal(
    detectBlock({ status: 200, requestedUrl: 'https://x.test/', finalUrl: 'https://x.test/', html: '<form><input type="password" name="p"></form>' }).reason,
    'password-gate');
});

test('a real site containing a login form is NOT a wall', () => {
  const html = '<html><body><nav>...</nav>' + 'Real content about the business. '.repeat(40) +
    '<form><input type="password"></form></body></html>';
  assert.equal(detectBlock({ status: 200, requestedUrl: 'https://x.test/', finalUrl: 'https://x.test/', html }), null);
});

test('link and image extraction stays on-origin and keeps image queries', () => {
  const html = `
    <a href="/about">a</a><a href="https://other.test/x">b</a>
    <a href="mailto:a@b.c">c</a><a href="/brochure.pdf">d</a><a href="/about#team">e</a>
    <img src="/hero.jpg?w=1200" srcset="/hero-800.jpg 800w, /hero-1600.jpg 1600w">
    <meta property="og:image" content="https://cdn.test/og.png">`;
  assert.deepEqual(extractLinks(html, 'https://x.test/', 'https://x.test'), ['https://x.test/about']);
  const imgs = extractImages(html, 'https://x.test/');
  assert.ok(imgs.includes('https://x.test/hero.jpg?w=1200'), 'the query must survive: it is part of the URL we fetch');
  assert.ok(imgs.includes('https://x.test/hero-1600.jpg'));
  assert.ok(imgs.includes('https://cdn.test/og.png'));
});

test('normaliseUrl drops the fragment and the trailing slash but not the root', () => {
  assert.equal(normaliseUrl('/about/#team', 'https://x.test'), 'https://x.test/about');
  assert.equal(normaliseUrl('/', 'https://x.test'), 'https://x.test/');
  assert.equal(normaliseUrl('javascript:void(0)', 'https://x.test'), null);
});

test('extractTitle decodes entities and collapses whitespace', () => {
  assert.equal(extractTitle('<title>\n  Acme &amp; Sons\n</title>'), 'Acme & Sons');
});

// -------------------------------------------------------------- end to end

/** A small site with a sitemap, a robots deny, an oversized JPEG and a lying CDN param. */
function fixtureServer() {
  const hero = png(2000, 3000);                     // portrait: the case palate-assets exists for
  const wide = jpeg(2400, 1350, { padBytes: 70000 }); // SOF past 64KB: forces the wider retry
  const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"></svg>');
  const routes = {
    '/robots.txt': ['text/plain', Buffer.from('User-agent: *\nDisallow: /private\nSitemap: http://127.0.0.1:' + PORT + '/sitemap.xml\n')],
    '/sitemap.xml': ['application/xml', Buffer.from(
      '<?xml version="1.0"?><sitemapindex><sitemap><loc>http://127.0.0.1:' + PORT + '/sitemap-pages.xml</loc></sitemap></sitemapindex>')],
    '/sitemap-pages.xml': ['application/xml', Buffer.from(
      '<?xml version="1.0"?><urlset>' +
      ['/', '/about', '/private'].map((p) => `<url><loc>http://127.0.0.1:${PORT}${p}</loc></url>`).join('') +
      '</urlset>')],
    '/': ['text/html', Buffer.from(
      '<html><head><title>Acme &amp; Sons</title></head><body>' +
      // The param claims 1200x400. The file is a 2000x3000 portrait. Believing the param is the bug.
      '<img src="/hero.png?w=1200&h=400">' +
      '<img src="/wide.jpg"><img src="/logo.svg"></body></html>')],
    '/about': ['text/html', Buffer.from('<html><head><title>About</title></head><body><img src="/logo.svg"></body></html>')],
    '/private': ['text/html', Buffer.from('<html><head><title>Private</title></head><body>secret</body></html>')],
    '/hero.png': ['image/png', hero],
    '/wide.jpg': ['image/jpeg', wide],
    '/logo.svg': ['image/svg+xml', logo],
  };
  return createServer((req, res) => {
    const path = req.url.split('?')[0];
    const hit = routes[path];
    if (!hit) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html><title>404</title></html>'); }
    const [type, body] = hit;
    const range = req.headers.range && /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    if (range && type.startsWith('image/')) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), body.length - 1);
      const slice = body.subarray(start, end + 1);
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': slice.length });
      return res.end(slice);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': body.length });
    res.end(body);
  });
}

test('end to end: sitemap index, robots deny, range-measured images', async (t) => {
  const server = fixtureServer();
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stdout, stderr } = await run([`http://127.0.0.1:${PORT}/`, '--out', out]);
  assert.equal(status, 0, `crawl exited ${status}:\n${stdout}${stderr}`);
  const doc = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(doc.discovery, 'sitemap', 'the sitemap index must be followed to its child sitemap');
  assert.equal(doc.blocked, null);

  const paths = doc.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/', '/about'], 'robots must keep /private out of the crawl');
  assert.equal(doc.counts.skippedByRobots, 1);
  assert.equal(doc.pages.find((p) => p.path === '/').title, 'Acme & Sons');

  // THE claim of this tool: the dimensions come from the file, not from the URL.
  const heroKey = Object.keys(doc.assets).find((k) => k.includes('hero.png'));
  assert.ok(heroKey.includes('w=1200'), 'the URL we fetched carried the misleading CDN params');
  const hero = doc.assets[heroKey];
  assert.equal(hero.width, 2000);
  assert.equal(hero.height, 3000);
  assert.equal(hero.orientation, 'portrait');
  assert.equal(hero.heroCapable, false, 'a 2:3 portrait is never hero-capable, whatever ?w= says');
  assert.equal(hero.fits.find((f) => f.slot === 'full-bleed hero').verdict, 'destructive');
  assert.equal(hero.reviewed, false, 'pixels cannot say where the subject is: that stays unrecorded');

  // The oversized-EXIF retry: without it a real photograph reads as unmeasurable.
  const wide = doc.assets[Object.keys(doc.assets).find((k) => k.includes('wide.jpg'))];
  assert.equal(wide.error, undefined, `the >64KB-header JPEG must be retried, got ${wide.error}`);
  assert.deepEqual([wide.width, wide.height, wide.heroCapable], [2400, 1350, true]);

  const logo = doc.assets[Object.keys(doc.assets).find((k) => k.includes('logo.svg'))];
  assert.equal(logo.kind, 'icon', 'vector art has no frame to crop through');

  assert.equal(doc.counts.unmeasured, 0, stdout);
});

test('end to end: an auth wall exits 3 and says BLOCKED, not "1 page"', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(404); return res.end(); }
    res.writeHead(401, { 'content-type': 'text/html', 'www-authenticate': 'Basic realm="staging"' });
    res.end('<html><title>401</title></html>');
  });
  await new Promise((r) => server.listen(PORT + 1, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stderr } = await run([`http://127.0.0.1:${PORT + 1}/`, '--out', out]);

  assert.equal(status, 3, 'a wall must not exit 0');
  assert.match(stderr, /BLOCKED/);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.blocked.reason, 'auth');
  assert.equal(doc.discovery, 'none');
});

test('end to end: no sitemap, so the nav is followed instead', async (t) => {
  const pages = {
    '/': '<html><title>Home</title><a href="/services">s</a><a href="/contact">c</a></html>',
    '/services': '<html><title>Services</title><a href="/services/roofing">r</a></html>',
    '/services/roofing': '<html><title>Roofing</title></html>',
    '/contact': '<html><title>Contact</title></html>',
  };
  const server = createServer((req, res) => {
    const p = req.url.split('?')[0].replace(/(.)\/$/, '$1');
    if (!(p in pages)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html></html>'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(pages[p]);
  });
  await new Promise((r) => server.listen(PORT + 2, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stdout, stderr } = await run([`http://127.0.0.1:${PORT + 2}/`, '--out', out]);
  assert.equal(status, 0, stdout + stderr);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.discovery, 'links');
  assert.deepEqual(doc.pages.map((p) => p.path).sort(), ['/', '/contact', '/services', '/services/roofing']);
  assert.deepEqual(doc.warnings, [], 'a complete link crawl has nothing to warn about');

  // --max-pages must report a SAMPLE, and must not then also claim the homepage served no links:
  // that claim fired on page count rather than on what was discovered, so it contradicted the
  // three URLs sitting in the same output.
  const capped = join(dir, 'capped.json');
  const r2 = await run([`http://127.0.0.1:${PORT + 2}/`, '--out', capped, '--max-pages', '1']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const doc2 = JSON.parse(readFileSync(capped, 'utf8'));
  assert.ok(doc2.warnings.some((w) => /SAMPLE/.test(w)), doc2.warnings.join('|'));
  assert.ok(!doc2.warnings.some((w) => /no in-origin links/.test(w)),
    'links WERE found; only the visit budget ran out');
});

test('end to end: an apex that redirects to www is crawled, not reported as empty', async (t) => {
  // Found by running this against a real plumber's site. The requested origin was kept, every
  // discovered URL then failed the on-origin test, the crawl found ZERO pages, and it exited 0.
  // "0 ok, 0 failed" on a nine-page site is the worst output this tool can produce.
  const apex = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(404); return res.end(); }
    res.writeHead(301, { location: `http://127.0.0.1:${PORT + 5}${req.url}` });
    res.end();
  });
  const www = createServer((req, res) => {
    const p = req.url.split('?')[0].replace(/(.)\/$/, '$1');
    if (p === '/robots.txt') { res.writeHead(404); return res.end(); }
    if (p !== '/' && p !== '/about') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html></html>'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><title>${p}</title><a href="/about">a</a></html>`);
  });
  await new Promise((r) => apex.listen(PORT + 4, '127.0.0.1', r));
  await new Promise((r) => www.listen(PORT + 5, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { apex.close(); www.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stdout, stderr } = await run([`http://127.0.0.1:${PORT + 4}/`, '--out', out]);
  assert.equal(status, 0, stdout + stderr);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.origin, `http://127.0.0.1:${PORT + 5}`, 'the canonical origin must be adopted');
  assert.deepEqual(doc.redirectedOrigin, { from: `http://127.0.0.1:${PORT + 4}`, to: `http://127.0.0.1:${PORT + 5}` });
  assert.deepEqual(doc.pages.map((p) => p.path).sort(), ['/', '/about']);
});

test('end to end: zero crawled pages is BLOCKED, never a clean exit', async (t) => {
  // The entry answers, but everything it offers is off-origin. Nothing was learned about the
  // site, so "0 ok" must not be handed back as a successful crawl.
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /\n');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>Home</title></html>');
  });
  await new Promise((r) => server.listen(PORT + 6, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stderr } = await run([`http://127.0.0.1:${PORT + 6}/`, '--out', out]);
  assert.equal(status, 3);
  assert.match(stderr, /BLOCKED by robots/);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.blocked.reason, 'robots');
});

test('end to end: a homepage with no links is a warning and exit 1, not a one-page site', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt' || req.url.includes('sitemap')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(PORT + 3, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'palate-crawl-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const out = join(dir, 'site-map.json');
  const { status, stdout } = await run([`http://127.0.0.1:${PORT + 3}/`, '--out', out]);

  assert.equal(status, 1, 'an unestablished architecture must not read as a clean crawl');
  assert.match(stdout, /client-rendered nav/);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.pages.length, 1);
  assert.ok(doc.warnings.some((w) => /NOT been established/.test(w)));
});
