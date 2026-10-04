/**
 * vitals.mjs - Core Web Vitals measured locally, in the same lab conditions PageSpeed uses.
 *
 * VENDORED IN TWO REPOSITORIES, byte-identical, hash-pinned. Same contract as
 * design-measure.mjs:
 *   canonical  ~/dev/palate/skill/scripts/reference-capture/vitals.mjs
 *   vendored   palate-product/apps/grader/worker/src/vitals.mjs
 *
 * WHY. The grader scores all 17 points of performance from one PageSpeed call. The plugin
 * measures none of it and never has: the only performance claim in the whole doctrine is a
 * line in references/connective-tissue.md saying "Lighthouse 100 is the baseline", which is an
 * aspiration with no gate behind it. That is the single largest hole in the plugin-vs-grader
 * gap, 15.3 of the overall 100, and it is the likeliest reason a Palate rebuild would improve
 * a site's design and not move its grade.
 *
 * THE THROTTLING IS THE ENTIRE POINT, and measuring without it would be worse than not
 * measuring. PageSpeed's mobile lab simulates slow 4G with 4x CPU throttling, where ordinary
 * sites land at 5 to 12 seconds. An unthrottled local run on a developer laptop against
 * localhost reports an LCP around 0.3s for almost anything, so a gate built on it would pass
 * every build and then watch the same page score 40 on performance in the public grader. That
 * is precisely the divergence this work exists to close, so the numbers here are taken under
 * CDP network and CPU emulation matched to Lighthouse's mobile preset.
 *
 * WHAT IT DOES NOT CLAIM. This is a lab proxy, not field data, exactly as PSI's lab pass is.
 * TBT is not INP and is labelled TBT everywhere. Local numbers will not equal PSI's to the
 * decimal: PSI runs on Google's hardware from a different network position, and the honest
 * use of this is to catch the build that is obviously slow, not to predict a score to a point.
 */

export const VITALS_VERSION = '1.0.0';
// SHA-256 of this file with the hash value below blanked. Both repos assert it, and
// palate-product additionally diffs the two copies. See the header.
export const VITALS_SHA = 'd9f137c069f75bdeaa2fe1a59d5e80b787171421394da73ad8ad90fdf8ab7b93';

// Lighthouse's mobile preset, as documented for its simulated throttling. Copied here rather
// than referenced so the numbers are visible at the point they are applied.
export const MOBILE_THROTTLE = {
  rttMs: 150,
  throughputKbps: 1638.4,      // 1.6 Mbps down, Lighthouse's slow-4G figure
  uploadKbps: 750,
  cpuSlowdownMultiplier: 4,
};

/**
 * Measure LCP, CLS and Total Blocking Time on an already-created Playwright page.
 *
 * The page must NOT have been navigated yet: the observers have to be installed before the
 * document loads or LCP and CLS entries that fired during load are simply gone, and a page
 * that reported no LCP would look like a fast one.
 */
