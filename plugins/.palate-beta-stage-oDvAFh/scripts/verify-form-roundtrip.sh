#!/usr/bin/env bash
# POST the contact form to a DEPLOYED site and prove the endpoint answers.
#
# Called by verify-vercel.sh and verify-cloudflare.sh after the 200 check, and runnable on its
# own against any deployment.
#
#   Usage:  verify-form-roundtrip.sh <site-url> [--env production|preview]
#   Exit:   0  the round trip is proven: 2xx carrying "smoke": true, nothing sent
#           1  the endpoint is there and something is wrong, with the reason printed
#           2  SKIPPED with a reason: no /api/contact here, or production with no secret set
#
# WHY THIS IS SAFE TO RUN AGAINST A LIVE SITE. The request carries `x-palate-smoke: 1`, which
# makes src/pages/api/contact.ts validate the body and answer `{ ok: true, smoke: true }`
# having sent nothing. On a preview that is all it takes. In PRODUCTION the endpoint ignores
# the header unless `x-palate-smoke-secret` matches `PALATE_SMOKE_SECRET`.
#
# PRODUCTION WITH NO SECRET IS A SKIP, NOT A FAILURE, and that is the whole reason this block
# exists. Without it the request falls through to the real path, Turnstile refuses the token
# this script does not have, and the operator reads a 400 on their contact endpoint minutes
# after going live. Nothing is broken; nobody set a variable. So the check refuses to run,
# says which variable and where to put it, and exits 2 so it can never read as a pass either.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/workflow-route.sh"
palate_route_workflow writer verify-form-roundtrip "$PWD"
URL="${1:?site url}"
URL="${URL%/}"
shift || true
SITE_ENV=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) SITE_ENV="${2:-}"; shift 2 ;;
    --env=*) SITE_ENV="${1#--env=}"; shift ;;
    *) echo "verify-form-roundtrip: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

# THE SECRET, in the order the pipeline actually fills it: the environment first, then ./.env,
# which is where provision-vercel.sh and provision-cloudflare.sh write the value they generate
# and which .gitignore already covers. Reading the file is what makes the ordinary path need no
# manual step at all. One key, by name; the file is not sourced.
# XTRACE OFF FROM HERE TO THE CONFIG FILE. Moving the header off the curl argv keeps it out of
# `ps`, and does nothing about `bash -x`, which prints every assignment WITH its value and would
# have printed the secret twice over: once on the quote-stripping expansions and once on the
# printf that writes the file. Restored to whatever it was, so a caller tracing this script
# still sees everything except the value.
__xt="$-"; set +x
SECRET="${PALATE_SMOKE_SECRET:-}"
if [ -z "$SECRET" ] && [ -f .env ]; then
  # THE LAST ASSIGNMENT WINS, because that is what sourcing the file does, and the provisioning
  # scripts source it. .env.example ships a blank `PALATE_SMOKE_SECRET=` line, so an operator
  # who copies the example and then provisions ends up with a blank line followed by a real
  # one: `head -1` read the blank, called the secret unset, and skipped forever on production
  # telling them to set a variable that was already set. `export ` is tolerated because a
  # hand-written .env often carries it and the skip would otherwise name a line they can see.
  SECRET="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}PALATE_SMOKE_SECRET[[:space:]]*=[[:space:]]*//p' .env | tail -1)"
  SECRET="${SECRET%\"}"; SECRET="${SECRET#\"}"
  SECRET="${SECRET%\'}"; SECRET="${SECRET#\'}"
fi
# Blank or whitespace-only is UNSET. The endpoint fails closed on it either way, so sending it
# would only turn a clear skip into a confusing 400.
case "$SECRET" in *[![:space:]]*) ;; *) SECRET="" ;; esac

# CAN WE PROVE THIS IS NOT PRODUCTION? That is the question, not "is it production", and the
# inversion mirrors the endpoint's. The guard there is open only for a build that says out loud
# it is not production, so a script that ran whenever it could not see the word "production"
# would post into a 400 on every deployment whose environment it simply could not read. The
# stage file is the build's own word for it, and is read with grep rather than jq so a missing
# jq cannot turn this guard off silently.
[ -z "$SITE_ENV" ] && SITE_ENV="${PALATE_SITE_ENV:-${PUBLIC_SITE_ENV:-${VERCEL_ENV:-}}}"
IS_PROD=0
KNOWN=0
case "$(printf '%s' "$SITE_ENV" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
  production) IS_PROD=1; KNOWN=1 ;;
  "")         ;;
  *)          KNOWN=1 ;;
