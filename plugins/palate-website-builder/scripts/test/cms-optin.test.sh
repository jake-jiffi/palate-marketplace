#!/usr/bin/env bash
# Guards the two properties this repo can silently lose:
#   1. the DEFAULT scaffold carries NO CMS (the Sanity tree is ~850 packages), and
#   2. adding one stays purely ADDITIVE - scripts/add-sanity.sh must swap the seam
#      files without ever editing astro.config.mjs, BaseLayout.astro or any page.
# Also pins the Astro major against its adapter majors, because @astrojs/vercel@10
# and @astrojs/cloudflare@13 peer astro@^6 and would install a broken tree on 7.
# Static/file-level only: no npm install, no build.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$DIR/templates/astro-project"
OVERLAY="$DIR/templates/cms-sanity"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }
ck()   { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
ckno() { if eval "$2" >/dev/null 2>&1; then bad "$1"; else ok "$1"; fi; }

# --- 1. the default scaffold is CMS-free -------------------------------------
ckno "base package.json has no sanity dependency"   "grep -q 'sanity' '$BASE/package.json'"
ckno "base package.json has no portabletext dep"    "grep -q 'portabletext' '$BASE/package.json'"
ckno "base astro.config.mjs does not import sanity" "grep -q '@sanity/astro' '$BASE/astro.config.mjs'"
ckno "base BaseLayout does not import sanity"       "grep -q '@sanity/astro' '$BASE/src/layouts/BaseLayout.astro'"
ckno "base load.ts does not import sanity:client"   "grep -q 'sanity:client' '$BASE/src/lib/load.ts'"
ckno "base has no sanity.config.ts"                 "test -f '$BASE/sanity.config.ts'"
ckno "base has no src/sanity/ schema dir"           "test -d '$BASE/src/sanity'"
ckno "base contact route does not import sanity"    "grep -q '@sanity/client' '$BASE/src/pages/api/contact.ts'"

# --- 2. the seam that keeps it additive --------------------------------------
ck "base astro.config spreads cmsIntegrations"  "grep -q 'cmsIntegrations(env)' '$BASE/astro.config.mjs'"
ck "base ships a no-op astro.cms.mjs"           "test -f '$BASE/astro.cms.mjs'"
ck "base cmsIntegrations returns empty"         "grep -qE 'return \[\]' '$BASE/astro.cms.mjs'"
ck "base BaseLayout mounts CmsVisualEditing"    "grep -q 'CmsVisualEditing' '$BASE/src/layouts/BaseLayout.astro'"
ck "base ships a no-op CmsVisualEditing"        "test -f '$BASE/src/components/CmsVisualEditing.astro'"
ck "base loadPage still takes a fallback"       "grep -q 'fallback: T' '$BASE/src/lib/load.ts'"
# SSR must stay on with no CMS, or adding one later becomes a static->SSR rebuild.
ck "base stays output: server"                  "grep -q 'output: \"server\"' '$BASE/astro.config.mjs'"

# --- 3. the overlay is complete ----------------------------------------------
for f in astro.cms.mjs deps.json sanity.config.ts src/lib/load.ts src/lib/sanity.ts \
         src/env.d.ts src/components/CmsVisualEditing.astro src/pages/api/contact.ts \
         src/sanity/schema/index.ts scripts/seed-content.mjs; do
  ck "overlay has $f" "test -f '$OVERLAY/$f'"
done

# --- 4. add-sanity.sh actually wires it, and edits nothing it must not -------
cp -R "$BASE" "$T/proj"
printf '{"brand":"vendored"}\n' > "$T/proj/.palate-skill-state.json"
cksum_before_config=$(cksum < "$T/proj/astro.config.mjs")
cksum_before_layout=$(cksum < "$T/proj/src/layouts/BaseLayout.astro")
cksum_before_index=$(cksum < "$T/proj/src/pages/index.astro")

if bash "$DIR/scripts/add-sanity.sh" "$T/proj" >/dev/null 2>&1; then ok "add-sanity.sh succeeds"
else bad "add-sanity.sh succeeds"; fi

ck "adds @sanity/astro to package.json"     "grep -q '\"@sanity/astro\"' '$T/proj/package.json'"
ck "adds the seed script"                   "grep -q '\"seed\"' '$T/proj/package.json'"
ck "adds tsx (the seed runner)"             "grep -q '\"tsx\"' '$T/proj/package.json'"
ck "astro.cms.mjs now wires sanity"         "grep -q '@sanity/astro' '$T/proj/astro.cms.mjs'"
ck "load.ts now queries sanity:client"      "grep -q 'sanity:client' '$T/proj/src/lib/load.ts'"
ck "CmsVisualEditing now renders overlay"   "grep -q 'VisualEditing' '$T/proj/src/components/CmsVisualEditing.astro'"
ck "sanity.config.ts installed"             "test -f '$T/proj/sanity.config.ts'"
ck "schemas installed"                      "test -f '$T/proj/src/sanity/schema/index.ts'"
ck "env vars documented"                    "grep -q 'SANITY_PROJECT_ID' '$T/proj/.env.example'"

# The whole point: these three must be byte-identical afterwards.
[ "$(cksum < "$T/proj/astro.config.mjs")" = "$cksum_before_config" ] \
  && ok "astro.config.mjs untouched" || bad "astro.config.mjs untouched"
[ "$(cksum < "$T/proj/src/layouts/BaseLayout.astro")" = "$cksum_before_layout" ] \
  && ok "BaseLayout.astro untouched" || bad "BaseLayout.astro untouched"
[ "$(cksum < "$T/proj/src/pages/index.astro")" = "$cksum_before_index" ] \
  && ok "pages untouched" || bad "pages untouched"

# --- 5. idempotent, and refuses a project with no seam ----------------------
before=$(cksum < "$T/proj/package.json")
bash "$DIR/scripts/add-sanity.sh" "$T/proj" >/dev/null 2>&1
[ "$(cksum < "$T/proj/package.json")" = "$before" ] \
  && ok "add-sanity.sh is idempotent" || bad "add-sanity.sh is idempotent"

mkdir -p "$T/legacy/src"; printf '{}\n' > "$T/legacy/package.json"
printf 'export default defineConfig({ integrations: [] });\n' > "$T/legacy/astro.config.mjs"
ckno "refuses a project with no cmsIntegrations seam" \
     "bash '$DIR/scripts/add-sanity.sh' '$T/legacy'"

# Wrong order would overwrite package.json and strip the CMS back out.
ckno "switch-host-cloudflare refuses after add-sanity" \
     "bash '$DIR/scripts/switch-host-cloudflare.sh' '$T/proj'"

# Provisioning an unwired project would create a real Sanity project the site
# cannot use - a silent, billable dead end.
mkdir -p "$T/nocms"; cp "$BASE/package.json" "$T/nocms/package.json"
ckno "provision-sanity refuses an unwired project" \
     "PALATE_PROJECT_DIR='$T/nocms' bash '$DIR/scripts/provision-sanity.sh' s N d.com"
# ...and must NOT block a wired one (it should get past the guard to the token check).
if PALATE_PROJECT_DIR="$T/proj" bash "$DIR/scripts/provision-sanity.sh" s N d.com 2>&1 \
   | grep -q "has no CMS wired"; then bad "provision-sanity allows a wired project"
else ok "provision-sanity allows a wired project"; fi

# --- 6. Astro major vs adapter majors ---------------------------------------
av=$(jq -r '.dependencies.astro' "$BASE/package.json")
case "$av" in 7.*) ok "astro pinned to 7.x ($av)";; *) bad "astro pinned to 7.x (got $av)";; esac
case "$av" in *"^"*|*"~"*) bad "astro pin is exact";; *) ok "astro pin is exact";; esac
ck "vercel adapter is 11.x (peers astro@^7)" \
   "jq -re '.dependencies[\"@astrojs/vercel\"]|startswith(\"11.\")' '$BASE/package.json'"