export async function measureVitals(page, url, { timeoutMs = 45000 } = {}) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: MOBILE_THROTTLE.rttMs,
      downloadThroughput: (MOBILE_THROTTLE.throughputKbps * 1024) / 8,
      uploadThroughput: (MOBILE_THROTTLE.uploadKbps * 1024) / 8,
    });
    await client.send('Emulation.setCPUThrottlingRate', { rate: MOBILE_THROTTLE.cpuSlowdownMultiplier });
  } catch (e) {
    // Throttling that silently failed would report a laptop-speed number as if it were a slow-4G
    // one, which is worse than no measurement: it would pass every build and surprise every
    // customer at grade time. So this is a refusal, not a degraded pass.
    try { await client.detach(); } catch {}
    return { applicable: false, reason: 'CDP throttling could not be applied (' + (e && e.message ? e.message : e) + '), so no lab-comparable number could be taken.' };
  }

  // Installed before navigation. buffered:true still misses entries on a document that has
  // already loaded, which is why the caller must hand over a fresh page.
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, longTasks: [] };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__vitals.lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__vitals.longTasks.push({ start: e.startTime, dur: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* an engine without these entry types reports zeroes, handled by the caller */ }
  });

  let navOk = true, navError = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  } catch (e) {
    navOk = false; navError = String(e && e.message ? e.message : e).slice(0, 160);
  }
  if (!navOk) {
    try { await client.detach(); } catch {}
    return { applicable: false, reason: 'the page did not load under mobile throttling within ' + Math.round(timeoutMs / 1000) + 's (' + navError + ').' };
  }

  // Settle so late-arriving images can still take LCP and so shifts after load are counted.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  const raw = await page.evaluate(() => {
    const v = window.__vitals || { lcp: 0, cls: 0, longTasks: [] };
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = (performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint') || {}).startTime || 0;
    let bytes = 0, scriptBytes = 0;
    for (const r of performance.getEntriesByType('resource')) {
      // transferSize is 0 cross-origin without Timing-Allow-Origin, so this UNDERCOUNTS on a
      // site with third parties and is reported as a floor rather than a total.
      bytes += r.transferSize || 0;
      if (r.initiatorType === 'script') scriptBytes += r.transferSize || 0;
    }
    return {
      lcpMs: v.lcp, clsScore: v.cls, fcpMs: fcp,
      longTasks: v.longTasks,
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : 0,
      loadEventEndMs: nav ? nav.loadEventEnd : 0,
      transferBytes: bytes, scriptBytes,
    };
  });

  try { await client.detach(); } catch {}

  // TBT: the portion of every long task beyond 50ms, inside a BOUNDED window. Lighthouse
  // measures FCP to interactive; leaving the window open through the settle counted the
  // analytics and lazy work that run after load and reported 3,232ms on our own homepage,
  // which would have failed a build for work no visitor waits on. Bounded at the load event
  // it reads as the blocking a visitor actually experiences before the page is usable.
  const tbtWindowEnd = raw.loadEventEndMs > raw.fcpMs ? raw.loadEventEndMs : Infinity;
  const tbtMs = raw.longTasks
    .filter((t) => t.start >= raw.fcpMs && t.start < tbtWindowEnd)
    .reduce((a, t) => a + Math.max(0, Math.min(t.dur, tbtWindowEnd - t.start) - 50), 0);

  return {
    applicable: true,
    lcpMs: Math.round(raw.lcpMs),
    clsScore: Math.round(raw.clsScore * 1000) / 1000,
    tbtMs: Math.round(tbtMs),
    fcpMs: Math.round(raw.fcpMs),
    transferBytes: raw.transferBytes,
    scriptBytes: raw.scriptBytes,
    throttling: MOBILE_THROTTLE,
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
// Linear between a good and a bad threshold. Matches the grader's interp() so the two sides
// convert a raw measurement into a score identically.
const interp = (value, good, bad) => (good < bad ? clamp01((bad - value) / (bad - good)) : clamp01((value - bad) / (good - bad)));

/**
 * Score vitals into the grader's performance checks. Same shape as scoreDesignFacts:
 * { id, raw, detail, lowConfidence, measured }, or applicable:false to stay unmeasured.
 *
 * Thresholds are Google's published Core Web Vitals boundaries, not ours.
 */
export function scoreVitals(v) {
  const out = [];
  const na = (id, why) => out.push({ id, raw: null, applicable: false, detail: why, lowConfidence: true });
  if (!v || !v.applicable) {
    for (const id of ['lcp', 'cls', 'responsiveness', 'js_execution_and_payload'])
      na(id, v && v.reason ? v.reason : 'Performance was not measured.');
    return out;
  }

  const lcpS = v.lcpMs / 1000;
  out.push({
    id: 'lcp', raw: interp(lcpS, 2.5, 4.0),
    detail: `Largest Contentful Paint ${lcpS.toFixed(1)}s under simulated slow 4G with 4x CPU throttling (good is under 2.5s, poor past 4.0s).`,
    lowConfidence: false, measured: { lcpMs: v.lcpMs, fcpMs: v.fcpMs },
  });
  out.push({
    id: 'cls', raw: interp(v.clsScore, 0.1, 0.25),
    detail: `Cumulative Layout Shift ${v.clsScore.toFixed(3)} (good is under 0.1). Reserve space for anything that arrives late: images without dimensions, fonts that swap, and injected banners.`,
    lowConfidence: false, measured: { cls: v.clsScore },
  });
  out.push({
    id: 'responsiveness', raw: interp(v.tbtMs, 200, 600),
    detail: `Total Blocking Time ${v.tbtMs}ms. This is a lab proxy for responsiveness, not INP, which cannot be measured from a page load.`,
    lowConfidence: true, measured: { tbtMs: v.tbtMs },
  });
  const scriptKb = Math.round(v.scriptBytes / 1024);
  out.push({
    id: 'js_execution_and_payload', raw: interp(scriptKb, 150, 600),
    detail: `${scriptKb}KB of JavaScript transferred on first load. Cross-origin resources without Timing-Allow-Origin report zero, so this is a floor rather than a total.`,
    lowConfidence: true, measured: { scriptKb, transferKb: Math.round(v.transferBytes / 1024) },
  });
  return out;
}
