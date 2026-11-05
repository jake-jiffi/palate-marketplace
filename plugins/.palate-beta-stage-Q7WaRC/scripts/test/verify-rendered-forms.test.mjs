/**
 * The form round-trip and the mobile nav, driven for real.
 *
 * A BROWSER SUITE. It is in the SLOW list in run.sh, so --fast skips it; run it by hand.
 *
 * The complaint it answers: `references/testing.md` described a post-deploy test that submits
 * the contact form, and nothing anywhere submitted anything. A broken endpoint, a wrong
 * Turnstile key, a submit handler that never bound: all of them shipped silently, because
 * every check this gate ran read a page and none of them pressed a button.
 *
 * So the gate now fills the form with valid values, presses submit with `x-palate-smoke: 1`
 * set on the page, and reads the endpoint's answer. The directions that matter:
 *
 *   IT REACHES THE ENDPOINT      a 2xx carrying `smoke: true` is the only pass.
 *   A REAL SEND IS A FAILURE     a 200 without the flag means the smoke header was ignored
 *                                and the submission took the real path, which on a live site
 *                                is an enquiry in the client's inbox. Reported as such.
 *   NO REQUEST IS A FAILURE      a submit handler that never bound looks identical to a
 *                                working form until something presses the button.
 *   NO FORM IS A SKIP            a brochure site with no contact form has not failed, and
 *                                the run says it inspected none rather than going quiet.
 *   A FAILED PROBE IS NOT BANKED the incremental record must not carry the route forward as
 *                                passing, or the next run skips the route that broke.
 *   THE ENDPOINT IS AN INPUT     editing `src/pages/api/contact.ts` changes nothing in any
 *                                page's import closure, so without it in the global digest
 *                                every page stays "unchanged, skipped" on exactly the run
 *                                where the endpoint is what moved.
 *
 * The nav probe opens the disclosure at 390, asserts the target became visible, presses
 * Escape and asserts it closed. A nav that opens and cannot be dismissed from the keyboard
 * traps a keyboard-only visitor on a full-screen overlay.
 *
 * The server is an in-process node:http listener on port 0, so two of these can run at once
 * in sibling worktrees without a port to collide over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VR = join(HERE, '..', 'reference-capture', 'verify-rendered.mjs');

// Two named faces and a readable measure, not because this suite grades typography but
// because the hygiene score files a High against `/` when it does not clear its floor, and
// that High would delete the home route's record and mask what these tests are about.
const shell = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:16px/1.6 Verdana,Geneva,sans-serif;color:#1a1a1a;background:#fff}
main{max-width:34rem;margin:0 auto;padding:2rem}
h1,h2{font-family:Georgia,'Times New Roman',serif}h1{font-size:2.5rem}
label{display:block;margin-top:1rem}
input,textarea{font:inherit;padding:.6rem;border:1px solid #555;min-height:44px;width:18rem}
a,button{color:#0b4a6f;min-height:44px;display:inline-block}
:focus-visible{outline:3px solid #0b4a6f}
[hidden]{display:none}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;

const FILLER = '<p>A paragraph of ordinary body copy so the accessibility pass has something ' +
  'real to read on this route, rather than scanning a blank page.</p>';

// Set per fixture, read by contactPage. A module-level switch keeps every existing call site
// and every existing assertion untouched.
let SHAPE = 'plain';

/**
 * The contact page. `behaviour` decides what its submit handler does, which is the only thing
 * that changes between the fixtures: the markup is the shipped template's shape throughout
 * (no `action` attribute, a JSON fetch from a script), because that shape is exactly what a
 * probe keyed on `form[action="/api/contact"]` alone would never see.
 */
/**
 * The shapes a real build produces that the probe used to get wrong.
 *
 *   duplicate  a `display: none` copy kept for a breakpoint, ABOVE the working one. The probe
 *              took the first form in DOM order and spent five seconds waiting for a submit
 *              control it could never click, then filed a High about a pointer.
 *   modal      the form inside a <dialog> the disclosure probe had just certified in the same
 *              run. Same five-second timeout, same High, on ordinary work.
 *   renamed    `full-name` instead of `name`, which is what an agent writes when it is not
 *              copying ContactForm.astro. The form was invisible to the probe and the run said
 *              "no contact form", which is a claim about the site rather than about the probe.
 */
