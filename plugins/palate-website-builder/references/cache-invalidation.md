# Cache invalidation / content freshness

The site is SSR (`output: "server"`) on both hosts. Pages render on request and
read the latest published Sanity content, so **content changes need no rebuild**
and there is nothing to wire on publish.

## Why a publish is live immediately
`loadPage()` fetches through the Sanity client. In production it uses the Sanity
API CDN, which purges on publish, so the next request renders the new content
(seconds, not a deploy). `vercel.json` sets no HTML `Cache-Control`, and the
Cloudflare adapter likewise does not cache HTML, so responses are not held stale
at the edge.

## Vercel (default)
No deploy hook, no rebuild-on-publish webhook. `provision-vercel.sh` runs
`vercel git connect`, so the only redeploys are CODE changes pushed to `main`
(auto) and PR previews. Content publishes need none of that.

## Cloudflare (backup)
The overlay ships `revalidate.yml` (Sanity webhook -> `repository_dispatch` ->
rebuild + `wrangler deploy`) as an OPTIONAL belt-and-braces full redeploy. It is
not required for content freshness (SSR already serves fresh), so wiring the
Sanity webhook is optional on the Cloudflare path.

## Manual refresh
Vercel: re-run `vercel deploy --prod` or push to `main`. Cloudflare:
`wrangler deploy` or a `workflow_dispatch` on `deploy.yml`.

## The form handler is dynamic
`src/pages/api/contact.ts` has `prerender = false` and runs as a server function
on every request (read by `locals.runtime?.env ?? import.meta.env`, so it works
on both hosts).
