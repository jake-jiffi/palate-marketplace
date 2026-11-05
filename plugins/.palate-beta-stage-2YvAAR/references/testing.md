# Testing and verification

## The eval suite (run on every skill change AND every model upgrade)

The skill ships an eval pyramid. Run it whenever the skill changes, and again on every
model upgrade: a model swap shifts the VLM's taste and the sampling behaviour the
divergent spine (Move 1) and the visual loop (Move 3) depend on, so a suite that was
green on one model is not assumed green on the next.

**1. The deterministic gate tests (fast, no model in the loop) - the floor.** Run them
all; every one must be green:

```
for t in scripts/test/*.test.sh; do bash "$t"; done
```

These cover the gates the build leans on: `gate-mcp-depth` (the depth floor, fail-open
contract), `gate-uniqueness` (within-build distinctness), `gate-novelty` (the CONVERGE
concept pre-check + cross-build / type-face recurrence), `gate-done` (the visual +
verifier + novelty "done" gate, fail-open ladder), `ux-lint-eyebrow` (the kicker tell),
and `self-review-fired` (the keystone: a seeded visual defect BLOCKS "done", a clean
build is ALLOWED - `evals/12-self-review-fired.md`).

**2. The two-plane eval over a finished build.** `scripts/eval-runner.mjs` scores one
build on the PROCESS plane (did it draw on the library with depth, AND did DIVERGE
sample wide + CONVERGE score two axes) and the OUTPUT plane (uniqueness + slop + the
cross-build novelty gate):

```
node scripts/eval-runner.mjs --manifest <build>/build-manifest.json --variants <build>/*.html
```

**3. The golden + audacious sets (on-demand, one build per brief).** A full skill build
per brief is heavy, so these run out-of-band: build each brief once into
`<results>/<brief-id>/` (manifest + rendered variant HTML), then aggregate:

```
node scripts/eval-suite.mjs --briefs evals/golden-briefs.json    --results <results>
node scripts/eval-suite.mjs --briefs evals/audacious-briefs.json --results <results>
```

`evals/golden-briefs.json` over-represents the thin everyday verticals (the moat vs
generic slop); `evals/audacious-briefs.json` proves the other failure mode - that the
skill samples wide, advances from the low-typicality tail, decomposes ambition into
buildable mechanics, and still clears the visual loop + every gate
(`evals/11-novelty.md`). `eval-suite` reports a pass-rate and exits 0 only when every
PRESENT build passes (a not-yet-built brief is reported "missing", not failed; add
`--strict` to require every brief built for a CI gate). Run `>= 3` trials per brief and
end-state; every new failure becomes a new case.

## Per-phase verify scripts
Each phase has a verify-{phase}.sh that must pass before the phase is marked complete. See pipeline.md.

## Build-time checks (in CI)
- astro check (typecheck)
- npm run build (must succeed; a logic error here halts, never deploys broken)

## What is actually measured, and on how much of the site

Nothing in this plugin runs Lighthouse. The doctrine used to say "Lighthouse CI, baseline
100s", which promised a gate that does not exist and a number nothing produced.

- **Performance** is a local lab run of Core Web Vitals (`scripts/reference-capture/vitals.mjs`)
  under PageSpeed's own mobile emulation, slow 4G with 4x CPU throttling. It runs on the HOME
  route only, and it is a lab proxy rather than field data: TBT is not INP and is labelled TBT.
  Unthrottled numbers are worthless here, 7.9x apart from the throttled ones on our own site,
  which is why the emulation is not optional.
- **Accessibility** is a SUBSET of axe, described in `references/audit-dimensions.md`, run at
  three viewports. Clearing it is not a WCAG 2.2 AA pass.
- **A route whose own status is meant to be non-200 is not failed for returning it.** `/404`
  answers 404, the browser logs that as a console error, and the console rule filed a High at
  every viewport, so every sweep on the shipped template exited 1 on a fault nobody could fix.
  Only the navigation response itself is exempt: a script error or a missing image on `/404`
  is still a High.
