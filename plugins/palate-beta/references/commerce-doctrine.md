# Commerce doctrine: building a Shopify storefront

**Read this only when the target is a Shopify store.** For the ORDERED PATH from zero to a live storefront, read `shopify-runbook.md` first; this file is the reasoning behind each step. Everything here is additive to the normal
build doctrine, never a replacement. A brochure site never loads this file and nothing in it
applies.

Palate's product is an Astro site with an optional headless CMS. Shopify is an OPTIONAL TRACK
inside that product: it activates on detection, and when it fires it has to be excellent.

---

## 0. First: run the survey. It costs nothing and needs no credential.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-shopify.mjs" <live-store-url>
```

Writes `.palate/catalogue.json`: real handles, titles, descriptions, prices, variants, options,
**image URLs with dimensions**, categories, tags.

**Shopify serves the full Storefront GraphQL API TOKENLESS** on any host it serves itself, covering
products, collections, selling plans, search, pages, blogs, articles and cart read/write, with
`access-control-allow-origin: *`. So this works on a prospect's live store before anyone has been
asked for a credential, an account, or five minutes in an admin screen.

**Build Explore variants against their REAL products and their own photography.** A client seeing
their own catalogue in eight directions is a categorically better pitch than lorem, and it is free.

### The ceiling, which is hard

- **No metaobjects, no exact inventory.** `metaobjects` and `quantityAvailable` are ACCESS_DENIED
  without scopes. `availableForSale` and price DO work, so in-stock/sold-out and pricing render fine.
- **Live stores only.** A dev store answers 400 "Online Store channel is locked".
- **It dies on the apex at cutover.** Tokenless works only on a host Shopify serves. The moment the
  domain points at Vercel, `theirdomain.com/api/...` becomes our own 404.
- **No per-buyer allowance, and the buyer-IP header cannot be sent.** A widely repeated "complexity
  cap of 1,000" did NOT hold when tested: a tokenless query for 250 products x 100 variants x 20
  media returned all 250 with `requestedQueryCost: 188` and no error. The Storefront API reports
  `requestedQueryCost` but NO `throttleStatus`, unlike the Admin API, so you cannot read your own
  headroom. Do not design against a number nobody can verify.

**Never let a build reach production on tokenless.** It is a pitch-and-build capability. Production
needs a Storefront token from the Headless channel.

### Exit codes

`0` surveyed · `2` not a Shopify host (or already headless) · `3` blocked (channel locked)

---

## 1. Render strategy, per route type

Palate is static by default and **that survives commerce**: a real 742-URL storefront ships 783
prerendered pages with one on-demand route. Do not reach for `output: "server"`.

| Route | Ruling | Why |
|---|---|---|
| Home | **static** | No per-visitor content. Every argument for a server here is a separate decision. |
| Collection listing | **static** | One page per collection via `getStaticPaths`. Fetch the WHOLE collection, not the first 24, or the count lies and products have no route in. |
| Product detail | **static + a price island** | See §2. This is the sharp edge. A `server:defer` island does NOT promote the site: `output` stays `static`, one function is emitted, and only `/_server-islands/[name]` routes to it. An adapter is required. |
| Cart | **client-side, server endpoints for mutations** | See §3. |
| Search | static shell, client-side query | Shopify predictive search, not pagefind, once a catalogue exists. |
| Customer account | on-demand | OAuth, and the session cannot be baked. |
| Campaign landing page | on-demand + a runtime sitemap | If shipping one needs a deploy, the rebuild has failed its brief. |

When a collection outgrows one Storefront page, the answer is **pagination as real prerendered
routes**, not SSR for the whole site. Never promote the site because one collection got big.

---

## 2. THE PRICE RULE, and it is a legal one

A statically built product page bakes the price at build time. On a store with promotional pricing
that is a wrong price on a live page, and Australian Consumer Law does not care about your cache
architecture.

**Tier 1 — fully static, price baked, no island.** Defensible ONLY when prices move on a
merchandising cadence you control and you redeploy on `products/update`. Acceptable for a
password-gated prototype. **Not acceptable for a live store with promotional pricing.**

**Tier 2 — the correct default.** Static page, `server:defer` price and stock island, short HTTP
cache, and the build-stamped price as the island's **fallback slot content**. Instant LCP, a
correct-in-almost-all-cases price, and a self-healing update.

**The island must fail CLOSED**, and **ASTRO CANNOT DO THAT ON ITS OWN. You need TWO mechanisms.**

Astro's entire island error handling is one line in `replaceServerIsland()`:

```js
if (!s || r.status !== 200 || r.headers.get('content-type')?.split(';')[0].trim() !== 'text/html') return;
```

On any non-200, any wrong content-type, or a rejected fetch it **returns and touches nothing, so
the fallback stays on screen. There is no error slot: the fallback IS the error state.** And the
fallback is the build-time price. Measured in a browser across seven failure modes, **five showed
the stale price and four of those logged nothing at all**:

| Island endpoint | Customer sees | Console |
|---|---|---|
| 200 `text/html` | live price | clean |
| 500 | **STALE** | **silent** |
| 502 with an HTML body | **STALE** | **silent** |
| 200 but `application/json` | **STALE** | **silent** |
| network abort / DNS fail | **STALE** | `Failed to fetch` |
| hangs forever | **STALE indefinitely** | **silent** |
| island caught its own error, returned 200 | "check price in cart" | clean |

**Mechanism 1 — catch INSIDE the island** and render the error state yourself, so the response is
still a 200 `text/html`. Covers Shopify being slow, throttling, or returning an error payload.

**Mechanism 2 — a client-side watchdog on the host page**, because mechanism 1 cannot run when the
island endpoint 500s, cold-starts, crashes, is blocked, or the props fail to decrypt after a deploy.
On success Astro REMOVES the fallback node, so `isConnected` is the success signal:

```html
<script is:inline>
  (function () {
    setTimeout(function () {
      document.querySelectorAll('[data-price-fallback]').forEach(function (el) {
        if (!el.isConnected) return;            // the island resolved
        el.textContent = 'Check price in cart';
        el.setAttribute('data-price-state', 'unavailable');
      });
    }, 2500);
  })();
