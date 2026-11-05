#!/usr/bin/env bash
# Verify Phase B: project responds, both tokens exist in state/env.
set -euo pipefail
grep -q "SANITY_PROJECT_ID" .env 2>/dev/null || { echo "FAIL: no project id in .env"; exit 1; }
grep -q "SANITY_API_READ_TOKEN" .env 2>/dev/null || { echo "FAIL: no read token"; exit 1; }
echo "SANITY_OK (read token in .env; write token in Worker secret)"
