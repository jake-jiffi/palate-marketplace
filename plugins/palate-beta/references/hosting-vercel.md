# Hosting on Vercel (the default host)

Vercel is the skill's default host. Cloudflare is supported as the backup -
pick it with `--host cloudflare` or when the brief calls for it. Either way the
plan checkpoint always ASKS which host to use, stating Vercel as the default.
Everything else (Astro 7, the brand package, the reference library, the
connective tissue, the evals, and Sanity via `@sanity/astro` + the embedded
Studio at `/studio` IF a CMS was added) is host-agnostic and stays unchanged.

## Why Vercel is the default

- **Vercel Toolbar Comments** on every preview deployment - reviewers point and
  click anywhere on the page and leave notes that sync back, no code to add
  (see Toolbar section below). Direct fit for client review.
- The GitHub integration owns the build/deploy loop and gives every PR an
  automatic preview deployment.
- First-class Vercel surfaces (Web Analytics, Speed Insights, Edge Config,
  Vercel Blob) are available without extra wiring.

## When to choose the Cloudflare backup

- Unlimited bandwidth on the free tier (Vercel meters).
- 300+ edge locations vs Vercel's ~30.
- No cold starts (V8 isolates) vs Vercel's serverless function cold starts.
- Workers Static Assets pricing for high-traffic marketing sites.

For most Palate marketing sites either works; Vercel is the default and the
person confirms the choice at the plan checkpoint.

## The template is Vercel-native

`templates/astro-project/` ships ready for Vercel: the `@astrojs/vercel/serverless`
adapter (pinned `11.0.5` for Astro 7), `@vercel/analytics`, a `vercel.json`
(framework hint + cache and security headers, with `X-Frame-Options: SAMEORIGIN`
so an embedded Sanity Studio preview iframe still works if a CMS is added),
`.env.example` with
Vercel env conventions, and `.github/workflows/ci.yml` only. A default build
does NOT run any host switch.

### The Content-Security-Policy

**What this policy is worth, plainly: it is a host allowlist, not protection against injected
script.** `script-src` carries `'unsafe-inline'` because a static Astro build ships inline
script it does not control and cannot nonce, and Vercel reads `vercel.json` from the repository
rather than from build output, so a hash would be hand-committed and go stale. So the policy
stops a script, a frame or a form reaching a host that is not on the list, and it does not stop
inline script that reaches the page. Do not describe it to a client as XSS protection.

`vercel.json` and `templates/host-cloudflare/_headers` serve the SAME policy, and they are
edited together: two hosts disagreeing about what one site may load is a bug that only shows
up after a host switch. It is built from the hosts the template actually loads in a browser,
which is Humblytics (the analytics script, with its own subdomains allowed to connect because
the beacon endpoint is not knowable from the template) and Cloudflare Turnstile, which also
needs `frame-src` because the widget renders in an iframe. Resend is a server-side fetch from
`src/pages/api/contact.ts` and is deliberately absent: widening the policy for a request the
browser never makes is how a CSP stops describing anything. Both `style-src` and `script-src`
carry `'unsafe-inline'`: `style-src` because Astro inlines small stylesheets, `script-src` for
the measured reason above.

**The Vercel Toolbar sources are on the Vercel policy and not on the Cloudflare one.** Vercel
injects the Toolbar into preview HTML, and its Comments are the headline win for client review
below, so a policy without it would ship a document promising a feature the same repository
blocks. The list is Vercel's own, from the "Using a Content Security Policy" section of
`vercel.com/docs/vercel-toolbar/managing-toolbar` (read 2026-09-09), and it is SIX sources
rather than the obvious one: `https://vercel.live` on `script-src`, `connect-src`, `frame-src`,
`style-src` and `font-src`, `wss://ws-us3.pusher.com` on `connect-src` for Comments,
`https://assets.vercel.com` on `font-src`, and `blob:` on `img-src`. The first pass allowed the
script, the frame and the connection and forgot the rest, which loads an unstyled toolbar with
dead Comments: half an allowlist reads as a working feature until a client opens it. The
Toolbar's image hosts need no entry of their own because `img-src` already allows every
`https:` source.

**AND ALL SIX ARE ON THE CLIENT'S LIVE SITE TOO, for a feature that only exists on previews.**
`vercel.json` is one static file with one `Content-Security-Policy` header, so there is no
production variant of it to narrow: production allows `https://vercel.live` and
`wss://ws-us3.pusher.com` and always will, unless the header is moved to middleware and varied
on `VERCEL_ENV`. The widening is deliberate and it is not temporary. It costs one origin the
client does not control on script-src, which is worth saying out loud to anybody whose security
review reads this file.

None of it is on the Cloudflare overlay: there is no Vercel Toolbar on a Workers deployment.
And none of it is derivable from the template source, which is why the derived-host test cannot
catch a mistake here; the host comes from the platform, not from the build, so the test pins
each source by name instead. STILL NOT MEASURED against a real preview deployment, which is
the one place the Toolbar exists. Open the console on the first preview after this ships.