</script>
```

Verified end to end: the page paints the build price instantly, and with the island endpoint dead
the watchdog replaces it inside the deadline.

**One consequence to accept honestly.** The fallback is what every non-JS consumer reads: curl,
most LLM scrapers, and the first-pass crawl. So the machine-readable price is the BUILD-TIME price.
The island does not fix the machine-readability problem in §6, it just moves it. If exact price
legibility to agents matters more than instant paint, use ISR or a webhook-driven rebuild instead
and keep the price in the HTML.

---

## 3. Cart: the id is a capability URL

A cart id embeds a secret and grants read/write to that cart, which can carry the buyer's email,
address and phone:

```
gid://shopify/Cart/hWNGF16uSYsIVMh8xWFUngMG?key=fdd38b3114c8cad6a4616fe5e7adaf
```

**HttpOnly Secure cookie, never localStorage.** Any XSS on a localStorage cart leaks buyer PII. All
cart mutations run behind Astro server endpoints or Actions. Marking those routes
`prerender = false` is the correct, narrow exception; the catalogue stays static.

```
httpOnly: true   secure: true   sameSite: 'lax'   path: '/'   maxAge: 60*60*24*14
```

**`sameSite: 'lax'`, NOT `'strict'`, and this is the one with a real consequence.** The buyer
returns from Shopify's own checkout domain, which is a cross-site top-level navigation. A Strict
cookie is not sent on it, so the cart vanishes at the worst possible moment in the funnel.

**This is the field's most common mistake, so do not copy it from anywhere.** Of nine surveyed
open-source Astro-Shopify storefronts, four put the cart id in `localStorage`, and three of those
are the same file copy-pasted between repos. Even Hydrogen's own published cart example passes no
`httpOnly`, no `secure` and no `sameSite`, so the copy-paste path from Shopify's own documentation
yields a cart cookie `document.cookie` can read.

Also note: nothing else in the ecosystem uses `server:defer` with Shopify. A GitHub code search
returns hits in exactly one repository, and it is ours. The §2 pattern is not something to look up.

**MEASURE THE QUANTITY. NEVER TRUST AN EMPTY `userErrors`.** `cartLinesAdd` can be accepted, return
a cart, return `userErrors: []`, and have changed nothing: asking for more than is available is the
confirmed case in Shopify's own feedback repo. So "no errors" is not "it worked". Read
`totalQuantity` before and after and require it to move, or the buyer is told the item is in their
bag while the bag stays empty. Identify lines by `id`: `view_key` (API 2026-07) is ADDITIVE, and
`id`/`lineIds` keep working.

**`Cart.discountAllocations` IS ALSO DEPRECATED.** A build rendering "you saved $X" off it is
reading a field on the way out.

**`checkoutUrl` IS NOT ONE OPTION AMONG SEVERAL, IT IS THE ONLY ONE.** The Checkout APIs were
deprecated in 2024-04 and **sunset on 1 April 2025**; they no longer function. Any tutorial, blog
post or model output referencing `checkoutCreate`, `checkoutLineItemsAdd` or the `Checkout` object
is dead code, which is why `gate-headless.mjs` fails a build that calls them.

**Never read `CartCost.totalTaxAmount`** or its sibling tax and duty fields: deprecated since
2025-01, and on a taxes-included store the cart can never show a tax line anyway.

---

## 3b. Add to bag must SHOW something, without leaving the page

**The most persistent complaint on the first real build was "I still cannot add to cart", and the
item was in the bag every single time.**

Add-to-bag was a plain form POST: full page reload, then a small confirmation line above the
button. Every mechanical check passed. `curl` returned 303, the API reported `totalQuantity: 1`,
the cookie carried the right flags. And to the person clicking, the page flickered and looked
identical. Nobody buys from an API response.

**A confirmation the visitor has to go looking for is not a confirmation.** The bar is: after
add-to-bag, something they can see changes, and they did not navigate anywhere.

**THE PATTERN: a cart drawer, server-rendered, progressively enhanced.**

1. `/api/cart/drawer` returns the cart as an **HTML fragment**, not JSON. The cart id is a
   capability secret in an HttpOnly cookie, so the browser asks for MARKUP rather than for data it
   would have to hold. The id never reaches client JavaScript.
2. A document-level `submit` listener intercepts `form[data-add-to-cart]`, POSTs with `fetch`,
   refreshes the fragment, and slides the drawer in.
3. **The form still posts normally without JavaScript.** The listener only engages when `fetch`
   exists, and falls back to `form.submit()` if the request throws, so the no-JS path is the
   redirect that already worked. This is enhancement, not a dependency.
4. The header bag link opens the drawer instead of navigating. `/cart` still exists as a real page
   for deep links, no-JS and anyone who wants a full view.
5. Escape closes it, focus moves in and is restored, `role="dialog"` and `aria-modal="true"`.

**No framework.** About 2KB of vanilla script and one server endpoint. A React island for a cart
drawer spends the entire framework budget on the one thing a form and a fetch already do.

**And a free product is a real product.** A$0.00 renders as a price, adds to the bag, shows a
subtotal and checks out (verified: Shopify accepts a zero-total checkout with a 200). Samples,
digital downloads and gift-with-purchase are legitimate. **Never gate on a price being non-zero.**
The defect worth catching is a price that renders BLANK, which is a different thing entirely.

---

## 4. What you cannot do, on any plan

**No plan buys a custom checkout. Including Plus.** The Shopify API Terms forbid "an alternative to
Shopify Checkout for checkout or payment processing". Plus buys extensibility INSIDE Shopify's
checkout. A self-hosted checkout needs express written authorisation, which is an enterprise
negotiation, not a product tier.

When a client asks for a custom checkout the answer is no, and the productive follow-up is which
checkout BEHAVIOUR they want, because that maps to an extension, a Function or a branding change,
each with a known plan gate.

| Capability | Basic / Grow | Advanced | Plus |
|---|---|---|---|
| Storefront API, cart, catalogue | yes | yes | yes |
| Customer Account API in full | yes | yes | yes |
| Editor-level checkout branding | yes | yes | yes |
| Extensions on Thank you / Order status | yes | yes | yes |
| Market overrides on checkout extensions | no | **yes** | yes |
| UI on information / shipping / payment steps | no | no | **yes** |
| Checkout Branding API | no | no | **yes** |
| Functions inside a custom app | no | no | **yes** |

**Basic to Advanced is nearly flat for checkout. The cliff is Advanced to Plus.** In one sentence:
Advanced cannot place anything on the pages where the buyer enters their address and pays. Shopify
Scripts stopped executing on 30 June 2026, so there is no workaround below Plus short of publishing
a public App Store app.

**Say "PLUS-ONLY" out loud and cost it separately.** Never quietly design around it.

---

## 5. Three traps that fail silently

**Publication.** A product not published to the Headless channel AND the queried market is
**indistinguishable from a product that does not exist**. No error, no warning. Two of the three
conditions are merchant admin actions that can change after launch without telling anyone. Treat an
empty catalogue as a build-time assertion failure, never as an empty state to render gracefully.

**Inventory scope.** `unauthenticated_read_product_inventory` is not granted by default, so
`quantityAvailable` is denied. You can render in-stock/sold-out; you cannot render "only 3 left".

**Shopify's own docs contradict each other.** Seven direct contradictions were found live on the
same day, including metaobject field limits given as both 40 and 64. Design against the lower
number and never ground a build on a single doc page.

---

## 5b. Four build-time traps that cost an evening each

Every one of these was hit on the first real storefront, and none produced an error message.

**A STATIC PAGE CANNOT READ `Astro.url.searchParams`.** It is evaluated at BUILD time and is
always empty, so a server-rendered `?added=1` banner silently never appears. This is not a
commerce rule, it is a general Astro trap worth knowing on any build. Read the query client-side,
or make the route on-demand and know that you did.

**`productCreate` WITH `productOptions` CREATES A DEFAULT VARIANT PRICED AT ZERO.** Setting
options is not setting prices. Fifty-six of seventy-three seeded products shipped at A$0.00 and
the storefront rendered them correctly, which is exactly why nobody noticed. Follow every
`productCreate` with `productVariantsBulkUpdate`, then read the price back.

**A DEPENDENCY THAT ONLY EXISTS IN `node_modules` BUILDS LOCALLY AND FAILS ON THE PLATFORM.** A
brand package written straight into `node_modules` works on the machine that wrote it and cannot
survive a clean clone. The only signal was a deploy-failure email. Vendor it as a real local
package with a `file:` dependency.

**A PLAIN POST WITHOUT `Origin` AND `Referer` IS REJECTED BY ASTRO'S CSRF CHECK WITH A 403.** A
real browser form sends both. Any script that exercises a cart endpoint must too, or it reports a
broken cart on a storefront whose cart is perfect.

---

## 6. Going headless SUBTRACTS agent readiness

Every Shopify store already serves, with no developer work:

- `/.well-known/ucp` — the UCP manifest, currently version 2026-08-25
- `/api/ucp/mcp` — **13 unauthenticated tools including `create_checkout` and `complete_checkout`**
- `/agents.md` and `/llms.txt` — plain-language buying instructions Shopify writes for the merchant

**UCP and the MCP endpoints survive headless** (Shopify serves them at the domain level).
**`/agents.md` and `/llms.txt` are rendered by the Liquid layer and DISAPPEAR**, verified on
Shopify's own Hydrogen demo storefront.

So hand-building agent endpoints adds nothing. It restores what going headless removed. Budget it
as a cost, never sell it as a differentiator.

**Where the real work is:** 39% of retailer homepages are not machine-readable to LLMs, and no
platform will fix that for a merchant. Server-render the critical content. A custom front end that
puts price, availability or specs behind JavaScript is LESS legible to an agent, not more.

---

## 6b. When the conversation creates the items

The common shape is not "build a site for this store". It is: someone describes what they want,
Palate CREATES the items in Shopify, builds the site, and most of the site is not Shopify content
at all. A video hero, an editorial block, a lookbook, all hand-authored, all POINTING AT catalogue
items.

**That pointer is the fragile part**, and nothing about it fails at build time. A handle that was
renamed, never created, or created but not published leaves a 404 behind a link on the page a
campaign is driving traffic to. The page renders. The build is green.

`scripts/gate-headless.mjs` resolves every reference in both directions:

| Check | What it catches |
|---|---|
| `J1-dangling-product-ref` | content links to a handle not in the catalogue |
| `J2-dangling-collection-ref` | same for collections, usually a campaign destination |
| `J3-featured-unavailable` | a hero featuring something sold out, worse than featuring nothing |
| `J4-hardcoded-price` | a price typed into content, which no island can ever correct |
| `J5-unrouted-products` | catalogue items with no built page, so part of the store is unreachable |
| `K1-write-guard` | a script that mutates Shopify with no development-store guard |

**Publication is the usual cause of a dangling reference and it is silent.** A product not
published to the channel is indistinguishable from one that never existed, so the item can be
created correctly, appear in admin, and still be a 404 on the site. Create, publish, then verify by
reading the catalogue back. Never assume the create succeeded because it returned an id.

**Writes need a guard, always.** A metaobject type identifier cannot be renamed after creation, so
a mistake on a live store is permanent. Require `shop.plan.partnerDevelopment`, or a dry run plus
explicit approval, before any mutation. `scripts/seed-shopify-dev-store.mjs` is the worked example:
it refuses outright unless the store is a development store.

---

## 6c. Verify it at RUNTIME, not just in the source

Static analysis of a storefront is a proxy. It can read that `httpOnly: true` appears in a file;
it cannot tell you the cookie that actually reaches a browser carries it. Flags set in one file
and `cookies.set()` called in another satisfy a regex and fail a buyer.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-headless.mjs" . --runtime https://the-deployed-url
```

