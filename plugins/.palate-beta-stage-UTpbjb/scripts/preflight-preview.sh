#!/usr/bin/env bash
# Preflight for a PREVIEW build. Always checks the local Astro toolchain
# (writable working dir, node 22+, npm, git, jq). It never checks PRODUCTION
# infra (Sanity / custom domain / GitHub). The preview is, by default, deployed
# to a SHAREABLE Vercel preview, so it also checks `vercel` login + the brand
# token UNLESS PALATE_PREVIEW_DELIVERY=local (a local dev-server preview, which
# needs no cloud creds at all).
set -euo pipefail
fail() { echo "PREVIEW PREFLIGHT FAIL: $1" >&2; echo "  remediation: $2" >&2; exit 1; }
ok() { echo "  ok: $1"; }
echo "palate-website-builder preview preflight"

# Environment + working dir (proven writable by detect-environment)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
eval "$(bash "$SCRIPT_DIR/detect-environment.sh")" || fail "could not find a writable working directory" "set PALATE_WORK_DIR to a writable path"
[ -n "${WORK_ROOT:-}" ] || fail "no working directory resolved" "set PALATE_WORK_DIR"
ok "working dir: $WORK_ROOT (env: ${ENV_KIND})"

# node 22+
[ "${HAS_NODE}" = "yes" ] || fail "node not found" "install Node 22+ (a preview needs it to build the real Astro project)"
[ "${NODE_OK}" = "yes" ] || fail "node too old" "upgrade to Node 22+"
ok "node $(node --version)"
command -v npm >/dev/null 2>&1 || fail "npm not found" "comes with Node"; ok "npm $(npm --version)"
command -v git >/dev/null 2>&1 || fail "git not found" "install git"; ok "git present"
command -v jq >/dev/null 2>&1 || fail "jq not found" "install jq (brew install jq / apt-get install jq)"; ok "jq present"

# Preview delivery. Default: a SHAREABLE Vercel preview deployment (so the client
# can review + leave Toolbar Comments). Set PALATE_PREVIEW_DELIVERY=local (or pass
# --local-preview) for a local dev-server preview that needs no cloud creds.
DELIVERY="${PALATE_PREVIEW_DELIVERY:-vercel}"
if [ "$DELIVERY" = "vercel" ]; then
  command -v vercel >/dev/null 2>&1 || fail "vercel CLI not found" "npm i -g vercel (or use --local-preview)"
  vercel whoami >/dev/null 2>&1 || fail "vercel not authed" "vercel login (or use --local-preview)"
  ok "vercel authed (preview is deployed to a shareable URL)"
  if [ "${VENDOR_BRAND:-0}" != "1" ]; then
    [ -n "${GITHUB_PACKAGES_TOKEN:-}" ] || fail "GITHUB_PACKAGES_TOKEN unset" \
      "export it so the Vercel preview build can install the private brand package (or use --vendor-brand / --local-preview)"
    ok "GITHUB_PACKAGES_TOKEN present (forwarded to the Vercel preview build)"
  fi
  echo "PREVIEW PREFLIGHT PASS (shareable Vercel preview)"
else
  ok "local preview delivery (dev server; no cloud creds needed)"
  echo "PREVIEW PREFLIGHT PASS (local dev-server preview)"
fi
