#!/usr/bin/env bash
# These assertions protect the retained legacy workflow. New live-design routing is tested separately.
# Tests the scaffold's RENDER MODE and the invariants that hang off it.
#
# THE BUG THIS EXISTS FOR, and it shipped for months. The scaffold was `output: "server"`, so
# a build produced ZERO html files. `astro-pagefind` ships in the scaffold's dependencies and
# `Search.astro` ships in its components, and pagefind indexes BUILT HTML: it indexed zero
# pages on every site Palate ever made. Astro said so in the build log every single time
# ("Output type `server` does not produce static *.html pages ... will not work with
# astro-pagefind") and nothing read it. Measured on one scaffold built both ways: server -> 0
# html / 0 indexed, static -> 7 html / 7 indexed.
#
# A real build is the honest test and costs an npm install of 547 packages, so these are the
# cheap invariants that catch the same class deterministically: a search integration that
# cannot see the output, an exception declared where it is not needed, and the one habit that
# would quietly turn a one-line escalation back into a hunt.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TPL="$DIR/../../templates/astro-project"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

CONF="$TPL/astro.config.mjs"
# READ THE SETTING, NOT THE PROSE. The first version grepped the whole file and matched the
# words `output: "server"` inside the comment EXPLAINING why it is no longer server, so the
# test reported the opposite of the truth. Comment and continuation lines are stripped first.
mode=$(grep -vE '^\s*(//|\*|/\*)' "$CONF" | grep -oE 'output:\s*"(static|server)"' \
       | grep -oE 'static|server' | head -1)

# --- 1. THE MODE ---------------------------------------------------------------------
[ "$mode" = "static" ] && ok "the scaffold is static by default" \
  || bad "the scaffold is output: \"$mode\"; marketing pages should be files, not functions"

# --- 2. A SEARCH INTEGRATION MUST BE ABLE TO SEE THE OUTPUT ---------------------------
# This is the assertion that would have caught it. pagefind reads built HTML; under server
# output there is none, and the integration is dead weight that reports success.
if grep -q '"astro-pagefind"' "$TPL/package.json" 2>/dev/null; then
  [ "$mode" = "static" ] \
    && ok "astro-pagefind ships and the output mode produces HTML for it to index" \
    || bad "astro-pagefind ships but output is \"$mode\", which produces no *.html: it will index ZERO pages"
else
  ok "no pagefind in the scaffold; nothing to index"
fi

# --- 3. THE EXCEPTIONS ARE DECLARED, AND ONLY THE EXCEPTIONS --------------------------
# robots.txt reads the request host; the contact route is an endpoint. Both must opt out.
for f in src/pages/robots.txt.ts src/pages/api/contact.ts; do
  grep -q 'export const prerender = false' "$TPL/$f" 2>/dev/null \
    && ok "$(basename "$f") declares prerender = false" \
    || bad "$(basename "$f") needs on-demand rendering and does not declare it"
done

# NEVER `prerender = true` on a page. Static is already the default, so it adds nothing, and
# it pins that page as static when someone later flips the config to "server", turning a
# one-line escalation into a file-by-file hunt. Declare exceptions, never the rule.
pinned=$(grep -rln 'export const prerender = true' "$TPL/src/pages" 2>/dev/null || true)
[ -z "$pinned" ] && ok "no page pins itself with prerender = true" \
  || bad "prerender = true pins pages against a future flip to server: $(echo "$pinned" | tr '\n' ' ')"

# --- 4. A DYNAMIC ROUTE MUST ENUMERATE ITSELF -----------------------------------------
# Without getStaticPaths a dynamic route is silently dropped from a static build, and Astro
# warns rather than fails: "getStaticPaths() ignored in dynamic page".
for f in "$TPL"/src/pages/**/*.tpl "$TPL"/src/pages/**/\[*\].astro; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    slug.astro.tpl|\[*\].astro) ;;
    *) continue ;;
  esac
  grep -q 'getStaticPaths' "$f" \
    && ok "$(basename "$f") enumerates its routes at build time" \
    || bad "$(basename "$f") is a dynamic route with no getStaticPaths; it will not be built"
done

# --- 5. THE CMS PREVIEW IS THE THIRD EXCEPTION ----------------------------------------
CMS="$DIR/../../templates/cms-sanity/astro.cms.mjs"
if [ -f "$CMS" ]; then
  grep -q 'astro:route:setup' "$CMS" \
    && ok "the CMS overlay flips the preview deployment to on-demand" \
    || bad "the CMS overlay has no route:setup hook, so a draft preview would be frozen at build time"
  grep -q 'PUBLIC_SANITY_VISUAL_EDITING_ENABLED' "$CMS" \
    && ok "and it keys that on the visual-editing flag" \
    || bad "the CMS overlay does not key the render mode on the visual-editing flag"