function shapedForm(shape, fields) {
  if (shape === 'duplicate') {
    return `<form id="cf-dup" style="display:none">${fields}<button type="submit">Send</button></form>`;
  }
  if (shape === 'unreadable') {
    // Visible, two real fields, and nothing the probe can key on: no action, no name/email/
    // message, no email input, no textarea. It is not a contact form and may never be one, but
    // the run must say it could not read it rather than implying the page has no form.
    return '<form id="booking"><label for="br">Reference</label><input id="br" name="booking-ref">' +
      '<label for="bd">Date</label><input id="bd" name="enquiry-body" type="date">' +
      '<button type="submit">Check</button></form>';
  }
  return '';
}

function contactPage(behaviour) {
  const send = {
    posts: `await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.name.value, email: f.email.value, message: f.message.value }) });`,
    silent: `/* the handler that never sends: bound, prevents the default, and does nothing */`,
    // A REAL, REACHABLE third party. It used to be a host that does not resolve, which meant the
    // test passed whether or not the submission was blocked: the assertion that matters is that
    // nothing was DELIVERED, and only a listening server can show that.
    elsewhere: `await fetch("__THIRD__/submit", { method: "POST", body: "x" }).catch(() => {});`,
  }[behaviour];
  const nameField = SHAPE === 'renamed' ? 'full-name' : 'name';
  const inner = `
      <label for="cf-name">Name</label><input id="cf-name" name="${nameField}" type="text" required />
      <label for="cf-email">Email</label><input id="cf-email" name="email" type="email" required />
      <label for="cf-message">Message</label><textarea id="cf-message" name="message" rows="4" required></textarea>`;
  // A WORKING dialog, opened and closed correctly, which is the critic's actual scenario: the
  // disclosure probe certifies it in the same run and the form probe must then not fail the
  // form inside it. A trigger wired to nothing would fail the run for an unrelated reason.
  const open = SHAPE === 'modal'
    ? '<button id="enqBtn" commandfor="enq" aria-haspopup="dialog">Enquire</button><dialog id="enq">'
    : '';
  const close = SHAPE === 'modal'
    ? '</dialog><script>const enqEl=document.getElementById("enq");' +
      'document.getElementById("enqBtn").addEventListener("click",()=>enqEl.showModal());</script>'
    : '';
  return shell('Contact', `${FILLER}
    ${shapedForm(SHAPE, inner)}
    ${open}
    <form id="contact-form" novalidate>${inner}
      <button type="submit">Send message</button>
    </form>
    ${close}
    <script>
      const f = document.getElementById("contact-form");
      f.addEventListener("submit", async (e) => { e.preventDefault(); ${send} });
    </script>`);
}

/**
 * The home page, with a mobile nav disclosure. `nav` picks which of the three behaviours it
 * has: correct, opens but ignores Escape, or a button wired to nothing at all.
 */
function dialogMarkup(mode) {
  if (mode === 'none') return '';
  // A NATIVE <dialog> reached through commandfor, which is the shape a trigger with no
  // aria-controls and no inline handler takes. Escape closes it for free unless cancel is
  // prevented, which is exactly the fault worth catching.
  const cancel = mode === 'traps' ? 'dlgEl.addEventListener("cancel", (e) => e.preventDefault());' : '';
  const open = mode === 'dead' ? '' : 'dlgBtn.addEventListener("click", () => dlgEl.showModal());';
  // The names are prefixed because classic inline scripts SHARE one top-level scope: a second
  // `const b` on the same page is a SyntaxError that kills the whole later script, and the nav
  // then genuinely does not open. The probe was right about that and the fixture was wrong.
  return `
    <button id="dlgbtn" commandfor="dlg" aria-haspopup="dialog">Book a call</button>
    <dialog id="dlg"><h2>Book a call</h2><p>Pick a time that suits.</p>
      <button id="dlgclose">Close</button></dialog>
    <script>
      const dlgEl = document.getElementById("dlg");
      const dlgBtn = document.getElementById("dlgbtn");
      ${open}
      ${cancel}
      document.getElementById("dlgclose").addEventListener("click", () => dlgEl.close());
    </script>`;
}

