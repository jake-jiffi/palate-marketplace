#!/usr/bin/env bash
# The Shopify documentation must stay DISCOVERABLE and must keep the facts that were paid for.
#
# Every claim asserted here cost a real defect on a real build. A doc that loses one of them
# sends the next person to rediscover it the same expensive way, and doctrine drifts silently
# because nothing reads it on a schedule.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL="$DIR/../../SKILL.md"
RUN="$DIR/../../references/shopify-runbook.md"
DOC="$DIR/../../references/commerce-doctrine.md"
pass=0; fail=0
has() { if grep -qi -- "$2" "$3" 2>/dev/null; then echo "ok   - $1"; pass=$((pass+1));
        else echo "FAIL - $1"; fail=$((fail+1)); fi; }

# --- discoverable at all -----------------------------------------------------
[ -f "$RUN" ] && { echo "ok   - the runbook exists"; pass=$((pass+1)); } || { echo "FAIL - no runbook"; fail=$((fail+1)); }
[ -f "$DOC" ] && { echo "ok   - the doctrine exists"; pass=$((pass+1)); } || { echo "FAIL - no doctrine"; fail=$((fail+1)); }
has "SKILL.md names the runbook"            "shopify-runbook" "$SKILL"
has "SKILL.md names the doctrine"           "commerce-doctrine" "$SKILL"
has "SKILL.md names the survey script"      "palate-shopify.mjs" "$SKILL"
has "SKILL.md names the conformance gate"   "gate-headless.mjs" "$SKILL"
has "the doctrine points at the runbook"    "shopify-runbook" "$DOC"

# --- the facts that cost something -------------------------------------------
has "runbook: tokenless needs no credential"        "no credential" "$RUN"
has "runbook: three admin clicks for production"    "Headless" "$RUN"
has "runbook: admin custom apps are gone"           "1 January 2026" "$RUN"
has "runbook: store execute returns UNWRAPPED"      "UNWRAPPED" "$RUN"
has "runbook: the page list a store needs"          "/collections/\[handle\]" "$RUN"
has "runbook: run --runtime against the DEPLOYED url" "DEPLOYED" "$RUN"
has "runbook: walk it yourself"                     "walk yourself" "$RUN"
has "runbook: a symptom table"                      "Symptom" "$RUN"
has "runbook: never read state after a click"       "after a click" "$RUN"
has "runbook: publication failure is silent"        "products in admin, 4 visible" "$RUN"

has "doctrine: the price island watchdog"           "watchdog" "$DOC"
has "doctrine: the island fails CLOSED"             "fail closed" "$DOC"
has "doctrine: SameSite must be Lax not Strict"     "sameSite: 'lax'" "$DOC"
has "doctrine: the cart id is a capability URL"     "capability URL" "$DOC"
has "doctrine: empty userErrors is not success"     "userErrors" "$DOC"
has "doctrine: the add-to-bag drawer"               "cart drawer" "$DOC"
has "doctrine: free products are legitimate"        "free product is a real product" "$DOC"
has "doctrine: static pages cannot read searchParams" "searchParams" "$DOC"
has "doctrine: variant prices are a separate mutation" "productVariantsBulkUpdate" "$DOC"
has "doctrine: no plan buys a custom checkout"      "including Plus" "$DOC"
has "doctrine: headless DELETES agents.md"          "agents.md" "$DOC"
has "doctrine: qualification criteria"              "Qualification" "$DOC"

# The measurement half. Each of these is a silent failure: nothing errors, and the merchant
# finds out weeks later. They are the facts most likely to be trimmed as "background".
has "doctrine: headless splits their analytics"     "SPLITS their analytics" "$DOC"
has "doctrine: the buyer IP header is required"     "Shopify-Storefront-Buyer-IP" "$DOC"
has "doctrine: checkout must share the root domain" "same root\|same-root" "$DOC"
has "doctrine: the shopify cookies are retired"     "_shopify_y" "$DOC"
has "doctrine: inContext shrinks the catalogue"     "SHRINKS THE CATALOGUE" "$DOC"
has "doctrine: the cart ignores inContext"          "are ignored" "$DOC"
has "doctrine: metafields are opt-in off Liquid"    "always accessible in Liquid" "$DOC"
has "doctrine: pixel behaviour is unproven"         "Do not promise a merchant" "$DOC"

# Customer accounts. The verdict is SKIP for most merchants, and the traps below are all
# copied from either a shipped commercial template or Shopify's own documentation.
has "doctrine: usually do not build customer accounts" "DO NOT BUILD THIS" "$DOC"
has "doctrine: discovery hits the Shopify-served domain" "SHOPIFY-SERVED domain" "$DOC"
has "doctrine: origin and user-agent are required"   "Node.s .fetch. sends neither" "$DOC"
has "doctrine: app clients get no refresh token"     "never receives a refresh token" "$DOC"
has "doctrine: refresh tokens rotate"                "Refresh tokens rotate" "$DOC"
has "doctrine: auth cookies are Lax not Strict"      "Strict is not sent" "$DOC"
has "doctrine: order scoping is unproven"            "404 rather than 403" "$DOC"
has "doctrine: level 2 is an app gate"               "APP gate, not" "$DOC"

# Operations. The deploy-hook line is a CORRECTION of advice this repo used to give, and the
# complexity cap is a correction of a claim it made from a measurement that could not support it.
has "doctrine: never wire a webhook to a deploy hook" "NEVER wire a Shopify webhook straight" "$DOC"
has "doctrine: products/update fires on every order" "fires on every ORDER" "$DOC"
has "doctrine: deploy hooks are dropped past the cap" "drops the trigger rather than queueing" "$DOC"
has "doctrine: webhooks alone are non-conformant"   "delivery is not" "$DOC"
has "doctrine: listing topics are required"         "PRODUCT_LISTINGS_ADD" "$DOC"
has "doctrine: HMAC over the raw bytes"             "RAW bytes, before any parse" "$DOC"
has "doctrine: a GraphQL error arrives in a 200"    "inside a 200" "$DOC"
has "doctrine: version pinning defers, not freezes" "defers behaviour" "$DOC"
has "doctrine: the complexity cap is real and tokenless-only" "TOKENLESS-ONLY" "$DOC"
has "doctrine: the earlier cap claim is corrected"  "never tested the cap at all" "$DOC"

# --- it must stay OPTIONAL ----------------------------------------------------
has "commerce is an optional track" "OPTIONAL track" "$SKILL"
if grep -q "commerce-doctrine\|shopify-runbook" "$DIR/../../references/core-doctrine.md" 2>/dev/null; then
  echo "FAIL - Shopify docs must NOT be in the always-loaded core doctrine"; fail=$((fail+1))
else
  echo "ok   - Shopify docs stay OUT of the always-load budget"; pass=$((pass+1))
fi

echo "---"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
