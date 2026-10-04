#!/usr/bin/env bash
# Tests the Explore PRESENTATION gate (scripts/gate-explore.mjs).
#
# It holds three things that are easy to skip and impossible to notice missing: the page that
# explains the range exists, every rung carries its own argument, and the ladder positions are
# real. It must stay silent on everything else, because a gate that fires on an ordinary edit
# gets switched off and then protects nothing.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-explore.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# run <dir> -> "PASS" or "BLOCK"
run() { node "$GATE" "$1" >/dev/null 2>&1 && echo PASS || echo BLOCK; }
# The output is CAPTURED and then searched, never piped into `grep -q`. Under `set -o pipefail`
# a `-q` grep exits on the first match, SIGPIPEs node, and the pipeline reports the signal, so
# every assertion fails at the exact moment it should pass. That cost a debugging round here.
why() { node "$GATE" "$1" 2>&1 >/dev/null || true; }
want() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
         else echo "FAIL - $1 (got $3, want $2)"; fail=$((fail+1)); fi; }
has() { local out; out="$(why "$2")"
        if printf '%s' "$out" | grep -qiF "$3"; then echo "ok   - $1"; pass=$((pass+1));
        else echo "FAIL - $1 (no '$3' in output)"; fail=$((fail+1)); fi; }

mk() { mkdir -p "$1/src/lib" "$1/src/pages"; }
page() { : > "$1/src/pages/explore.astro"; }

# A fully-argued two-rung set.
good_variants() { cat > "$1/src/lib/variants.ts" <<'TS'
export interface Variant { id: string; name: string; href: string; ambition: number; what: string; why: string; feeling: string; }
export const variants: Variant[] = [
  { id: "v1", name: "The Quiet Room", href: "/v1", ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "People arriving here are anxious and have usually been dismissed once already, so nothing asks anything of them before they have read a sentence.",
    feeling: "unhurried, private, adult" },
  { id: "v2", name: "The Folder", href: "/v2", ambition: 2,
    what: "The record itself becomes the interface, opening as you scroll.",
    why: "Their entire pitch is that a clinician finally sees six months of evidence instead of one appointment, so the page should behave like that evidence.",
    feeling: "purposeful, quietly technical" },
];
export const landingVariants: Variant[] = [];
TS
}

# === 1. NOT AN EXPLORE BUILD: nothing to say.
A="$TMP/none"; mk "$A"
want "no variants.ts at all -> pass" PASS "$(run "$A")"

# === 2. THE SHIPPED TEMPLATE, whose example entry is COMMENTED OUT. A naive scan reads that
# comment as a fully-argued variant and passes a build that registered nothing.
B="$TMP/template"; mk "$B"
cp "$DIR/../../templates/astro-project/src/lib/variants.ts" "$B/src/lib/variants.ts"
want "the bare template (example is commented out) -> pass" PASS "$(run "$B")"

# === 3. THE HAPPY PATH.
C="$TMP/good"; mk "$C"; good_variants "$C"; page "$C"
want "argued variants + the explore page -> pass" PASS "$(run "$C")"

# === 4. VARIANTS BUT NO COACHING PAGE.
D="$TMP/nopage"; mk "$D"; good_variants "$D"
want "variants with no explore.astro -> block" BLOCK "$(run "$D")"
has "and it says the client would get a list of URLs" "$D" "list of URLs"

# === 5. A VARIANT THAT DOES NOT ARGUE FOR ITSELF.
E="$TMP/thin"; mk "$E"; page "$E"
cat > "$E/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "v1", name: "The Quiet Room", href: "/v1", ambition: 1 },
];
export const landingVariants = [];
TS
want "a variant with no what/why/feeling -> block" BLOCK "$(run "$E")"
has "and it names the missing fields" "$E" "missing what, why, feeling"

# === 6. A FEELING THAT DESCRIBES ANY WEBSITE.
F="$TMP/generic"; mk "$F"; page "$F"; good_variants "$F"
sed -i '' 's/unhurried, private, adult/modern and clean/' "$F/src/lib/variants.ts"
want "feeling \"modern and clean\" -> block" BLOCK "$(run "$F")"
has "and it says it would be true of any page" "$F" "describes any website"

# === 7. A "why" THAT ONLY RESTATES THE "what".
G="$TMP/restate"; mk "$G"; page "$G"
cat > "$G/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "v1", name: "The Quiet Room", href: "/v1", ambition: 1,
    what: "One column with a single photograph and a great deal of quiet air.",
    why: "A single photograph, one quiet column, and a great deal of air.",
    feeling: "unhurried, private" },
];
export const landingVariants = [];
TS
want "a why that restates the what -> block" BLOCK "$(run "$G")"

# === 8. TWO VARIANTS CLAIMING THE SAME RUNG.
H="$TMP/samerung"; mk "$H"; page "$H"; good_variants "$H"
sed -i '' 's/ambition: 2,/ambition: 1,/' "$H/src/lib/variants.ts"
want "two variants on one rung -> block" BLOCK "$(run "$H")"
has "and it names both" "$H" "v1, v2"

# === 9. A LADDER WITH A GAP.
I="$TMP/gap"; mk "$I"; page "$I"; good_variants "$I"
sed -i '' 's/ambition: 2,/ambition: 7,/' "$I/src/lib/variants.ts"
want "positions 1 and 7 for two variants -> block" BLOCK "$(run "$I")"

# === 10. A PLACEHOLDER NAME.
J="$TMP/placeholder"; mk "$J"; page "$J"; good_variants "$J"
sed -i '' 's/The Quiet Room/Option 1/' "$J/src/lib/variants.ts"
want "a variant named \"Option 1\" -> block" BLOCK "$(run "$J")"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