Nine checks that ask the storefront instead of reading it: the product page serves and carries a
price a non-JS consumer can read, the canonical is on the wire, **the cart cookie ACTUALLY SENT
carries HttpOnly, Secure and SameSite=Lax**, the capability secret never appears in a page, the
cart resolves to a **Shopify-hosted** checkout URL, and `/agents.md` and `/llms.txt` genuinely
serve rather than merely existing in `src`.

Three things this taught us, each of which had produced a wrong answer first:

- **A 303's body is not exposed by `fetch`**, and a leaked cart id would not be there anyway. Look
  for it in a PAGE, which is where a drawer would inline it.
- **A real browser form post sends `Origin` and `Referer`.** Without them Astro's CSRF check
  answers 403, and the gate reported "no cart cookie" on a storefront whose cart was perfect.
- **An auth wall is not a missing route.** A deployment behind Vercel's protection answers 302 for
  every path, and calling that "this product has no page" is a false failure on a healthy site. It
  is reported UNKNOWN, once, with the reason.

**Run it against the deployed URL, not only localhost.** Deployment protection, edge redirects and
env-var differences are all invisible locally.

---

## 6d. Walk the funnel. Checking parts is not checking the path.

**The single most expensive lesson from building a real storefront**: the gate reported 43 checks
clean on a store nobody could shop.

