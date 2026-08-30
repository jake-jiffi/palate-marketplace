# Commerce doctrine: building a Shopify storefront

**Read this only when the target is a Shopify store.** Everything here is additive to the normal
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
- **Complexity capped at 1,000**, no per-buyer allowance, and the buyer-IP header cannot be sent.

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

**Never read `CartCost.totalTaxAmount`** or its sibling tax and duty fields: deprecated since
2025-01, and on a taxes-included store the cart can never show a tax line anyway.

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