- **Coverage.** `verify-rendered.sh` renders the first **14 routes** by default and says how
  many it dropped. On a bigger site raise it with `--max-routes <n>`, or pass `--routes` to
  name the ones that matter. A 3,400-page site is measured on 14 pages unless you say
  otherwise, and the summary prints exactly that.
- **Re-running after a fix.** `--changed <file,...>` renders only the routes those files can
  reach, and a file the index has never heard of falls wide and says which one.
  `--changed` rebuilds `.palate/index.json` first, since both the blast radius and every
  route's hash are read from it and a stale closure narrows to the wrong routes. A file the
  index cannot place also SETS THE RECORDS ASIDE for that run, because its effect on any hash
  is unknown too. If every selected route is unchanged the run exits 2, skipped rather than
  passed. The saving is a ratio of your own sweep: 25s against 187s on a thirty-route fixture,
  and about 15s of that is the home-route probes, which every run pays whatever it renders. A route whose
  sources have not changed since it last passed is skipped and printed "unchanged, skipped";
  the record lives in `.palate-shots/manifest.json` as `{ sourcesHash, renderedHash,
  passed_at }` per route. Measured on a thirty-route fixture: 25s against a 187s sweep. Run
  the lanes cheap first, ux-lint before rendered, rendered before vitals.
  **The hygiene trend reads inside the loop**, not only on a full sweep: the line names the run
  it compared against. It states a verdict only when the two runs swept the same routes. When
  they did not it prints both scores and NO verdict, because the design checks are measured on
  the home route alone and a blast radius that excludes it moves the number by five points on a
  change that did nothing. A run that rendered no home route says build hygiene was not
  measured rather than printing nothing.
- **What the hash covers.** A route's own source, its whole import closure, the content
  entries it renders (the collection its `getCollection` call names, so editing a post
  re-renders the post and its listing), and the SHARED inputs no closure has to name: the Astro config, `package.json` and the lockfile, everything
  under `src/styles` and `src/layouts`, and the CSS those layouts import, which is how the
  brand package's `tokens.css` and `fonts.css` are reached. Change one of those and every
  record goes, with the run printing `global inputs changed, all routes re-rendered`.
- **The sweep before hand-over is `--full`**, which ignores every unchanged-route record.
  Remote content, `public/` assets and environment values stay outside the hash,
  so an unchanged source can still render differently.
  Converge incrementally, certify on a full sweep.

## Post-deploy smoke checks
- workers.dev returns 200
- robots.txt, sitemap, llms.txt return 200
- a test POST to /api/contact, run by `verify-form-roundtrip.sh` from both host verifiers

## The form round-trip test

The gate fills the contact form with valid values, presses send, and reads what the endpoint
answered. Reading the markup cannot tell a working form from one whose submit handler never
bound, whose endpoint returns 500, or whose Turnstile key is wrong: all three render
identically. Pressing the button separates them.

**The smoke header is what makes it safe to run.** The request carries `x-palate-smoke: 1`,
and `src/pages/api/contact.ts` answers it by validating the body and returning
`{ ok: true, smoke: true }` having sent nothing. A 2xx carrying that flag is the only pass.
A 2xx WITHOUT it is a failure, not a pass: it means the header was ignored, the submission
took the real path, and against a deployed site that is a fake enquiry in the client's inbox
and, with a CMS wired, a document in their content.

**The header does nothing without the matching secret unless the build says out loud that it is
not production.** Production and an UNKNOWN environment are both closed; only an explicit
non-production `PUBLIC_SITE_ENV` (preview, development, anything that is not "production") is
open. An unset or blank secret refuses every request rather than matching every request.