The survey was clean. Routes were static. The cart cookie carried the right flags on the wire. The
price island failed closed. The checkout URL was Shopify's. Every part passed.

And a visitor landing on the home page had **no navigation, no footer, no link to a bag, no
`/cart` page at all, and a product page with ZERO outbound links.** They could add to a cart and
then were stranded, permanently, with no way to see it or pay.

Nothing was broken. Everything was missing. Those fail differently and only a walk finds the second.

So `gate-headless.mjs --runtime` now walks it:

| Check | The question |
|---|---|
| `W1-*-is-a-dead-end` | can a visitor LEAVE this page? |
| `W2-*-bag-reachable` | is the bag linked from every page, or is add-to-cart a trap? |
| `W3-cart-page` | does `/cart` exist and offer a route to pay? |
| `W4-*-chrome` | is there a header and a footer, where nav and the bag live? |
| `R9-unresolved-tokens` | is a scaffold `{{TOKEN}}` being SERVED to a visitor? |

**A storefront needs these before it needs anything clever.** Header with collections and a bag
count, footer, `/cart` with quantity edit, remove and a checkout button, `/search`, a collections
index, and a product page that links back to its collection and to the bag. If a build has the
plumbing and not these, it is not a store yet.

**And take the walk yourself.** Open the deployed URL, click from the home page to a product, add
it, find the bag, reach checkout. Whatever you cannot do is the defect list. That walk found every
item above in about ninety seconds, and no amount of check-writing had found any of them.

