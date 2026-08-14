---
description: Bring an existing site under Palate management, whether or not Palate built it. Derives the brain, locks the tokens, indexes the routes, baselines every page.
argument-hint: "[path to the site folder, or a live URL]"
---

# /palate-website-builder:adopt

The site: **$ARGUMENTS**

Adoption is harder than scaffolding and you should say so early. A new site is built to fit the
tooling. An old one was not, and some of what follows will come back partial. Partial and named
beats complete and invented, every time.

Nothing here is a judgement of the site. A site adopted at 44 must still be able to merge a typo
fix tomorrow, so record what is there and never gate on it.

## 1. Work out what you are adopting

If the argument is a path, use it. If it is a URL, look for a local checkout first (ask, do not
guess), because a URL alone gets baselines and nothing else.

Read, in this order: `package.json`, `astro.config.*`, `next.config.*`, `svelte.config.*`,
`nuxt.config.*`, `_config.yml`, `config.toml`, then the top two levels of the tree.

Three tiers. Say which one out loud before doing any work, and say what it costs.

**Tier 1, Astro with `src/pages`.** Everything works: the content graph, blast radius, the
contribution contract, baselines, drift.

**Tier 2, another framework, or static HTML, with a repo.** Anything that renders works:
baselines, drift, accessibility, vitals, the token lock, the local grade, plus the crawled route
map and the image measurements from section 3a. The content graph does not, because
`palate-index.mjs` reads `src/pages` and exits 2 without it. That means no blast radius
and no `palate-contract.mjs`, so contributions cannot be scoped by diff class. Say exactly that.
Do not half-build an index that will be wrong.

**Tier 3, a hosted builder with no repo** (Squarespace, Wix, Webflow, Shopify, WordPress you
cannot clone). It cannot be adopted in place, because there are no files to manage. Offer the
honest alternative: the crawl, baselines and a grade against the live URL, so there is a record of
where it started, and rebuilding is a separate decision. Do not pretend a URL is under management.

## 2. Get it running, or fall back to the live URL

Tier 1 and any tier 2 project with a `package.json`:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" .
```

It backgrounds the server, polls until it answers, and prints `SERVE_URL=…`. Use that URL for
everything below. If it prints `SERVE_FAIL`, do not debug the project's build here. Fall back to
the live URL, note in the report that the baselines are of the deployed site rather than the
working tree, and carry on. The two are different measurements and conflating them is how a
baseline lies later.

## 3a. Map the site before you measure anything

**This is the step that decides every route list below, and it is required on every tier.** Before
this existed, tier 2 had no route source at all and the measurements below ran against `/`,
`/about` and `/contact`, three routes guessed from nothing. On a site with `/services/roofing` and
no `/about`, that measured two 404s and reported them as the site.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-crawl.mjs" "$SERVE_URL" \
  --out .palate/site-map.json --assets-out .palate/assets.json --max-pages 100
```

It reads `/sitemap.xml` first, follows a sitemap index to its children, and falls back to
following in-origin links from the homepage when there is no sitemap. It stays on-origin, obeys
`robots.txt`, and follows an apex-to-www redirect to the canonical origin.

Use the live URL rather than `$SERVE_URL` when section 2 fell back, and say which one the map is
of. A local preview and the deployed site are different measurements.

**Read the exit code, it is the finding.**

- **0** clean. `.palate/site-map.json` holds every route with its title, status and images.
- **1** crawled but incomplete. Read the `WARNING` lines: a sitemap larger than `--max-pages`
  (the map is a sample, say so), routes that failed, or a homepage that served no links at all,
  which usually means a client-rendered nav and means the architecture is **not established**.
  Do not proceed as though the route list is complete.
- **3** BLOCKED. An auth wall, a Shopify password page, an SSO redirect, a WAF 403, or a
  `robots.txt` that disallows everything. Read `blocked.reason` and **say it out loud**: a wall
  returns one page, which is indistinguishable from a one-page site by count alone. Nothing behind
  it has been seen. Use `--ignore-robots` only when the customer owns the site and asks.