**Add a third-party script or a client-side fetch and you add its host here.**
`scripts/test/template-headers.test.sh` derives the host list from the template source and
fails naming the host, so the failure arrives at the build rather than as a blank widget on the
client's live site. `scripts/test/template-csp-live.test.sh` serves the built template with the
policy enforced and fails on a single console error.

**A CMS BUILD NEEDS MORE, and `scripts/add-sanity.sh` adds it.** The Studio mounts at
`/studio` and the visual-editing overlay runs in the browser, so the overlay step extends
whichever policy the project carries (`vercel.json` on Vercel, `public/_headers` on Cloudflare,
since the Cloudflare switch deletes `vercel.json`) with `https://*.api.sanity.io`,
`https://*.apicdn.sanity.io`, `https://api.sanity.io` and `https://cdn.sanity.io` on
`connect-src`, plus `https://design-system-static.sanity.io` on `font-src`. It is idempotent,
and it says so out loud when a project carries no policy to extend rather than passing over it.

**Those hosts were measured, not reasoned about.** A real build of the overlay served under the
base policy raised `connect-src` violations for `https://<projectId>.api.sanity.io`
(`users/me`, `check/cors`) and `font-src` violations for the Studio's own Inter webfont on
`design-system-static.sanity.io`, which nobody would have listed from reading the code. The base
policy still lists only what the base template loads, because widening it for a service most
builds never call is how a policy stops describing anything.

`frame-src` names `'self'` for the same reason: an explicitly set `frame-src` does NOT fall
back to `default-src`, so a policy listing only Turnstile would stop the site framing its own
pages, which is exactly how Sanity's Presentation tool shows a live preview.

HSTS is on the Cloudflare overlay only: Vercel sends it itself on a custom domain, Workers does
not. Two years with subdomains, and deliberately without `preload`, which is a one-way door for
a client's apex domain.

`provision-vercel.sh` makes the whole loop hands-off:

- Pushes `GITHUB_PACKAGES_TOKEN` to all environments so the Vercel build can
  `npm ci` the private `@palate-projects/{slug}-brand` package.
- Pushes every Sanity / Resend / Turnstile var per environment.
- Runs `vercel git connect --yes`, so once the repo exists (Phase D) every push
  to `main` auto-deploys to production and every PR gets a preview deployment
  with the Toolbar live. No deploy workflow, no manual dashboard step.

**Content changes DO need a redeploy.** The site is static (`output: "static"`),
so published content is baked at build time and a publish is live once the site
rebuilds. On a CMS build, wire a Sanity webhook to a Vercel deploy hook: a change
then lands in a minute or two. This is the one real cost of the render mode and
it is worth saying to the client up front. (The Cloudflare backup's
`revalidate.yml` does the same job there.)

What you get for it: every page is a file on a CDN rather than a serverless
invocation, site search actually indexes (pagefind reads built HTML and saw none
under SSR), and the site survives the function runtime being unavailable.

## The Cloudflare backup overlay

Only on `--host cloudflare`, Phase A runs `scripts/switch-host-cloudflare.sh`,
which swaps in `templates/host-cloudflare/`:

- `astro.config.mjs` -> `@astrojs/cloudflare` adapter.
- `package.json` -> `@astrojs/cloudflare`, `wrangler`; drops the Vercel deps.
- `wrangler.toml` + `public/_headers` -> Workers config and edge headers.
- `.env.example` -> Cloudflare/Workers env conventions.
- `.github/workflows/` -> `deploy.yml`, `preview.yml`, `revalidate.yml` (build
  in CI, `wrangler deploy` the artifact - the site never builds on Cloudflare).
- `vercel.json` is removed.

Either way the Sanity wiring, the embedded Studio config, `src/lib/content.ts`,
the connective tissue, the seed/publish scripts, the contact handler and the
evals are all untouched. `src/pages/api/contact.ts` reads env via
`locals.runtime?.env ?? import.meta.env`, so it works on both hosts without a
code change.

## The env model on Vercel

Simpler than Cloudflare's two-bucket split. There is **one place** - Vercel
project settings (or `vercel env add` via CLI) - scoped per environment
(Production / Preview / Development). Vercel makes the same env vars available
to both the build step AND the runtime serverless functions, so there is no
"is this a build-time or runtime var?" question to get wrong.

| Variable | Production | Preview | Development |
|----------|-----------:|--------:|------------:|
| `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_READ_TOKEN` | yes | yes | yes |
| `PUBLIC_SANITY_VISUAL_EDITING_ENABLED` | `false` | **`true`** | `false` |
| `SANITY_API_WRITE_TOKEN` (used by `/api/contact` + seed scripts) | yes | yes | optional |
| `RESEND_API_KEY`, `TURNSTILE_SECRET` | yes | yes | optional |
| `PALATE_SMOKE_SECRET` (the post-deploy form round trip) | yes | no | no |