esac
if [ -f .palate-skill-state.json ] \
  && grep -q '"stage"[[:space:]]*:[[:space:]]*"production"' .palate-skill-state.json; then
  IS_PROD=1; KNOWN=1
fi

if [ -z "$SECRET" ] && { [ "$IS_PROD" = "1" ] || [ "$KNOWN" != "1" ]; }; then
  if [ "$IS_PROD" = "1" ]; then why="this is a PRODUCTION deployment"; else why="this deployment's environment is UNKNOWN, which the endpoint treats as production"; fi
  cat >&2 <<EOF
FORM_ROUNDTRIP: SKIPPED - $why and PALATE_SMOKE_SECRET is not set,
so the endpoint would refuse the smoke header, take the real path, and answer 400. Nothing is
broken. Nothing was posted. Either build the deployment with PUBLIC_SITE_ENV set (production, or
preview on a preview, which is what every automatic path already does), or set the SAME secret
value in two places:
  1. the deployment, so the endpoint honours the header:
       Vercel      vercel env add PALATE_SMOKE_SECRET production
       Cloudflare  wrangler secret put PALATE_SMOKE_SECRET --name <slug>-site
  2. this shell, so the request carries it:
       export PALATE_SMOKE_SECRET=...      (or add the line to ./.env)
provision-vercel.sh and provision-cloudflare.sh generate it and do both on a fresh build; this
skip is what a deployment provisioned before they did looks like.
EOF
  case "$__xt" in *x*) set -x ;; esac
  exit 2
fi

BODY='{"name":"Palate verify","email":"verify@example.com","message":"Automated round-trip check from the Palate post-deploy verifier. Nothing to action."}'
args=(-s -S --max-time 20 -X POST
  -H "content-type: application/json"
  -H "x-palate-smoke: 1")

tmp="$(mktemp)"
cfg="$(mktemp)"
chmod 600 "$cfg"
trap 'rm -f "$tmp" "$cfg"' EXIT
if [ -n "$SECRET" ]; then
  # THROUGH A CONFIG FILE, not the command line. An -H on the argv is visible in `ps` to every
  # local user for the life of the request.
  printf 'header = "x-palate-smoke-secret: %s"\n' "$SECRET" > "$cfg"
  args+=(--config "$cfg")
  case "$__xt" in *x*) set -x ;; esac
else
  case "$__xt" in *x*) set -x ;; esac
  echo "verify-form-roundtrip: PALATE_SMOKE_SECRET is not set. Correct for a preview, where the header works on its own." >&2
fi
# `|| echo "000"` would CONCATENATE with the 000 curl's own -w already wrote on a failed
# connection, producing "000000", which matches no branch below and lands in the wildcard. The
# unreachable-host branch would have existed and never once fired.
code=$(curl "${args[@]}" -o "$tmp" -w "%{http_code}" -d "$BODY" "$URL/api/contact" 2>/dev/null) || code="${code:-000}"
seen=$(tr -d '\r\n' < "$tmp" | cut -c1-200)

case "$code" in
  404|405)
    echo "FORM_ROUNDTRIP: SKIPPED - $URL/api/contact answered $code, so this deployment has no contact endpoint to test." >&2
    exit 2
    ;;
  000)
    echo "FORM_ROUNDTRIP: FAILED - no response from $URL/api/contact within 20s." >&2
    exit 1
    ;;
  2*)
    if printf '%s' "$seen" | grep -q '"smoke"[[:space:]]*:[[:space:]]*true'; then
      echo "FORM_ROUNDTRIP: $URL/api/contact -> $code with smoke: true (validated, nothing sent)"
      exit 0
    fi
    echo "FORM_ROUNDTRIP: FAILED - $URL/api/contact answered $code WITHOUT \"smoke\": true, so the header was ignored and this submission took the real path. On a live site that is a fake enquiry in the client's inbox. Either the endpoint predates the smoke contract, or PUBLIC_SITE_ENV is production and PALATE_SMOKE_SECRET does not match the value the deployment holds. Response: $seen" >&2
    exit 1
    ;;
  *)
    echo "FORM_ROUNDTRIP: FAILED - $URL/api/contact answered $code. Response: $seen" >&2
    exit 1
    ;;
esac
