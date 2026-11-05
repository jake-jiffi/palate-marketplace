#!/usr/bin/env bash
# Tests the security headers the scaffold ships on both hosts.
#
# The template sent nosniff, SAMEORIGIN, a referrer policy and a permissions policy, and no
# Content-Security-Policy on either host and no HSTS on the Cloudflare overlay. A CSP is the
# one header that changes what a compromised or injected script can do, and a site with no
# HSTS accepts a first request over plain http.
#
# THE DURABLE HALF OF THIS TEST IS THE HOST LIST. The CSP is derived from what the template
# actually loads in a browser, so the day someone adds a third-party script or a client-side
# fetch to a new host, this fails and names it rather than the customer finding a blank widget
# in production. Server-side fetches (src/pages/api) are deliberately not in the list: the
# browser never makes them, and listing them would widen the policy for nothing.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
T="$DIR/../../templates/astro-project"
CF="$DIR/../../templates/host-cloudflare/_headers"
VJ="$T/vercel.json"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
has() { # <desc> <file> <pattern>
  grep -qF "$3" "$2" && ok "$1" || bad "$1 (missing '$3' from $(basename "$2"))"
}

# The CSP as each host serves it, read once so every assertion below judges the real string.
VERCEL_CSP="$(node -e '
  const j = require(process.argv[1]);
  const rule = (j.headers || []).find((h) => h.source === "/(.*)") || { headers: [] };
  const csp = (rule.headers || []).find((h) => h.key === "Content-Security-Policy");
  process.stdout.write(csp ? csp.value : "");
' "$VJ" 2>/dev/null)"
CF_CSP="$(awk '/^ *Content-Security-Policy:/ { sub(/^ *Content-Security-Policy: */, ""); print; exit }' "$CF")"

# One directive's value, so every source below is judged where it would actually be used.
# READ THE DIRECTIVE, NOT THE STRING: an early draft searched the whole policy for a token and
# fired on a correct one, because a later directive carried it legitimately.
directive() { # <csp> <name> -> the directive's value, empty when absent
  printf '%s' "$1" | tr ';' '\n' | awk -v d="$2" '{ sub(/^ +/, ""); if ($1 == d) { sub(/^[^ ]+ */, ""); print; exit } }'
}

[ -n "$VERCEL_CSP" ] && ok "vercel.json serves a Content-Security-Policy on every route" \
  || bad "vercel.json serves NO Content-Security-Policy"
[ -n "$CF_CSP" ] && ok "the Cloudflare overlay serves a Content-Security-Policy" \
  || bad "the Cloudflare overlay serves NO Content-Security-Policy"

# ============ 1. THE DIRECTIVES, on both hosts ===========================================
for d in "default-src 'self'" "object-src 'none'" "base-uri 'self'" "form-action 'self'"; do
  case "$VERCEL_CSP" in *"$d"*) ok "vercel CSP: $d" ;; *) bad "vercel CSP is missing: $d" ;; esac
  case "$CF_CSP" in *"$d"*) ok "cloudflare CSP: $d" ;; *) bad "cloudflare CSP is missing: $d" ;; esac
done
# THE SOURCES, not the spelling. These three directives carry host lists that differ per host
# (the Vercel Toolbar is on one and not the other), so each required source is asserted on its
# own rather than as one literal string that a legitimate addition would break.
for name in "vercel:$VERCEL_CSP" "cloudflare:$CF_CSP"; do
  who="${name%%:*}"; csp="${name#*:}"
  for pair in "style-src:'self'" "style-src:'unsafe-inline'" "img-src:'self'" "img-src:data:" \
              "img-src:https:" "font-src:'self'" "font-src:data:"; do
    d="${pair%%:*}"; src="${pair#*:}"
    case "$(directive "$csp" "$d")" in
      *"$src"*) ok "$who CSP $d carries $src" ;;
      *) bad "$who CSP $d is missing $src" ;;
    esac
  done
done

# READ THE DIRECTIVE, NOT THE STRING. The first draft searched the whole policy for
# "script-src" followed by "'unsafe-inline'" and fired on a correct policy, because style-src
# comes after script-src and carries the token legitimately. A check keyed on where something
# sits in a line rather than on what it means is the same fault this repo has shipped before.
for name in "vercel:$VERCEL_CSP" "cloudflare:$CF_CSP"; do
  who="${name%%:*}"; csp="${name#*:}"
  # Astro inlines small stylesheets, and a build of this template also ships inline SCRIPT it
  # does not control: the Vercel adapter's analytics bootstrap and whichever component script
  # Astro chose to inline. Measured on a real build, so both directives carry 'unsafe-inline'.
  for d in script-src style-src; do
    case "$(directive "$csp" "$d")" in
      *"'unsafe-inline'"*) ok "$who CSP: $d allows the inline content a real build ships" ;;
      *) bad "$who CSP blocks inline $d content, which a built page carries: it will break" ;;
    esac
  done
  # A HASH OR A NONCE BESIDE 'unsafe-inline' SILENTLY TURNS IT OFF. Every modern browser
  # ignores 'unsafe-inline' when either is present, so adding one "to tighten things up" kills
  # every inlined script in the build with no error to read.
  case "$(directive "$csp" script-src)" in
    *"sha256-"*|*"sha384-"*|*"sha512-"*|*"nonce-"*)
      bad "$who CSP mixes a hash or nonce with 'unsafe-inline' in script-src, which disables it" ;;
    *) ok "$who CSP does not mix a hash or nonce with 'unsafe-inline' in script-src" ;;
  esac
done

