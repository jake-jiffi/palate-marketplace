#!/usr/bin/env bash
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

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
