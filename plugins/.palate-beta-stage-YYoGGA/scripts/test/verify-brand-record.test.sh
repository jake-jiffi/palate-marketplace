#!/usr/bin/env bash
# Tests scripts/verify-brand-record.mjs (W4): a complete per-client brand record (tokens +
# approved type + motion band + voice) is valid so a returning build inherits it; a record
# missing the motion band or voice (the two the old flow re-derived every build) is invalid.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
V="$DIR/../verify-brand-record.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { local desc="$1" want="$2" got="$3"; if [ "$got" -eq "$want" ]; then echo "ok   - $desc"; pass=$((pass+1)); else echo "FAIL - $desc (exit $got, want $want)"; fail=$((fail+1)); fi; }

cat > "$TMP/good.json" <<'JSON'
{ "slug": "lighthouse-optometry", "version": 1,
  "tokens": { "package": "@palate-projects/lighthouse-optometry-brand", "version": "2.0.0" },
  "approvedType": { "display": "Simula", "body": "Satoshi" },
  "motionBand": "calm",
  "voice": { "summary": "warm, plain-spoken, reassuring", "say": ["book an eye test"], "doNotSay": ["leverage"] } }
JSON
node "$V" "$TMP/good.json" >/dev/null 2>&1; check "complete record (pkg + type + motionBand + voice) is valid" 0 $?

cat > "$TMP/vendored.json" <<'JSON'
{ "slug": "x", "tokens": { "vendored": true }, "approvedType": { "display": "A", "body": "B" }, "motionBand": "bold", "voice": { "summary": "loud" } }
JSON
node "$V" "$TMP/vendored.json" >/dev/null 2>&1; check "vendored-tokens record is valid" 0 $?

cat > "$TMP/no-motion.json" <<'JSON'
{ "slug": "x", "tokens": { "vendored": true }, "approvedType": { "display": "A", "body": "B" }, "voice": { "summary": "x" } }
JSON
node "$V" "$TMP/no-motion.json" >/dev/null 2>&1; check "record missing motionBand is invalid (the re-derived gap)" 2 $?

cat > "$TMP/no-voice.json" <<'JSON'
{ "slug": "x", "tokens": { "vendored": true }, "approvedType": { "display": "A", "body": "B" }, "motionBand": "calm" }
JSON
node "$V" "$TMP/no-voice.json" >/dev/null 2>&1; check "record missing voice is invalid (the re-derived gap)" 2 $?

echo ""; echo "verify-brand-record: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
