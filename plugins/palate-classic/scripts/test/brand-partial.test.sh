#!/usr/bin/env bash
# Tests that a PARTIAL brand (colours from the client, no type) can be represented, both
# in the brand record and at detection.
#
# WHY IT EXISTS. Doctrine says a partial brand counts as brand-provided: lock the given
# half, choose the missing half to fit. Neither surface could say that.
#   - verify-brand-record.mjs required approvedType unconditionally, so the only way to
#     store a colours-only brand was to invent a face and record it as "approved". That is
#     a lie the next build inherits, and it removes type from the axes DIVERGE may vary.
#   - verify-brand-exports.sh required ./fonts.css, so a colour-only package read as
#     broken and Phase 0 routed a real brand to "regenerate or vendor". It also collapsed
#     a registry failure into the same MISSING_EXPORTS line as a genuinely absent export.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REC="$DIR/../verify-brand-record.mjs"
EXP="$DIR/../verify-brand-exports.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { local d="$1" want="$2" got="$3"; if [ "$got" -eq "$want" ]; then echo "ok   - $d"; pass=$((pass+1)); else echo "FAIL - $d (exit $got, want $want)"; fail=$((fail+1)); fi; }
contains() { local d="$1" needle="$2" hay="$3"; case "$hay" in *"$needle"*) echo "ok   - $d"; pass=$((pass+1));; *) echo "FAIL - $d (got: $(printf '%s' "$hay" | head -1))"; fail=$((fail+1));; esac; }

# ---- the record -----------------------------------------------------------------------
cat > "$TMP/partial.json" <<'JSON'
{ "slug": "acme", "tokens": { "package": "@palate-projects/acme-brand", "version": "1.0.0" },
  "locked": { "colour": true, "type": false },
  "motionBand": "calm", "voice": { "summary": "plain, direct" } }
JSON
out="$(node "$REC" "$TMP/partial.json" 2>&1)"; rc=$?
check "colours locked / type free is a VALID record" 0 $rc
contains "the record reports type as the axis DIVERGE may vary" "DIVERGE_FREE_AXES=type" "$out"

# A fully locked record (no `locked` key at all) keeps its old meaning, so every record
# written before this field existed still validates and still varies nothing.
cat > "$TMP/full.json" <<'JSON'
{ "slug": "acme", "tokens": { "vendored": true }, "approvedType": { "display": "A", "body": "B" },
  "motionBand": "calm", "voice": { "summary": "s" } }
JSON
out="$(node "$REC" "$TMP/full.json" 2>&1)"; rc=$?
check "a record with no locked key stays valid (backwards compatible)" 0 $rc
contains "a fully provided brand frees no axis" "DIVERGE_FREE_AXES=none" "$out"

# A record that says type is free AND names an approved face cannot be acted on.
cat > "$TMP/contra.json" <<'JSON'
{ "slug": "acme", "tokens": { "vendored": true }, "locked": { "colour": true, "type": false },
  "approvedType": { "display": "X", "body": "Y" }, "motionBand": "calm", "voice": { "summary": "s" } }
JSON
node "$REC" "$TMP/contra.json" >/dev/null 2>&1
check "type free plus an approvedType is contradictory and invalid" 2 $?

# Locking nothing is brand-creation, not a brand record.
cat > "$TMP/nolock.json" <<'JSON'
{ "slug": "acme", "tokens": { "vendored": true }, "locked": { "colour": false, "type": false },
  "motionBand": "calm", "voice": { "summary": "s" } }
JSON
node "$REC" "$TMP/nolock.json" >/dev/null 2>&1
check "a record locking no axis is invalid (that is brand-creation)" 2 $?

# A misspelt axis must be rejected, not silently ignored into "everything locked".
cat > "$TMP/badaxis.json" <<'JSON'
{ "slug": "acme", "tokens": { "vendored": true }, "locked": { "colours": true },
  "approvedType": { "display": "X", "body": "Y" }, "motionBand": "calm", "voice": { "summary": "s" } }
JSON
node "$REC" "$TMP/badaxis.json" >/dev/null 2>&1
check "an unknown locked axis is rejected, not ignored" 2 $?

# Type locked still demands the faces, which is the original guarantee.
cat > "$TMP/lockednotype.json" <<'JSON'
{ "slug": "acme", "tokens": { "vendored": true }, "locked": { "colour": true, "type": true },
  "motionBand": "calm", "voice": { "summary": "s" } }
JSON
node "$REC" "$TMP/lockednotype.json" >/dev/null 2>&1
check "locked.type true without approvedType is still invalid" 2 $?

# ---- detection ------------------------------------------------------------------------
# Stub npm so the exports check runs offline and deterministically. It is the only
# external call in the script.
STUB="$TMP/bin"; mkdir -p "$STUB"
mknpm() { cat > "$STUB/npm" <<EOF
#!/usr/bin/env bash
$1
EOF
chmod +x "$STUB/npm"; }

mknpm 'echo "{\"./tokens.css\":\"x\",\"./fonts.css\":\"x\",\"./tailwind.preset\":\"x\",\"./components/*\":\"x\"}"'
out="$(PATH="$STUB:$PATH" bash "$EXP" acme 1.0.0 2>&1)"; rc=$?
check "a complete brand package is OK" 0 $rc
contains "a complete package reports plain OK" "OK" "$out"

mknpm 'echo "{\"./tokens.css\":\"x\",\"./tailwind.preset\":\"x\",\"./components/*\":\"x\"}"'
out="$(PATH="$STUB:$PATH" bash "$EXP" acme 1.0.0 2>&1)"; rc=$?
check "a colour-only brand package is accepted, not called broken" 0 $rc
contains "a colour-only package is reported as a partial brand with type free" "OK:PARTIAL:type-free" "$out"

mknpm 'echo "{\"./fonts.css\":\"x\"}"'
out="$(PATH="$STUB:$PATH" bash "$EXP" acme 1.0.0 2>&1)"; rc=$?
check "a package missing the token core is still a real MISSING_EXPORTS failure" 1 $rc
contains "the missing core export is named" "./tokens.css" "$out"

mknpm 'echo "npm ERR! 401 Unauthorized" >&2; exit 1'
out="$(PATH="$STUB:$PATH" bash "$EXP" acme 1.0.0 2>&1)"; rc=$?
check "a registry failure exits 2 (cannot verify), not 1 (missing)" 2 $rc
contains "a registry failure says so instead of blaming the package" "CANNOT_VERIFY" "$out"

echo ""; echo "brand-partial: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
