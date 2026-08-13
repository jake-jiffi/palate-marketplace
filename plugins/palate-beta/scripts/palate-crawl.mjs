#!/usr/bin/env node
/**
 * palate-crawl.mjs - discover a LIVE site's real architecture, for the majority case: a site
 * Palate did not build.
 *
 * ========================= THE FAILURE THIS EXISTS FOR =========================
 *
 * `commands/adopt.md` claimed the route list came "from `.palate/index.json` on tier 1; from the
 * sitemap, then the nav, on tier 2". Tier 2 had no implementation at all. Nothing in this repo
 * read a live `sitemap.xml`, nothing followed a link, and `palate-index.mjs` exits 2 without
 * `src/pages`. So a WordPress, Shopify, Squarespace or hand-written HTML site got NO architecture,
 * and the measurement step then fell back to three guessed routes (`/`, `/about`, `/contact`)
 * whether or not that site had any of them. Adoption reported success on a site it had never
 * mapped.
 *
 * ========================== MEASURED, NEVER ASSUMED ===========================
 *
 * Two things here are measurements and both were previously guesses:
 *
 *   THE ROUTES. From the sitemap when there is one (including a sitemap index, which is what a
 *   real WordPress or Shopify site serves), otherwise by following in-origin links breadth-first
 *   from the homepage. Capped, on-origin, and obeying robots.txt.
 *
 *   THE IMAGE DIMENSIONS. From a RANGE REQUEST on each file's own header, parsed here. This is
 *   the whole point: knowing a photo is 2000x3000 BEFORE it is dropped into a 3:1 slot is what
 *   stops the failure `palate-assets.mjs` documents (a 2:3 portrait letterboxed to 3:1 shows 22%
 *   of the frame, so a candid of two people arrives as two decapitated torsos). CDN query params
 *   (`?w=1200`, `?width=800`) are DELIBERATELY IGNORED: they describe what the CDN was asked for,
 *   not what the file is, and a resize param on a portrait source still yields a portrait.
 *
 * ============================= HONEST WHEN BLOCKED ============================
 *
 * The dangerous output of a crawler is not an error, it is a small number. A site behind SSO, a
 * Shopify password page or a staging basic-auth wall returns one page, and "1 route" reads exactly
 * like a one-page site. So a wall is detected and reported as BLOCKED with exit 3, never as a
 * successful crawl of a small site. Same for a robots.txt that disallows everything, and for a
 * homepage that serves no links at all (a client-rendered nav), which is recorded as a warning and
 * exits 1 rather than pretending the site is one page deep.
 *
 * ============================== KNOWN LIMITS =================================
 *
 * Named here rather than discovered later. A PAGE URL is deduplicated with its query string
 * REMOVED, so `?page=2` pagination and `?p=123` permalinks collapse into one route. That is the
 * right trade against a faceted shop crawling forever, and it is wrong on the minority of sites
 * that route entirely on query strings: read the page count against the sitemap's and say so.
 * IMAGE URLs keep their query, because the query changes which bytes come back. And nothing here
 * runs JavaScript: an image or a link that only exists after hydration is invisible, which is why
 * a homepage with no links is reported as an unestablished architecture rather than a small site.
 *
 * ========================== SHAPE: FEEDS palate-assets ========================
 *
 * The `assets` block is written in `palate-assets.mjs`'s own record shape, produced by importing
 * its `kindOf` and `assess` rather than reimplementing them, so the two can never drift. That tool
 * measures LOCAL files only; this is how a remote photograph finally gets measured at all.
 *
 * Usage:
 *   node palate-crawl.mjs <url> [--out .palate/site-map.json] [--max-pages 100]
 *   node palate-crawl.mjs <url> --assets-out .palate/assets.json
 *   node palate-crawl.mjs <url> --no-images --concurrency 4 --timeout 20000
 *   node palate-crawl.mjs <url> --ignore-robots        # recorded in the output, never silent
 *
 * Exit: 0 crawled clean, 1 crawled but incomplete (pages failed, or nothing to follow),
 *       2 bad arguments, 3 BLOCKED (auth wall, password gate, robots deny-all, homepage dead).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { kindOf, assess } from './palate-assets.mjs';

const UA = 'PalateCrawl/1 (+https://palatemcp.com; site adoption)';

/** Extensions that are never a page. Following them wastes the cap and measures nothing. */
const NON_PAGE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tif', '.tiff',
  '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.pdf', '.zip', '.gz', '.rss', '.atom',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.map',
]);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tif', '.tiff']);

