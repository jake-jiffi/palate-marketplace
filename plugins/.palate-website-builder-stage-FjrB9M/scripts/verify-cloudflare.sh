#!/usr/bin/env bash
# Verify Phase C: workers.dev returns 200, and the contact form reaches its endpoint.
# Usage: verify-cloudflare.sh <workers-dev-url>
#
# The form round trip is a separate script so both hosts run the same request; see
# verify-form-roundtrip.sh for why posting to a live site is safe. A deployment with no
# contact endpoint SKIPS that half with a printed reason and still passes, because a brochure
# site has not failed by having no form.
set -uo pipefail
URL="${1:?workers.dev url}"
HERE="$(cd "$(dirname "$0")" && pwd)"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL" || echo "000")
[ "$code" = "200" ] || { echo "FAIL: $URL returned $code"; exit 1; }

bash "$HERE/verify-form-roundtrip.sh" "$URL"; form=$?
# 0 is a pass and 2 is a printed skip. EVERYTHING ELSE FAILS, including 126 and 127. `[ $form
# -eq 1 ] && exit 1` passed a round trip that was missing, non-executable, or died before
# reaching any of its own branches, so the deploy verifier printed OK having inspected nothing:
# the exists-but-never-fires class this epic exists to close, undone silently.
case "$form" in
  0|2) ;;
  1) echo "FAIL: the contact form round trip failed (see above)" >&2; exit 1 ;;
  *) echo "FAIL: the contact form round trip exited $form without reaching a verdict, so the form is UNCHECKED. Is scripts/verify-form-roundtrip.sh present and executable?" >&2; exit 1 ;;
esac
echo "CLOUDFLARE_OK"
