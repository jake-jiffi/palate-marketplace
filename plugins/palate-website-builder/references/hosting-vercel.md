# Hosting on Vercel (the default host)

Vercel is the skill's default host. Cloudflare is supported as the backup -
pick it with `--host cloudflare` or when the brief calls for it. Either way the
plan checkpoint always ASKS which host to use, stating Vercel as the default.
Everything else (Astro 6, Sanity via `@sanity/astro`, the embedded Studio at
`/studio`, the brand package, the reference library, the connective tissue, the
evals) is host-agnostic and stays unchanged.

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
adapter (pinned `^10.0.7` for Astro 6), `@vercel/analytics`, a `vercel.json`
(framework hint + cache and security headers, with `X-Frame-Options: SAMEORIGIN`
so the embedded Sanity Studio preview iframe still works), `.env.example` with
Vercel env conventions, and `.github/workflows/ci.yml` only. A default build
does NOT run any host switch.

`provision-vercel.sh` makes the whole loop hands-off:

- Pushes `GITHUB_PACKAGES_TOKEN` to all environments so the Vercel build can
  `npm ci` the private `@palate-projects/{slug}-brand` package.
- Pushes every Sanity / Resend / Turnstile var per environment.
- Runs `vercel git connect --yes`, so once the repo exists (Phase D) every push
  to `main` auto-deploys to production and every PR gets a preview deployment
  with the Toolbar live. No deploy workflow, no manual dashboard step.

**Content changes need NO redeploy.** The site is SSR (`output: "server"`) and
`vercel.json` sets no HTML cache, so each request renders fresh and reads the
latest published Sanity content (the Sanity API CDN purges on publish). A
publish is live on the next page load - there is no deploy hook or rebuild-on-
publish webhook to wire. (The Cloudflare backup keeps `revalidate.yml` as an
optional full-redeploy on publish, but it is not required for content freshness
there either.)

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

- `@astrojs/vercel` ^10.0.7 (must match the Astro 6 major)
- `@vercel/analytics` ^2.0.1 (only if you wire Web Analytics in code; the
  adapter's `webAnalytics: { enabled: true }` is the simpler path)
- `vercel` (the CLI) ^48 - installed globally, not a project dep

## Domain

Phase E on Vercel: `vercel domains add <domain>`. Vercel auto-issues TLS.
DNS cutover is the same careful, human-confirmed step as on any host - hold
until the client signs off.