// ------------------------------------------------------------------ image headers
//
// Every parser below reads ONLY the file header, which is why a 64KB range request is enough for
// a 12MB photograph. Each returns null rather than a guess: an unparsed image must show up as
// unmeasured in the report, because "we do not know how big this is" is the finding.

/** PNG: fixed layout, IHDR always immediately after the 8-byte signature. */
function pngSize(b) {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' };
}

function gifSize(b) {
  if (b.length < 10) return null;
  const sig = b.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: 'gif' };
}

/**
 * JPEG: the dimensions live in a start-of-frame marker whose position is not fixed, so the marker
 * chain has to be walked. A big EXIF or colour profile can push SOF past 64KB, which is why the
 * caller retries with a larger range instead of recording the photo as unmeasurable.
 */
function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (i + 8 >= b.length) return null;
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), format: 'jpeg' };
    }
    i += 2 + len;
  }
  return null;
}

/** WebP has three container flavours and they store the size in three different places. */
function webpSize(b) {
  if (b.length < 30) return null;
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: 'webp' };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
  }
  if (chunk === 'VP8X') {
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { width: w + 1, height: h + 1, format: 'webp' };
  }
  return null;
}

/**
 * AVIF/HEIC: ISO base media boxes. Rather than walk the whole box tree for one number, scan for
 * every `ispe` (image spatial extents) and take the LARGEST. An AVIF commonly carries a thumbnail
 * item before the primary one, and taking the first would report a 320px thumb as the photograph.
 */
function isobmffSize(b) {
  if (b.length < 16) return null;
  const brandBox = b.toString('latin1', 4, 8);
  if (brandBox !== 'ftyp') return null;
  const brand = b.toString('latin1', 8, 12);
  const known = ['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1'];
  if (!known.includes(brand)) return null;
  let best = null;
  let at = 0;
  for (;;) {
    const idx = b.indexOf('ispe', at, 'latin1');
    if (idx === -1 || idx + 16 > b.length) break;
    const w = b.readUInt32BE(idx + 8);
    const h = b.readUInt32BE(idx + 12);
    at = idx + 4;
    if (w > 0 && h > 0 && w < 100000 && h < 100000) {
      if (!best || w * h > best.width * best.height) best = { width: w, height: h, format: 'avif' };
    }
  }
  return best;
}

/**
 * SVG is text, and its "intrinsic" size is whatever the viewBox says when width/height are
 * percentages, which they usually are on a responsive logo.
 */
function svgSize(b) {
  const head = b.toString('utf8', 0, Math.min(b.length, 8192));
  if (!/<svg[\s>]/i.test(head)) return null;
  const tag = head.match(/<svg[^>]*>/i);
  if (!tag) return null;
  const attr = (n) => {
    const m = tag[0].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const num = (v) => {
    if (!v || /%$/.test(v)) return null;
    const f = parseFloat(v);
    return Number.isFinite(f) && f > 0 ? f : null;
  };
  let w = num(attr('width'));
  let h = num(attr('height'));
  if (!w || !h) {
    const vb = attr('viewBox');
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
    }
  }
  if (!w || !h) return null;
  return { width: Math.round(w), height: Math.round(h), format: 'svg' };
}

/**
 * Dimensions from a file header. Order matters only in that each parser validates its own magic
 * bytes first, so a mislabelled Content-Type cannot make a PNG parse as a JPEG.
 */
export function imageSize(buf) {
  if (!buf || !buf.length) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return pngSize(b) || gifSize(b) || webpSize(b) || isobmffSize(b) || jpegSize(b) || svgSize(b) || null;
}

// ---------------------------------------------------------------------- robots

/**
 * robots.txt, parsed for the group that applies to us plus every Sitemap: line.
 *
 * The group rules are the reason this is not three lines: a real WordPress robots.txt has a `*`
 * group and several bot-specific ones, and picking rules out of the wrong group means either
 * ignoring a Disallow we must obey or obeying one aimed at a scraper.
 */
export function parseRobots(text) {
  const sitemaps = [];
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (key !== 'allow' && key !== 'disallow') continue;
    if (!current) { current = { agents: ['*'], rules: [] }; groups.push(current); }
    lastWasAgent = false;
    current.rules.push({ allow: key === 'allow', path: value });
  }
  return { sitemaps, groups };
}