function homePage(nav, dialog = 'none', thirdParty = '') {
  // TWO subresources: one straight to the third party, and one to a SAME-ORIGIN path that
  // redirects there. The second is the shape that defeated the origin check, because the
  // request the handler sees is same-origin and the one that arrives at the third party is not.
  const pixel = thirdParty
    ? `<img src="${thirdParty}/pixel.png" alt="" width="1" height="1">` +
      '<img src="/redirects-away" alt="" width="1" height="1">'
    : '';
  if (nav === 'none') return shell('Home', FILLER + pixel + dialogMarkup(dialog));
  const escape = nav === 'traps'
    ? '/* no Escape handler: the trap */'
    : `document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });`;
  const open = nav === 'dead'
    ? '/* the button is bound to nothing */'
    : `b.addEventListener("click", () => {
         const isOpen = b.getAttribute("aria-expanded") === "true";
         if (isOpen) close(); else { b.setAttribute("aria-expanded", "true"); p.hidden = false; }
       });`;
  return shell('Home', `${FILLER}${pixel}${dialogMarkup(dialog)}
    <button id="navbtn" aria-controls="navpanel" aria-expanded="false">Menu</button>
    <div id="navpanel" hidden><a href="/contact">Contact</a></div>
    <script>
      const b = document.getElementById("navbtn");
      const p = document.getElementById("navpanel");
      function close() { b.setAttribute("aria-expanded", "false"); p.hidden = true; }
      ${open}
      ${escape}
    </script>`);
}

/**
 * A fixture project plus its server.
 *
 * `endpoint` decides what /api/contact answers, which is how a broken deployment is
 * reproduced without breaking the handler under test.
 */
async function makeFixture({ form = 'posts', nav = 'none', dialog = 'none', endpoint = 'smoke', thirdParty = false, shape = 'plain' } = {}) {
  SHAPE = shape;
  const root = mkdtempSync(join(tmpdir(), 'palate-forms-'));
  for (const d of ['src/pages', 'src/pages/api', 'src/styles', 'src/layouts', '.palate']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'src', 'styles', 'globals.css'), ':root { --ink: #1a1a1a; }\n');
  writeFileSync(join(root, 'src', 'layouts', 'BaseLayout.astro'), '---\nimport "../styles/globals.css";\n---\n<slot />\n');
  writeFileSync(join(root, 'astro.config.mjs'), 'export default { output: "static" };\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }, null, 2));
  writeFileSync(join(root, 'src', 'pages', 'index.astro'), '---\n---\n<h1>Home</h1>\n');
  writeFileSync(join(root, 'src', 'pages', 'contact.astro'), '---\n---\n<h1>Contact</h1>\n');
  writeFileSync(join(root, 'src', 'pages', 'api', 'contact.ts'), 'export const POST = async () => new Response("{}");\n');

  const routes = [
    { path: '/', source: 'src/pages/index.astro', kind: 'static', dependsOn: [], links: [] },
    { path: '/contact', source: 'src/pages/contact.astro', kind: 'static', dependsOn: [], links: [] },
  ];
  writeFileSync(join(root, '.palate', 'index.json'), JSON.stringify({
    root, routes, entries: [], counts: { routes: routes.length, entries: 0, drafts: 0 },
    links: { parsed: 0, files: 0, orphans: [], dead: [], stale: 0 },
  }, null, 2));

  // THE THIRD PARTY. A separate origin on its own ephemeral port, recording every request it
  // receives with its headers, so two things become assertable rather than assumed: that no
  // cross-origin POST is delivered, and that the smoke SECRET never leaves for a host that has
  // no business holding it.
  const thirdSeen = [];
  let thirdUrl = '';
  let thirdServer = null;
  if (thirdParty) {
    thirdServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        thirdSeen.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    await new Promise((ok) => thirdServer.listen(0, '127.0.0.1', ok));
    thirdUrl = `http://127.0.0.1:${thirdServer.address().port}`;
  }

  const posts = [];
  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
    if (path === '/api/contact' && req.method === 'POST') {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        posts.push({ headers: req.headers, body: raw });
        const smoke = req.headers['x-palate-smoke'] === '1';
        if (endpoint === 'redirects') {
          res.writeHead(307, { location: thirdUrl + '/handed-over' });
          res.end();
          return;
        }
        const answers = {
          // The correct handler: the header is honoured and nothing is sent.
          smoke: smoke ? [200, { ok: true, smoke: true }] : [200, { ok: true }],
          // The header is ignored, so a live deployment would have sent a real enquiry.
          ignores: [200, { ok: true }],
          // Validation is broken, or the mail provider is refusing.
          broken: [500, { error: 'submission failed' }],
          // What the real endpoint answers once the smoke header has been REFUSED: the real
          // path runs and Turnstile turns down a token the probe never had. This is what an
          // unbaked build looks like from the outside, and it looks like nothing else.
          refuses: [400, { error: 'verification failed' }],
          // The route is not being served: a build missing it, or a plain static file server
          // standing in for `npm run preview`, which runs the adapter.
          absent: [404, { error: 'not found' }],
          // Same-origin, and it hands the submission to another host. Playwright does NOT run a
          // route handler for a request produced by a redirect, so before the fix the browser
          // followed this and delivered the body AND the injected secret to the second origin.
          redirects: [307, null],
        }[endpoint];
        res.writeHead(answers[0], { 'content-type': 'application/json' });
        res.end(JSON.stringify(answers[1]));
      });
      return;
    }
    if (path === '/redirects-away' && thirdUrl) {
      res.writeHead(302, { location: thirdUrl + '/followed-from-same-origin' });
      res.end();
      return;
    }
    const body = path === '/' ? homePage(nav, dialog, thirdUrl)
      : path === '/contact' ? contactPage(form).replace(/__THIRD__/g, thirdUrl || 'https://forms.example.invalid')
      : null;
    if (!body) { res.writeHead(404, { 'content-type': 'text/html' }); res.end(shell('Not found', '<p>No such page.</p>')); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    root, server, posts, thirdSeen, thirdUrl, index: join(root, '.palate', 'index.json'),
    url: `http://127.0.0.1:${server.address().port}`,
    out: join(root, '.palate-shots'),
    stop() { server.close(); if (thirdServer) thirdServer.close(); rmSync(root, { recursive: true, force: true }); },
  })));
}

