#!/usr/bin/env bash
# Asserts the template's business facts are SINGLE-SOURCED.
#
# A fact about the business (its name, its contact address, its description) is
# written once in src/lib/business.ts and read everywhere else. The moment one is
# retyped into a page, a layout or an API route, the next change leaves that one
# surface stale, and the stale surface is usually the one a customer acts on: an
# old phone number, an old address, a structured-data block describing a business
# that no longer exists that way.
#
# This is the test behind /palate:fact. "Change it once and every surface follows"
# is only true while nothing has quietly forked a copy, and nobody notices a fork
# by reading the page, because both versions look fine on their own.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TPL="$DIR/../../templates/astro-project"
OVERLAY="$DIR/../../templates/cms-sanity"
pass=0; fail=0

ok()   { echo "ok   - $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL - $1"; fail=$((fail + 1)); }

# The record itself is the ONE place these literals are allowed to appear.
RECORD="src/lib/business.ts"

# --- 1. No hardcoded facts anywhere in src/, except the record ----------------
# Checked as placeholders because that is what the template ships; in a real
# scaffold Claude substitutes them, and a duplicate then becomes a real duplicated
# fact. Catching it here catches it before it can ever be substituted twice.
for token in '{{CLIENT_NAME}}' '{{ONE_LINE_DESCRIPTION}}' 'hello@{{DOMAIN}}'; do
  hits=$(cd "$TPL" && grep -rln -- "$token" src/ 2>/dev/null | grep -v "^${RECORD}$" || true)
  if [ -z "$hits" ]; then
    ok "no hardcoded $token outside $RECORD"
  else
    bad "hardcoded $token in: $(echo "$hits" | tr '\n' ' ')(import it from lib/business instead)"
  fi
done

# --- 2. The record exists and exports what the template consumes --------------
for sym in "export const business" "export function businessJsonLd" "export interface BusinessRecord"; do
  if grep -q "$sym" "$TPL/$RECORD" 2>/dev/null; then
    ok "$RECORD has: $sym"
  else
    bad "$RECORD is missing: $sym"
  fi
done

# --- 3. Every file that USES a fact also IMPORTS it ---------------------------
# A missing import is a build failure rather than a silent one, but it is a build
# failure discovered by whoever scaffolds next rather than by us, and the fix is
# one line here. (Astro components and TS both import from lib/business.)
missing=""
while IFS= read -r f; do
  [ "$f" = "$RECORD" ] && continue
  grep -q "lib/business" "$TPL/$f" || missing="$missing $f"
done < <(cd "$TPL" && grep -rl -E '\bbusiness(JsonLd)?\.' src/ 2>/dev/null || true)
if [ -z "$missing" ]; then
  ok "every file using a fact imports lib/business"
else
  bad "uses business.* without importing it:$missing"
fi

# --- 4. Structured data is built, never hand-written --------------------------
# The Organization/LocalBusiness node must come from businessJsonLd(), so the
# entity in the markup can never describe a different business from the copy.
if grep -q "businessJsonLd" "$TPL/src/layouts/BaseLayout.astro" 2>/dev/null; then
  ok "BaseLayout builds its JSON-LD from the record"
else
  bad "BaseLayout hand-writes JSON-LD; use businessJsonLd() so it cannot drift"
fi

# A named head slot has to exist, or a page passing slot=\"head\" (the blog post
# route passes its BlogPosting node that way) has its structured data SILENTLY
# DROPPED. Astro renders nothing for a slot that does not exist, so this failure
# is invisible on the page and only ever shows up in an audit.
if grep -q '<slot name="head"' "$TPL/src/layouts/BaseLayout.astro" 2>/dev/null; then
  ok "BaseLayout exposes a head slot for per-page structured data"
else
  bad "BaseLayout has no <slot name=\"head\" />; per-page JSON-LD is dropped silently"
fi

# --- 5. The CMS overlay obeys the same rule -----------------------------------
# add-sanity.sh swaps the contact route wholesale, so the overlay's copy is a
# second place the enquiry address could fork. It is the highest-consequence fact
# in the file: get it wrong and enquiries go to an address nobody reads.
if [ -f "$OVERLAY/src/pages/api/contact.ts" ]; then
  if grep -q "business.email" "$OVERLAY/src/pages/api/contact.ts"; then
    ok "CMS overlay contact route reads the enquiry address from the record"
  else
    bad "CMS overlay contact route hardcodes the enquiry address"
  fi
fi

# --- 6. The YAML date-rollover guard is still in the schema -------------------
# Verified by real build probe, not by reading: `publishedAt: 2026-13-01` does NOT
# fail validation on its own. YAML rolls the out-of-range month over and hands Zod
# 2027-01-01, a perfectly valid Date. The post then publishes, sorts to the top of
# every listing, and carries the wrong datePublished into its structured data,
# with no error anywhere. The future-date refine is the only thing that catches
# it, so this asserts it has not been tidied away by someone who read
# `z.coerce.date()` and reasonably assumed it was enough.
if grep -q "publishedAt.valueOf() <= Date.now()" "$TPL/src/content.config.ts" 2>/dev/null; then
  ok "posts schema still guards the YAML date-rollover trap"
else
  bad "the future-date refine is gone; 2026-13-01 will silently publish as 2027-01-01"
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