---

## 6e. Going headless SPLITS their analytics, and only one half reports the loss

Checkout stays on Shopify. So `checkout_started`, `checkout_completed` and every checkout-side
pixel keep firing exactly as before, and the revenue dashboard looks untouched. The storefront
does not: a custom front end is **not on the list of surfaces permitted to publish standard
events** (Liquid theme files, theme app extensions, checkout UI extensions and customer account
UI extensions are the whole list), so `page_viewed`, `product_viewed`, `collection_viewed`,
`search_submitted` and `product_added_to_cart` stop arriving.

**The merchant keeps their conversions and loses their funnel, and nothing reports a fault.**
They find out weeks later when someone asks why traffic fell off a cliff while sales did not.
Say this out loud during qualification, not after launch. Restoring measurement is a cost of
headless, in the same column as `/agents.md`.

Four rules that follow:

- **Send `Shopify-Storefront-Buyer-IP` on every buyer-driven server-side call.** Case-sensitive.
  Without it, in Shopify's words, "Shopify can't differentiate requests from different buyers",
  which costs throttling headroom, bot protection, **and the buyer's logged-in checkout
  experience**. Build-time calls have no buyer and must send nothing. Use the first entry of
  `x-forwarded-for`, never the socket address, which is your server.
- **One wire client.** Two copies is how a required header lands on the cart path and is
  forgotten on the price path. This exact fault shipped here and the gate now blocks it.
