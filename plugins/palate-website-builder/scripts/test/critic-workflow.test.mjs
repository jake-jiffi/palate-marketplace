import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Instruction and packaging contracts only. These do not prove native model compliance.
const root = process.env.PALATE_CRITIC_PACKAGE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const entry = fs.existsSync(path.join(root, 'skills/palate-website-builder/SKILL.md'))
  ? 'skills/palate-website-builder/SKILL.md' : 'SKILL.md';
const skill = read(entry), live = read('references/live-build.md');
const protocol = read('references/critic-review.md');

test('host skill, live workflow, command and agent resolve the same critic protocol', () => {
  for (const file of [entry, 'references/live-build.md', 'agents/palate-critic.md', 'commands/jury.md', 'commands/grade.md', 'agents/palate-verifier.md']) {
    const links = [...read(file).matchAll(/\]\(([^)]*critic-review\.md(?:#[^)]*)?)\)/g)];
    assert.ok(links.length, `${file} has no critic protocol link`);
    for (const [, target] of links) {
      assert.equal(path.resolve(root, path.dirname(file), target.split('#')[0]), path.join(root, 'references/critic-review.md'), file);
    }
  }
  const agent = read('agents/palate-critic.md');
  assert.match(agent, /^---\nname: palate-critic\ndescription: [^\n]+\n---/);
  assert.match(read('commands/jury.md'), /^---\ndescription: [^\n]+\nargument-hint:/);
  assert.match(read('commands/README.md'), /:jury`/);
});

test('live checkpoints occur after selection and before final handover without delaying options', () => {
  const select = live.indexOf('Use `node scripts/palate.mjs select`');
  const direction = live.indexOf('**selected-direction pass**');
  const fullSite = live.indexOf('Finish all promised routes');
  const final = live.indexOf('**final-site pass**');
  const handover = live.indexOf('Reopen the preview after the native session returns');
  assert.ok(select >= 0 && select < direction && direction < fullSite);
  assert.ok(fullSite < final && final < handover);
  assert.match(live, /after the initial live options were shared, not as a gate on every option/);
  assert.match(skill, /Small edits do not restart this process/);
  assert.match(skill, /jury entry point/);
  assert.match(skill, /takes precedence over the legacy build route/);
  assert.ok(skill.indexOf('Explicit jury review') < skill.indexOf('Existing local codebase without that marker'));
});

test('correction, escalation and final repair share one persistent allowance', () => {
  assert.match(protocol, /at most four total builder revision rounds/);
  assert.match(protocol, /Lightweight corrections, escalated jury revisions and final repairs \*\*all consume the same allowance/);
  assert.match(protocol, /Three rounds consumed means at most one remains, including any final repair/);
  assert.match(protocol, /two consecutive rounds show no evidence-backed improvement/);
  assert.match(protocol, /initial critique can meet the target without a builder round/);
  assert.match(protocol, /Before delegating each builder/);
  assert.match(protocol, /persist the consumed round count, including interrupted builder attempts/);
  assert.match(protocol, /Escalation, a stage change, a command or a session restart does not reset/);
  assert.match(protocol, /Only a genuinely new user-authorised direction or scope/);
  assert.match(protocol, /target not met/);
});

test('coordinator escalates observed craft gaps without manual invocation or rating prerequisite', () => {
  assert.match(skill, /autonomously escalate/);
  assert.match(skill, /no manual jury request or rating event is needed/);
  assert.match(protocol, /The coordinator owns escalation/);
  assert.match(protocol, /Do not wait for a manual jury request, a ladder result or a rating event/);
  assert.match(protocol, /Design below 9, Creativity or Motion below 8/);
  assert.match(protocol, /useful signals, not required triggers/);
  assert.match(protocol, /Do not merely list those gaps at handover/);
  assert.match(protocol, /not a prerequisite or a hard ceiling/);
  assert.match(protocol, /arbitrary spacing tweaks for a missing creative idea/);
  assert.match(protocol, /proceed without routine approval pauses/);
  assert.match(protocol, /Missing browser evidence, credentials or an external service are different/);
  assert.match(protocol, /the evidence justifying escalation/);
  assert.match(read('commands/jury.md'), /additional entry, not a prerequisite/);
  for (const text of [skill, live, protocol, read('README.md')]) {
    assert.doesNotMatch(text, /at most one focused correction round|Explicitly requested through `jury`|without restarting aesthetic iteration|instead of starting another aesthetic loop/);
  }
});

test('actual independent delegation, completion and unavailable-tool outcomes are explicit', () => {
  for (const text of ['actual agent tools', 'separate builder', 'Do not end the task after delegation', 'Wait for completion or a specific blocker', 'resolved, unresolved or regressed', 'fresh critic', 'independence was unavailable', 'unverified behaviour']) {
    assert.ok(protocol.includes(text), text);
  }
  assert.match(read('agents/palate-critic.md'), /do not attempt nested delegation/i);
  assert.match(protocol, /In Codex, or without a registered agent/);
  assert.match(protocol, /Respect review-only requests and explicit limits on testing or changes/);
});

test('critic checkpoints do not fall through to the grading instrument or legacy verifier', () => {
  assert.match(protocol, /does not invoke .*:grade`/);
  assert.match(protocol, /pairwise judge swarms/);
  const grade = read('commands/grade.md');
  assert.ok(grade.indexOf('Their internal scores do not trigger') < grade.indexOf('## A site can always be graded'));
  assert.match(grade, /Preserve an explicit request for this grading instrument as a separate task/);
  const verifier = read('agents/palate-verifier.md');
  assert.ok(verifier.indexOf('Do not execute the legacy gate list below') < verifier.indexOf('## What to run'));
  assert.match(verifier, /Return the independent .* to the main coordinator/);
});

test('jury weights, separate motion and unverified core journeys cannot be averaged into a pass', () => {
  const weights = [...protocol.matchAll(/^\| (Design|Usability|Creativity|Content) \| (\d+)% \|$/gm)]
    .map(([, name, value]) => [name, Number(value)]);
  assert.deepEqual(weights, [['Design', 40], ['Usability', 30], ['Creativity', 20], ['Content', 10]]);
  assert.equal(weights.reduce((sum, [, weight]) => sum + weight, 0), 100);
  assert.match(protocol, /overall = 0\.40 \* Design \+ 0\.30 \* Usability \+ 0\.20 \* Creativity \+ 0\.10 \* Content/);
  assert.match(protocol, /Functionality, Completeness, Accessibility and Motion/);
  assert.match(protocol, /at least 8 in every category and overall, with Design at least 9/);
  assert.match(protocol, /If a weighted category is unverified, withhold the overall/);
  assert.match(protocol, /broken or unverified core workflow prevents a pass/);
  assert.match(protocol, /Normal motion is the primary experience/);
  assert.match(protocol, /visible changes between them/);
  assert.match(protocol, /already-open door, final transform or drawn line does not prove/);
});

test('references, product identity, evidence and project-state boundaries survive packaging', () => {
  for (const text of ['at least three relevant outstanding references', 'Keep the reference set stable', 'selected direction, identity, genuine imagery, factual claims, important URLs and core journeys', 'offline, permission and saved-data-after-refresh', 'validity.sourceFingerprint', 'Never hand-edit `palate.project.json`', 'not runtime verification or a deployment receipt', 'existing issue tracker', 'Do not commission a full rebuild']) {
    assert.ok(protocol.includes(text), text);
  }
  assert.match(read('commands/jury.md'), /preview URL without editable source permits critique only/);
});