The crawl also measures **every image from its own file header**, over a range request, so a
2000x3000 portrait is known to be a portrait before anything decides to put it in a 3:1 slot. CDN
query params (`?w=1200`) are ignored on purpose: they say what the CDN was asked for, not what the
file is. `.palate/assets.json` comes out in `palate-assets.mjs`'s own record shape, so the two
sources of image truth (local files, remote photos) read identically.

Report the counts as findings: how many images could not be measured, and every photo the map
flags as destroyed by a common slot. `subject` and `treatment` stay null, because pixels cannot
say where the subject is. That is `/palate-website-builder:image`'s job, not adoption's.

## 3. Derive the brain from the site's own words

`.palate/brain/` is plain markdown the customer owns. Four files, matching what the rest of the
commands read: `facts.md`, `voice.md`, `constraints.md`, `decisions.md`.

Read the site's actual pages: the home page, about, contact, services or products, the footer,
and any structured data in a `<script type="application/ld+json">` block. Then write:

**`facts.md`** the single-sourced business facts as they currently appear: legal and trading
name, phone, email, address, hours, service area, prices, ABN or company number, social handles.
Beside each, the route and file you took it from. Where two pages disagree, record **both** and
mark the conflict. A footer saying one phone number and a contact page saying another is the most
common thing adoption finds, and resolving it silently destroys the evidence.

**`voice.md`** how this site already writes: person and tense, sentence length, whether it uses
contractions, the words it repeats, the words it avoids, how it addresses the reader, how CTAs
are phrased. Quote four or five real lines as specimens. This is descriptive, not aspirational.
It is the record of the voice a future post has to match, not the voice you would prefer.

**`constraints.md`** anything the site cannot do or must always do that you can see from the
outside: regulated claims, required disclaimers, licence numbers on display, accessibility
commitments, languages, a booking system it must link to, a phone number that must be clickable.

**`decisions.md`** dated, one entry, written today: that the site was adopted, at which commit,
what tier, what was derived rather than told, and what remains unconfirmed.

**Mark every derived line as derived.** A prefix is enough (`derived:`). The difference between a
fact the owner confirmed and a fact you read off their own footer matters the first time one of
them is wrong.

## 4. Lock the tokens from the site's own CSS

Not from a stylesheet by reading. From the rendered page, because a real site's type stack and
palette live in computed styles and external sheets, and reading source misses both.

Write and run this against the running site. It uses `measurePage`, the same measurement the
grader uses, so the lock and the score are the same object.

```js
// .palate/tmp/tokens.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
// The plugin root arrives as an argument, never from the environment: the shell a Bash
// call runs in does not reliably export CLAUDE_PLUGIN_ROOT, and reading it there yields
// undefined and a confusing resolver error. createRequire finds the plugin's own
// Playwright regardless of where this file sits.
const P = process.argv[2];
const { chromium } = createRequire(P + '/scripts/reference-capture/package.json')('playwright');
const { measurePage } = await import(pathToFileURL(P + '/scripts/reference-capture/design-measure.mjs').href);

const [base, ...routes] = process.argv.slice(3);
// channel: 'chromium' is not optional. Every launcher in this repo sets it because the
// headless_shell segfaults in-sandbox, and adoption is the command most likely to be run
// on a machine nobody here has ever seen.
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] });
const out = {};
for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(new URL(route, base).href, { waitUntil: 'load', timeout: 45000 });
  out[route] = await measurePage(page);
  await ctx.close();
}
await browser.close();
mkdirSync('.palate', { recursive: true });
writeFileSync('.palate/tokens.json', JSON.stringify(out, null, 2) + '\n');
console.log('tokens: ' + Object.keys(out).length + ' route(s) measured');
```

Routes come from the map, never from a guess. Take the first few real ones:

