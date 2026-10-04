import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { execute } from '../live/cli.mjs';
import { readState } from '../live/project.mjs';
import { declarations } from '../live/system.mjs';

const base = fs.realpathSync(os.tmpdir());
const SYSTEM = `:root { --heading-size-h1: 4rem; --text-size-regular: 1rem; --color-ink: #1d1d1b; }
h1, .heading-style-h1 { font-size: var(--heading-size-h1); }
h2, .heading-style-h2 { font-size: 3rem; }
h3, .heading-style-h3 { font-size: 2rem; }
h4, .heading-style-h4 { font-size: 1.5rem; }
h5, .heading-style-h5 { font-size: 1.25rem; }
h6, .heading-style-h6 { font-size: 1rem; }
.text-size-regular { font-size: var(--text-size-regular); }
.padding-global { padding-inline: 2rem; }
.container-large { max-width: 80rem; }
.padding-section-large { padding-block: 8rem; }
`;
function write(project, name, value) { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
async function mutate(project, command, value) {
  const file = path.join(path.dirname(project), `in-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(value));
  return execute({ command, project, input: file, expect: String(readState(project).revision), op: crypto.randomUUID() });
}
async function site(t, { select = true, system = SYSTEM } = {}) {
  const root = fs.mkdtempSync(path.join(base, 'palate-system-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'site');
  await execute({ command: 'init', project, expect: '0', op: 'init' });
  await mutate(project, 'source', { productKind: 'service', platform: 'wordpress', routes: ['/'], journeys: ['enquiry'] });
  for (const id of ['a', 'b']) {
    write(project, `src/directions/${id}/index.astro`, `<h1>${id}</h1>`);
    await mutate(project, 'option', { id, status: 'ready', label: id, previewUrl: `http://127.0.0.1:4321/_palate/directions/${id}` });
  }
  if (select) await mutate(project, 'select', { optionId: 'a' });
  if (system !== null) write(project, 'src/styles/system.css', system);
  return project;
}
const check = project => execute({ command: 'system', action: 'check', project });
const rules = result => result.failures.map(item => `${item.rule}:${item.file}:${item.property || ''}`);

test('before a direction is chosen, options are free to explore', async t => {
  const project = await site(t, { select: false, system: null });
  write(project, 'src/directions/a/index.astro', '<h1 class="big">a</h1><style>.big { font-size: 90px; color: #f00; }</style>');
  const result = await check(project);
  assert.equal(result.ok, true);
  assert.match(result.skipped, /starts at the pick/);
});

test('after the pick, the system must exist and define the shared structure and heading defaults', async t => {
  let project = await site(t, { system: null });
  assert.deepEqual(rules(await check(project)), ['system-missing:src/styles/system.css:']);
  project = await site(t, { system: 'h1 { font-size: 4rem; } .padding-global{} .container-large{}' });
  const result = await check(project);
  assert.deepEqual(result.failures.map(item => item.rule), ['system-incomplete', 'system-incomplete']);
  assert.match(result.failures[0].detail, /\.padding-section-, \.heading-style-h1/);
  assert.match(result.failures[1].detail, /h2, h3, h4, h5, h6/);
});

test('type and colour literals outside the system fail; tokens, relative units and keywords pass', async t => {
  const project = await site(t);
  write(project, 'src/components/Card.astro', `<p class="lede">x</p><style>
  .lede { font-size: 18px; line-height: 1.4; font-weight: 600; color: #222; letter-spacing: -0.02em; }
  .ok { font-size: var(--text-size-regular); line-height: inherit; font-weight: var(--weight, 600); font-family: var(--font-body), sans-serif; color: var(--color-ink); font-size: 1.2em; }
  .mixed { font-size: clamp(var(--a), 5vw, var(--b)); background: rgba(0, 0, 0, .4); border: 1px solid white; }
  .fine { font-size: calc(var(--text-size-regular) * 1.25); background: transparent url(/x.png); color: currentColor; }
</style>`);
  const result = await check(project);
  assert.deepEqual(rules(result).sort(), [
    'colour-literal:src/components/Card.astro:background', 'colour-literal:src/components/Card.astro:border', 'colour-literal:src/components/Card.astro:color',
    'type-literal:src/components/Card.astro:font-size', 'type-literal:src/components/Card.astro:font-size', 'type-literal:src/components/Card.astro:font-weight', 'type-literal:src/components/Card.astro:line-height',
  ].sort());
  assert.equal(result.failures.find(item => item.property === 'line-height').line, 2);
});

test('a heading is sized only by the system, even with a token, wherever its rule lives', async t => {
  const project = await site(t);
  write(project, 'src/components/Family.astro', '<h3 class="fam__name">Doors</h3><h2 class="heading-style-h3 enq">Enquire</h2><style>.fam__name { font-size: var(--heading-size-h2); } .enq { color: var(--color-ink); }</style>');
  write(project, 'src/styles/pages.css', '.page-hero h1 { font-size: var(--heading-size-h1); } .page-hero .kicker { font-size: var(--text-size-regular); }');
  const result = await check(project);
  assert.deepEqual(rules(result).sort(), ['heading-size-outside-system:src/components/Family.astro:font-size', 'heading-size-outside-system:src/styles/pages.css:font-size']);
});

test('a written reason turns a failure into a recorded exception', async t => {
  const project = await site(t);
  write(project, 'src/components/Hero.astro', `<h1 class="mega">Hi</h1><style>
  /* system: the opening line is set once at poster scale */
  .mega { font-size: 12vw; }
  .note { color: #b00; } /* system: legal red from the licence notice */
</style>`);
  const result = await check(project);
  assert.equal(result.ok, true);
  assert.deepEqual(result.exceptions.map(item => [item.rule, item.reason]), [['heading-size-outside-system', 'the opening line is set once at poster scale'], ['colour-literal', 'legal red from the licence notice']]);
});

test('spacing literals warn without failing, and discarded directions, font descriptors and the style guide are out of scope', async t => {
  const project = await site(t);
  write(project, 'src/components/Band.astro', '<section><style>.band { padding: 112px 0; gap: 24px; margin-top: var(--space-large); }</style></section>');
  write(project, 'src/directions/b/index.astro', '<h1 class="x">b</h1><style>.x { font-size: 90px; color: red; }</style>');
  write(project, 'src/style-guide/index.astro', '<p style="font-size: 13px; color: #999">specimen</p>');
  write(project, 'src/styles/fonts.css', "@font-face { font-family: 'Brand'; font-weight: 400; src: url(/brand.woff2); }");
  const result = await check(project);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.summary.spacingLiterals, 2);
  assert.deepEqual(result.spacingWarnings, [{ file: 'src/components/Band.astro', literals: 2 }]);
});

