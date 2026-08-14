---
description: Take one page off the live site, with the right status code and an honest answer about how long it takes.
argument-hint: "<route or post slug> [--redirect /where-instead] [--dir <path>]"
---

# /palate-website-builder:unpublish

Take one page down. Say how long it takes before doing anything, because the answer is not
"instantly" and pretending otherwise is how somebody stands in front of a client watching a page
that should be gone.

**The mechanism, plainly.** There is no edge flag. Unpublishing without a rebuild is Phase 7 and
does not exist yet. Today this is a content change plus a deploy: the page keeps being served by
the current deployment until the new one is READY. The deploy is the clock.

Give them a real number for that clock, not a guess. `vercel ls` from the project dir prints the
duration of recent production deployments; quote the last few. If there is no deployment history
to read, say the time is unknown and that you will report it when the deploy finishes.

The one exception is a CMS-backed page, and it is genuinely instant. Check for it first.

## 1. Resolve exactly one target

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir> --out .palate/index.json
```

Read `routes` and `entries`. Match `$ARGUMENTS` against a route path, a route source, or a
collection entry id. If it matches more than one, list them and stop. Unpublishing the wrong page
is not recoverable inside the window that matters.

## 2. Pick the mechanism, and say which one applies

**CMS-backed** (`sanity.config.ts` at the project root, `src/lib/load.ts` querying Sanity, and
this page's copy actually comes from there): unpublish the document in the Studio at `/studio`.
The site is SSR and reads published content per request, so it is live on the next page load.
No deploy, no rebuild. Stop here, and say that is why it was instant.

**A collection entry** (`src/content/<collection>/<id>.md`): set `draft: true` in the
frontmatter. Drafts are filtered out of every listing and return 404 in production, and stay
visible in local preview and in the diff. Do not delete the file: deleting it throws away the
reason, the diff and the ability to put it back.

**A route** (`src/pages/...`): ask one question, because the right answer is a status code, not a
deletion.

- Gone for good: delete the route source. It 404s.
- Moved: delete it and add the old path to `redirects` in `astro.config.mjs` pointing at the new
  one, which issues a 301 on the SSR adapter. `--redirect` answers this without asking.
- Temporarily off: the honest repo-native form is a redirect to the parent section. There is no
  hidden state for a route the way there is for a collection entry, and inventing one with a
  conditional is a trap for whoever finds it in three months.

## 3. Fix what the removal breaks, before deploying

A page that disappears takes links with it.

- Remove it from the nav.
- Remove it from the sitemap if the sitemap is hand-listed.
- Any page that lists the item (a listing, a related block, a footer column) has to stop listing
  it.
- Re-run `palate-index.mjs` and read `links.dead`. Every internal href pointing at the removed
  path is now a 404 for a real visitor, and it is the part everyone forgets.

## 4. Ship it

Hand to `/palate-website-builder:publish`. It runs the contract, heals, commits, deploys, rebuilds the index and
re-baselines. Do not invent a second deploy path here; two ways to ship is how one of them stops
being tested.

Note the elapsed time and report it. The page is down when the deployment is READY, not when the
push lands.

## 5. Say what is still not gone

Even after the deploy:

- Search engines keep serving the cached result until they recrawl. A 404 or a 301 tells them
  faster than a page that quietly vanishes from the nav.
- Any CDN or browser cache on the old URL has to expire.
- Anything already printed, linked or emailed still points at it. A 301 to somewhere sensible is
  worth more than a clean 404 when there are inbound links.

## 6. If it has to be gone in seconds

The only fast lever on the host is rolling production back to a deployment that never had the
page: `/palate-website-builder:rollback`. That takes the whole site back with it, including every other change
since. Say that tradeoff out loud and let them choose. Never do it silently to make a single page
disappear faster.
