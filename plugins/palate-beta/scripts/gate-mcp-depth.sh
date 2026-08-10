#!/usr/bin/env bash
# scripts/gate-mcp-depth.sh - the portable MCP-depth gate.
#
# Reads build-manifest.json (real tool telemetry, not the agent's narration) and
# fails closed if the build did not actually draw on the library. This is the
# source of truth; the Pre/Stop hooks are thin wrappers that call it, and it runs
# anywhere (CI, pre-commit, Cursor) on its own.
#
# Exit 0 = pass, 2 = block (with a specific, actionable reason on stderr),
# 3 = UNGROUNDED (the third state, see below).
#
# THE THIRD STATE. Exit 3 means the gate RAN, the manifest parsed, and it recorded ZERO
# Palate MCP calls: the build carries no taste layer. That is NOT a failure and it must
# NEVER block. It is a LABEL, so that absence is visible instead of silent - the old
# behaviour returned 0 here, which made an ungrounded build indistinguishable from a
# grounded one once it had finished. Callers MUST treat 3 as not-a-block (an exit-code
# check, not `if non-zero`) and surface it ONCE, never repeatedly.
#
# This script only DECIDES depth (0 pass / 2 block / 3 ungrounded). Whether a block is
# enforced is up to the caller: the Stop/PreToolUse hooks NUDGE by default and only
# hard-block when PALATE_GATE_STRICT=1. It also fails OPEN when it cannot be satisfied
# (see below), so it never traps a session. PALATE_GATE_OFF=1 disables the gate entirely.
# Thresholds overridable via env: PALATE_MIN_REFS, PALATE_MIN_INNER, PALATE_MIN_TOOLS,
# PALATE_MIN_RICH_LAYER. Raise them for a stricter bar.
set -euo pipefail

MANIFEST="${1:-build-manifest.json}"
MIN_REFS="${PALATE_MIN_REFS:-5}"
MIN_INNER="${PALATE_MIN_INNER:-2}"
MIN_TOOLS="${PALATE_MIN_TOOLS:-3}"
MIN_RICH="${PALATE_MIN_RICH_LAYER:-1}"

fail() { echo "MCP-depth gate FAILED: $1" >&2; exit 2; }
skip() { echo "MCP-depth gate skipped: $1"; exit 0; }
# UNGROUNDED goes to STDERR, unlike skip(): both hooks run this gate with stdout ignored
# and stderr piped, so a label written the way skip() writes it would reach nobody.
ungrounded() { echo "MCP-depth gate UNGROUNDED: $1" >&2; exit 3; }

# SKIP (exit 0) when there is genuinely NOTHING TO GATE: no jq to read the manifest with,
# no manifest at all, or a manifest that is not readable JSON. These are tooling and
# tracking gaps, not statements about the build, so they stay silent fail-open exactly as
# before. They are deliberately NOT the ungrounded case: labelling a missing-jq
# environment "ungrounded" would be wrong, and would hand the user a reconnect command
# that fixes nothing.
command -v jq >/dev/null 2>&1 || skip "jq is not installed; not gating."
[ -f "$MANIFEST" ] || skip "no $MANIFEST (no tracked build, or the Palate MCP is not in use)."
jq -e . "$MANIFEST" >/dev/null 2>&1 || skip "$MANIFEST is not readable JSON; not gating."

# UNGROUNDED (exit 3): the manifest IS readable and it recorded zero Palate MCP calls.
# The build ran without the taste layer. Say it ONCE, factually, with the one command
# that fixes it, and do not block: the plugin favours the MCP, it does not die without it.
mcpcalls=$(jq '((.mcp_calls // []) | length)' "$MANIFEST" 2>/dev/null || echo 0)
[ "${mcpcalls:-0}" -ge 1 ] || ungrounded "no Palate MCP calls recorded, so this build carries no Palate taste layer (the MCP is not connected or was renamed, or the survey ran in a subagent whose calls never reached this manifest). Connect it with: claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp"

refs=$(jq '(.references_surveyed // []) | unique | length' "$MANIFEST")
inner=$(jq '(.inner_pages_viewed // []) | length' "$MANIFEST")
tools=$(jq '[(.mcp_calls // [])[].tool] | unique | length' "$MANIFEST")
deepread=$(jq '[(.mcp_calls // [])[] | select(.tool=="mcp__palate__refs_get")] | length' "$MANIFEST")
# R2 rich-layer depth: refs_get calls that pulled a real craft/taste layer (not just
# concept or a card). Derived from the call args (source of truth), so it works on
# any manifest schema. format:"design" counts as the 'design' layer.
# The rich layers are the taste/craft depth that stops generic output:
# signature_moves, do_dont, component_prompts, the design DESIGN.md (tokens WITH the
# why), and pages (inner-page anatomy). Raw tokens (numbers only), concept and
# astro_recipe do NOT count - a token-only read is the shallow case this closes.
rich=$(jq '[(.mcp_calls // [])[] | select(.tool=="mcp__palate__refs_get")
  | [ (.args.layer // []), (if .args.format=="design" then ["design"] else [] end) ] | flatten[]
  | select(. == "signature_moves" or . == "do_dont" or . == "component_prompts"
        or . == "design" or . == "pages")] | length' "$MANIFEST")

[ "$refs" -ge "$MIN_REFS" ] || fail "Narrow retrieval: $refs reference(s) surveyed, the gate needs $MIN_REFS. Run the palate-surveyor subagent, or call refs_search across more verticals."
[ "$deepread" -ge 1 ] || fail "Shallow read: no refs_get call. You looked at cards but never read a reference deeply. refs_get your backbone and donors."
[ "$rich" -ge "$MIN_RICH" ] || fail "Token-thin read: $rich refs_get call(s) pulled a taste/craft layer, the gate needs $MIN_RICH. You read references but only took the surface (cards / raw tokens / concept) - never the depth that stops output looking generic. Pull layer:\"do_dont\" + layer:\"component_prompts\" + layer:\"signature_moves\" (or format:\"design\", or layer:\"pages\") on your donors."
[ "$inner" -ge "$MIN_INNER" ] || fail "Thin inner-page coverage: $inner inner page(s) viewed, the gate needs $MIN_INNER. refs_get_screenshot the pricing/menu/booking pages of your donors."
[ "$tools" -ge "$MIN_TOOLS" ] || fail "Narrow tool use: only $tools palate tool(s) used, the gate needs $MIN_TOOLS (e.g. refs_search + refs_get + refs_get_screenshot/refs_similar)."

# Soft check: if the agent declared a signature move, its source must have been fetched.
sigslug=$(jq -r '.signature_move.source_slug // empty' "$MANIFEST")
if [ -n "$sigslug" ]; then
  jq -e --arg s "$sigslug" '(.references_surveyed // []) | index($s)' "$MANIFEST" >/dev/null 2>&1 \
    || fail "Signature move source '$sigslug' was never fetched (not in references_surveyed). Fetch it before building on it."
fi

echo "MCP-depth gate passed: $refs refs surveyed, $inner inner page(s), $tools palate tool(s), $deepread deep read(s), $rich rich-layer read(s)."
exit 0