test('inline style attributes are checked like stylesheet rules', async t => {
  const project = await site(t);
  write(project, 'src/pages/index.astro', '<p style="font-size: 14px">x</p>');
  assert.deepEqual(rules(await check(project)), ['type-literal:src/pages/index.astro:font-size']);
});

test('the check exits non-zero through the project wrapper, so verify can require it', async t => {
  const project = await site(t);
  write(project, 'src/components/Card.astro', '<style>.c { font-size: 17px; }</style>');
  let run = spawnSync(process.execPath, [path.join(project, 'scripts/palate.mjs'), 'system', 'check'], { cwd: project, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).summary.typeLiterals, 1);
  write(project, 'src/components/Card.astro', '<style>.c { font-size: var(--text-size-regular); }</style>');
  run = spawnSync(process.execPath, [path.join(project, 'scripts/palate.mjs'), 'system', 'check'], { cwd: project, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout);
});

test('verify requires the system scope and refuses any other command claiming it', async t => {
  const project = await site(t);
  write(project, '.palate/evidence/browser.json', '{}');
  const missing = await mutate(project, 'verify', { commands: [], reviews: [{ scope: 'browser', path: '.palate/evidence/browser.json', result: 'passed' }] });
  assert.ok(missing.verification.required.includes('system'));
  assert.equal(missing.verification.result, 'failed');
  await assert.rejects(mutate(project, 'verify', { commands: [{ scope: 'system', argv: ['true'] }] }), /system scope must execute/);
});

test('the CSS reader keeps nested selectors, quoted text and line numbers straight', () => {
  const found = declarations('@media (min-width: 40rem) {\n  .a { content: "x;y"; font-size: 2rem; }\n}\n.b{color:red}');
  assert.deepEqual(found.map(item => [item.selector, item.property, item.line]), [['.a', 'content', 2], ['.a', 'font-size', 2], ['.b', 'color', 4]]);
});