**The test is not "is this production", and that inversion is the whole lesson.** It used to be,
and the guard shipped switched OFF five separate times: the Cloudflare bootstrap deploy, its
revalidate workflow (which a CMS publish triggers, so it reopened on every content publish), two
more workflows, and a bare `wrangler deploy`, which does not build at all and ships whatever
`dist/` holds after any local gate rebuilt it. Chasing the sixth build command is not the fix,
because the DEFAULT was wrong: every new path inherited "I do not know what this build is"
meaning "no secret needed". Now a forgotten build command costs a printed skip that names
itself, never a live site quietly discarding enquiries.

The guard is not aimed at an attacker. It is aimed at a proxy or a browser extension adding a
header to a real visitor's submission on a deployment where nobody set the variable, which would
make the enquiry evaporate. A refused smoke request therefore goes through the real path rather
than being rejected, because whoever sent it may be a customer who never chose the header.

Where it runs:

- **Against the preview**, inside `verify-rendered.mjs`. Any route carrying a contact form is
  found during the desktop pass and submitted once afterwards, in its own browser context so
  the audit pass never carries the header. A form is a contact form when it declares
  `action="/api/contact"` OR carries a name, an email and a message field: the shipped
  `ContactForm.astro` has no action at all and posts with `fetch`, so the attribute alone
  would never match the template this was written for. Where the form posts is then measured
  rather than assumed, and a form posting to a third party is reported as UNMEASURED with the
  destination named, never as clean.
  **A cross-origin POST is aborted at the wire**, so a site wired to Formspree, HubSpot or a
  client CRM never collects a fake enquiry from a verify run; the attempt still fires
  `requestfailed`, so the finding is unchanged and only the delivery is not.
  **The secret is attached to one request, and the probe follows that request itself.**
  `setExtraHTTPHeaders` carries a header to every host the page touches, so only the plain
  `x-palate-smoke: 1` goes there. Same-origin was not narrow enough either: a request produced
  by a redirect never reaches a Playwright route handler, so ANY same-origin path that redirects
  to a CDN handed the secret over, measured on two real servers. The secret now rides only the
  POST to `/api/contact`, and every same-origin POST is fetched with `maxRedirects: 0` so a
  cross-origin `Location` is refused here rather than followed by the browser. What that cannot
  stop, said rather than fixed: a same-origin path that proxies onward server-side receives the
  secret legitimately and could forward it. At most three form-carrying routes are submitted per run, and the
  rest are named as not submitted: on an Explore build every variant carries the same form and
  the extra submissions buy the same answer.
- **Against the deployed URL**, by `scripts/verify-form-roundtrip.sh <url> [--env production]`,
  which `verify-vercel.sh` and `verify-cloudflare.sh` both call after their 200 check. It exits
  0 on a proven round trip, 1 on a failure, and **2 with a printed reason** in two cases: the
  deployment serves no `/api/contact`, because a brochure site has not failed by having no
  form; or it is **production and `PALATE_SMOKE_SECRET` is not set**, in which case it posts
  nothing at all and prints which variable to set and where. **Both verifiers fail on any other
  exit code**, including 126 and 127: a round-trip script that is missing or dies before
  reaching a verdict leaves the form unchecked, and that must not read as OK.
  Without that second skip the
  request falls through to the real path, Turnstile refuses the token the script does not have,
  and the operator reads a 400 on their contact endpoint minutes after going live with nothing
  actually broken. Production is read from `--env`, then `PALATE_SITE_ENV` / `PUBLIC_SITE_ENV`
  / `VERCEL_ENV`, then the build's own `.palate-skill-state.json` stage.
- **The secret is provisioned, not asked for.** `provision-vercel.sh` and
  `provision-cloudflare.sh` generate `PALATE_SMOKE_SECRET` when it is absent, write it to
  `.env` (gitignored) and push it to the deployment: Vercel on the production target only,
  Cloudflare as a Worker secret. The verifier reads `.env` when the variable is not already
  exported, so the ordinary path needs no manual step. An existing value is kept rather than
  regenerated, because a new one would leave the deployment holding the old and every later
  round trip failing on a mismatch. The write is an upsert and `.env` is chmod 600. The read
  takes the LAST assignment, which is what sourcing the file does, tolerates an `export`
  prefix, and treats a blank or whitespace value as unset.
