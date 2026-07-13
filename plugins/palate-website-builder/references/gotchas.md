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

## `npm run dev` react-refresh error under Astro 6.4 (local-preview only)
`npm run dev` (and `--local-preview` via `serve-preview.sh`) can throw a
`vite-react-refresh-wrapper ... Missing field 'moduleType'` error from the
`@astrojs/react` integration under Astro 6.4's vite 7 dev pipeline. It affects
DEV ONLY. The production build (`npm run build` / `astro build`) and the default
deployed Vercel preview (`deploy-preview.sh`) are unaffected. Workaround: use the
default shareable Vercel preview (not `--local-preview`) for client handover; if a
local dev loop is needed, remove `@astrojs/react` from `astro.config.mjs` for the
session (the marketing pages are `.astro`, React is only used by Sanity visual
editing islands which are not exercised in a content.ts-fallback preview).