`PALATE_SMOKE_SECRET` is read at RUNTIME on both hosts, and it was not always: the endpoint used
to fall back to `import.meta.env`, which Vite bakes at build, so on Vercel a value set in the
dashboard after the deploy did nothing and a rotation silently did not take. The handler layers
`process.env` over the baked object on the node runtime, so setting or rotating it takes effect
on the next invocation with no redeploy. On Cloudflare it arrives as a Worker secret through
`locals.runtime.env`. The PUBLIC_ vars above are a different matter and are genuinely baked:
`PUBLIC_SITE_ENV` is read from the build and changing it DOES need a redeploy.

`scripts/provision-vercel.sh` pushes all of these via `vercel env add`,
idempotently (it removes any existing value first).

## Vercel Toolbar - Comments on every preview

This is the headline win for client review. The Toolbar's Comments feature is
**built into Vercel** - on every preview deployment, logged-in team members
who visit the URL see a floating toolbar. They click anywhere on the page,
type a note, it threads back to the team. No code, no integration, no script
tag - it Just Works on Vercel preview URLs.

What this enables:
- Send the client the `{preview-url}`.
- They leave point-and-click comments on the page.
- You see the comments in the Vercel dashboard, address them in
  the next push, and the preview redeploys automatically.

### How previews are deployed and shared (`deploy-preview.sh`)

The preview stage hands over a **Vercel preview deployment**, not just a local
link, so it is shareable for feedback. `scripts/deploy-preview.sh <project-dir>
<slug> [--explore]` links the project, pushes the preview-env build vars
(`GITHUB_PACKAGES_TOKEN` for the brand package, `PUBLIC_EXPLORE_MODE`), runs
`vercel deploy` (preview, never `--prod`), and prints `SHAREABLE_URL`. No Sanity
project, domain or production deploy is touched - the build renders from
`content.ts`. `--explore` turns the bottom-right direction picker on.

The `SHAREABLE_URL` opens for a client who is NOT on the Vercel team, with no
setup step. `deploy-preview.sh` does it automatically with the CLI:

```
vercel project protection enable <slug>-site --protection-bypass \
  --protection-bypass-secret <secret>
```

It generates a stable per-project secret (saved to a gitignored
`.palate-vercel-bypass`, so previously shared links keep working) and appends
`?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true` to the
URL, so anyone with the link gets straight in. Logged-in reviewers can still
leave Toolbar Comments. To revoke later:
`vercel project protection disable <slug>-site --protection-bypass --protection-bypass-secret <secret>`.

The Sanity Presentation tool (CMS-driven editing) and the Vercel Toolbar
(reviewer comments) are complementary, not competing - both can be active on
the same preview deployment.

### Optional - the Toolbar on localhost or production

The Comments feature is preview-only by default. To enable the Toolbar on
`astro dev` (so reviewers can comment on a local tunnelled URL) or on
production (for an authenticated employee-only overlay), install
`@vercel/toolbar` and conditionally mount it - see Vercel's docs. Not wired
in by default to keep production lean.

## Production deploy (hands-off via `vercel` CLI)

`scripts/provision-vercel.sh <slug>` is the hands-off equivalent of Phase C:

1. `vercel link --yes --project <slug>-site` - links the local dir to the
   Vercel project. Idempotent: reuses `.vercel/` if present.
2. Pushes every env var listed above to the right environment(s) via
   `vercel env add` (with an upfront `vercel env rm` to keep it idempotent).
3. `vercel deploy --prod --yes` - the initial production deploy. Returns the
   live URL.

Subsequent deploys happen automatically when the GitHub repo (Phase D) pushes
to `main` - Vercel's GitHub integration owns the CI loop. PR branches get an
automatic preview deployment with the Toolbar live.

Prerequisites (one-time, account-level - everything else is automated):
- `npm i -g vercel`
- `vercel login` (browser auth)
- The user has accepted the Vercel team invite for `palate-projects` (or
  whichever team).
- The **Vercel for GitHub app is installed** on the GitHub org so
  `vercel git connect` can link repos (install once at
  github.com/apps/vercel; without it, git connect cannot attach the repo).
- `GITHUB_PACKAGES_TOKEN` is exported (the read:packages PAT) - `provision-vercel.sh`
  forwards it to the Vercel build so the private brand package installs.

## Pinned versions

- `@astrojs/vercel` 11.0.5 (must match the Astro major: v11 peers `astro@^7`, v10 is Astro 6 only)
- `@vercel/analytics` ^2.0.1 (only if you wire Web Analytics in code; the
  adapter's `webAnalytics: { enabled: true }` is the simpler path)
- `vercel` (the CLI) ^48 - installed globally, not a project dep

## Domain

Phase E on Vercel: `vercel domains add <domain>`. Vercel auto-issues TLS.
DNS cutover is the same careful, human-confirmed step as on any host - hold
until the client signs off.