```
ROUTES=$(node -e 'const d=require("./.palate/site-map.json");console.log(d.pages.filter(p=>p.status>=200&&p.status<300).slice(0,5).map(p=>p.path).join(" "))')
node .palate/tmp/tokens.mjs "${CLAUDE_PLUGIN_ROOT}" "$SERVE_URL" $ROUTES
```

Each route returns weighted lists: `fonts`, `sizes`, `colours`, `radii`, `shadows`, `borders`,
`pads`, plus `lineHeightRatio`, `measureChars`, `failAACount`, `under44` and `tells`. Weight is
ink, not count, so the top entries are what the page is actually made of rather than what appears
most often in the markup.

Then write the lock itself, `.palate/tokens.lock.md`, in words: the two or three type faces that
carry real weight, the type sizes that recur, the accent and its role, the radius, the border
weight, the spacing unit. This is the file a future contribution is held against, so it has to be
readable by a person. The JSON is the evidence; the markdown is the rule.

**Record `tells` and `failAACount`, do not fix them now.** They are the inherited state. Fixing
them during adoption makes the first baseline a measurement of your work rather than of theirs,
and every later comparison inherits that lie.

## 5. Build the index (tier 1 only)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --out .palate/index.json
```

It prints routes, entries, drafts, orphans and dead links. Report the orphans and dead links as
findings, not as failures.

**Recover the taste lineage while you are here.** If a `build-manifest.json` exists with a
non-empty `references_surveyed`, this site was built by Palate and its donors are recoverable:
write `.palate/donors.json` (`{ version: 1, spine, donors, writtenAt }`, spine = the hero pick's
donor from `explore.shown`/`explore.picks` when present, else the first surveyed reference). The
RUN SITE commands read it to keep drawing on the SAME references the site's craft came from: a
post pulls the spine's `copy_voice`, a new page prefers a recorded donor over a stranger. Without
it every later session re-searches the library cold, as if this site's taste came from nowhere.
No manifest, or an empty survey, means the lineage is genuinely unknown: write nothing, never
invent a donor. Then prove the graph works on this site, because a graph nobody has
tested is a liability:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --reads business
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --blast src/lib/business.ts
```

If `facts.source` is empty, this site has no single record of its business facts, they are typed
into pages by hand. Say so. It is the single highest-value thing to fix on an adopted site and
the reason `/palate-website-builder:fact` will not do much here yet.

On exit 2, you are tier 2. Skip to section 6 and say the graph is unavailable and why.

## 6. Baseline every route

Baselines hold **numbers, never pixels**: throttled vitals, the appearance embedding, contrast
and tap-target counts, the design facts. About 20KB of diffable JSON per route, most of it the
768 floats of the appearance embedding. Screenshots are
regenerated on demand for a before-and-after; they are an output, never a record. A repo that
commits stills can never be un-fattened without a history rewrite.

Route list: from `.palate/index.json` on tier 1; from `.palate/site-map.json`, written by the
crawl in section 3a, on tier 2 and tier 3.

Tier 1:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-baseline.mjs" "$PWD" --base "$SERVE_URL" --all
```

Tier 2 and 3, where there is no `src/pages` for `--all` to read:

```
ROUTES=$(node -e 'const d=require("./.palate/site-map.json");console.log(d.pages.filter(p=>p.status>=200&&p.status<300).map(p=>p.path).join(","))')
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-baseline.mjs" "$PWD" --base "$SERVE_URL" --routes "$ROUTES"
```

`--all` baselines every static route in the index, and needs an Astro `src/pages`; it exits 2 with
a named reason on anything else rather than baselining nothing. `--routes` needs no index at all,
which is what makes tier 2 work. `--dry-run` shows what would be written without writing it.

This used to be seventy lines of JavaScript pasted into this file. It is a real script now, at
`scripts/palate-baseline.mjs`, covered by `scripts/test/palate-baseline.test.mjs`, because an
inline copy cannot be syntax-checked, cannot be tested, and has to be fixed twice.

It skips dynamic routes and endpoints deliberately. `/blog/[slug]` is a template rather than a
page, so baselining the literal bracket path would store a 404 as the thing every future post is
compared against, and `robots.txt` has no appearance to drift.

Verified end to end against a real page: 768-dimension embedding, throttled vitals
(`lcpMs`, `clsScore`, `tbtMs`, `fcpMs` under 150ms RTT and 4x CPU), contrast and tap-target
counts, and the design facts, all written to `.palate/baselines/<route>.json`.

The appearance head **refuses rather than guesses**. A blank or flat capture comes back
`applicable: false` with a reason, and the baseline stores `embeddingRefused` instead of a
vector. Report the refusals; a route with no embedding has no drift signal, and finding that out
in three weeks is worse than reading it today.

First run downloads the model that judges how a page looks, **356MB, once**. Say so before you
start. If it is missing entirely, run
`bash "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/setup.sh" --with-taste` first.

Also run the accessibility and rendered checks across the same routes and keep the output as part
of the adoption record:

Use the same `$ROUTES` the baselines used. A hardcoded `/,/about,/contact` was here and it was a
guess: on a site with none of those three it audited three 404 pages and reported the result as
the site's accessibility.

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" "$SERVE_URL" --routes "$ROUTES" --out .palate/adoption
```