/** The rules that apply to one user agent. A named group wins over `*` entirely, per the spec. */
export function rulesFor(robots, agent = 'palatecrawl') {
  const a = agent.toLowerCase();
  const named = robots.groups.filter((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  const chosen = named.length ? named : robots.groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function ruleToRegex(pattern) {
  // A robots path is a prefix match with `*` as a wildcard and `$` as an end anchor. Everything
  // else is literal, so it must be escaped or a path containing `.` or `?` matches far too much.
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '$' && i === pattern.length - 1) out += '$';
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out);
}

/**
 * Longest matching rule wins, and Allow wins a tie. That tie-break is what makes the common
 * `Disallow: /wp-admin/` + `Allow: /wp-admin/admin-ajax.php` pair behave.
 */
export function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // an empty Disallow means "allow everything", so it matches nothing
    if (!ruleToRegex(r.path).test(path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// ------------------------------------------------------------------------ HTML

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s) => String(s).replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? m);

export function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null;
}

/**
 * srcset, parsed as a state machine rather than `split(',')`.
 *
 * Splitting on commas is the obvious version and it is wrong on every Cloudinary or Imgix URL,
 * because their transform segments contain commas (`/upload/w_100,h_100/a.jpg`). Getting this
 * wrong does not error, it silently measures a URL that does not exist.
 */
export function parseSrcset(value) {
  const s = String(value || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) i++;
    let url = s.slice(start, i);
    const hadComma = /,$/.test(url);
    url = url.replace(/,+$/, '');
    if (url) out.push(url);
    // A trailing comma means this candidate carried no descriptor, so the next token is a URL.
    if (!hadComma) while (i < s.length && s[i] !== ',') i++;
  }
  return out;
}

/** Every in-origin page URL this HTML points at. */
export function extractLinks(html, pageUrl, origin) {
  const out = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const href = decode(m[2] ?? m[3] ?? m[4] ?? '').trim();
    const u = normaliseUrl(href, pageUrl);
    if (!u) continue;
    if (new URL(u).origin !== origin) continue;
    if (NON_PAGE_EXT.has(extname(new URL(u).pathname).toLowerCase())) continue;
    out.add(u);
  }
  return [...out];
}

