# Shopify headless: the runbook

**Zero to a live storefront, in order.** Read `commerce-doctrine.md` for the WHY behind any step;
this file is the sequence. Every step names what proves it worked, because a step you cannot
verify is a step you will repeat later under pressure.

Commerce is an OPTIONAL track. If the target is not a Shopify store, none of this applies and the
ordinary build doctrine stands.

---

## Before anything: should this merchant go headless at all?

Any ONE of these is a no, not a risk to manage (`commerce-doctrine.md` §8):

- their app budget exceeds the storefront budget and one vendor dominates it with no fallback
- a rule must be enforced at checkout and they will not buy Plus
- marketing cannot pass a 30-minute authoring test and the preview route is out of scope
- they cannot name what is currently firing on their storefront

Of 173 exceptionally-designed Shopify stores measured in the Palate library, **149 run Liquid
themes and about 11 are bespoke headless builds.** Headless is the minority answer. Make it a
decision, not a default.

---

## 1. Survey the store. No credential, no setup, zero clicks.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-shopify.mjs" https://theirstore.com
```

Writes `.palate/catalogue.json`: real handles, titles, prices, variants, options, **image URLs
with width and height**, categories, tags.

**Proves it worked:** a product count and a collection count. Exit 2 means not a Shopify host (or
already headless); exit 3 means blocked, and a dev store answers that way because its Online Store
channel is locked.

**Then build Explore against their OWN products and photography.** At brief time they are still on
Liquid, so tokenless works. A client seeing their real catalogue in eight directions is a
categorically better pitch than lorem, and it costs nothing.

**Ceiling:** no metaobjects, no exact inventory, live stores only, and it stops working on the apex
the moment the domain cuts over. Never let a build reach production on tokenless.

---

## 2. Get a production credential. Three admin clicks, once.

1. Install the **Headless** channel from the Shopify App Store
2. Sales channels → Headless → **Add storefront**, copy the **public** access token
3. Only if the design needs it: Manage API access → Storefront API → Permissions → tick
   `unauthenticated_read_metaobjects` and/or `unauthenticated_read_product_inventory`

Admin UI only, no API behind it. Then re-survey with the token:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-shopify.mjs" https://theirstore.myshopify.com --token "$TOKEN"
```

**Proves it worked:** the catalogue records `productionSafe: true` and
`source: "storefront-api-token"`.

Two dead ends, so nobody wastes an afternoon: **admin custom apps have been unavailable since
1 January 2026**, and `storefrontAccessTokenCreate` is the wrong door because it needs a
sales-channel app, which is more setup than the Headless channel it would replace.

**Never give a Shopify token a `PUBLIC_` prefix.** `PUBLIC_` is inlined at build, so rotating it
would require rebuilding every page in the catalogue.

---

## 3. Admin API, when you need it. One browser consent.

```bash
npx @shopify/cli@latest store auth --store "$STORE" --scopes read_products,read_publications
npx @shopify/cli@latest store execute -s "$STORE" -j -q '{ publications(first:20){ nodes { id name autoPublish } } }'
```

The token lives in the **OS keychain**, never in `.env` or the repo. Use it to run the publication
check before the build starts.

**`store execute` returns the payload UNWRAPPED** (`{shop:...}`), not `{data:{shop:...}}`. Reading
`j.data` yields `undefined`, and `undefined` read as a verdict is how a guard refuses for the
wrong reason.

---

## 4. Build the storefront

**Render strategy** (§1). Static by default; a real 742-URL store ships 783 prerendered pages with
one on-demand route. Only these earn `prerender = false`: cart mutation endpoints, the cart page,
customer account, campaign landing pages.

**The pages a storefront is not a store without.** The first build had the plumbing and none of
this, and a visitor could add to a bag and then was stranded permanently:

| | |
|---|---|
| Header | logo, collections nav, search, **bag link with a count** |
| Footer | collections, contact, the legal line |
| `/` | hero, collections, products from the catalogue |
| `/collections/[handle]` | the WHOLE collection, not the first 24 |
| `/products/[handle]` | price island, variant options, add to bag, **links back out** |
| `/cart` | lines, quantity edit, remove, checkout |
| `/search` | a real search over the catalogue |
| `/collections` | the index |
| `/404` | a way back, not a dead end |

**The price** (§2). Static page, `server:defer` island, build-stamped price as the fallback slot,
**plus a client-side watchdog**. Astro leaves the fallback in place on any island failure, so
without the watchdog five of seven failure modes show a stale price and four are silent.

