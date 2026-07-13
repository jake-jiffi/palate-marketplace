#!/usr/bin/env bash
# create-palate - scaffold a real, gated Palate Astro project for a NON-Claude tool.
#
# The Claude plugin scaffolds + gates for you via hooks. A Cursor / Codex / Gemini / Copilot
# user has none of that. This is the portable equivalent: ONE command that produces an
# Astro 6 + Tailwind 4 + Vercel starter (no private deps), drops the tool's always-load Palate
# doctrine, and wires the gate as a committed pre-push hook AND CI so it cannot be skipped.
# The agent then surveys the MCP, DIVERGEs, and builds inside it.
#
# Usage (no clone):
#   curl -fsSL https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/main/scripts/create-palate.sh | bash -s -- [dir] [tool]
#     dir  = target directory (default: palate-site)
#     tool = codex | cursor | gemini | copilot | generic  (default: codex)
# From a skill checkout (offline, uses local template + doctrine):
#   scripts/create-palate.sh [dir] [tool]
#
# Env: PALATE_REF=<git-ref>  pin the fetched template/gates/doctrine (default main).
set -euo pipefail

DIR="${1:-palate-site}"
TOOL="${2:-codex}"
REF="${PALATE_REF:-main}"
REPO="jake-jiffi/palate-website-builder"
BASE="https://raw.githubusercontent.com/${REPO}/${REF}"

echo "create-palate: scaffolding a gated Astro project in '$DIR' (tool: $TOOL, ref: $REF)" >&2

SELF_DIR=""
case "${BASH_SOURCE[0]:-$0}" in
  */*) SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || true)" ;;
esac

# 1. The Astro starter (a local checkout is preferred and offline; else degit the public subdir).
if [ -n "$SELF_DIR" ] && [ -d "$SELF_DIR/templates/portable-starter" ]; then
  mkdir -p "$DIR"
  cp -R "$SELF_DIR/templates/portable-starter/." "$DIR/"
else
  command -v npx >/dev/null 2>&1 || { echo "create-palate: npx (Node.js) is required to fetch the starter" >&2; exit 2; }
  npx --yes degit "${REPO}/templates/portable-starter#${REF}" "$DIR" || { echo "create-palate: could not fetch the starter template" >&2; exit 2; }
fi
cd "$DIR"

# 1b. The vendored-brand marker. .palate-skill-state.json is gitignored (it is build state), so
# it is not committed to the template and degit drops it - but the anti-freestyle gate reads it,
# so write it here if the copy did not carry it.
if [ ! -f .palate-skill-state.json ]; then
  cat > .palate-skill-state.json <<'STATE'
{
  "brand": "vendored",
  "stack": "astro",
  "portable": true,
  "note": "Portable Palate starter. Brand tokens are vendored in src/styles/globals.css. Do not delete; the anti-freestyle gate reads the vendored marker."
}
STATE
fi

# 2. The always-load doctrine for this tool (from skill-lite).
case "$TOOL" in
  gemini)  DEST="GEMINI.md";                       SRC="skill-lite/gemini/GEMINI.md" ;;
  cursor)  DEST=".cursor/rules/palate.mdc";        SRC="skill-lite/cursor/palate.mdc" ;;
  copilot) DEST=".github/copilot-instructions.md"; SRC="skill-lite/copilot/copilot-instructions.md" ;;
  *)       DEST="AGENTS.md";                        SRC="skill-lite/AGENTS.md" ;;   # codex / generic
esac
mkdir -p "$(dirname "$DEST")"
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/$SRC" ]; then
  cp "$SELF_DIR/$SRC" "$DEST"
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BASE/$SRC" -o "$DEST" || echo "create-palate: could not fetch $SRC; add it manually from $BASE/$SRC" >&2
fi

# 3. The gate as a committed pre-push hook (the un-skippable floor; version-controlled).
mkdir -p .palate/git-hooks
cat > .palate/git-hooks/pre-push <<HOOK
#!/usr/bin/env bash
# Palate gate: block a push if the build is freestyle (not Astro) or slop. Override: git push --no-verify
echo "palate: running the gate (palate-verify) before push..." >&2
curl -fsSL ${BASE}/scripts/palate-verify.sh | bash -s -- . || {
  echo "palate: gate failed. Fix the findings above, or 'git push --no-verify' to override." >&2
  exit 1
}
HOOK
chmod +x .palate/git-hooks/pre-push

# 4. CI: the same gate on every PR (tool-agnostic enforcement that the model cannot skip).
mkdir -p .github/workflows
cat > .github/workflows/palate.yml <<CI
name: Palate gate
on:
  pull_request:
    branches: [main]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --no-audit --no-fund
      - name: palate-verify
        run: curl -fsSL ${BASE}/scripts/palate-verify.sh | bash -s -- .
CI

# 5. Git init + wire the committed hook via core.hooksPath (survives a re-clone once set).
if command -v git >/dev/null 2>&1; then
  [ -d .git ] || git init -q
  git config core.hooksPath .palate/git-hooks
fi

echo >&2
echo "create-palate: done -> $DIR" >&2
echo "  next:  cd $DIR && npm install" >&2
echo "  read:  $DEST  (the Palate doctrine + runbook) - survey the MCP, DIVERGE, then build in src/pages" >&2
echo "  gate:  the pre-push hook + CI run palate-verify automatically; run it any time with" >&2
echo "         curl -fsSL ${BASE}/scripts/palate-verify.sh | bash -s -- ." >&2