ck "vite override is ^8 (astro 7 uses vite 8)" \
   "jq -re '.overrides.vite==\"^8\"' '$BASE/package.json'"
ck "cloudflare overlay astro matches base" \
   "jq -re --arg v '$av' '.dependencies.astro==\$v' '$DIR/templates/host-cloudflare/package.json'"
ck "cloudflare adapter is 14.x (peers astro@^7)" \
   "jq -re '.dependencies[\"@astrojs/cloudflare\"]|startswith(\"14.\")' '$DIR/templates/host-cloudflare/package.json'"
ck "portable starter astro matches base" \
   "jq -re --arg v '$av' '.dependencies.astro==\$v' '$DIR/templates/portable-starter/package.json'"
ckno "cloudflare overlay carries no sanity dep" \
   "grep -q '@sanity/astro' '$DIR/templates/host-cloudflare/package.json'"

# --- 7. the Sanity major, and the base pins its peers depend on -------------
# sanity and @sanity/vision must move together (vision peers sanity ^6).
sv=$(jq -r '.dependencies.sanity' "$OVERLAY/deps.json")
vv=$(jq -r '.dependencies["@sanity/vision"]' "$OVERLAY/deps.json")
case "$sv" in ^6.*) ok "sanity pinned to the 6 line ($sv)";; *) bad "sanity pinned to the 6 line (got $sv)";; esac
[ "${sv%%.*}" = "${vv%%.*}" ] && ok "@sanity/vision matches the sanity major" \
                              || bad "@sanity/vision matches the sanity major ($sv vs $vv)"
ck "@sanity/image-url is the v2 line" \
   "jq -re '.dependencies[\"@sanity/image-url\"]|startswith(\"^2.\")' '$OVERLAY/deps.json'"
# v2 deprecated the default export; the named one must be used.
ck "image helper uses the named createImageUrlBuilder" \
   "grep -q 'createImageUrlBuilder' '$OVERLAY/src/lib/sanity.ts'"
ckno "image helper does not use the deprecated default import" \
   "grep -qE '^import [a-zA-Z]+ from \"@sanity/image-url\"' '$OVERLAY/src/lib/sanity.ts'"
# deps.json cannot raise a base pin (project wins the merge), so the BASE must
# already satisfy sanity@6's peers or a CMS install warns / resolves low.
ck "base react floor satisfies sanity 6 (^19.2.2)" \
   "jq -re '.dependencies.react==\"^19.2.2\"' '$BASE/package.json'"
ck "base styled-components floor satisfies sanity 6 (^6.1.19)" \
   "jq -re '.dependencies[\"styled-components\"]==\"^6.1.19\"' '$BASE/package.json'"

echo "cms-optin: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
