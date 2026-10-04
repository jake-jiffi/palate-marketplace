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

# 2b. THE BOARDS ARE THE SAME FAULT IN ITS CURRENT SHAPE. `/boards/bN` and `public/_explore/`
# name the directions the client did NOT choose and ship stills of them to their own domain.
scaffold "$TMP/boards"
mkdir -p "$TMP/boards/src/pages/boards" "$TMP/boards/public/_explore"
printf -- '---\n---\n<h1>b1</h1>\n' > "$TMP/boards/src/pages/boards/b1.astro"
printf -- '---\n---\n<h1>b2</h1>\n' > "$TMP/boards/src/pages/boards/b2.astro"
printf '\x89PNG\r\n\x1a\n' > "$TMP/boards/public/_explore/b1.png"
echo 'export const variants = [{ id: "b1", name: "The Quiet Room", href: "/boards/b1" }];' > "$TMP/boards/src/lib/variants.ts"
mkdir -p "$TMP/boards/dist"; echo '<urlset><url><loc>https://x.com/boards/b1/</loc></url></urlset>' > "$TMP/boards/dist/sitemap-0.xml"
check "live boards after the pick fire" "$(run "$TMP/boards")" "1"
check "and src/pages/boards is named" \
  "$(out "$TMP/boards" | grep -c 'src/pages/boards/ still exists')" "1"
check "and the card stills are named" \
  "$(out "$TMP/boards" | grep -c 'public/_explore/ still exists')" "1"
check "and the sitemap leak is called out" \
  "$(out "$TMP/boards" | grep -c 'advertises')" "1"

# 3. BEFORE the pick, variants are the deliverable and must not be a finding
scaffold "$TMP/pre"; printf -- '---\n---\n<h1>v1</h1>\n' > "$TMP/pre/src/pages/v1.astro"
echo 'export const variants = [{ id: "v1", name: "Deep Trawl", href: "/v1" }];' > "$TMP/pre/src/lib/variants.ts"
echo '{"explore":{"ran":false}}' > "$TMP/pre/build-manifest.json"
check "variants before the pick are NOT a finding" "$(run "$TMP/pre")" "0"

# 3b. And neither are the boards. Before the pick they ARE the deliverable, and a gate that
# fired here would fail every build at the exact moment the client is meant to be looking.
scaffold "$TMP/preboards"
mkdir -p "$TMP/preboards/src/pages/boards" "$TMP/preboards/public/_explore"
printf -- '---\n---\n<h1>b1</h1>\n' > "$TMP/preboards/src/pages/boards/b1.astro"
echo 'export const variants = [{ id: "b1", name: "The Quiet Room", href: "/boards/b1" }];' > "$TMP/preboards/src/lib/variants.ts"
echo '{"explore":{"ran":false}}' > "$TMP/preboards/build-manifest.json"
check "boards before the pick are NOT a finding" "$(run "$TMP/preboards")" "0"

# 4. photos: never measured, and measured but never looked at
scaffold "$TMP/noassets"; rm "$TMP/noassets/.palate/assets.json"
check "images with no assets.json fire" "$(run "$TMP/noassets")" "1"
check "and it says the tool never ran" \
  "$(out "$TMP/noassets" | grep -c 'never ran')" "1"

# 4b. COMMERCE: product photography lives on Shopify's CDN, so there are no local files and
# assets.json is never written. The Storefront API returns width and height per image, so those
# photographs ARE measured. The direction that matters most is the last one: with no catalogue,
# nothing changes and the original finding still fires.
scaffold "$TMP/cat"; rm "$TMP/cat/.palate/assets.json"
cat > "$TMP/cat/.palate/catalogue.json" <<'JSON'
{"ok":true,"products":[{"handle":"a","image":{"url":"https://cdn.shopify.com/a.jpg","width":1920,"height":2400}},
                       {"handle":"b","image":{"url":"https://cdn.shopify.com/b.jpg","width":1000,"height":1000}}]}
