#!/usr/bin/env bash
# Tests that Palate's working files stay out of the client's repo.
#
# The bug: a real client build committed 387 of them, 249 screenshots, 297MB, into the
# deliverable repo. Two causes, and a fix has to close both: the scaffold ignored only
# `.palate/index.json` and `*.log`, and it ships inside `{slug}-site/` while a build writes
# `.palate/`, `.palate-shots/` and `build-manifest.json` at the workspace root above it.
#
# The other direction matters just as much: MEASURED state must stay committed. Ignoring
# baselines or the human photo review would make every later contribution look like the first.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/../palate-gitignore.sh"
SCAFFOLD_IGNORE="$DIR/../../templates/astro-project/.gitignore"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

# ignored <repo> <path> -> yes|no
ignored() { git -C "$1" check-ignore -q "$2" 2>/dev/null && echo yes || echo no; }
expect() { # <desc> <repo> <path> <yes|no>
  local got; got=$(ignored "$2" "$3")
  [ "$got" = "$4" ] && ok "$1" || bad "$1 (ignored=$got, want $4)"
}

# ============ 1. THE REAL LAYOUT: git at the workspace root, site one level down ==========
W="$TMP/work"; mkdir -p "$W/acme-site/src/pages"
git -C "$W" init -q 2>/dev/null
cp "$SCAFFOLD_IGNORE" "$W/acme-site/.gitignore"      # where the scaffold puts it
touch "$W/.palate-skill-state.json"
bash "$SCRIPT" "$W" >/dev/null 2>&1

# The files the real build wrote at the workspace root, above the scaffold's ignore.
for f in build-manifest.json .palate-skill-state.json .palate-shots/desktop-full.png \
         verify-report.json .palate/mcp-journal.jsonl .palate/harvest/page.json \
         .palate/live-capture/home.html .palate/index.json .palate/assets.reviewed.backup.json; do
  expect "root: $f is ignored" "$W" "$f" yes
done

# MEASURED state must survive. Ignoring these is the opposite failure and just as real.
for f in .palate/assets.json .palate/FINDINGS.md .palate/VARIANT-CONTRACT.md \
         .palate/brand-record.json .palate/donors.json .palate/site-map.json \
         .palate/baselines/home.json src/pages/index.astro; do
  expect "root: $f stays COMMITTED" "$W" "$f" no
done

# ============ 2. THE OTHER LAYOUT: git initialised at the site directory ==================
S="$TMP/site"; mkdir -p "$S/src/pages"
git -C "$S" init -q 2>/dev/null
cp "$SCAFFOLD_IGNORE" "$S/.gitignore"                 # scaffold ignore IS the repo root here
expect "site-only layout: screenshots ignored" "$S" ".palate-shots/x.png" yes
expect "site-only layout: manifest ignored" "$S" "build-manifest.json" yes
expect "site-only layout: journal ignored" "$S" ".palate/mcp-journal.jsonl" yes
expect "site-only layout: assets.json committed" "$S" ".palate/assets.json" no

# ============ 3. IT IS IDEMPOTENT AND APPEND-ONLY =========================================
before=$(wc -l < "$W/.gitignore")
bash "$SCRIPT" "$W" >/dev/null 2>&1
bash "$SCRIPT" "$W" >/dev/null 2>&1
after=$(wc -l < "$W/.gitignore")
[ "$before" = "$after" ] && ok "re-running does not duplicate the block" \
  || bad "re-running duplicated the block ($before -> $after lines)"

# A rule the client already had must survive untouched.
P="$TMP/pre"; mkdir -p "$P"; git -C "$P" init -q 2>/dev/null
printf 'secrets.txt\n' > "$P/.gitignore"          # no trailing-newline edge case is covered below
bash "$SCRIPT" "$P" >/dev/null 2>&1
grep -q '^secrets.txt$' "$P/.gitignore" && ok "an existing rule is preserved" || bad "an existing rule was lost"
expect "and the new rules apply" "$P" ".palate-shots/a.png" yes

# A .gitignore with NO trailing newline must not have the marker glued onto its last rule.
N="$TMP/nonl"; mkdir -p "$N"; git -C "$N" init -q 2>/dev/null
printf 'keepme.txt' > "$N/.gitignore"
bash "$SCRIPT" "$N" >/dev/null 2>&1
grep -q '^keepme.txt$' "$N/.gitignore" && ok "a file with no trailing newline is not corrupted" \
  || bad "the last existing rule was glued to the marker"

# ============ 4. NO REPO: nothing to do, and no noise =====================================
X="$TMP/norepo"; mkdir -p "$X"
bash "$SCRIPT" "$X" >/dev/null 2>&1
[ -f "$X/.gitignore" ] && bad "wrote a .gitignore outside a repo" || ok "no git repo: writes nothing"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