- **Every build says what it is, and an unbaked one is CLOSED.** The guard reads
  `PUBLIC_SITE_ENV` as baked at build time, so a build that leaves it empty is treated as
  production: the endpoint refuses the smoke header without the secret and the round trip skips
  with a reason. That is the inversion, and it means a forgotten build command costs a skip
  rather than a live site quietly discarding enquiries.
  **So every local path bakes it too**, because a skip on the path an operator uses every day is
  still a check that never runs: `serve-preview.sh` sets `preview` in BOTH modes, the default
  `npm run dev` and `--built`, and both templates' own `dev` script sets it as well. The
  Cloudflare overlay's `npm run deploy` builds as production before deploying, and so do
  `provision-cloudflare.sh`'s bootstrap build, `deploy.yml` and `revalidate.yml`.
  **Never a bare `wrangler deploy`:** it does not build, so it ships whatever `dist/` holds.
  **One local path is still not covered and the finding says so:** `serve-preview.sh --built`
  REUSES an existing `dist/` rather than rebuilding it, so a directory left behind by a bare
  `npm run build` is served unbaked and refuses. The round trip's own finding names
  `PUBLIC_SITE_ENV` and that reuse first, because the symptom is a 400 reading
  "verification failed" and the reader's next move otherwise is to go and debug Turnstile.
  The fix is `rm -rf dist` and re-run, since re-running `serve-preview.sh` on its own will
  reuse the same directory, or build it yourself with `PUBLIC_SITE_ENV=preview npm run build`.
- **The endpoint's own contract** is exercised as code by
  `scripts/test/contact-smoke.test.mjs`, against BOTH copies of the handler. `add-sanity.sh`
  copies `templates/cms-sanity/src/pages/api/contact.ts` over the base file, so the two carry
  a marked, byte-identical smoke block and the suite compares it.

**The mobile nav and any dialog are worked in the same pass.** The gate finds a closed
disclosure, clicks it, asserts the element it controls became visible, presses Escape and
asserts it closed. Navs are probed at 390 and dialogs at both 390 and 1440, because a nav at
desktop is normally already open. An overlay that cannot be dismissed from the keyboard leaves
a keyboard visitor tabbing through the whole sheet to get out, and looks perfect in a
screenshot; a native `<dialog>` gets Escape for free unless the `cancel` event is prevented,
which is one invisible line. The finding is deduplicated on the control's label, because one
nav or one dialog is normally one shared component.

**The two halves carry different severities, and the difference is deliberate.** A control
that opens NOTHING is a **High** and blocks: there is no design in which a dead burger is the
intent. A control that opens and will not close on Escape is a **Medium and does not block**:
closing only from the button is a real accessibility fault and a common deliberate
implementation, the disclosure pattern does not require Escape (only the dialog and
menu-button patterns do), and a gate that fails a client's build over it gets the whole
interaction pass switched off, which costs more than the finding is worth. Only the High
reaches `.palate-shots/interaction.json`, which is the file the stop hook blocks on.

A trigger is discoverable through `aria-controls`, `aria-haspopup="dialog"`, `commandfor` or
`data-dialog-target`. A `<dialog>` whose opener is bound in a module with none of those cannot
be found from the DOM and is not probed: wire the trigger to the dialog with one of them and
it is covered.

**Editing the endpoint re-renders the pages.** `src/pages/api/contact.ts` is in no page's
import closure, so `src/pages/api` is part of the global digest the unchanged-route skip
folds in. Without that, every page would read as unchanged on exactly the run where the
endpoint is what moved, and the round trip would be skipped on the change it exists to catch.
