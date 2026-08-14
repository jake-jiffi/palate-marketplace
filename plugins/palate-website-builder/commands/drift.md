---
description: Measure how far each route has moved from its own stored baseline. Free, local, and not a judgement.
argument-hint: "[route,route] or --all or --rebaseline"
---

Answer one question: **has this page moved?**

It does not answer whether the move was good. That needs the learned taste head, which is not
on this machine. Say so in the output; never let a distance read as a verdict.

Free and local end to end. The SigLIP embedding is computed here, the comparison is cosine
distance against `.palate/baselines/<route>.json`, and nothing leaves the machine.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}` (or the skill checkout root if unset). `$SITE`
is the project directory.

## 1. Pick the routes

- `--all`, or no argument: every static route in the index.
- A comma-separated list: exactly those.
- Otherwise, if the working tree is dirty, the routes the contract's plan names for the diff
  (`node "$PALATE/scripts/palate-contract.mjs" "$SITE" --changed <files...> --json`).

```bash
node "$PALATE/scripts/palate-index.mjs" "$SITE"     # writes .palate/index.json
```

Skip endpoints (`/robots.txt`, `/llms.txt`, `/api/*`) and unrendered dynamic patterns
(`/blog/[slug]`). There is nothing for a vision model to embed.

## 2. Serve the site

```bash
bash "$PALATE/scripts/serve-preview.sh" "$SITE"     # prints SERVE_URL=...
```

## 3. Measure

Run this against `$SERVE_URL`. It captures each route's hero at exactly 1440x900 (the only
viewport the appearance head was trained on), embeds it, and compares against that route's own
baseline.

Write it to a temp file and run that. **Do not pipe it to `node` on stdin**: with no script
file, node parses `--url` as one of its own options and dies with `node: bad option: --url`.

```bash
export PALATE_ROOT="$PALATE"
DRIFT="${TMPDIR:-/tmp}/palate-drift-$$.mjs"
cat > "$DRIFT" <<'EOF'
const P = process.env.PALATE_ROOT;
const pw = await import(`${P}/scripts/reference-capture/node_modules/playwright/index.js`);
const chromium = pw.chromium ?? pw.default?.chromium;
const { embedHero, disposeTaste, HERO_VIEWPORT } = await import(`${P}/scripts/reference-capture/taste-local.mjs`);
const { readBaseline, writeBaseline, cosineDistance, driftFinding, DRIFT_REVIEW_AT } =
  await import(`${P}/scripts/palate-contract.mjs`);

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(`--${n}`); return i === -1 ? d : a[i + 1]; };
const base = String(arg('url', '')).replace(/\/+$/, '');
const dir = String(arg('dir', '.'));
const routes = String(arg('routes', '/')).split(',').map((r) => r.trim()).filter(Boolean);
const rebaseline = a.includes('--rebaseline');

const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: HERO_VIEWPORT });
const rows = [];
for (const route of routes) {
  const row = { route, distance: null, note: null, finding: null };
  try {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    const png = await page.screenshot({ fullPage: false });
    let em;
    try { em = await embedHero(png); }
    catch (e) { em = { applicable: false, reason: e?.code || 'embed-unavailable',
                       detail: String(e?.message ?? e).slice(0, 200) }; }
    if (!em.applicable) { row.note = `NOT MEASURED (${em.reason}): ${em.detail}`; rows.push(row); continue; }
    const prior = readBaseline(dir, route);
    if (rebaseline || !prior?.embedding) {
      writeBaseline(dir, route, { at: new Date().toISOString(), model: em.model,
        image: em.image, embedding: em.embedding });
      row.note = prior?.embedding ? 're-baselined' : 'first baseline written, nothing to compare yet';
      rows.push(row); continue;
    }
    row.distance = Math.max(0, cosineDistance(em.embedding, prior.embedding));
    row.since = prior.at ?? null;
    row.flags = em.flags;
    row.finding = driftFinding(route, row.distance);
  } catch (e) {
    row.note = `NOT MEASURED (render-failed): ${String(e?.message ?? e).slice(0, 160)}`;
  }
  rows.push(row);
}
await page.close(); await browser.close(); await disposeTaste();
console.log(JSON.stringify({ base, threshold: DRIFT_REVIEW_AT, rows }, null, 2));
EOF

node "$DRIFT" --url "$SERVE_URL" --dir "$SITE" --routes "/,/contact,/blog"
rm -f "$DRIFT"
```

Pass `--rebaseline` through to the same call when the person asked for it. Exit is 0 in every
case, including a refusal: read the rows, not the status.

## 4. When it refuses

Every refusal is named and carries the fix. Report it as unmeasured, never as zero drift.

- `TASTE_DEPENDENCY_MISSING` or `TASTE_NOT_AUTHORISED`: the ~356MB SigLIP vision tower has
  not been fetched. `bash "$PALATE/scripts/reference-capture/setup.sh" --with-taste` fetches it
  once, or `PALATE_TASTE=1` authorises the download in place. Say the size; a third of a gigabyte
  arriving unasked is not acceptable.
- `uniform-image`: the page rendered as a flat fill, so it did not render. That is a build
  problem, not a taste problem. Scoring it would report a blank capture as roughly p87.
- `not-a-desktop-viewport-still`: the capture is the wrong shape. The head only sees 1440x900.
- `low-texture` in `flags`: scored, but check it by hand. A minimal dark hero and a stuck
  preloader look the same to a statistic.

## 5. Report

```
appearance drift, measured locally against each route's own baseline
review threshold 0.08

/            0.004   held steady        (baseline 2026-07-12)
/contact     0.191   MOVED              (baseline 2026-07-12)
             If that was intended, accept it and re-baseline with /palate-website-builder:drift --rebaseline.
             If not, the layout or tokens moved further than the copy did.
/blog        NOT MEASURED (uniform-image): the hero rendered as a flat fill.

This is distance, not quality. It says the page moved; it does not say the move was good.
Whether the move was an improvement is the paid half. The library percentile comes from `palate_taste_score` (which `grade-local.mjs` calls); the shareable number out of 100 comes from /palate-website-builder:grade. They are two different numbers and this paragraph exists to keep them apart.
```

Baselines hold numbers, never pixels. Do not write screenshots into `.palate/baselines/`; every
superseded image would be permanent and the history could not be un-fattened without a rewrite.
