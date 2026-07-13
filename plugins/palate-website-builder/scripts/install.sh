#!/usr/bin/env bash
# scripts/install.sh - install OR update the Palate website-builder skill's
# enforcement on this machine: the MCP connector, the gate hooks, and jq.
#
# Re-run it any time to UPDATE (it refreshes the hooks idempotently). It prints
# every change and backs up your settings. Reverse it with --uninstall.
#
#   PALATE_TOKEN=plt_live_xxx ./scripts/install.sh      # install / update
#   ./scripts/install.sh --uninstall                     # remove
#
set -euo pipefail
SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$SKILL_ROOT/VERSION" 2>/dev/null || echo unknown)"
ACTION="install"
TOKEN="${PALATE_TOKEN:-}"
for a in "$@"; do
  case "$a" in
    --uninstall) ACTION="uninstall" ;;
    --update) ACTION="install" ;;
    --token=*) TOKEN="${a#--token=}" ;;
  esac
done
say() { printf '%s\n' "$*"; }

if [ "$ACTION" = "uninstall" ]; then
  say "Uninstalling Palate skill enforcement..."
  node "$SKILL_ROOT/scripts/register-hooks.mjs" uninstall "$SKILL_ROOT"
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove palate >/dev/null 2>&1 && say "  removed the palate connector" || true
  fi
  rm -f "$HOME/.config/palate/skill-version"
  say "Done. (Cross-build memory at ~/.config/palate/builds.log.json kept; delete manually if you want.)"
  exit 0
fi

command -v node >/dev/null 2>&1 || { say "ERROR: node is required."; exit 1; }
say "Installing Palate website-builder skill v$VERSION"
say "  skill root: $SKILL_ROOT"

# jq (the gate needs it)
if ! command -v jq >/dev/null 2>&1; then
  say "jq not found (the depth gate needs it)."
  if command -v brew >/dev/null 2>&1; then
    say "  installing jq via brew..."; brew install jq >/dev/null 2>&1 || say "  brew install failed; install jq manually."
  else
    say "  install jq (brew install jq / apt-get install jq) and re-run."
  fi
fi

# Connector + token
if command -v claude >/dev/null 2>&1; then
  if [ -n "$TOKEN" ]; then
    claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp --header "Authorization: Bearer $TOKEN" >/dev/null 2>&1 \
      && say "  registered the palate MCP connector" \
      || say "  palate connector already present (skipped)"
  else
    say "  no token given - add the connector with:"
    say "    claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp --header \"Authorization: Bearer <plt_live_ token>\""
    say "  or re-run: PALATE_TOKEN=plt_live_... $0"
  fi
else
  say "  'claude' CLI not found - add the palate connector manually (see INSTALL.md)."
fi

# Hooks (idempotent + update-safe)
node "$SKILL_ROOT/scripts/register-hooks.mjs" install "$SKILL_ROOT"

# Version marker for update detection
mkdir -p "$HOME/.config/palate"
printf '%s\n' "$VERSION" > "$HOME/.config/palate/skill-version"

say ""
say "Done. The MCP-depth gate is active on your next website build:"
say "  - PreToolUse blocks writing source until you have surveyed the library"
say "  - Stop blocks finishing until the build reached real MCP depth"
say "  - PostToolUse records real telemetry to build-manifest.json"
say "Disable temporarily with PALATE_GATE_OFF=1. Uninstall: $0 --uninstall"