**The cart** (§3, §3b). HttpOnly + Secure + **SameSite=Lax** cookie, mutations behind server
endpoints, quantity verified after every mutation, and **a drawer that slides out on add**.

**Restore the agent surface** (§6). `/agents.md` and `/llms.txt` are rendered by Shopify's online
store layer and going headless deletes them.

---

## 5. Verify. Statically, then at runtime, then by walking it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-headless.mjs" .                      # 33 static checks
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-headless.mjs" . --runtime "$URL"     # + the wire and the walk
```

The done gate runs the static half automatically and is silent on any build with no catalogue.

**Run `--runtime` against the DEPLOYED url, not localhost.** Deployment protection, edge redirects
and env differences are all invisible locally.

**And take the walk yourself.** Open the deployed site, click from the home page to a product, add
it, find the bag, reach checkout. Whatever you cannot do is the defect list. That walk found no
nav, no footer, no bag link, no `/cart`, no `/search` and a product page with zero outbound links,
in about ninety seconds, on a build that had just passed 43 automated checks.

---

## 6. Deploy and keep it fresh

```bash
vercel deploy --prod
HOOK=$(vercel deploy-hooks create shopify-rebuild --ref main)
# then register a Shopify products/update webhook against $HOOK via store execute
```

A webhook to a deploy hook, no middleman. **A dependency that only exists in `node_modules` builds
locally and fails on the platform**, and the only signal is a deploy-failure email.

---

## The development store

`scripts/seed-shopify-dev-store.mjs` fills a dev store with a realistic invented catalogue and
**refuses to run unless `shop.plan.partnerDevelopment` is true**. A dev store keeps its Online
Store channel locked, so survey it with a token rather than tokenless.

**Publication is not optional and its failure is silent.** Measured on our own dev store: **23
products in admin, 4 visible to the Storefront API.** A product not published to the channel is
indistinguishable from one that does not exist. Publish, then read the catalogue back.

---

## When something looks broken, check these first

| Symptom | Cause |
|---|---|
| Catalogue is empty | Products not published to the channel. Silent. |
| Survey answers 400 | Dev store, Online Store channel locked. Use a token. |
| Survey answers 404 on the apex | Already headless. Tokenless only works on a Shopify-served host. |
| `{{TOKEN}}` on the page | Scaffold placeholders never resolved. |
| Price is A$0.00 everywhere | `productCreate` made default variants at zero. Prices are a separate mutation. |
| A banner never appears | Static page reading `Astro.url.searchParams`, which is empty at build. |
| Cart endpoint 403 | POST without `Origin`/`Referer`. Astro's CSRF check. |
| Cart lost after checkout | `SameSite=Strict`. Use Lax. |
| "Nothing happens when I add" | It added. There is no visible feedback. Build the drawer. |
| Deploy fails, works locally | A dependency that only exists in `node_modules`. |
| Storefront traffic vanished, sales did not | Headless splits analytics. Checkout events still fire; storefront events cannot. §6e. |
| Product count drops when a country is set | `@inContext(country:)` filters out products unpublished for it. Silent. §6f. |
| Metafields are null but the old theme showed them | Storefront API access is opt-in per definition; Liquid never needed it. §6f. |
| Buyers arrive at checkout signed out | No `Shopify-Storefront-Buyer-IP` on server-side calls. §6e. |
| Discovery dies with a JSON parse error | It hit YOUR apex and got your 404 page. Discover against the Shopify-served domain. §6g. |
| Login works locally, 401s on the server | Node's fetch sends no `origin`/`user-agent`. Reads like a bad token. §6g. |
| Sign-in works for an hour, then never | An app client gets no refresh token, or the rotated one was not persisted. §6g. |
| Login loops back to login forever | An auth cookie is `SameSite=Strict`, so it is absent on the return navigation. §6g. |

---

## Testing a storefront without lying to yourself

Four false failures came from the same mistake, and each one nearly caused a fix to working code:

**Never read state after a click.** `waitForURL` on a pattern that already matches resolves
instantly and reads the pre-navigation DOM. Assert REACHABILITY (the link exists and points where
it should), then navigate explicitly. Those are two different claims and conflating them is what
makes a harness lie.

Also: `spawnSync` blocks the event loop, so an in-process mock server can never accept the
connection; and `timeout` does not exist on macOS.
