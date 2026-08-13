---
description: Run the site-level checks no single contribution can trigger: sitemap coverage, crawlability, redirects and canonicals, schema, orphans, dead links, stale content, expiring facts.
argument-hint: "[project-dir]"
---

The contribution gate only ever sees a diff. These faults belong to the whole site and arrive
without anyone contributing anything: a WAF rule change can cost every answer engine, a
`sameAs` profile can 404, an opening hour can go stale over a public holiday. No contribution
caused any of it, so no contribution gate will ever catch it.

Run this monthly, and after any infrastructure or DNS change.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}` (or the skill checkout root). `$SITE` is the
project directory.

## 1. Build the graph and serve the site

```bash
node "$PALATE/scripts/palate-index.mjs" "$SITE"
bash "$PALATE/scripts/serve-preview.sh" "$SITE"     # prints SERVE_URL=...

# Every check below reads $BASE. Bind it once, here, and never inline a URL.
BASE="${DEPLOYED_ORIGIN:-$SERVE_URL}"
```

Sweep the deployed origin when the person names one. A crawlability fault caused by a CDN or a
firewall rule is invisible on localhost, and that is the fault this exists to find. Set
`DEPLOYED_ORIGIN` to sweep it; otherwise this falls back to the local server.

**Name which origin was used in the report header.** A robots or crawler-parity result means
nothing without it: the whole point of the check is that the two can disagree.

## 2. The deterministic crawl surface

Run this before anything by hand. It answers sitemap coverage, redirects, canonicals and robots
in one pass, and it is the only part of the sweep that cannot be talked out of a finding.

```bash
node "$PALATE/scripts/gate-seo.mjs" "$SITE" --base "$BASE"; echo "exit=$?"
```

`--base` is not optional on a real sweep. The disk pass cannot answer "does this URL redirect"
for a server-rendered route, which is most of them, and a redirect inside the sitemap or inside
llms.txt is a citation an answer engine simply drops.

Read the exit code, not the wording:

- **0** clean. The line it prints names how many URLs it measured; quote that number, because a
  clean result over three URLs and a clean result over three hundred are different claims.
- **1** findings. Each one is real and each one names its cause. Put them in BLOCKING.
- **2** it could not check something. **This is not a pass**, and it is the outcome the older
  faults hid behind. The commonest causes are an unbuilt project (the sitemap is a build
  artefact), a server-rendered build with no HTML on disk, and a dynamic route whose collection
  it cannot resolve. Fix what it names or say plainly in the report that the crawl surface is
  UNKNOWN.

The one it exists for: **collection entries missing from the sitemap**. `@astrojs/sitemap` only
lists what the build knows about, and an SSR dynamic route with no `getStaticPaths` is nothing
at build time. On a real client build that meant not one of its part-number pages was in the
sitemap, on a site whose whole SEO argument was part-number discoverability.

## 3. Crawlability by hand

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/robots.txt"
curl -sS "$BASE/robots.txt"
```

Check, against `src/pages/robots.txt.ts`:

- It serves 200 and is plain text. A 404 here is the whole fault.
- `GPTBot`, `ClaudeBot` and `PerplexityBot` are each still `Allow: /`. A generic
  `User-agent: *` block does not cover them once one is named.
- The `Sitemap:` line resolves. Fetch it and confirm 200.
- **On production only.** The endpoint closes deliberately when the deployment is a preview or
  the host is not the canonical one, because a preview is a public origin and indexing it puts
  the client's content at a URL they do not own. A `Disallow: /` here is the fault ONLY if
  `$BASE` is the canonical production origin. Say which origin you fetched before calling it.

## 4. AI-crawler fetch parity

The check nobody runs, and the one that fails silently. Fetch the same route as a browser and
as each AI crawler, then compare.

```bash
for ua in "Mozilla/5.0" "GPTBot/1.0" "ClaudeBot/1.0" "PerplexityBot/1.0"; do
  printf '%-22s %s %s bytes\n' "$ua" \
    "$(curl -sS -A "$ua" -o /tmp/palate-ua.html -w '%{http_code}' "$BASE/")" \
    "$(wc -c < /tmp/palate-ua.html)"
done
```

Any status divergence is a finding. So is a body more than about 10% smaller for a crawler:
that is a challenge page or a JS-only shell being served to the agents that cannot run JS.
Report the exact status and byte count for each, not a summary.

## 5. Organisation schema