## 7. Install the loop

Create `.palate/changelog.md` with one dated entry: adopted, from which commit, which tier, how
many routes baselined, what refused.

Add to `.gitignore` if not already there. The index is derived and rebuildable, the temp folder is
scratch. Baselines are measurements that cannot be recomputed from source, so they are committed.

```
.palate/index.json
.palate/tmp/
```

Then delete `.palate/tmp/`.

Run the anti-slop floor once so the inherited state is on the record, and do not act on it:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" .
```

Commit `.palate/brain/`, `.palate/baselines/`, `.palate/tokens.json`, `.palate/tokens.lock.md`
and `.palate/changelog.md` in one commit on a branch, never on the default branch.

## 8. Hand it back for one decision

They agree, or they correct. That is the whole interaction. Do not ask them to choose settings.

```
Adopted        acme-plumbing (tier 1, Astro, 9 routes)
Crawled        9 routes from the sitemap, 0 failed, 1 skipped by robots
Images         41 measured from their headers, 6 unmeasurable, 9 portraits
Baselined      9 of 9 routes, 1 appearance refused (/thanks: flat capture)
Facts found    phone, email, address, hours, 3 prices
Conflict       phone differs: footer 02 9550 1234, /contact 02 9550 4321
Voice          second person, short sentences, no contractions, "book a visit" not "get started"
Inherited      12 contrast failures, 4 tap targets under 44px, LCP 4.8s on /
Not available  nothing
```

Then one question and nothing else:

> Two things to confirm: which phone number is right, and is anything in `facts.md` wrong?
> Everything else is recorded and I have changed nothing about the site.

## 9. Say what this cannot do

Never leave these implicit. Include only the ones that actually apply.

- **Tier 2**: no content graph, so no blast radius and no contribution contract. A change cannot
  be scoped, so every check runs over every route or none.
- **Tier 3**: not under management at all. Baselines against a live URL and nothing else.
- **A framework nobody here recognises**: say the name, say the graph does not read it, and say
  the render-based half still works. Do not guess at its routing convention.
- **Deployed rather than local baselines**, if section 2 fell back.
- **No single record of business facts**, if `facts.source` came back empty.
- **Routes behind a login, a paywall, or a form**: not baselined, and say which.
- **A sampled route map**, if the crawl warned that the sitemap is larger than `--max-pages`. Say
  how many of how many.
- **An unestablished architecture**, if the crawl exited 1 because the homepage served no links.
  The route list is what one page happened to reference, not the site.
- **A blocked crawl** (exit 3): say the reason. Behind that wall, nothing has been measured, and
  a page count of one is not evidence of a one-page site.
- **Images that could not be measured**: name the count. An unknown dimension is not a safe one.

## 10. What comes next

One line, no menu:

> `/palate-website-builder:check` before any change, `/palate-website-builder:drift` any time to see what has moved.
