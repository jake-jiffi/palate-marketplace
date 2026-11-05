#!/usr/bin/env bash
# Tests that adding the CMS also opens the policy the CMS needs.
#
# THE REGRESSION THIS PINS. The base template now serves a Content-Security-Policy listing
# only the hosts the base template loads. `add-sanity.sh` mounts the Sanity Studio at /studio
# and turns on the visual-editing overlay, and both run in the BROWSER, so without this the
# next CMS client gets a Studio that cannot sign in and a webfont that will not load.
#
# THE HOSTS ARE MEASURED, not reasoned about. A real build of the overlay served under the
# base policy raised connect-src violations for `https://<projectId>.api.sanity.io`
# (`users/me`, `check/cors`) and font-src violations for the Studio's own Inter webfont on
# `design-system-static.sanity.io`, which nobody would have listed from reading the code.
#
# A CMS project carries EITHER vercel.json OR public/_headers: switch-host-cloudflare.sh
# deletes vercel.json when it applies the Cloudflare overlay. Both are covered here.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
TPL="$ROOT/templates/astro-project"
CF="$ROOT/templates/host-cloudflare/_headers"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

command -v jq >/dev/null 2>&1 || { echo "add-sanity-csp: jq is required by add-sanity.sh. NOT a pass." >&2; exit 2; }

# The hosts the Studio and the overlay actually reach, and the directive each belongs in.
CONNECT="https://*.api.sanity.io https://*.apicdn.sanity.io https://api.sanity.io https://cdn.sanity.io"
FONT="https://design-system-static.sanity.io"

# A project shaped like a scaffolded one: enough for add-sanity.sh to accept it.
scaffold() { # <dir> <host: vercel|cloudflare>
  local p="$1"
  mkdir -p "$p/src/components" "$p/src/lib" "$p/src/pages/api" "$p/public"
  cp "$TPL/package.json" "$p/package.json"
  cp "$TPL/astro.config.mjs" "$p/astro.config.mjs"
  cp "$TPL/astro.cms.mjs" "$p/astro.cms.mjs" 2>/dev/null
  cp "$TPL/src/components/CmsVisualEditing.astro" "$p/src/components/CmsVisualEditing.astro"
  cp "$TPL/src/lib/load.ts" "$p/src/lib/load.ts"
  cp "$TPL/src/env.d.ts" "$p/src/env.d.ts"
  cp "$TPL/src/pages/api/contact.ts" "$p/src/pages/api/contact.ts"
  if [ "$2" = "vercel" ]; then cp "$TPL/vercel.json" "$p/vercel.json"; else cp "$CF" "$p/public/_headers"; fi
}
# The policy as the project would serve it.
policy() { # <dir>
  if [ -f "$1/vercel.json" ]; then
    node -e '
      const j = require(process.argv[1]);
      const r = (j.headers || []).find((h) => h.source === "/(.*)") || { headers: [] };
      const c = (r.headers || []).find((h) => h.key === "Content-Security-Policy");
      process.stdout.write(c ? c.value : "");' "$1/vercel.json" 2>/dev/null
  else
    awk '/^ *Content-Security-Policy:/ { sub(/^ *Content-Security-Policy: */, ""); print; exit }' "$1/public/_headers"
  fi
}
# One directive's value, so a host is checked where it would actually be used.
directive() { printf '%s' "$1" | tr ';' '\n' | awk -v d="$2" '{ sub(/^ +/, ""); if ($1 == d) { sub(/^[^ ]+ */, ""); print; exit } }'; }

check_hosts() { # <label> <policy> <directive> <hosts>
  local label="$1" csp="$2" d="$3" h
  for h in $4; do
    case "$(directive "$csp" "$d")" in
      *"$h"*) ok "$label: $d allows $h" ;;
      *) bad "$label: $d does not allow $h, so the Studio is blocked" ;;
    esac
  done
}

# ============ 1. A VERCEL PROJECT gains the hosts ========================================
V="$TMP/vercel-proj"; scaffold "$V" vercel
bash "$ROOT/scripts/add-sanity.sh" "$V" >"$TMP/v.out" 2>"$TMP/v.err" \
  || { bad "add-sanity.sh failed on a vercel project"; sed 's/^/      /' "$TMP/v.err"; }
VP="$(policy "$V")"
[ -n "$VP" ] && ok "vercel.json still serves a policy after the overlay" \
  || bad "the overlay left vercel.json with no policy at all"
check_hosts "vercel" "$VP" connect-src "$CONNECT"
check_hosts "vercel" "$VP" font-src "$FONT"
# The base hosts must survive the patch: adding to a policy must never rewrite it.
check_hosts "vercel" "$VP" script-src "https://app.humblytics.com https://challenges.cloudflare.com"
case "$(directive "$VP" default-src)" in *"'self'"*) ok "vercel: default-src survives" ;; *) bad "vercel: default-src was lost" ;; esac
grep -q "CSP extended" "$TMP/v.out" && ok "and add-sanity says it extended the policy" \
  || bad "add-sanity extended the policy without saying so"