```bash
curl -sS "$BASE/" | grep -o '<script type="application/ld+json">.*</script>'
```

- The block exists, parses as JSON, and is a single node per entity.
- `@type` matches `business.schemaType` in `src/lib/business.ts`.
- No field is an empty string. `businessJsonLd()` omits unknown fields on purpose, because a
  validator reads an empty `telephone` as a claim. An empty one that reached the page means
  something bypassed the builder.
- Every fact in it matches `src/lib/business.ts`.

**Do not run `scripts/test/single-source-facts.test.sh` here.** It hardcodes the plugin's own
`templates/astro-project`, takes no project argument, and greps for `{{CLIENT_NAME}}` placeholders,
so on a customer site it prints `passed=11 failed=0` having read none of their files. A check that
reports clean while measuring nothing is worse than no check, because it retires the question.

The fork check that works on a real site reads the site's own record and looks for its values
anywhere they were retyped:

```bash
node -e '
const fs=require("fs"), rec=fs.readFileSync(process.argv[1],"utf8");
// The literals worth chasing: anything a person would retype into a page.
const vals=[...rec.matchAll(/^\s*(?:name|email|telephone):\s*"([^"]{4,})"/gm)].map(m=>m[1]);
if(!vals.length){console.log("no literal facts in the record; nothing to fork");process.exit(0)}
console.log("checking for forks of:", vals.join(" | "));
' "$SITE/src/lib/business.ts"

# Then grep src/ for each, excluding the record itself. Any hit is a fork.
grep -rn --exclude-dir=node_modules -F "<each value>" "$SITE/src" | grep -v "src/lib/business.ts"
```

Any hit outside the record is a finding: that surface will go stale the next time the fact changes,
and it will be the surface a customer acts on.

## 6. Orphans and dead internal links

Both come straight out of the index, no extra work:

```bash
node -e 'const i=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(i.links,null,1))' \
  "$SITE/.palate/index.json"
```

- **Dead links** are always a finding. An href to a path no route serves.
- **Orphans** are reported, never failed. A campaign landing page is legitimately unlinked. Name
  each one and ask whether it is deliberate. A published page nothing links to is usually a page
  someone forgot, and a page nothing links to is a page nothing ranks.

## 7. Stale content

Read `entries` out of the index:

- **Drafts that never shipped.** `draft: true` and a `publishedAt` more than 60 days old. It was
  written and then dropped.
- **Nothing published recently.** No entry inside 90 days on a site with a blog is a finding of
  its own: the collection is the reason the site was given a content runtime.
- **Future-dated entries.** The content config guards against these, so one that exists is a
  YAML rollover, not an intention.

## 8. Expiring facts

Everything in `src/lib/business.ts` that decays on its own:

```bash
node -e 'const i=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(i.facts ? i.facts.readBy.join("\n") : "no business fact record on this site: expiring-facts sweep unavailable")' \
  "$SITE/.palate/index.json"
```

- `sameAs` profiles: `curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' -L <url>` each.
  A 404 or a redirect to a login wall breaks the entity proof the schema rests on.
- `openingHours`: name them and ask. Nothing can verify these but the owner, and the wrong ones
  are what a customer drives to a closed door on.
- `telephone` and `email`: check the format is still E.164 and the address' domain still resolves.
- `serviceAreas` and `services`: list them and ask whether the business still does all of it.

## 9. Report

Rank by what it costs, not by how easy it is to fix. Crawler parity and dead links first,
because those cost traffic; opening hours next, because those cost a customer.

```
SITE SWEEP  palatemcp.com  2026-08-10

BLOCKING
  crawler parity   ClaudeBot gets 403, browsers get 200
                   Every answer engine has been unable to read this site since the
                   firewall rule changed. Allow the named crawler user agents.
  sitemap gap      gate-seo exit 1: 34 of 37 routes advertised; 3 part pages behind
                   /parts/[sku] are in no sitemap, so nothing crawls them
  dead link        /services/plumbing linked from /, no route serves it

REVIEW
  orphan           /v1 is published and nothing links to it (Explore leftover?)
  sameAs           https://facebook.com/example 404s; the schema claims it exists
  stale draft      "Winter service reminder" draft since 2026-04-02

ASK THE OWNER
  openingHours     "Mo-Fr 09:00-17:00" unchanged since the build. Still right?
```

Do not heal anything in this command without saying so. Deleting an orphan page or a `sameAs`
entry is a content decision, and the only decision the person owes you is agreement.
