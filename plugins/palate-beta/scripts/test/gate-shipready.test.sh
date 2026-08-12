#!/usr/bin/env bash
# gate-shipready: the seam between "built" and "deliverable".
#
# Three real defects shipped past every other gate on a finished build: eight rejected concept
# homepages live and in the sitemap, a literal {{HUMBLYTICS_SITE_ID}} inside a third-party script
# tag, and photographs nobody had measured. Each is invisible to a build that succeeds, a lint
# that passes and a screenshot that looks right.
#
# Four directions, because a gate that only ever fires is noise and gets switched off:
#   1. a clean project is SILENT and exits 0
#   2. each defect fires ON ITS OWN, so the finding names the actual cause
#   3. variants are NOT a finding before the client has picked (they are the deliverable then)
#   4. a project it cannot read BLOCKS (exit 2) rather than passing
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-shipready.mjs"
TMP="$(mktemp -d)"; pass=0; fail=0
trap 'rm -rf "$TMP"' EXIT

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   - $desc"; pass=$((pass + 1));
  else echo "FAIL - $desc (got '$got', want '$want')"; fail=$((fail + 1)); fi
}

# A clean, picked, delivered build.
scaffold() {
  local p="$1"; rm -rf "$p"; mkdir -p "$p/src/pages" "$p/src/lib" "$p/.palate"
  printf -- '---\n---\n<h1>Clean</h1>\n<img src="/a.jpg" alt="a">\n' > "$p/src/pages/index.astro"
  echo 'export const variants = []; export const landing = [];' > "$p/src/lib/variants.ts"
  echo '{"explore":{"ran":true,"picks":[{"surface":"hero","variant_id":"v3"}]},"variants":["v1"]}' > "$p/build-manifest.json"
  cat > "$p/.palate/assets.json" <<'JSON'
{"assets":{"a.jpg":{"kind":"photo","width":2000,"height":1200,"reviewed":true,"subject":"centre","treatment":"landscape card"},
           "brand/favicon.png":{"kind":"icon","width":32,"height":32,"reviewed":true}}}
JSON
}

run() { node "$GATE" "$1" >/dev/null 2>&1; echo $?; }
out() { node "$GATE" "$1" 2>&1 || true; }

scaffold "$TMP/clean"
check "a clean delivered build passes" "$(run "$TMP/clean")" "0"

# 1. an unresolved scaffold token, in source
scaffold "$TMP/ph"; printf -- '---\n---\n<div data-x="{{HUMBLYTICS_SITE_ID}}"></div>\n' >> "$TMP/ph/src/pages/index.astro"
check "an unresolved placeholder fires" "$(run "$TMP/ph")" "1"
check "and it names the token" \
  "$(out "$TMP/ph" | grep -c 'HUMBLYTICS_SITE_ID')" "1"

# 2. Explore left live after the pick
scaffold "$TMP/ex"; printf -- '---\n---\n<h1>v1</h1>\n' > "$TMP/ex/src/pages/v1.astro"
echo 'export const variants = [{ id: "v1", name: "Deep Trawl", href: "/v1" }];' > "$TMP/ex/src/lib/variants.ts"
mkdir -p "$TMP/ex/dist"; echo '<urlset><url><loc>https://x.com/v1/</loc></url></urlset>' > "$TMP/ex/dist/sitemap-0.xml"
check "live variants after the pick fire" "$(run "$TMP/ex")" "1"
check "the sitemap leak is called out separately" \
  "$(out "$TMP/ex" | grep -c 'sitemap')" "1"

# 3. BEFORE the pick, variants are the deliverable and must not be a finding
scaffold "$TMP/pre"; printf -- '---\n---\n<h1>v1</h1>\n' > "$TMP/pre/src/pages/v1.astro"
echo 'export const variants = [{ id: "v1", name: "Deep Trawl", href: "/v1" }];' > "$TMP/pre/src/lib/variants.ts"
echo '{"explore":{"ran":false}}' > "$TMP/pre/build-manifest.json"
check "variants before the pick are NOT a finding" "$(run "$TMP/pre")" "0"

# 4. photos: never measured, and measured but never looked at
scaffold "$TMP/noassets"; rm "$TMP/noassets/.palate/assets.json"
check "images with no assets.json fire" "$(run "$TMP/noassets")" "1"
check "and it says the tool never ran" \
  "$(out "$TMP/noassets" | grep -c 'never ran')" "1"

scaffold "$TMP/unrev"
node -e "const fs=require('fs');const p='$TMP/unrev/.palate/assets.json';const d=JSON.parse(fs.readFileSync(p));d.assets['a.jpg'].reviewed=false;fs.writeFileSync(p,JSON.stringify(d));"
check "a measured but unreviewed photo fires" "$(run "$TMP/unrev")" "1"
scaffold "$TMP/icononly"
node -e "const fs=require('fs');const p='$TMP/icononly/.palate/assets.json';const d=JSON.parse(fs.readFileSync(p));d.assets['brand/favicon.png'].reviewed=false;fs.writeFileSync(p,JSON.stringify(d));"
check "an unreviewed ICON does not fire (furniture is not judged)" "$(run "$TMP/icononly")" "0"

# 5. cannot check must never read as clean
mkdir -p "$TMP/empty"
check "a project with no src/pages BLOCKS rather than passing" "$(run "$TMP/empty")" "2"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
