#!/usr/bin/env bash
# Tests scripts/bootstrap.sh (the portable anti-slop floor) via its LOCAL path - no network.
# bootstrap.sh sits beside ux-lint.sh, so a checkout resolves the sibling gates and runs
# them over a fixture. Asserts: bad fixture -> exit 1 (blocks), good -> exit 0 (clean),
# strict tightens the bar, and the script is valid bash.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BOOT="$DIR/../bootstrap.sh"
FIX="$DIR/fixtures/uxlint"
pass=0; fail=0

check() { # <desc> <want-rc> <cmd...>
  local desc="$1" want="$2"; shift 2
  "$@" >/dev/null 2>&1; local rc=$?
  if [ "$rc" -eq "$want" ]; then echo "ok   - $desc (rc=$rc)"; pass=$((pass + 1));
  else echo "FAIL - $desc (rc=$rc, want $want)"; fail=$((fail + 1)); fi
}

# 1. Syntax: the script must parse (it is curl|bash'd by strangers).
check "bootstrap.sh is valid bash"            0 bash -n "$BOOT"
# 2. Local path resolves the sibling gates and gates a real build.
check "bad fixture exits 1 (blocks the ship)" 1 bash "$BOOT" "$FIX/bad"
check "good fixture exits 0 (clean)"          0 bash "$BOOT" "$FIX/good"
# 3. Strict tightens the floor without breaking a clean build.
check "good fixture clean under strict"       0 env PALATE_GATE_STRICT=1 bash "$BOOT" "$FIX/good"
# 4. A missing target is an internal error (2), passed through from ux-lint.
check "missing dir is an internal error (2)"  2 bash "$BOOT" "$FIX/does-not-exist"

echo "----"
echo "palate-check.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
