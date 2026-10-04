#!/usr/bin/env bash
# Preflight for palate-website-builder. Verifies every tool, token, and scope.
set -euo pipefail
fail() { echo "PREFLIGHT FAIL: $1" >&2; echo "  remediation: $2" >&2; exit 1; }
ok() { echo "  ok: $1"; }

echo "palate-website-builder preflight"

command -v node >/dev/null 2>&1 || fail "node not found" "install Node 22+"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "node too old" "upgrade to Node 22+"
ok "node $(node --version)"
command -v npm >/dev/null 2>&1 || fail "npm not found" "comes with Node"; ok "npm $(npm --version)"
command -v jq >/dev/null 2>&1 || fail "jq not found" "brew install jq"; ok "jq present"
command -v gh >/dev/null 2>&1 || fail "gh not found" "install GitHub CLI"
gh auth status >/dev/null 2>&1 || fail "gh not authed" "gh auth login"; ok "gh authed"
# Host preflight. Vercel is the default host; Cloudflare is the backup.
# The build flow exports PALATE_HOST from the chosen host (default vercel).
HOST="${PALATE_HOST:-vercel}"
if [ "$HOST" = "cloudflare" ]; then
  command -v wrangler >/dev/null 2>&1 || fail "wrangler not found" "npm i -g wrangler"; ok "wrangler present"
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || fail "CLOUDFLARE_API_TOKEN unset" "create a token with Workers + DNS edit, export it"
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || fail "CLOUDFLARE_ACCOUNT_ID unset" "export your account id"
  ok "cloudflare token + account present"
else
  command -v vercel >/dev/null 2>&1 || fail "vercel CLI not found" "npm i -g vercel"; ok "vercel CLI present"
  vercel whoami >/dev/null 2>&1 || fail "vercel not authed" "vercel login"; ok "vercel authed"
fi

# Sanity management token + org.
[ -n "${SANITY_AUTH_TOKEN:-}" ] || fail "SANITY_AUTH_TOKEN unset" "sanity login or create a management token with manage scope"
SANITY_ORG_ID="${SANITY_ORG_ID:-}"
[ -n "${SANITY_ORG_ID:-}" ] || fail "SANITY_ORG_ID unset" "export your Sanity organisation id (Settings then API in your Sanity dashboard)"
ok "sanity management token + org present"

# Resend
[ -n "${RESEND_API_KEY:-}" ] || echo "  warn: RESEND_API_KEY unset; forms will be wired but email send will fail until set" >&2

# The local ~/.npmrc for the brand package (unless vendoring)
if [ "${VENDOR_BRAND:-0}" != "1" ]; then
  if ! grep -q "palate-projects:registry" "${HOME}/.npmrc" 2>/dev/null; then
    fail "no GitHub Packages config in ~/.npmrc" \
      "add to ~/.npmrc:\n  @palate-projects:registry=https://npm.pkg.github.com\n  //npm.pkg.github.com/:_authToken=\${GITHUB_PACKAGES_TOKEN}\nand export GITHUB_PACKAGES_TOKEN (read:packages PAT)"
  fi
  ok "~/.npmrc has GitHub Packages config"
  # The token value must be exported too: needed for the local install AND, on
  # Vercel, pushed by provision-vercel.sh so the cloud build can install the
  # private brand package.
  [ -n "${GITHUB_PACKAGES_TOKEN:-}" ] || fail "GITHUB_PACKAGES_TOKEN unset" \
    "export GITHUB_PACKAGES_TOKEN (a read:packages PAT); provision-vercel.sh forwards it to the Vercel build"
  ok "GITHUB_PACKAGES_TOKEN present"
fi

echo "PREFLIGHT PASS"