JSON
check "catalogue photos measured from source do NOT fire" "$(run "$TMP/cat")" "0"
check "and it says how many were measured" \
  "$(out "$TMP/cat" | grep -c 'measured from the Storefront API')" "1"

scaffold "$TMP/catnodim"; rm "$TMP/catnodim/.palate/assets.json"
echo '{"ok":true,"products":[{"handle":"a","image":{"url":"https://cdn.shopify.com/a.jpg"}}]}' > "$TMP/catnodim/.palate/catalogue.json"
check "a catalogue WITHOUT dimensions still fires (nothing was measured)" "$(run "$TMP/catnodim")" "1"

scaffold "$TMP/catfailed"; rm "$TMP/catfailed/.palate/assets.json"
echo '{"ok":false,"reason":"channel-locked"}' > "$TMP/catfailed/.palate/catalogue.json"
check "a FAILED survey is not a measurement" "$(run "$TMP/catfailed")" "1"

scaffold "$TMP/catbad"; rm "$TMP/catbad/.palate/assets.json"
echo 'not json' > "$TMP/catbad/.palate/catalogue.json"
check "an unreadable catalogue is not a measurement" "$(run "$TMP/catbad")" "1"

scaffold "$TMP/unrev"
node -e "const fs=require('fs');const p='$TMP/unrev/.palate/assets.json';const d=JSON.parse(fs.readFileSync(p));d.assets['a.jpg'].reviewed=false;fs.writeFileSync(p,JSON.stringify(d));"
check "a measured but unreviewed photo fires" "$(run "$TMP/unrev")" "1"
scaffold "$TMP/icononly"
node -e "const fs=require('fs');const p='$TMP/icononly/.palate/assets.json';const d=JSON.parse(fs.readFileSync(p));d.assets['brand/favicon.png'].reviewed=false;fs.writeFileSync(p,JSON.stringify(d));"
check "an unreviewed ICON does not fire (furniture is not judged)" "$(run "$TMP/icononly")" "0"

# 4b. the kit's own demo surfaces
# They render invented firms, people and quotes, which is the class of content a real client
# build had to correct four separate times. The kit index claimed this gate removed them and it
# did not, so these four assertions are what makes the claim true.
scaffold "$TMP/kitprod"
printf '{"stage":"production"}' > "$TMP/kitprod/.palate-skill-state.json"
mkdir -p "$TMP/kitprod/src/pages/kit"; echo 'x' > "$TMP/kitprod/src/pages/kit/index.astro"
check "kit demo routes fire at production stage" "$(run "$TMP/kitprod")" "1"
check "and the finding names the surface" \
  "$(out "$TMP/kitprod" | grep -c 'src/pages/kit is still in the tree')" "1"

scaffold "$TMP/kitprev"
printf '{"stage":"preview"}' > "$TMP/kitprev/.palate-skill-state.json"
mkdir -p "$TMP/kitprev/src/pages/kit"; echo 'x' > "$TMP/kitprev/src/pages/kit/index.astro"
check "the same tree passes at PREVIEW stage, where the demos are the point" "$(run "$TMP/kitprev")" "0"

scaffold "$TMP/kitgone"
printf '{"stage":"production"}' > "$TMP/kitgone/.palate-skill-state.json"
check "and passes at production once the demos are gone" "$(run "$TMP/kitgone")" "0"

scaffold "$TMP/kitmap"
printf '{"stage":"production"}' > "$TMP/kitmap/.palate-skill-state.json"
mkdir -p "$TMP/kitmap/public"
printf '<urlset><url><loc>https://x.test/kit/faq/FaqAccordion/</loc></url></urlset>' > "$TMP/kitmap/public/sitemap-0.xml"
check "a sitemap advertising a kit demo URL fires on its own" "$(run "$TMP/kitmap")" "1"

# 5. cannot check must never read as clean
mkdir -p "$TMP/empty"
check "a project with no src/pages BLOCKS rather than passing" "$(run "$TMP/empty")" "2"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
