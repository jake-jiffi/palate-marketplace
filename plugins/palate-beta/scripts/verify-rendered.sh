#!/usr/bin/env bash
# verify-rendered.sh - the rendered, multi-viewport, real-motion gate for a BUILT site.
#
# Loads a running preview (the serve-preview.sh local dev link or the
# deploy-preview.sh Vercel URL) in a real browser at phone / tablet / desktop and
# asserts what only shows up when it RENDERS. It is the rendered counterpart to
# ux-lint.sh (mechanical, reads code) and the visual loop / reviewer pass
# (interpretive). It extends the rendered gate (overflow / console / blank /
# focus ring / 404) with the BOLD-build bug-class checks from
# references/rendered-bug-classes.md:
#   (a) no-JS / LCP-is-never-a-canvas - the hero shows a finished static state with
#       JS disabled (no JS-dismissed preloader covering it, no blank canvas);
#   (b) motion-ON reveal reaches the finished state - a REAL wheel scroll (JS on,
#       motion on) leaves 0 sections stuck at opacity:0 (reduced-motion masks this);
#   (c) pinned scenes RELEASE - a pinned hero element does not overprint the footer;
#   (f) heavy WebGL degrades on mobile - no above-the-fold <canvas> at 390.
# (Bug-classes (d) mid-word heading and (e) eyebrow creep are caught by ux-lint.sh.)
#
# With --out set it also writes an ordered scroll-through filmstrip for the home route at
# mobile + desktop (<out>/filmstrip/<vp>-NN.png) for the verifier's motion-choreography read.
#
# Usage:
#   scripts/verify-rendered.sh <base-url> [--routes /,/contact,/blog] [--out <dir>]
#
# Exit codes:
#   0  clean        1  findings at or above High        2  bad args
#   3  no browser available - the gate is BLOCKED; surface it, never pass.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/reference-capture"

URL="${1:-}"
[ -z "$URL" ] && { echo "verify-rendered: usage: verify-rendered.sh <base-url> [--routes a,b] [--out dir]" >&2; exit 2; }
shift

command -v node >/dev/null 2>&1 || { echo "verify-rendered: node is required" >&2; exit 2; }

# Reuse the capture engine's Playwright runtime; install it once if absent.
if [ ! -d "$ENGINE/node_modules/playwright" ]; then
  echo "verify-rendered: installing the browser runtime (one-off, via reference-capture/setup.sh)..." >&2
  bash "$ENGINE/setup.sh" >&2 || { echo "verify-rendered: browser runtime unavailable - gate BLOCKED, not passed." >&2; exit 3; }
fi

node "$ENGINE/verify-rendered.mjs" --url "$URL" "$@"