- **Consent must be able to reach checkout.** On a custom storefront `setTrackingConsent` takes
  four extra parameters (`headlessStorefront`, `checkoutRootDomain`, `storefrontRootDomain`,
  `storefrontAccessToken`), and Shopify is verbatim that **checkout must sit on the same root
  domain as the storefront** or it cannot read the cookies your banner set. That is a domain
  decision made before launch and expensive after. Consent also rides to checkout through
  `@inContext(visitorConsent:)` from API 2025-10.
- **`_shopify_y` and `_shopify_s` are gone.** Shopify's changelog says it stopped setting them
  from 1 January 2026; the Hydrogen migration guide says 30 April 2026. The two disagree, so plan
  for the earlier. `clientId` on a Web Pixels event replaces `_y`; `_s` has no replacement, so
  mint your own session value.

**UNRESOLVED, and say so rather than guessing:** no Shopify page states in either direction
whether admin-installed pixels execute on a merchant's own headless pages. The indirect evidence
says no (a headless front end is absent from the publishing-surfaces list, and Shopify has no
injection point on a page it does not render), but it is inference. Do not promise a merchant
their existing pixels will follow them.

## 6f. Selling internationally, and the CMS underneath

**`@inContext(country:)` SILENTLY SHRINKS THE CATALOGUE.** It does not only convert prices: it
"automatically filters out products that aren't published for the country specified". Add the
directive and a product count can drop with no error, no warning and a page that renders
perfectly. If the count moves when you add a country, that is the cause.

**The cart ignores it.** Verbatim: "In Cart queries and mutations the `buyer` and `country`
arguments for `@inContext` are ignored." Set cart context with `cartCreate` or
`cartBuyerIdentityUpdate({ countryCode })` instead, or the page quotes one currency and the
charge lands in another. `language` and `visitorConsent` DO still apply to cart operations.

**Detecting the buyer's market is your job, and Shopify says do it gently.** No automatic help
exists off the Online Store. Signals are `accept-language`, cookies and URL params, all of which
Shopify calls fragile for two stated reasons: page caching ignores them, and SEO bots crawl from
the US without cookies. Shopify's recommendation is **a banner offering to switch, explicitly not
an automatic redirect**. Give each locale its own URL (`/fr` paths or per-market domains); you
implement that routing, admin's market settings only drive the Online Store.

**Metafields are the biggest headless-only gotcha.** "This setting doesn't affect Liquid
templates — metafields are always accessible in Liquid regardless of this setting." Storefront
API access is opt-in per definition. So a merchant migrating off Liquid finds the fields their
theme has always shown returning null, and the fix is in admin, not in the code being debugged.