/** Every image this HTML references: img src, img/source srcset, and the social preview. */
export function extractImages(html, pageUrl) {
  const src = String(html);
  const out = new Set();
  const add = (raw) => {
    const u = normaliseUrl(decode(raw).trim(), pageUrl, { keepQuery: true });
    if (u) out.add(u);
  };
  for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const s = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    if (s) add(s[2] ?? s[3] ?? s[4] ?? '');
    const ss = tag.match(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (ss) for (const c of parseSrcset(ss[2] ?? ss[3] ?? '')) add(c);
  }
  for (const m of src.matchAll(/<source\b[^>]*>/gi)) {
    const ss = m[0].match(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (ss) for (const c of parseSrcset(ss[2] ?? ss[3] ?? '')) add(c);
  }
  for (const m of src.matchAll(/<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi)) {
    const c = m[0].match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (c) add(c[2] ?? c[3] ?? '');
  }
  // Inline background images: on a page-builder site the hero is frequently only here.
  for (const m of src.matchAll(/background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  return [...out].filter((u) => /^https?:/.test(u));
}

/** Absolute, fragment-free, trailing-slash-normalised. Returns null for anything not fetchable. */
export function normaliseUrl(href, base, { keepQuery = false } = {}) {
  if (!href) return null;
  if (/^(mailto:|tel:|javascript:|data:|sms:|#)/i.test(href)) return null;
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  if (!keepQuery) u.search = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.href;
}

// --------------------------------------------------------------------- sitemap

/** A sitemap is either a list of pages or a list of sitemaps. Both shapes come back named. */
export function parseSitemap(xml) {
  const s = String(xml);
  const isIndex = /<sitemapindex[\s>]/i.test(s);
  const locs = [...s.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((m) => decode(m[1]).trim())
    .filter(Boolean);
  return isIndex ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

// ------------------------------------------------------------------- blocked?

/**
 * Is this a wall rather than a site?
 *
 * The whole reason this function exists is that a wall's honest answer and a one-page site's
 * honest answer are the same number, and only one of them means "you have not seen this site".
 */
export function detectBlock({ status, finalUrl, html, requestedUrl }) {
  if (status === 401 || status === 407) {
    return { reason: 'auth', detail: `HTTP ${status}: the site requires credentials before it serves anything.` };
  }
  if (status === 403) {
    return { reason: 'forbidden', detail: 'HTTP 403: refused. This may be a WAF or bot filter rather than the site being small.' };
  }
  if (status >= 500) {
    return { reason: 'server-error', detail: `HTTP ${status} on the entry URL: nothing was crawled.` };
  }
  let final = null;
  try { final = new URL(finalUrl || requestedUrl); } catch { /* unparseable, fall through */ }
  if (final) {
    const p = final.pathname.toLowerCase();
    const gate = /^\/(password|login|signin|sign-in|account\/login|customer_authentication|wp-login\.php|auth)(\/|$)/.test(p);
    const offOrigin = requestedUrl && new URL(requestedUrl).origin !== final.origin;
    if (gate) {
      return {
        reason: offOrigin ? 'sso-redirect' : 'password-gate',
        detail: `The entry URL redirected to ${final.href}, which is a sign-in or password gate, not the site.`,
      };
    }
    if (offOrigin && /(^|\.)(okta\.com|auth0\.com|accounts\.google\.com|login\.microsoftonline\.com)$/.test(final.hostname)) {
      return { reason: 'sso-redirect', detail: `The entry URL redirected off-origin to ${final.hostname}.` };
    }
  }
  if (html && /<input[^>]+type\s*=\s*["']?password/i.test(html)) {
    // A password field on a page with almost no other content is a gate. A login form inside a
    // real site (a customer portal link) sits on a page with plenty else, so text length decides.
    const text = String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 600) {
      return { reason: 'password-gate', detail: 'The entry page is a password form with almost no other content.' };
    }
  }
  return null;
}

// ----------------------------------------------------------------------- fetch

async function fetchText(url, { timeout, ua }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    const ct = res.headers.get('content-type') || '';
    let body = '';
    if (/\.gz($|\?)/.test(url)) body = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    else body = await res.text();
    return { status: res.status, finalUrl: res.url || url, contentType: ct, body };
  } catch (e) {
    return { status: 0, finalUrl: url, contentType: '', body: '', error: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * The first N bytes of a file.
 *
 * A Range request is the point: a 12MB photograph's dimensions live in its first few dozen bytes,
 * and downloading the other 12MB to learn them is the difference between a crawl that finishes and
 * one nobody runs twice. Servers are allowed to ignore Range and send 200 with the whole file, so
 * the stream is read incrementally and abandoned once we have enough.
 */
async function fetchHeadBytes(url, { timeout, ua, maxBytes = 65536 }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect: 'follow', signal: ac.signal,
      headers: { 'user-agent': ua, range: `bytes=0-${maxBytes - 1}`, accept: 'image/*,*/*;q=0.8' },
    });
    const chunks = [];
    let got = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        chunks.push(Buffer.from(chunk));
        got += chunk.length;
        if (got >= maxBytes) break;
      }
    }
    const total = Number(res.headers.get('content-length')) || null;
    const range = res.headers.get('content-range');
    const full = range && /\/(\d+)$/.test(range) ? Number(range.match(/\/(\d+)$/)[1]) : total;
    return {
      status: res.status,
      bytes: Buffer.concat(chunks),
      contentType: res.headers.get('content-type') || '',
      totalBytes: full,
      ranged: res.status === 206,
    };
  } catch (e) {
    return { status: 0, bytes: Buffer.alloc(0), contentType: '', totalBytes: null, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

/** Bounded parallelism. A crawl that opens 200 sockets at once gets rate-limited or banned. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ------------------------------------------------------------------- measuring

/**
 * One image, measured from its own header and turned into a `palate-assets.mjs` record.
 *
 * `kindOf` and `assess` are IMPORTED, never reimplemented, so a remote photo and a local one are
 * judged by exactly the same arithmetic and cannot drift apart.
 */
export async function measureImage(url, opts) {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  let head = await fetchHeadBytes(url, opts);
  if (head.error) return { error: `fetch failed: ${head.error}`, reviewed: false };
  if (head.status >= 400) return { error: `HTTP ${head.status}`, reviewed: false };

  let size = imageSize(head.bytes);
  // A JPEG carrying a large EXIF or ICC profile can push its start-of-frame past 64KB. One wider
  // retry is far cheaper than recording a real photograph as unmeasurable.
  if (!size && head.bytes.length >= 65536 && /jpe?g/i.test(head.contentType + path)) {
    head = await fetchHeadBytes(url, { ...opts, maxBytes: 524288 });
    size = imageSize(head.bytes);
  }
  if (!size) {
    return {
      error: head.bytes.length
        ? `header not recognised (${head.contentType || 'no content-type'}, ${head.bytes.length} bytes read)`
        : 'empty response',
      reviewed: false,
    };
  }

  const meta = { width: size.width, height: size.height, format: size.format, bytes: head.totalBytes ?? null };
  // An SVG is vector: it never upscales and has no frame to crop through, so crop and hero
  // verdicts about it are arithmetically valid and meaningless. Treat it as furniture.
  const kind = size.format === 'svg' ? 'icon' : kindOf(path.replace(/^\//, ''), meta);
  return { ...meta, ...assess(meta, opts.slots, kind), remote: true };
}

// ------------------------------------------------------------------------ args

function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (flag, dflt = null) => {
    const i = a.indexOf(flag);
    if (i === -1) return dflt;
    const v = a[i + 1];
    return v && !v.startsWith('--') ? v : dflt;
  };
  return {
    url: a[0] && !a[0].startsWith('--') ? a[0] : null,
    out: get('--out'),
    assetsOut: get('--assets-out'),
    maxPages: Number(get('--max-pages', '100')) || 100,
    concurrency: Number(get('--concurrency', '4')) || 4,
    timeout: Number(get('--timeout', '20000')) || 20000,
    ua: get('--user-agent', UA),
    images: !a.includes('--no-images'),
    ignoreRobots: a.includes('--ignore-robots'),
  };
}

// ------------------------------------------------------------------------ main

async function main() {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error('palate-crawl: a URL is required.\n  node palate-crawl.mjs https://example.com [--out .palate/site-map.json] [--max-pages 100]');
    process.exit(2);
  }
  let entry;
  try { entry = new URL(args.url.includes('://') ? args.url : `https://${args.url}`); } catch {
    console.error(`palate-crawl: ${args.url} is not a URL.`);
    process.exit(2);
  }
  let origin = entry.origin;
  const net = { timeout: args.timeout, ua: args.ua };
  const warnings = [];

  // ---- robots.txt ---------------------------------------------------------
  let robotsOk = false;
  let robots = { sitemaps: [], groups: [] };
  let rules = [];
  let robotsStatus = 0;
  const loadRobots = async () => {
    const res = await fetchText(new URL('/robots.txt', origin).href, net);
    robotsStatus = res.status;
    robotsOk = res.status === 200 && /^\s*(user-agent|sitemap|allow|disallow)/im.test(res.body);
    robots = robotsOk ? parseRobots(res.body) : { sitemaps: [], groups: [] };
    rules = rulesFor(robots, args.ua);
  };
  await loadRobots();
  const allowed = (u) => {
    if (args.ignoreRobots) return true;
    try { return isAllowed(rules, new URL(u).pathname); } catch { return false; }
  };

  const doc = {
    version: 1,
    entry: entry.href,
    origin,
    robots: null,
    redirectedOrigin: null,
    discovery: null,
    blocked: null,
    warnings,
    counts: {},
    slots: null,
    pages: [],
    assets: {},
    generatedAt: null,
  };

  const outPath = resolve(args.out || '.palate/site-map.json');
  const finish = (code) => {
    doc.origin = origin;
    doc.robots = {
      fetched: robotsOk,
      status: robotsStatus,
      ignored: args.ignoreRobots,
      sitemaps: robots.sitemaps,
      rules: rules.map((r) => `${r.allow ? 'Allow' : 'Disallow'}: ${r.path}`),
    };
    doc.generatedAt = new Date().toISOString();
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
    process.exit(code);
  };

  // `allowed` takes an ABSOLUTE url: it was passed `entry.pathname` here, `new URL('/')` throws,
  // the catch returned false, and every site with no robots.txt reported itself as robots-blocked.
  if (!args.ignoreRobots && !allowed(entry.href)) {
    doc.blocked = { reason: 'robots', detail: `robots.txt disallows ${entry.pathname} for this agent. Nothing was crawled. Re-run with --ignore-robots only if you own this site.` };
    doc.discovery = 'none';
    console.error(`palate-crawl: BLOCKED by robots.txt. ${doc.blocked.detail}`);
    finish(3);
  }

  // ---- the entry page, which is also the wall detector --------------------
  const home = await fetchText(entry.href, net);
  if (home.status === 0) {
    doc.blocked = { reason: 'unreachable', detail: `could not fetch ${entry.href}: ${home.error}` };
    doc.discovery = 'none';
    console.error(`palate-crawl: BLOCKED, ${doc.blocked.detail}. This is not an empty site, it is an unread one.`);
    finish(3);
  }
  const block = detectBlock({ status: home.status, finalUrl: home.finalUrl, html: home.body, requestedUrl: entry.href });
  if (block) {
    doc.blocked = block;
    doc.discovery = 'none';
    doc.pages = [{ url: entry.href, path: entry.pathname, status: home.status, finalUrl: home.finalUrl, title: extractTitle(home.body), images: [] }];
    console.error(
      `palate-crawl: BLOCKED (${block.reason}). ${block.detail}\n` +
      '  Reporting this as a one-page site would be the lie: nothing behind the wall was seen.',
    );
    finish(3);
  }
  if (home.status >= 400) {
    doc.blocked = { reason: 'entry-not-found', detail: `HTTP ${home.status} on ${entry.href}` };
    doc.discovery = 'none';
    console.error(`palate-crawl: BLOCKED, ${doc.blocked.detail}.`);
    finish(3);
  }

  // FOLLOW THE CANONICAL ORIGIN. An apex that 301s to www is the commonest hosting setup there
  // is, and the first version kept the requested origin: every discovered URL then failed the
  // on-origin test, the crawl found ZERO pages, and it exited 0 saying so. Caught by running this
  // against a real plumber's site, which is the whole audience for the tool.
  try {
    const finalOrigin = new URL(home.finalUrl).origin;
    if (finalOrigin !== origin) {
      doc.redirectedOrigin = { from: origin, to: finalOrigin };
      origin = finalOrigin;
      await loadRobots(); // robots.txt is per-origin, so the old one no longer applies
      if (!allowed(home.finalUrl)) {
        doc.blocked = { reason: 'robots', detail: `${entry.href} redirects to ${finalOrigin}, whose robots.txt disallows it.` };
        doc.discovery = 'none';
        console.error(`palate-crawl: BLOCKED by robots.txt. ${doc.blocked.detail}`);
        finish(3);
      }
    }
  } catch { /* an unparseable final URL is handled by the push guard below */ }

  // ---- discovery: the sitemap first, then the nav -------------------------
  const seen = new Set();
  const frontier = [];
  const push = (u) => {
    const n = normaliseUrl(u, origin);
    if (!n || new URL(n).origin !== origin) return false;
    if (seen.has(n)) return false;
    seen.add(n);
    frontier.push(n);
    return true;
  };

  const sitemapCandidates = [...new Set([...robots.sitemaps, new URL('/sitemap.xml', origin).href, new URL('/sitemap_index.xml', origin).href])];
  const sitemapUrls = [];
  const visitedSitemaps = new Set();
  const readSitemap = async (url, depth = 0) => {
    if (depth > 2 || visitedSitemaps.has(url) || visitedSitemaps.size > 50) return;
    visitedSitemaps.add(url);
    const r = await fetchText(url, net);
    if (r.status !== 200 || !/<(urlset|sitemapindex)[\s>]/i.test(r.body)) return;
    const { urls, sitemaps } = parseSitemap(r.body);
    for (const u of urls) sitemapUrls.push(u);
    for (const s of sitemaps) await readSitemap(s, depth + 1);
  };
  for (const c of sitemapCandidates) {
    await readSitemap(c);
    if (sitemapUrls.length) break;
  }

  push(normaliseUrl(home.finalUrl, origin) || entry.href);
  let fromSitemap = 0;
  for (const u of sitemapUrls) if (push(u)) fromSitemap++;

  // Label from the sitemap's own size, not from how many URLs it ADDED. A two-page site whose
  // sitemap lists both would otherwise be labelled "links" because the homepage was already in
  // the frontier, and a one-URL sitemap is worth nothing, so the nav is followed instead.
  const haveSitemap = sitemapUrls.length > 1;
  doc.discovery = haveSitemap ? 'sitemap' : 'links';
  if (haveSitemap && sitemapUrls.length > args.maxPages) {
    warnings.push(`the sitemap lists ${sitemapUrls.length} URLs and --max-pages is ${args.maxPages}: this map is a SAMPLE, not the whole site.`);
  }

  // ---- crawl --------------------------------------------------------------
  const pages = [];
  const skippedByRobots = [];
  let head = 0;
  let followedLinks = false;
  while (head < frontier.length && pages.length < args.maxPages) {
    const batch = [];
    while (head < frontier.length && batch.length < args.concurrency && pages.length + batch.length < args.maxPages) {
      const u = frontier[head++];
      if (!allowed(u)) { skippedByRobots.push(u); continue; }
      batch.push(u);
    }
    if (!batch.length) continue;
    const results = await pool(batch, args.concurrency, async (u) => ({ u, r: await fetchText(u, net) }));
    for (const { u, r } of results) {
      const isHtml = /text\/html|application\/xhtml/i.test(r.contentType) || (!r.contentType && /<html/i.test(r.body));
      const page = {
        url: u,
        path: new URL(u).pathname,
        status: r.status,
        finalUrl: r.finalUrl !== u ? r.finalUrl : null,
        title: isHtml ? extractTitle(r.body) : null,
        contentType: r.contentType || null,
        images: [],
      };
      if (r.status === 0) page.error = r.error;
      pages.push(page);
      if (!isHtml || r.status >= 400) continue;
      page.images = extractImages(r.body, r.finalUrl || u);
      // Only follow links when the sitemap did not already give us the architecture. Doing both
      // turns a 5,000-URL shop into an unbounded crawl for no extra information.
      if (doc.discovery === 'links') {
        followedLinks = true;
        for (const l of extractLinks(r.body, r.finalUrl || u, origin)) {
          if (frontier.length < args.maxPages * 4) push(l);
        }
      }
    }
  }

  // Zero pages is never a result. It means the frontier never held anything on-origin, which is a
  // fault in the crawl and not a fact about the site, so it must not exit 0 with "0 ok".
  if (!pages.length) {
    doc.blocked = {
      reason: 'nothing-crawled',
      detail: `no page on ${origin} was fetched. The entry URL answered but produced no crawlable, ` +
        'robots-allowed URL on its own origin. This is a failed crawl, not a small site.',
    };
    console.error(`palate-crawl: BLOCKED, ${doc.blocked.detail}`);
    doc.counts = { discovered: seen.size, fetched: 0, ok: 0, failed: 0, skippedByRobots: skippedByRobots.length, images: 0, measured: 0, unmeasured: 0, photos: 0, icons: 0 };
    finish(3);
  }

  // ---- images -------------------------------------------------------------
  const allImages = [...new Set(pages.flatMap((p) => p.images))];
  if (args.images && allImages.length) {
    const measured = await pool(allImages, Math.max(args.concurrency, 6), (u) => measureImage(u, { ...net, slots: undefined }));
    allImages.forEach((u, i) => { doc.assets[u] = measured[i]; });
  } else if (!args.images) {
    warnings.push('--no-images: nothing was measured, so this map cannot answer whether a photo fits a slot.');
  }

  // ---- honesty checks -----------------------------------------------------
  const ok = pages.filter((p) => p.status >= 200 && p.status < 400);
  const failed = pages.filter((p) => p.status === 0 || p.status >= 400);
  const unmeasured = Object.values(doc.assets).filter((a) => a.error);
  const photosWithoutSize = allImages.length && unmeasured.length === allImages.length;

  // Keyed on what was DISCOVERED, not on how many pages were fetched. Keying it on
  // `pages.length === 1` fired on `--max-pages 1` against a site whose homepage linked three
  // routes, i.e. it claimed the architecture was unknown while sitting on the proof it was not.
  if (doc.discovery === 'links' && seen.size <= 1 && !sitemapUrls.length) {
    warnings.push(
      'the homepage served no in-origin links and there is no sitemap. This is usually a ' +
      'client-rendered nav, not a one-page site: the architecture has NOT been established.',
    );
  }
  const unvisited = seen.size - pages.length - skippedByRobots.length;
  // Only when the sitemap warning has not already said the same thing, or a capped crawl prints
  // two warnings that are one fact.
  if (unvisited > 0 && !warnings.some((w) => /^the sitemap lists/.test(w))) {
    warnings.push(`--max-pages ${args.maxPages} stopped the crawl with ${unvisited} URL(s) still unvisited: this map is a SAMPLE.`);
  }
  if (photosWithoutSize) {
    warnings.push(`none of the ${allImages.length} image(s) could be measured from their headers. Treat every dimension in this map as unknown.`);
  }
  if (haveSitemap && followedLinks) warnings.push('mixed discovery: sitemap plus followed links.');

  doc.counts = {
    discovered: seen.size,
    fetched: pages.length,
    ok: ok.length,
    failed: failed.length,
    skippedByRobots: skippedByRobots.length,
    images: allImages.length,
    measured: allImages.length - unmeasured.length,
    unmeasured: unmeasured.length,
    photos: Object.values(doc.assets).filter((a) => a.kind === 'photo').length,
    icons: Object.values(doc.assets).filter((a) => a.kind === 'icon').length,
  };
  doc.skippedByRobots = skippedByRobots;
  // Read the slot list off `assess` itself rather than the crawl's results, or a site whose images
  // are all logos writes `slots: null` and a consumer cannot tell "no slots" from "not measured".
  doc.slots = assess({ width: 1000, height: 1000 }).fits.map((f) => ({ name: f.slot, ratio: f.ratio }));
  doc.pages = pages;

  // ---- the assets doc, in palate-assets.mjs's own top-level shape ---------
  if (args.assetsOut) {
    const p = resolve(args.assetsOut);
    const prior = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { assets: {} };
    const priorAssets = prior.assets || {};
    const assets = {};
    for (const [k, v] of Object.entries(doc.assets)) {
      const was = priorAssets[k];
      // A recorded human/agent review survives a re-crawl, exactly as palate-assets preserves it.
      assets[k] = was && was.reviewed && !v.error
        ? { ...v, subject: was.subject ?? null, treatment: was.treatment ?? null, reviewed: true }
        : v;
    }
    const list = Object.values(assets).filter((a) => !a.error && a.kind === 'photo');
    const byOrientation = {};
    for (const a of list) byOrientation[a.orientation] = (byOrientation[a.orientation] || 0) + 1;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({
      version: 1,
      dir: origin,
      counts: {
        total: allImages.length,
        measured: doc.counts.measured,
        photos: list.length,
        icons: doc.counts.icons,
        unreadable: unmeasured.length,
        reviewed: list.filter((a) => a.reviewed).length,
        heroCapable: list.filter((a) => a.heroCapable).length,
        byOrientation,
      },
      slots: doc.slots,
      assets,
      generatedAt: new Date().toISOString(),
    }, null, 2) + '\n');
    console.log(`palate-crawl: assets also written in palate-assets shape -> ${args.assetsOut}`);
  }

  // ---- report -------------------------------------------------------------
  console.log(`palate-crawl: ${origin}`);
  console.log(`  discovery: ${doc.discovery}${robotsOk ? '' : ' (no robots.txt)'}`);
  console.log(`  pages: ${ok.length} ok, ${failed.length} failed, ${skippedByRobots.length} skipped by robots (${seen.size} discovered)`);
  if (args.images) {
    console.log(`  images: ${doc.counts.measured} of ${allImages.length} measured from headers (${doc.counts.photos} photo, ${doc.counts.icons} icon)`);
    const risky = Object.entries(doc.assets)
      .filter(([, a]) => !a.error && a.kind === 'photo' && a.fits?.some((f) => f.verdict === 'destructive'))
      .slice(0, 5);
    for (const [u, a] of risky) {
      const f = a.fits.find((x) => x.verdict === 'destructive');
      console.log(`    ${a.width}x${a.height} ${a.orientation}  ${f.slot} shows ${Math.round(f.visible * 100)}% - ${u}`);
    }
  }
  console.log(`  -> ${outPath}`);
  for (const w of warnings) console.log(`  WARNING: ${w}`);
  for (const f of failed.slice(0, 10)) console.error(`  FAILED ${f.status || 'net'} ${f.url}${f.error ? ' - ' + f.error : ''}`);

  const incomplete = failed.length > 0 || warnings.some((w) => /NOT been established|Treat every dimension/.test(w));
  finish(incomplete ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`palate-crawl: ${(e && e.stack) || e}`);
    process.exit(2);
  });
}