# THE PRESENTATION IFRAME. previewUrl origin is same-origin, and an explicitly set frame-src
# does NOT fall back to default-src, so 'self' has to be named or the preview pane is blank.
case "$(directive "$VP" frame-src)" in
  *"'self'"*) ok "vercel: frame-src names 'self', so the Presentation preview can frame the site" ;;
  *) bad "vercel: frame-src does not name 'self'; Sanity's Presentation preview will be blank" ;;
esac

# ============ 2. A CLOUDFLARE PROJECT, which has no vercel.json ==========================
C="$TMP/cf-proj"; scaffold "$C" cloudflare
bash "$ROOT/scripts/add-sanity.sh" "$C" >"$TMP/c.out" 2>"$TMP/c.err" \
  || { bad "add-sanity.sh failed on a cloudflare project"; sed 's/^/      /' "$TMP/c.err"; }
CP="$(policy "$C")"
check_hosts "cloudflare" "$CP" connect-src "$CONNECT"
check_hosts "cloudflare" "$CP" font-src "$FONT"
check_hosts "cloudflare" "$CP" script-src "https://app.humblytics.com"
# The rest of the file must be untouched: it carries the cache rules the site depends on.
grep -q "^/_astro/\*" "$C/public/_headers" && ok "cloudflare: the cache rules survive the patch" \
  || bad "cloudflare: the patch damaged the rest of _headers"
grep -q "Strict-Transport-Security" "$C/public/_headers" && ok "cloudflare: HSTS survives the patch" \
  || bad "cloudflare: HSTS was lost"

# ============ 3. IDEMPOTENT. Running it again adds nothing. ==============================
before="$(policy "$V")"
bash "$ROOT/scripts/add-sanity.sh" "$V" >"$TMP/v2.out" 2>/dev/null
after="$(policy "$V")"
[ "$before" = "$after" ] && ok "a second run leaves the policy byte-identical" \
  || bad "a second run changed the policy again"
grep -q "already carries the Sanity hosts" "$TMP/v2.out" && ok "and says the hosts were already there" \
  || bad "a second run did not say the hosts were already there"

# ============ 4. A POLICY WITH NO font-src AT ALL. The directive must be ADDED. ==========
# This is the dangerous shape, not a tidy one: with no font-src, fonts fall back to
# default-src 'self', so a trimmed policy blocks the Studio's webfont exactly as a listed-but-
# incomplete one does. Appending only to directives that already exist would miss it.
T="$TMP/trimmed"; scaffold "$T" vercel
node -e '
  const fs = require("fs"); const p = process.argv[1]; const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const r = (j.headers || []).find((h) => h.source === "/(.*)");
  const c = r.headers.find((h) => h.key === "Content-Security-Policy");
  c.value = c.value.split(";").map((d) => d.trim()).filter((d) => !d.startsWith("font-src")).join("; ");
  fs.writeFileSync(p, JSON.stringify(j, null, 2));' "$T/vercel.json"
bash "$ROOT/scripts/add-sanity.sh" "$T" >/dev/null 2>&1
TP="$(policy "$T")"
case "$(directive "$TP" font-src)" in
  *"design-system-static.sanity.io"*) ok "a missing font-src is ADDED, not skipped" ;;
  *) bad "the policy had no font-src and none was added, so the Studio font stays blocked" ;;
esac
case "$(directive "$TP" font-src)" in
  *"'self'"*) ok "and the added directive still allows the site's own fonts" ;;
  *) bad "the added font-src drops 'self', so the site's own webfonts stop loading" ;;
esac

# ============ 5. NO POLICY TO EXTEND: say so, never silently succeed =====================
N="$TMP/nopolicy"; scaffold "$N" vercel
node -e '
  const fs = require("fs"); const p = process.argv[1]; const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const r of j.headers || []) r.headers = (r.headers || []).filter((h) => h.key !== "Content-Security-Policy");
  fs.writeFileSync(p, JSON.stringify(j, null, 2));' "$N/vercel.json"
bash "$ROOT/scripts/add-sanity.sh" "$N" >/dev/null 2>"$TMP/n.err"
grep -q "carries NO Content-Security-Policy" "$TMP/n.err" && ok "a project with no policy is TOLD, not ignored" \
  || bad "a project with no policy was passed over in silence"
grep -q "api.sanity.io" "$TMP/n.err" && ok "and the message names the hosts to add by hand" \
  || bad "the message does not say what to add"

# The rest of the overlay must still have landed: the CSP is a step, not a gate.
[ -f "$N/sanity.config.ts" ] && ok "and the CMS is still installed" || bad "a missing policy blocked the install"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
