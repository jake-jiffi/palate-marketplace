# Gotchas

- **CI brand package install needs `permissions: packages: read`.** Without it, npm ci 401s on @palate-projects/{slug}-brand. It's in the workflow templates; never remove it.
- **Set GitHub secrets before first push.** The first CI run fires on push; if secrets aren't set, the build fails. provision-github.sh sets them before pushing.
- **Sanity Studio hostname is globally unique** across all of Sanity, not just the org. Check availability before committing to a slug.
- **Wrangler doesn't reliably manage custom domains via CLI.** Phase E uses the Cloudflare API directly.
- **sanity init --no-interactive has been flaky.** Phase B uses the Management API via curl for project creation.
- **Cloudflare SSL takes 5-30 min after domain attach.** The site works on workers.dev meanwhile; verify-domain.sh reports PENDING until ready.
- **The brand pin intentionally lags the brand repo latest.** That's the deliberate-update design, surfaced as brand-mismatch (informational, not an error).
- **Build never happens on Cloudflare.** If anyone switches to building on Cloudflare, the private brand package auth breaks (documented Cloudflare issue). The whole CI design exists to avoid this.
- **Humblytics free tier is 1,000 events/month.** Confirm the client's plan before relying on it for a high-traffic site.
- **The form handler needs the WRITE token.** If only the read token is set, every submission 401s. Phase B creates both; provision-cloudflare.sh pushes the write token as a Worker secret.
- **Digit-leading slugs** (e.g. "542 Partners") are rejected by Cloudflare and npm. derive-slug.sh surfaces this for confirmation.

## Astro 7 holds a dev-server LOCK, so a leaked server hijacks the next preview
`astro dev` in Astro 7 writes a lock file. If a previous run leaked a server -
easy to do, because the PID scripts capture is npm's wrapper, not astro's, so
`kill` can miss it - the next `astro dev` **refuses to start** and prints
`Dev server already running at <url>`. Astro 6 just picked a free port. The
danger is a script scraping that URL and handing it over as if it were the new
build. `serve-preview.sh` clears the lock before starting and hard-fails if it
sees the "already running" notice.

**There is no `astro dev stop`, and there never was.** Astro 7.2.0's supported
commands, read out of its own CLI source, are `add sync telemetry preferences
dev build preview check create-key docs info`. The extra positional is ignored,
so `npx astro dev stop` **starts a dev server**. This file used to recommend it,
`serve-preview.sh` used to call it, and both CI workflows had it inside a
`trap cleanup EXIT`, where it hung the job to GitHub's six-hour timeout on every
run, pass or fail. `|| true` cannot rescue a process that never returns.

To stop a dev server, kill the process group and then whatever still holds the
port, because the recorded PID is npm's wrapper and astro survives it:

```bash
kill -- -$(cat .palate-devserver.pid) 2>/dev/null; lsof -ti tcp:4321 | xargs kill
```

The lesson generalises: a CLI silently ignoring an unknown subcommand means
"command not found" and "command ran" look identical. Check the tool's own
command list before recommending a subcommand in doctrine.

## `npm run dev` react-refresh error (observed on Astro 6.4 + vite 7)
`npm run dev` (and `--local-preview` via `serve-preview.sh`) can throw a
`vite-react-refresh-wrapper ... Missing field 'moduleType'` error from the
`@astrojs/react` integration. Observed on Astro 6.4's vite 7 dev pipeline; NOT
re-confirmed on the Astro 7 / vite 8 template, so treat it as possible rather
than expected, and it affects DEV ONLY either way. The production build
(`npm run build` / `astro build`) and the default deployed Vercel preview
(`deploy-preview.sh`) are unaffected. Workaround: use the default shareable
Vercel preview (not `--local-preview`) for client handover; if a local dev loop
is needed, remove `@astrojs/react` from `astro.config.mjs` for the session (the
marketing pages are `.astro`; React is only exercised by a Sanity Studio /
visual-editing island or an opt-in Tier-2 R3F island, neither of which is in a
default no-CMS build).
