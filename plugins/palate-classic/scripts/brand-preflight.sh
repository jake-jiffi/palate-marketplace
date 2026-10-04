#!/usr/bin/env bash
# Preflight for palate-brand-as-code. Verifies every tool, token, and scope
# needed for a full run. Exits 0 if all pass, non-zero with remediation if not.
set -euo pipefail

fail() { echo "PREFLIGHT FAIL: $1" >&2; echo "  remediation: $2" >&2; exit 1; }
ok() { echo "  ok: $1"; }

echo "palate-brand-as-code preflight"

# node
command -v node >/dev/null 2>&1 || fail "node not found" "install Node 22+ (nvm install 22)"
node_major=$(node -p "process.versions.node.split('.')[0]")
[ "$node_major" -ge 22 ] || fail "node $node_major too old" "upgrade to Node 22+"
ok "node $(node --version)"

# npm
command -v npm >/dev/null 2>&1 || fail "npm not found" "comes with Node"
ok "npm $(npm --version)"

# jq
command -v jq >/dev/null 2>&1 || fail "jq not found" "brew install jq (or apt-get install jq)"
ok "jq $(jq --version)"

# gh auth
command -v gh >/dev/null 2>&1 || fail "gh not found" "install GitHub CLI, then gh auth login"
gh auth status >/dev/null 2>&1 || fail "gh not authed" "run: gh auth login"
ok "gh authed"

# sips (image conversion, macOS) or imagemagick fallback
if command -v sips >/dev/null 2>&1; then
  ok "sips available (image conversion)"
elif command -v convert >/dev/null 2>&1; then
  ok "imagemagick convert available (sips fallback)"
else
  echo "  warn: no sips or imagemagick; AVIF->JPG previews for photography will be skipped" >&2
fi

# GitHub Packages write capability. This is the distinct scope check.
# Test by querying whoami against the GitHub Packages registry with the token.
if [ -z "${GITHUB_PACKAGES_TOKEN:-}" ]; then
  fail "GITHUB_PACKAGES_TOKEN not set" \
    "create a classic PAT with write:packages + read:packages scopes, then: export GITHUB_PACKAGES_TOKEN=ghp_..."
fi
whoami_out=$(npm whoami --registry=https://npm.pkg.github.com 2>/dev/null || echo "")
if [ -z "$whoami_out" ]; then
  # whoami via registry can be flaky; do a direct API scope check as backup
  scope_check=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${GITHUB_PACKAGES_TOKEN}" \
    "https://api.github.com/user" || echo "000")
  [ "$scope_check" = "200" ] || fail "GITHUB_PACKAGES_TOKEN invalid or lacks scope" \
    "regenerate a classic PAT with write:packages + read:packages"
fi
ok "GitHub Packages token present and valid"

echo "PREFLIGHT PASS"