Hard limits worth knowing before promising a CMS: **20 enabled locales**, metaobject definitions
capped at **128** per shop (256 on Plus/Enterprise), **40 fields per definition**, 1,000,000
entries. Product tags are not translatable. `Market` is deprecated on the Storefront API's
`Localization` and `Country`, so build on country/language/catalog context instead.

## 6g. Customer accounts: usually DO NOT BUILD THIS

**For a typical small merchant, link to Shopify's hosted account pages.** They sit on
`accounts.theirbrand.com`, they are branded in the accounts editor, they show orders and
addresses, they cost a subdomain and a nav link, and once the subdomain is set **the buyer
cannot tell which one they are on**. The bespoke version costs a day and buys nothing.

Build it only when at least one of these is true:

1. **Reorder is a real behaviour** (consumables, coffee, pet food, supplements). One-click
   "buy this again" writing straight into the cart cannot be done on the hosted pages.
2. **B2B**: company locations, PO numbers, location-scoped history, draft orders awaiting
   approval. The hosted pages do not cover it and the API does.
3. **Self-serve subscription management**, but only on native Shopify subscriptions.
4. **The account area IS the product**: loyalty tiers, referral status, downloads, membership.
5. **Store credit is in play.** Balance and transactions are a genuine reason to return.

Skip it when order history and addresses are the whole scope, when the merchant is pre-launch
(nobody has a history to look at), when you cannot use a **Headless-channel** client, or when
the client signs off on Vercel previews: **auth cannot work on a preview deployment**, and that
is a thing to say before quoting, not after.

**The intermediate position is usually right:** `/account` as a thin server-rendered page over
the API showing orders, carrying ONE differentiated action (reorder, tier, subscription), and
linking out to the hosted pages for profile and address editing. Half a day, and Shopify
maintains the rest.

### If you do build it, six things that are wrong everywhere you would look

There is no correct Astro reference implementation. Nine harvested Astro+Shopify repositories
were searched and **none implements this API**, so everything below is copied from something
broken:

- **Discovery is mandatory and must hit the SHOPIFY-SERVED domain.** The reference documents
  the GraphQL endpoint as `{shop}/customer/api/{version}/graphql` and no live store matches it.
  Worse, once your Astro app owns the apex, `yourbrand.com/.well-known/openid-configuration`
  returns **your own 404 page**, which is HTML, so it fails `.json()` with a parse error rather
  than an HTTP error. Keep the shop domain in its own variable, separate from the site origin.
- **`origin` and `user-agent` are required**, and Node's `fetch` sends neither. Missing `origin`
  is a 401 `invalid_token`; missing `user-agent` is a 403. Both read like a credential problem
  and neither is. This is why code works in a browser console and fails in an Astro route.
- **Use a confidential client on the Headless channel, never an app client.** Shopify's own
  tutorial builds an app client, and that client type **never receives a refresh token**, so the
  session dies at sixty minutes with no server-side recovery. Discovery also advertises
  `refresh_token` support for client types that never get one, so do not trust it.
- **Refresh tokens rotate.** Persist the new one from every refresh response, or the session
  survives exactly one hour and then logs the buyer out permanently. The refresh grant does NOT
  return a new `id_token`, so carry the original forward or you cannot log out.
