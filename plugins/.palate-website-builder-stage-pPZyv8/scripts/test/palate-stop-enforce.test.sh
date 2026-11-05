#!/usr/bin/env bash
# Tests the ENFORCE-ON-EVIDENCE layer in hooks/palate-stop.mjs: it BLOCKS by default when
# there is positive on-disk evidence of a real failure (console errors, page/section
# overflow, verdict:fail), and does NOT block on a clean build or when the artefacts are
# ABSENT (could-not-verify must never be a false trap). Default config (no STRICT/OFF).
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$DIR/../hooks/palate-stop.mjs"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
mk() { local d="$T/$1"; rm -rf "$d"; mkdir -p "$d/.palate-shots"; printf '{"files_written":["src/pages/index.astro"]}' > "$d/build-manifest.json"; [ -n "${2:-}" ] && printf '%s' "$2" > "$d/.palate-shots/manifest.json"; [ -n "${3:-}" ] && printf '%s' "$3" > "$d/verify-report.json"; [ -n "${4:-}" ] && printf '%s' "$4" > "$d/.palate-shots/interaction.json"; true; }
blocks() { echo "{\"cwd\":\"$T/$1\"}" | node "$HOOK" 2>/dev/null | grep -q '"decision":"block"'; }
want() { local desc="$1" name="$2" expect="$3"; if blocks "$name"; then got=BLOCK; else got=allow; fi; if [ "$got" = "$expect" ]; then echo "ok   - $desc ($got)"; pass=$((pass+1)); else echo "FAIL - $desc (got $got want $expect)"; fail=$((fail+1)); fi; }

mk clean    '{"console_errors":0,"overflow":{"desktop":0},"sections":[{"sid":"hero","viewport":"desktop","overflow":0}]}' '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0}}'
mk console  '{"console_errors":2,"overflow":{"desktop":0},"sections":[]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":2}}'
mk overflow '{"console_errors":0,"overflow":{"mobile":40},"sections":[{"sid":"hero","viewport":"mobile","overflow":40}]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}'
mk secnoise '{"console_errors":0,"overflow":{"desktop":0,"mobile":0},"sections":[{"sid":"hero","viewport":"mobile","overflow":30}]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}'
mk subpx    '{"console_errors":0,"overflow":{"desktop":8},"sections":[{"sid":"hero","viewport":"desktop","overflow":8}]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}'
mk vfail    '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' '{"verdict":"fail","visual":{"pass":false,"console_errors":0}}'
mk ixfail   '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}' '{"interaction_failures":[{"route":"/","vp":"desktop","msg":"hover on nav trigger changes nothing"}]}'
mk ixempty  '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}' '{"interaction_failures":[]}'
mk absent   '' ''

want "clean build is allowed (no false block)"             clean    allow
want "console errors block by default"                     console  BLOCK
want "real PAGE overflow blocks by default"                overflow BLOCK
want "sub-threshold page overflow (<=16px) does not block" subpx    allow
want "noisy section overflow + clean page does NOT block"  secnoise allow
want "verifier verdict:fail blocks by default"             vfail    BLOCK
want "interaction-state failure blocks by default"         ixfail   BLOCK
want "empty interaction_failures does NOT block"           ixempty  allow
want "absent artefacts do NOT block (could-not-verify)"    absent   allow

echo "----"; echo "palate-stop-enforce.test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
