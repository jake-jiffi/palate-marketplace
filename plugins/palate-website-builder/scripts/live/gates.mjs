// The checks a live project runs on its built site before it may be called done and released:
// SEO, facts and taste. Each one reads evidence the build cannot fake by declaration alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fail, confined, json } from './project.mjs';

const runtimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Installed package: scripts/gate-*.mjs. Pinned runtime: .palate/runtime/gates/gate-*.mjs.
const gatePath = name => path.join(runtimeRoot, fs.existsSync(path.join(runtimeRoot, 'digest.json')) ? 'gates' : '', name);

function runGate(project, name) {
  const result = spawnSync(process.execPath, [gatePath(name), project], { cwd: project, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}`.trim() || result.error?.message || '' };
}

/** gate-seo over the built output. Clean only: a partial pass has unknowns, and unknown is not clean. */
export function seoCheck(project) {
  const { status, output } = runGate(project, 'gate-seo.mjs');
  return { ok: status === 0, scope: 'seo', output };
}

const visibleText = html => html
  .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ').trim().toLowerCase();

function builtPage(project, page) {
  const route = page.replace(/[?#].*$/, '').replace(/^\/*/, '');
  const candidates = route.endsWith('.html') ? [route] : [path.join(route, 'index.html'), `${route.replace(/\/$/, '')}.html`];
  for (const candidate of candidates) {
    const file = confined(project, path.join('dist', candidate));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return fs.readFileSync(file, 'utf8');
  }
  return null;
}

/**
 * Facts: gate-facts finds the site contradicting itself, and .palate/evidence/facts.json lists the
 * factual claims the built pages make, each quoted verbatim from its page and checked against the
 * client's own source. An invented year, spec or testimonial passes every other gate, so the claim
 * list is where it has to be caught.
 */
export function factsCheck(project) {
  const problems = [];
  const gate = runGate(project, 'gate-facts.mjs');
  if (gate.status !== 0) return { ok: false, scope: 'facts', problems: ['gate-facts could not read the built site; run npm run build first.'], output: gate.output };
  let evidence;
  try { evidence = json(confined(project, '.palate/evidence/facts.json')); } catch {
    return { ok: false, scope: 'facts', problems: ['Write .palate/evidence/facts.json: {"claims":[{"page":"/about/","quote":"<verbatim from the page>","source":"<the client page or profile fact it rests on>","verdict":"supported"}]}. See references/live-build.md.'], output: gate.output };
  }
  const claims = Array.isArray(evidence?.claims) ? evidence.claims : null;
  if (!claims) problems.push('facts.json needs a "claims" array.');
  else if (!claims.length && !(typeof evidence.noClaims === 'string' && evidence.noClaims.trim())) problems.push('No claims listed. A site that states no facts says so with "noClaims":"<reason>".');
  for (const [index, claim] of (claims || []).entries()) {
    const at = `Claim ${index + 1}`;
    if (!claim || typeof claim.page !== 'string' || typeof claim.quote !== 'string' || claim.quote.trim().length < 3 || typeof claim.source !== 'string' || !claim.source.trim()) { problems.push(`${at} needs page, a verbatim quote and the source it rests on.`); continue; }
    if (claim.verdict !== 'supported') { problems.push(`${at} ("${claim.quote}") is ${claim.verdict || 'unchecked'}: correct it to what the source says, or remove it from ${claim.page}.`); continue; }
    const html = builtPage(project, claim.page);
    if (html === null) problems.push(`${at}: ${claim.page} is not a built page.`);
    else if (!visibleText(html).includes(visibleText(claim.quote))) problems.push(`${at}: "${claim.quote}" does not appear on ${claim.page}; quote the page exactly.`);
  }
  // gate-facts prints each disagreement as "  [label] N values across ...". Each one is either
  // fixed or explained; a site saying 41 reviews here and 42 there is not left to chance.
  const explained = new Set((Array.isArray(evidence?.disagreements) ? evidence.disagreements : []).filter(d => d && typeof d.reason === 'string' && d.reason.trim()).map(d => d.label));
  for (const [, label] of gate.output.matchAll(/^\s+\[([^\]]+)\] \d+ values across/gm)) {
    if (!explained.has(label)) problems.push(`The site gives two values for "${label}" (see the gate output). Make them agree, or explain in facts.json "disagreements":[{"label":"${label}","reason":"..."}].`);
  }
  return { ok: !problems.length, scope: 'facts', claims: claims?.length || 0, problems, output: gate.output };
}

/**
 * Taste is the local grade's pairwise ladder against library exemplars: a second judge that is
 * not the builder and not the critic. Passed only when the ladder reads the site comparable or
 * better with no flattery risk. A ladder that could not run is recorded as unjudged, by name.
 */
export function tasteEvidence(project, review) {
  let grade;
  try { grade = JSON.parse(fs.readFileSync(confined(project, review.path), 'utf8')); } catch { fail('Taste evidence must be the local grade (local-grade.json from grade-local.mjs).'); }
  const ladder = grade && typeof grade.ladder === 'object' ? grade.ladder : null;
  if (!ladder) fail('Taste evidence has no ladder; supply local-grade.json from grade-local.mjs.');
  if (ladder.applicable !== true) {
    if (typeof review.unjudged !== 'string' || !review.unjudged.trim()) fail(`The ladder did not run (${ladder.reason || 'no reason given'}). Run it, or record why with "unjudged":"<reason>".`);
    return { unjudged: review.unjudged.trim() };
  }
  const good = ['comparable', 'better'].includes(ladder.rung) && !grade.flattery?.risk;
  if (review.result === 'passed' && !good) fail(`The local grade reads this site ${String(ladder.rung || 'unknown').replace(/_/g, ' ')} than its exemplar${grade.flattery?.risk ? ', with flattery risk' : ''}. Improve it and grade again; taste cannot be marked passed.`);
  return { rung: ladder.rung };
}

/** A release receipt: the site answers at the URL it was deployed to. */
export async function probeRelease(input) {
  let url;
  try { url = new URL(input.url); } catch { fail('Release needs the deployed "url".'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) fail('Release url must be the public https URL, without credentials.');
  if (typeof input.host !== 'string' || !input.host.trim()) fail('Release needs the "host" it was deployed to.');
  let response;
  try { response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch (error) { fail(`The deployed site did not answer at ${url.href}: ${error.message}`, 'NOT_LIVE'); }
  if (!response.ok) fail(`The deployed site answered ${response.status} at ${url.href}.`, 'NOT_LIVE');
  return { url: url.href, host: input.host.trim(), production: input.production === true, status: response.status };
}
