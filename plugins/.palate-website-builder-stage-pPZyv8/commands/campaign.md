---
description: Create a campaign landing page with its matched copy, its UTM destination and its tracking, as one change.
argument-hint: "[the campaign, e.g. \"spring service special for Google search\"]"
---

A campaign is a landing page, the copy that matches the promise in the ad, the destination URL
the ad points at, and the tracking that proves it worked. This command makes all four at once
and binds them to one key, because they are only useful together.

**Why this is one command and not four.** A campaign without its own copy sends a paid click
carrying a specific promise to a page about something else. That is not a theoretical failure:
we have measured it on our own account, where a whole channel's clicks arrived with no
`utm_campaign` at all and therefore never once saw a matched headline, and a campaign with a
mismatched hero ran a two second median visit. Paid clicks cost money and a mismatch is
measurable, so the link is built into the mechanism rather than written down as a rule.

`$ARGUMENTS` describes the campaign. If it is empty, ask what the ad will promise and which
platform it runs on.

## 1. Pick the key. One key, three uses.

Choose one kebab-case key that names the audience and the offer, for example
`spring-service-au` or `icp2-emergency-callout`. Everything derives from it:

- the route, `/c/<key>`
- the `utm_campaign` value on the destination URL, exactly `<key>`
- the entry in the campaign copy record

They cannot drift, because they are the same string: `getStaticPaths()` reads
`Object.keys(campaigns)`, so a page cannot exist without an entry. **Be precise about what that
does and does not give you.** A missing entry produces NO ROUTE, it does not fail the build, and
nothing checks that the `utm_campaign` on the destination URL matches the key. So the structure
prevents an orphaned page; it does not prevent a live ad pointing at a key that was never written.

If you want the house rule actually enforced, step 2 must also write the test: every key in the
live set has copy, and none of it contains an em dash or a banned verb. Palate's own version of
this rule is backed by exactly such a test, and the rule is only as real as the test is.
Do not hand-write the key in three places.

## 2. Build the mechanism (first campaign only)

If `src/lib/campaigns.ts` does not exist yet, create it: one typed record keyed by the exact
`utm_campaign` value, each entry carrying the hero copy and the meta for that campaign.

Then create `src/pages/c/[campaign].astro` with `getStaticPaths()` returning
`Object.keys(campaigns)` and `export const prerender = true`. This is the binding: a key without
a page is impossible, and a page without a key is impossible, so a campaign can never ship with
the wrong hero on it.

Match the site's existing conventions while you do it. The page uses the site's layout, the
site's tokens and the site's components, and it reads copy from the record the same way other
pages read theirs. It is a landing page, not a second website.

If the file already exists, add the key to the record and stop. There is nothing else to build.

## 3. Write the copy against the ad, not against the homepage

The headline on the page has to answer the promise in the ad, in the words the ad used. If you
cannot state the ad's promise in one sentence, you are not ready to write the page.

Read `.palate/brain/voice.md` and `.palate/brain/constraints.md` if they exist. Facts come from
`src/lib/business.ts`. One primary action on the page, repeated, with nothing competing with it.

Ground the page's composition in the library if the MCP is reachable:
`mcp__palate__refs_search { pageType: "landing", conversionPrimitive, query }` then
`mcp__palate__refs_get_screenshot` on the best two, **and pull their taste layer, which is where
the library earns its keep on a landing page**: `mcp__palate__refs_get { slug, layer: ["do_dont",
"component_prompts"] }` on both. The screenshot shows what the donor did; `do_dont` says what it
REFUSED to do, and a landing page is mostly made of refusals (one action, no nav competition, no
vanity strip above the offer). `component_prompts` carries the donor's own recipe for the
conversion blocks you are about to build. Take the composition and the rules, not the copy.

A campaign page also stays THIS site's page: read `.palate/donors.json` and, when the spine donor
is a plausible fit for a landing composition, weigh it against the search results before
reaching for a stranger. If the tools are absent, say so once with the recovery line
`claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp` and
compose from the site's own highest-converting page instead.

**Indexing.** If the landing page substantially duplicates an existing page, set `noindex` on it
through the layout's prop. Note that this is a PAGE-level noindex and does not trip the
`sitewide_noindex` cap, which is a different thing: the cap fires when the whole site tells
search engines to stay away.

**Orphan status is expected.** `palate-index` will report `/c/<key>` as an orphan, because
nothing links to it. That is correct for a campaign landing page and is reported rather than
failed. Do not add a nav link to silence it.

## 4. Emit the destination URL

Print the full URL, ready to paste, built from the site's real domain:

```
https://<domain>/c/<key>?utm_source=<platform>&utm_medium=cpc&utm_campaign=<key>&utm_content=<creative>
```

`utm_campaign` must be exactly the key. Nothing else works, because that is the string the page
is registered under.

Two platform notes that decide whether this ever fires:

- **Google Ads**: set the UTMs as the campaign's **final URL suffix**, not on each ad. Every ad
  then inherits them. Auto-tagging alone sends only a `gclid` and no `utm_campaign`, so a
  campaign relying on auto-tagging arrives with no campaign name at all and the matched copy
  never fires.
- **Anything with a click id** (`gclid`, `rdt_cid`, `msclkid`): the click id is what identifies
  the individual click. The UTMs are what identify the campaign. Capture both.

## 5. Tracking

Use what the site already has. Read the layout and find the analytics, the pixel, or the
conversion tag that is actually installed.

- Confirm the campaign parameters survive the landing. If the site stores attribution, check
  that `utm_campaign` lands with the key in it and is not dropped on the first navigation.
- Confirm the page's primary action fires whatever conversion event the site already uses.
- If the site has NO analytics installed, say that plainly and stop pretending otherwise. A
  campaign that cannot be measured is a campaign you will not be able to judge, and the honest
  move is to say so before the money is spent, not to add a tag nobody asked for.

Never add a third-party script to a customer's site as a side effect of this command.

## 6. Plan and check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed <files> --json
```

Expect `structural` on the first campaign (a new route and a new component) and `content` on
each one after it. Run the lanes the contract names:

```
"${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
  <SERVE_URL> --routes /c/<key> --out .palate-shots
```

Plus `npx astro check`, `npm run build`, and
`"${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" <dir>`.

Two checks that matter more here than anywhere else, because this page takes paid traffic:

- **Mobile at 390.** Load the served route at 390 wide and confirm nothing covers the primary
  action, at the top of the page AND after a scroll. A fixed element that clears the button on
  load can still cover it once the reader scrolls the button under it. We have shipped that bug
  on our own site.
- **Throttled LCP.** The verifier measures under slow 4G with 4x CPU. A paid click that waits is
  a paid click that leaves.

## 7. Heal, then show

Fix and re-run before showing anything. Two flat iterations is a stall; report it.

Show:

- The key, the route, and the destination URL ready to paste.
- The headline, beside the ad promise it answers.
- The mobile still at 390 and the desktop still.
- The lane results, including the throttled LCP.
- Where the conversion is recorded, or the plain statement that nothing records it.

Then one last thing, and say it out loud: if this campaign underperforms, the first move is to
fix its targeting and its copy. Pausing it teaches you nothing.
