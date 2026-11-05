#!/usr/bin/env bash
# A FAILED CAPTURE EXITS NON-ZERO AND SAYS SO IN ITS OWN MANIFEST.
#
# THE FAULT THIS PINS. screenshot-build.mjs exited 0 on every path, including a browser that
# never launched, under a comment reading "never wedge a build over a screenshot". The caller
# therefore could not tell a capture from a crash, and the PNGs from the PREVIOUS run were still
# sitting in the output directory, so the done gate counted them and called the visual loop
# evidenced. A capture that did not happen must not be able to satisfy the shot-count test.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SHOOTER="$DIR/../reference-capture/screenshot-build.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# No browser is installed at that path, so chromium.launch throws before anything is captured.
# It is the launch branch on purpose: it needs no server and no browser, so this stays fast.
out="$(env PLAYWRIGHT_BROWSERS_PATH="$TMP/no-browsers" \
  node "$SHOOTER" --url "http://127.0.0.1:1/" --out "$TMP/shots" 2>&1)"; rc=$?

if [ "$rc" -eq 1 ]; then echo "ok   - a failed launch exits 1"; pass=$((pass+1));
else echo "FAIL - a failed launch exits 1 (got $rc)"; fail=$((fail+1)); fi

m="$TMP/shots/manifest.json"
if [ -f "$m" ] && grep -qF '"status": "failed"' "$m"; then
  echo "ok   - and the shots manifest records status failed"; pass=$((pass+1))
else
  echo "FAIL - and the shots manifest records status failed (got: $(cat "$m" 2>/dev/null | head -8))"; fail=$((fail+1))
fi
if [ -f "$m" ] && grep -qF '"error":' "$m"; then
  echo "ok   - and carries the reason"; pass=$((pass+1))
else
  echo "FAIL - and carries the reason"; fail=$((fail+1))
fi

# --- THE INCREMENTAL RECORD SURVIVES A CAPTURE ---------------------------------------
# Three scripts write into one manifest.json. verify-rendered.mjs owns `routes`,
# `globalInputs` and `sweep`; this driver owns `status`, the shots and the console-error
# count. It carries the other three forward explicitly, and nothing pinned that. Dropping
# `sweep` would take gate-done's summary from "last sweep PARTIAL, 3 of 12" back to saying
# nothing at all, which is the blind spot the field exists to close, reopened by the
# neighbouring script.
inc="$TMP/inc"; mkdir -p "$inc"
cat > "$inc/manifest.json" <<'JSON'
{
  "status": "captured",
  "routes": { "/": { "sourcesHash": "abc", "renderedHash": "def", "passed_at": "2026-09-09T00:00:00.000Z" } },
  "globalInputs": "cafebabe",
  "sweep": { "full": false, "selected": 12, "rendered": 3, "skipped": 9, "narrowed": null, "over_cap": 0, "at": "2026-09-09T00:00:00.000Z" }
}
JSON
env PLAYWRIGHT_BROWSERS_PATH="$TMP/no-browsers" \
  node "$SHOOTER" --url "http://127.0.0.1:1/" --out "$inc" >/dev/null 2>&1
carried="$(node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const bits = [];
if (m.routes && m.routes["/"] && m.routes["/"].sourcesHash === "abc") bits.push("routes");
if (m.globalInputs === "cafebabe") bits.push("globalInputs");
if (m.sweep && m.sweep.rendered === 3 && m.sweep.selected === 12) bits.push("sweep");
process.stdout.write(bits.join(","));
' "$inc/manifest.json" 2>/dev/null)"
for field in routes globalInputs sweep; do
  case ",$carried," in
    *",$field,"*) echo "ok   - a capture carries the incremental $field forward"; pass=$((pass+1)) ;;
    *) echo "FAIL - a capture carries the incremental $field forward (carried: ${carried:-none})"; fail=$((fail+1)) ;;
  esac
done

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