fi

# --- 6. THE WORKAROUND THE OLD MODE NEEDED IS GONE ------------------------------------
# Posts are prerendered routes now, so @astrojs/sitemap enumerates them itself.
grep -q 'customPages' "$CONF" \
  && bad "astro.config.mjs still hand-lists posts for the sitemap; prerendered routes are enumerated natively" \
  || ok "the sitemap workaround is gone"

# --- 7. THE RULE IS SCOPED TO NEW BUILDS ----------------------------------------------
# A site built before this default is output: "server" and is working. An agent in CONTINUE
# mode reading "static by default, and here is what SSR was costing you" could reasonably
# decide to fix a live client site, which on a store means getStaticPaths on every dynamic
# route and is exactly where product pages disappear. The doctrine has to say so in both
# places an agent would look.
grep -q "NEVER RETROFIT AN EXISTING SITE" "$DIR/../../LEGACY.md" \
  && ok "LEGACY.md scopes the render mode to new builds" \
  || bad "LEGACY.md does not forbid retrofitting an existing site's render mode"
grep -qi "Match the site you are in" "$DIR/../../references/continue-mode.md" \
  && ok "continue-mode.md tells an edit to match the site it is in" \
  || bad "continue-mode.md does not tell an edit to match the site's existing render mode"

# --- 8. A PREVIEW IS NOINDEXED IN THE PAGE, NOT ONLY IN robots.txt --------------------
# Disallow stops the CRAWL. It does not stop the URL being INDEXED when something links to
# it, and a preview deployment is a real public origin carrying a client's content at a
# domain they do not own. The two mechanisms fail differently, so the scaffold ships both.
BL="$TPL/src/layouts/BaseLayout.astro"
grep -q 'PUBLIC_SITE_ENV === "production"' "$BL" \
  && ok "BaseLayout knows whether this build is the live site" \
  || bad "BaseLayout does not read PUBLIC_SITE_ENV, so it cannot tell a preview from production"

# Unknown fails toward noindex, so production has to be DETECTABLE on every host we ship to,
# by every route the value can arrive on. A production deploy that cannot prove it is
# production noindexes itself, which is a total and silent loss of search traffic.
grep -q 'VERCEL_ENV === "production"' "$BL" \
  && ok "and reads VERCEL_ENV directly, for a build whose config did not fold it in" \
  || bad "BaseLayout reads only one production signal; a Vercel build that missed the inline noindexes itself"

# The Cloudflare overlay has no VERCEL_ENV to fall back on, so CI has to say which build this
# is, and the config has to bake it in: wrangler vars reach the Worker at runtime and the
# robots meta is decided at build time.
CF="$(dirname "$TPL")/host-cloudflare"
if [ -d "$CF" ]; then
  grep -q 'PUBLIC_SITE_ENV: production' "$CF/.github/workflows/deploy.yml" \
    && ok "the Cloudflare production deploy declares itself production" \
    || bad "the Cloudflare deploy sets no PUBLIC_SITE_ENV, so the live site would noindex itself"
  grep -q 'PUBLIC_SITE_ENV: preview' "$CF/.github/workflows/preview.yml" \
    && ok "and its preview deploy declares itself a preview" \
    || bad "the Cloudflare preview deploy sets no PUBLIC_SITE_ENV"
  grep -q 'import.meta.env.PUBLIC_SITE_ENV' "$CF/astro.config.mjs" \
    && ok "and the overlay bakes the value into the build" \
    || bad "the Cloudflare overlay never defines PUBLIC_SITE_ENV, so CI setting it changes nothing"
fi

META="$(grep 'content="noindex"' "$BL" | head -1)"
case "$META" in
  *'!isProduction'*) ok "every non-production page carries meta robots noindex" ;;
  *) bad "the noindex meta does not fire on a non-production build: $META" ;;
esac
# The env half must not hang off the prop, or a preview page that did not ask stays indexable.
case "$META" in
  *'noindex ||'*) ok "and an explicit noindex prop still works, in production too" ;;
  *) bad "the noindex prop no longer reaches the meta tag: $META" ;;
esac

# Explore variants are rejected concept homepages. They must never be indexable anywhere.
found_variant=0
for f in "$TPL"/src/pages/v[0-9]*.astro; do
  [ -f "$f" ] || continue
  found_variant=1
  grep -q 'noindex' "$f" \
    && ok "$(basename "$f") declares noindex" \
    || bad "$(basename "$f") is a rejected concept homepage with no noindex"
done
[ "$found_variant" = "1" ] || ok "no Explore variant ships in the scaffold; nothing to noindex"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