function runGate(argv, env = {}) {
  return new Promise((done) => {
    const p = spawn('node', [VR, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => done({ out, status }));
  });
}
const gate = (fx, extra = [], env = {}) => runGate(['--url', fx.url, '--index', fx.index, '--no-vitals', ...extra], env);

test('a working form is submitted once, with the smoke header, and passes', async (t) => {
  const fx = await makeFixture({ form: 'posts' });
  t.after(() => fx.stop());
  const r = await gate(fx);

  assert.equal(fx.posts.length, 1, `the form was posted ${fx.posts.length} times, not once`);
  assert.equal(fx.posts[0].headers['x-palate-smoke'], '1', 'the smoke header did not reach the endpoint');
  const sent = JSON.parse(fx.posts[0].body);
  assert.equal(sent.name.trim().length > 0, true, 'the name field was submitted empty');
  assert.match(sent.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `the email field was filled with "${sent.email}"`);
  assert.equal(sent.message.trim().length > 0, true, 'the message field was submitted empty');
  assert.match(r.out, /form round trip: \/contact answered 200 with smoke: true/,
    `the pass was not reported\n${r.out.slice(-1200)}`);
  assert.ok(!/\[High\].*form round trip/.test(r.out), `a clean fixture produced a form finding\n${r.out.slice(-1200)}`);
});

test('an endpoint that ignores the smoke header is a failure, named as a real send', async (t) => {
  const fx = await makeFixture({ form: 'posts', endpoint: 'ignores' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[High\].*form round trip/, `no High was filed\n${r.out.slice(-1200)}`);
  assert.match(r.out, /without `smoke: true`/, 'the finding did not say the flag was missing');
  assert.match(r.out, /real path/, 'the finding did not warn that a real enquiry may have been sent');
  assert.equal(r.status, 1, 'the gate did not exit 1 on a High');
});

test('an endpoint that errors is a failure carrying the status', async (t) => {
  const fx = await makeFixture({ form: 'posts', endpoint: 'broken' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[High\].*form round trip.*answered 500/, `the status was not reported\n${r.out.slice(-1200)}`);
  assert.ok(!/was set at BUILD time/.test(r.out),
    'a server error was blamed on the build environment, which is only the story for a refusal');
});

test('a refusal names the build environment rather than sending the reader to debug Turnstile', async (t) => {
  // R1 SURVIVED ON A SECOND PATH. Baking PUBLIC_SITE_ENV into both serve-preview modes fixes
  // the run that builds its own dist/; the built mode REUSES an existing dist/, so a directory
  // left behind by a bare `npm run build` is still served unbaked and still refuses. The block
  // is then honest, since that build really would refuse, but the message pointed nowhere and
  // the reader's next move was to debug Turnstile.
  const fx = await makeFixture({ form: 'posts', endpoint: 'refuses' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[High\].*form round trip.*answered 400/, `the status was not reported\n${r.out.slice(-1200)}`);
  assert.match(r.out, /PUBLIC_SITE_ENV was set at BUILD time/,
    `a refusal did not name the build environment\n${r.out.slice(-1500)}`);
  assert.match(r.out, /reuses an existing dist/,
    `the message did not name the reuse that keeps an unbaked build in play\n${r.out.slice(-1500)}`);
});

test('a 404 from the endpoint says the route is not served, not that it refused', async (t) => {
  // The wrong message here sends someone debugging validation when the endpoint is simply
  // absent, which is also what a plain static server serving dist/ looks like.
  const fx = await makeFixture({ form: 'posts', endpoint: 'absent' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[High\].*form round trip.*answered 404/, `the status was not reported\n${r.out.slice(-1200)}`);
  assert.match(r.out, /not being served at that path/, 'the finding blamed the endpoint rather than its absence');
  assert.ok(!/endpoint refuses it/.test(r.out), 'a missing route was described as a refusal');
});

test('a form whose submit never reaches the endpoint is a failure', async (t) => {
  const fx = await makeFixture({ form: 'silent' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.equal(fx.posts.length, 0);
  assert.match(r.out, /\[High\].*form round trip.*no request/i, `a dead submit passed\n${r.out.slice(-1200)}`);
});

test('a form posting to a third party is reported as unmeasured, and DELIVERS NOTHING', async (t) => {
  // The submission used to go out for real before the Medium was filed, so a site wired to
  // Formspree, HubSpot or a client CRM collected one fake enquiry per verify run. The third
  // party here is a REAL listening server: the old fixture used a host that does not resolve,
  // which is why "nothing was delivered" could not be told from "nothing was reachable".
  const fx = await makeFixture({ form: 'elsewhere', thirdParty: true });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, new RegExp(fx.thirdUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `the destination was not named\n${r.out.slice(-1400)}`);
  assert.match(r.out, /\[Medium\].*form round trip/, 'a form posting elsewhere was not reported as unmeasured');
  assert.ok(!/\[High\].*form round trip/.test(r.out), 'a third-party form was failed rather than reported');
  const delivered = fx.thirdSeen.filter((q) => q.method === 'POST');
  assert.equal(delivered.length, 0,
    `${delivered.length} submission(s) were DELIVERED to the third party: ${JSON.stringify(delivered[0] || {}).slice(0, 200)}`);
});

test('a same-origin endpoint that redirects off-site is refused, and delivers nothing', async (t) => {
  // Measured against the reviewer's probe before this existed: Playwright never invokes a route
  // handler for a request produced by a redirect, so a same-origin /api/contact that 307s to a
  // form vendor handed over the body AND the injected secret. The handler follows the POST
  // itself now, with maxRedirects 0, and refuses a cross-origin Location.
  const fx = await makeFixture({ form: 'posts', endpoint: 'redirects', thirdParty: true });
  t.after(() => fx.stop());
  const r = await gate(fx, [], { PALATE_SMOKE_SECRET: 'do-not-leak-me' });

  assert.equal(fx.thirdSeen.filter((q) => q.url.startsWith('/handed-over')).length, 0,
    'the submission was delivered to the third party through the redirect');
  assert.equal(fx.thirdSeen.filter((q) => q.headers['x-palate-smoke-secret']).length, 0,
    'the secret crossed the redirect to the third party');
  assert.match(r.out, /\[High\].*form round trip.*REFUSED rather than followed/,
    `the refusal was not reported\n${r.out.slice(-1400)}`);
});

test('the smoke secret never leaves for a third-party host', async (t) => {
  // setExtraHTTPHeaders is per PAGE, not per origin, so a secret set there rides every
  // subresource: fonts, analytics, Turnstile, any CDN. It is a production credential and those
  // hosts never needed it. The page pulls a cross-origin image, and the third party records
  // what it was sent.
  const fx = await makeFixture({ form: 'posts', thirdParty: true });
  t.after(() => fx.stop());
  const r = await gate(fx, [], { PALATE_SMOKE_SECRET: 'do-not-leak-me' });

  assert.ok(fx.thirdSeen.length > 0, 'the cross-origin subresource was never requested, so nothing was measured');
  // The direct subresource AND the one that arrives via a same-origin redirect. Without the
  // second, the origin check alone looked sufficient and the measured leak had no route to take.
  assert.ok(fx.thirdSeen.some((q) => q.url.startsWith('/followed-from-same-origin')),
    `the same-origin redirect never reached the third party, so the leak path was not exercised: ${fx.thirdSeen.map((q) => q.url).join(', ')}`);
  const leaked = fx.thirdSeen.filter((q) => q.headers['x-palate-smoke-secret']);
  assert.equal(leaked.length, 0,
    `the secret went to the third party on ${leaked.length} request(s): ${leaked.map((q) => q.url).join(', ')}`);
  // ...and it still reached the endpoint that needs it, so the fix is a narrowing rather than
  // a removal.
  assert.equal(fx.posts.length, 1, `the form was posted ${fx.posts.length} times`);
  assert.equal(fx.posts[0].headers['x-palate-smoke-secret'], 'do-not-leak-me',
    'the secret did not reach our own endpoint');
  assert.match(r.out, /form round trip: \/contact answered 200 with smoke: true/, `the round trip did not pass\n${r.out.slice(-1200)}`);
});

test('a site with no contact form says it inspected none rather than going quiet', async (t) => {
  const fx = await makeFixture({ form: 'posts', nav: 'none' });
  // Serve the contact route without a form by pointing both routes at the home page.
  t.after(() => fx.stop());
  const r = await gate(fx, ['--routes', '/']);
  assert.equal(fx.posts.length, 0);
  assert.match(r.out, /form round trip: no contact form on \d+ route\(s\), nothing submitted/,
    `the skip was not printed\n${r.out.slice(-1200)}`);
  assert.ok(!/form round trip.*\[High\]/.test(r.out), 'a site with no form was failed');
});

test('a route whose form probe failed is not banked as passing', async (t) => {
  const fx = await makeFixture({ form: 'posts', endpoint: 'broken' });
  t.after(() => fx.stop());
  await gate(fx, ['--out', fx.out]);
  const m = JSON.parse(readFileSync(join(fx.out, 'manifest.json'), 'utf8'));
  assert.ok(m.routes, 'the run wrote no routes map at all');
  assert.equal(m.routes['/contact'], undefined,
    'the route whose form round trip failed kept a passing record, so the next run skips it');
  assert.ok(m.routes['/'], 'an unrelated route lost its record too');
});

test('editing the contact endpoint re-renders the pages, so the form is probed again', async (t) => {
  // src/pages/api/contact.ts is in no page's import closure. Without it in the global digest
  // every route reads as unchanged on precisely the run where the endpoint is what moved, and
  // the round trip is skipped on the change it exists to catch.
  const fx = await makeFixture({ form: 'posts' });
  t.after(() => fx.stop());
  const first = await gate(fx, ['--out', fx.out]);
  assert.equal(fx.posts.length, 1, `the first run posted ${fx.posts.length} times\n${first.out.slice(-900)}`);

  const second = await gate(fx, ['--out', fx.out]);
  assert.match(second.out, /\/contact unchanged, skipped/, 'nothing was skipped on an unchanged second run');
  assert.equal(fx.posts.length, 1, 'the form was posted again on a run where nothing had changed');
  // ...and the run says the form was not submitted BECAUSE routes were skipped, rather than
  // leaving "nothing submitted" to read as "this site has no form".
  assert.match(second.out, /form round trip: no route was rendered this run, so nothing was submitted\. 2 unchanged route\(s\) were skipped/,
    `the skip did not say why nothing was submitted\n${second.out.slice(-1200)}`);

  writeFileSync(join(fx.root, 'src', 'pages', 'api', 'contact.ts'),
    'export const POST = async () => new Response(JSON.stringify({ ok: true }));\n');
  const third = await gate(fx, ['--out', fx.out]);
  assert.match(third.out, /global inputs changed, all routes re-rendered/,
    `the endpoint edit did not invalidate the records\n${third.out.slice(-1200)}`);
  assert.equal(fx.posts.length, 2, 'the form was not re-submitted after the endpoint changed');
});

test('the mobile nav opens, shows its target and closes on Escape', async (t) => {
  const fx = await makeFixture({ nav: 'works' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /mobile nav: \/ @mobile opened and dismissed/, `the pass was not reported\n${r.out.slice(-1200)}`);
  assert.ok(!/\[High\].*mobile nav/.test(r.out), `a working nav produced a finding\n${r.out.slice(-1200)}`);
});

test('a mobile nav that will not close on Escape is reported, and does NOT block', async (t) => {
  // Medium on purpose. Closing only from the button is a real accessibility fault and a common
  // deliberate implementation, and a gate that blocks a client's build on it gets the whole
  // interaction pass switched off. Both halves are asserted: it is said, and it costs nothing.
  const fx = await makeFixture({ nav: 'traps' });
  t.after(() => fx.stop());
  const r = await gate(fx, ['--out', fx.out]);
  assert.match(r.out, /\[Medium\].*mobile nav.*Escape/, `an undismissable nav was not reported\n${r.out.slice(-1400)}`);
  assert.ok(!/\[High\].*mobile nav/.test(r.out), 'the Escape finding is still filed as a High');
  assert.equal(r.status, 0, `an advisory finding failed the run\n${r.out.slice(-1400)}`);
  const ix = JSON.parse(readFileSync(join(fx.out, 'interaction.json'), 'utf8'));
  assert.ok(!ix.interaction_failures.some((f) => f.check === 'mobile-nav-escape-dismiss'),
    'the advisory finding reached interaction.json, which is the file the stop hook blocks on');
  // ...and the route keeps its record, because nothing at or above High was filed against it.
  const m = JSON.parse(readFileSync(join(fx.out, 'manifest.json'), 'utf8'));
  assert.ok(m.routes['/'], 'an advisory finding dropped the route record');
});

test('a mobile nav button that opens nothing is a failure', async (t) => {
  const fx = await makeFixture({ nav: 'dead' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[High\].*mobile nav.*did not open/i, `a dead nav button passed\n${r.out.slice(-1200)}`);
});

test('a dead nav button blocks through interaction.json, not only through the exit code', async (t) => {
  // hooks/palate-stop.mjs reads this file and blocks on a non-empty list. A finding that
  // never reaches it is a finding the build walks past. Keyed on the OPEN check, which is the
  // one that blocks: a control that opens nothing is a dead control in any design.
  const fx = await makeFixture({ nav: 'dead' });
  t.after(() => fx.stop());
  await gate(fx, ['--out', fx.out]);
  const ix = JSON.parse(readFileSync(join(fx.out, 'interaction.json'), 'utf8'));
  const hit = ix.interaction_failures.find((f) => f.check === 'mobile-nav-open');
  assert.ok(hit, `interaction.json carries no mobile-nav failure: ${JSON.stringify(ix).slice(0, 400)}`);
  assert.match(hit.msg, /did not open anything/);
});

test('a dialog opens and closes on Escape', async (t) => {
  // Reached through `commandfor`, with no aria-controls anywhere: the shape a probe keyed on
  // aria alone would never see. Escape is native here, so this direction also proves the probe
  // is not simply failing everything it finds.
  const fx = await makeFixture({ dialog: 'works' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /dialog: \/ @\w+ opened and dismissed/, `the pass was not reported\n${r.out.slice(-1400)}`);
  assert.ok(!/\[High\].*dialog:/.test(r.out), `a working dialog produced a finding\n${r.out.slice(-1400)}`);
});

test('a dialog that swallows the cancel event is reported, and does NOT block', async (t) => {
  // preventDefault on `cancel` is the one line that turns a correct native dialog into a trap,
  // and it is invisible in the markup. Same severity call as the nav: said, not blocking.
  const fx = await makeFixture({ dialog: 'traps' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[Medium\].*dialog:.*Escape/, `a trapping dialog was not reported\n${r.out.slice(-1400)}`);
  assert.ok(!/\[High\].*dialog:/.test(r.out), 'the Escape finding is still filed as a High');
  assert.equal(r.status, 0, `an advisory finding failed the run\n${r.out.slice(-1400)}`);
});

test('a dialog trigger wired to nothing is a failure, and it reaches interaction.json', async (t) => {
  const fx = await makeFixture({ dialog: 'dead' });
  t.after(() => fx.stop());
  const r = await gate(fx, ['--out', fx.out]);
  assert.match(r.out, /\[High\].*dialog:.*did not open anything/i, `a dead dialog trigger passed\n${r.out.slice(-1400)}`);
  const ix = JSON.parse(readFileSync(join(fx.out, 'interaction.json'), 'utf8'));
  assert.ok(ix.interaction_failures.some((f) => f.check === 'dialog-open'),
    `interaction.json carries no dialog failure: ${JSON.stringify(ix).slice(0, 400)}`);
});

test('the nav and the dialog on one page are told apart', async (t) => {
  // Zag's dialog trigger carries aria-expanded exactly like a burger does, so a probe that
  // took the first match and called it "mobile nav" would mislabel every dialog on the site.
  // Read from the findings rather than interaction.json, because both are advisory now.
  const fx = await makeFixture({ nav: 'traps', dialog: 'traps' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /\[Medium\]\s+mobile nav:.*Escape/, `no nav finding\n${r.out.slice(-1600)}`);
  assert.match(r.out, /\[Medium\]\s+dialog:.*Escape/, `no dialog finding\n${r.out.slice(-1600)}`);
  // One defect each, not the nav reported twice under two names.
  assert.equal((r.out.match(/mobile nav: what /g) || []).length, 1, 'the nav was filed more than once');
  assert.equal((r.out.match(/dialog: what /g) || []).length, 1, 'the dialog was filed more than once');
});

test('a hidden duplicate kept for a breakpoint does not block the build', async (t) => {
  // A `display: none` copy above the working form. The probe took the first match in DOM order
  // and spent five seconds on a `page.click` that could never land, then filed a High about a
  // pointer on a site with nothing wrong with it.
  const fx = await makeFixture({ form: 'posts', shape: 'duplicate' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.equal(fx.posts.length, 1, `the visible form was not the one submitted (${fx.posts.length} posts)`);
  assert.match(r.out, /form round trip: \/contact answered 200 with smoke: true/,
    `the working form was not submitted\n${r.out.slice(-1400)}`);
  assert.ok(!/\[High\].*form round trip/.test(r.out), `a hidden duplicate blocked the build\n${r.out.slice(-1400)}`);
  assert.ok(!/could not be clicked/.test(r.out), 'the probe still waited on an unclickable control');
});

test('a form inside a closed modal is SKIPPED with a reason, not failed', async (t) => {
  // The dialog the disclosure probe certifies a moment earlier. Nothing here is a fault, and a
  // High would fail a correct build, which is how a whole interaction pass gets switched off.
  const fx = await makeFixture({ form: 'posts', shape: 'modal' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.ok(!/\[High\].*form round trip/.test(r.out), `a modal form blocked the build\n${r.out.slice(-1600)}`);
  assert.match(r.out, /no submit control visible at desktop/, `the skip was not printed\n${r.out.slice(-1600)}`);
  assert.match(r.out, /UNMEASURED, not clean/, 'the skip read as a pass');
  assert.equal(r.status, 0, 'a skipped form failed the run');
});

test('a form whose fields are named differently is still found and submitted', async (t) => {
  // `full-name` rather than `name`, which is what an agent writes when it is not copying the
  // template. It used to be invisible, and the run said "no contact form": the same
  // exists-but-never-fires defect the action-only selector had, moved into its replacement.
  const fx = await makeFixture({ form: 'posts', shape: 'renamed' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.equal(fx.posts.length, 1, `a renamed contact form was not submitted (${fx.posts.length} posts)`);
  assert.match(r.out, /form round trip: \/contact answered 200 with smoke: true/,
    `the renamed form was not recognised\n${r.out.slice(-1400)}`);
  assert.ok(!/no contact form/.test(r.out), 'the run still claimed the site has no contact form');
});

test('a visible form the probe cannot classify is NAMED, never reported as absent', async (t) => {
  // The honest-report half of the same finding: "no contact form" is a claim about the site,
  // and it must never stand in for "a form I did not recognise".
  const fx = await makeFixture({ form: 'posts', shape: 'unreadable' });
  t.after(() => fx.stop());
  const r = await gate(fx);
  assert.match(r.out, /did not \s*recognise as a contact form|recognise as a contact form/,
    `an unrecognised visible form was not named\n${r.out.slice(-1600)}`);
  assert.match(r.out, /booking-ref|enquiry-body|<form>|#/, 'the report did not identify which form');
});