# ============ 2. EVERY HOST THE TEMPLATE ACTUALLY LOADS is allowed =======================
# Browser-facing only: a <script src> or a client-side fetch. src/pages/api runs on the
# server, and a JSON-LD @context is a name, never a request.
#
# CHECK THE DIRECTIVE THAT WOULD DO THE LOADING. The first draft searched the whole policy for
# the host, so dropping the analytics host from script-src while connect-src still carried it
# passed: the check said "allowed somewhere" when the question is "allowed to be a script".
script_hosts="$(grep -rhoE 'src="https://[a-zA-Z0-9.-]+' "$T/src" --include='*.astro' --exclude-dir=api 2>/dev/null \
  | sed 's/^src="https:\/\///' | sort -u)"
connect_hosts="$(grep -rhoE 'fetch\("https://[a-zA-Z0-9.-]+' "$T/src" --include='*.astro' --include='*.ts' --exclude-dir=api 2>/dev/null \
  | sed 's/^fetch("https:\/\///' | sort -u)"
[ -n "$script_hosts" ] || bad "found no third-party script host in the template, so this check inspected nothing"

allows() { # <directive-value> <host> -> 0 when the host is allowed, wildcard included
  local val="$1" h="$2" wild="*.${2#*.}"
  case "$val" in *"https://$h"*|*"https://$wild"*) return 0 ;; *) return 1 ;; esac
}
check_hosts() { # <directive> <host-list>
  local d="$1" list="$2" h who csp
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    for name in "vercel:$VERCEL_CSP" "cloudflare:$CF_CSP"; do
      who="${name%%:*}"; csp="${name#*:}"
      if allows "$(directive "$csp" "$d")" "$h"; then
        ok "$who CSP $d allows $h, which the template loads"
      else
        bad "$who CSP $d does not allow $h, and the template loads it from there"
      fi
    done
  done <<< "$list"
}
check_hosts script-src "$script_hosts"
if [ -n "$connect_hosts" ]; then
  check_hosts connect-src "$connect_hosts"
else
  ok "the template makes no client-side fetch to a third-party host"
fi

# Turnstile renders in an iframe, which default-src 'self' would block outright.
for name in "vercel:$VERCEL_CSP" "cloudflare:$CF_CSP"; do
  who="${name%%:*}"; csp="${name#*:}"
  case "$(directive "$csp" frame-src)" in
    *"challenges.cloudflare.com"*) ok "$who CSP frames Turnstile" ;;
    *) bad "$who CSP has no frame-src for Turnstile, so the widget cannot render" ;;
  esac
done

# THE VERCEL TOOLBAR, which the platform injects into every preview and the doc promises as
# the headline win for client review. It is not in the template source, so the derived-host
# check above cannot see it, and the Cloudflare overlay must NOT carry it: there is no Vercel
# Toolbar on Workers, and a host that never loads has no business in a policy.
#
# ALL SIX DIRECTIVES, from Vercel's own list. The first pass allowed the script, the frame and
# the connection and forgot the stylesheet, the webfont, the blob images and the Comments
# websocket, which would have loaded an unstyled toolbar with dead Comments under a doc calling
# Comments the headline win. Half an allowlist reads as a working feature until a client opens it.
toolbar() { # <directive> <required source>
  case "$(directive "$VERCEL_CSP" "$1")" in
    *"$2"*) ok "vercel CSP $1 carries $2 for the Toolbar" ;;
    *) bad "vercel CSP $1 is missing $2, so the Toolbar loads half-broken on every preview" ;;
  esac
}
toolbar script-src  "https://vercel.live"
toolbar connect-src "https://vercel.live"
toolbar connect-src "wss://ws-us3.pusher.com"   # Comments; no https source covers a websocket
toolbar frame-src   "https://vercel.live"
toolbar style-src   "https://vercel.live"
toolbar font-src    "https://vercel.live"
toolbar font-src    "https://assets.vercel.com"
toolbar img-src     "blob:"                     # avatars and screenshots
# img-src also needs vercel.live and vercel.com. The template already allows every https image
# source, so the hosts are covered without repeating them; assert the cover, not the spelling.
case "$(directive "$VERCEL_CSP" img-src)" in
  *"https:"*|*"https://vercel.live"*) ok "vercel CSP img-src covers the Toolbar's image hosts" ;;
  *) bad "vercel CSP img-src covers neither https: nor vercel.live, so Toolbar images are blocked" ;;
esac
# And the overlay stays clean: not one of the Toolbar sources belongs on a Workers deploy.
for src in "vercel.live" "assets.vercel.com" "ws-us3.pusher.com"; do
  case "$CF_CSP" in
    *"$src"*) bad "the Cloudflare overlay lists $src, which a Workers deploy never loads" ;;
    *) ok "the Cloudflare overlay does not carry $src" ;;
  esac
done

# A server-side host must NOT be in the policy: widening it for a request the browser never
# makes is how a CSP stops describing anything.
case "$VERCEL_CSP$CF_CSP" in
  *"api.resend.com"*) bad "the CSP lists api.resend.com, which only the server ever calls" ;;
  *) ok "the CSP does not list hosts only the server calls" ;;
esac

# ============ 3. HSTS on the Cloudflare overlay ==========================================
has "the Cloudflare overlay sends HSTS" "$CF" "Strict-Transport-Security: max-age=63072000; includeSubDomains"

# ============ 4. THE HEADERS THAT WERE ALREADY THERE are still there =====================
for h in "X-Content-Type-Options" "X-Frame-Options" "Referrer-Policy" "Permissions-Policy"; do
  has "vercel.json still sends $h" "$VJ" "$h"
  has "the Cloudflare overlay still sends $h" "$CF" "$h"
done

# ============ 5. THE HOSTING DOC says what is served =====================================
has "hosting-vercel.md documents the CSP" "$DIR/../../references/hosting-vercel.md" "Content-Security-Policy"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