- **Nothing goes in the browser.** Shopify's reference puts the `code_verifier` in
  `localStorage` and its tutorial returns the access token to the client; both are written for
  an SPA with no server. A commercially sold Astro template sets `token=...; Path=/;
  SameSite=Lax` under a comment claiming HttpOnly, and returns the token in the JSON body too.
  Cookies are HttpOnly + Secure + **Lax** (Strict is not sent on the navigation back from
  Shopify's hosted login, so the callback loops forever).
- **`customerAccessTokenCreate` is the legacy password flow.** Shopify labels it "for legacy
  customer accounts only" but has NOT deprecated it in the schema, which is why templates keep
  shipping it and why nothing breaks until the merchant switches accounts, at which point every
  sign-in fails at once.

**UNPROVEN, and it is the one unknown with a security consequence:** the reference for the root
`order(id:)` query never states whether it is buyer-scoped. Until you have tested it with two
real accounts, confirm the id belongs to the session's customer before rendering, and return
**404 rather than 403** (a 403 on a real id and a 404 on a fake one tells an attacker which
order ids exist).

`scripts/gate-customer-auth.mjs` enforces all of the above and is silent on any build with no
account surface. Also corrected: **Level 2 Protected Customer Data approval is an APP gate, not
an API gate** (there is no Partner app to submit for a Headless-channel client), and the June
2026 metafield-definition rule touches only app-owned metafields, not customer or order ones.

## 7. Commerce anti-patterns

The general anti-pattern list still applies. These are additional, and the first two are the ones
that make a store look templated.

- **A card grid with no hierarchy.** Every product identical, same ratio, same weight, nothing
  leading. A real merchandiser has a hero product, a story, a reason for the order.
- **Stock badges as decoration.** "Bestseller" on everything means nothing. A badge earns its place
  by being rare.
- **The three-icon trust bar** (free shipping / secure checkout / easy returns) as a full band. It
  is the single most templated block in commerce.
- **A PDP that is a spec sheet.** Price, variant picker, add-to-cart, accordion, done. That is the
  default theme and the client can get it for free.
- **Filters nobody can use on a phone.** A facet drawer that covers the results it filters.
- **Placeholder product photography.** If the merchant's photos are bad, that is a finding to
  RAISE, not to hide behind a tight crop. Measure them first (§0 gives dimensions free).

**What is NOT an anti-pattern on a storefront, and the lint knows it:** a status pill above the
product `<h1>`. "In stock", "Sale", "Low stock" is state the buyer needs. `hero-status-pill` stands
down on files under `products/` when a catalogue exists.

---

## 8. Qualification: when NOT to take a headless build

Any ONE of these holding is a no, not a risk to manage.

1. **The app budget exceeds the storefront budget and one vendor dominates it with no fallback on
   their current plan.** You are selling a vendor migration and calling it a rebuild.
2. **A rule must be enforced at checkout and they will not buy Plus.** Headless moves that gap into
   your code and your liability, and the enforcement layer you build is defeatable by a cart
   permalink.
3. **Marketing cannot pass a 30-minute authoring test and the preview route is out of scope.** The
   single most predictive failure signal: the content model gets routed around within a quarter.
4. **They cannot name what is currently firing on their storefront**, or cannot tolerate a
   multi-week automation freeze while the new signal reconciles.

**The lie test, for any vendor's "headless-ready" claim.** They support headless if and only if
(a) there is a documented HTTP endpoint returning JSON your server can call, and (b) the aggregate
data can reach a metafield or an API response so it can be server-rendered into JSON-LD. A "paste
this div and our script finds it" vendor **fails**: that content never reaches structured data and
never reaches the Merchant Center feed.

What they lose permanently: the theme editor (every campaign becomes a ticket and a deploy), the
drop-in app ecosystem, `/agents.md` and `/llms.txt`, and an annual API version treadmill.

---

## 9. Setup, entirely on the customer's machine

No hosted middleman. Every credential is public by design, in the customer's own Vercel project, or
in their OS keychain. **No Palate-hosted service ever sees the merchant's data or their token.**

| Tier | Manual steps | Gets you |
|---|---|---|
| 0 · prototype | **0** | Real catalogue and cart, live store, no credential |
| 1 · production | **3** admin clicks | Headless channel → Add storefront → copy the public token |
| 2 · Admin API | **1** browser consent | `shopify store auth` then `store execute`, keychain-stored |
| 3 · deploy + freshness | 0 beyond `vercel login` | Vercel deploy hook fired by a Shopify webhook |
| 4 · customer login | **1**, after first deploy | Callback URI on the real HTTPS URL, **no tunnel ever** |

**Four steps is the floor** for a complete production storefront, and every one is a Shopify admin
action with no API behind it.

Two dead ends, so nobody wastes an afternoon: **creating a custom app in admin is not available
since 1 January 2026**, and `storefrontAccessTokenCreate` is the wrong door because it needs a
sales-channel app, which is more setup than the Headless channel it would replace.

Never give a Shopify token a `PUBLIC_` prefix: `PUBLIC_` is inlined at build, so rotating it would
require rebuilding every page.
