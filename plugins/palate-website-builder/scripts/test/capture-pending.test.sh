#!/usr/bin/env bash
# A KILLED CAPTURE LEAVES ITS OWN RECORD, not the previous run's.
#
# THE FAULT THIS PINS. screenshot-build.mjs built its manifest in memory and wrote it only on
# the launch-failure path or at the very end. A timeout, an OOM or a SIGKILL between those
# points reached neither, so .palate-shots/manifest.json still held the PREVIOUS run's
# status "captured" with that run's PNGs beside it, and the done gate counted them as evidence.
# That is the stale-evidence case the capture work was meant to close, surviving inside it, and
# it is the likeliest failure on a slow build: a real capture once took 195.9s on a 180s budget.
#
# The manifest is written before the browser starts, so the killed run reads "pending", which
# the done gate refuses.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SHOOTER="$DIR/../reference-capture/screenshot-build.mjs"
pass=0; fail=0

# Needs the capture engine's own playwright (scripts/reference-capture/node_modules), like the
# other browser-driven suites; skip loudly rather than fail if it is absent.
if ! node -e "require('$DIR/../reference-capture/node_modules/playwright')" 2>/dev/null; then
  echo "SKIP: playwright is not installed under scripts/reference-capture (run its setup.sh)"
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# JOB CONTROL, so the driver gets its OWN PROCESS GROUP and the kill below takes the browser
# with it. Killing the node process alone ORPHANS chromium: it is a child, it is mid-navigation
# on a page that never answers, and it keeps running. The first version of this test left
# sixteen chromium processes behind per run, which then starved the browser suites that run
# after it and made two of them fail in the full runner while passing standalone.
set -m

# A server that ACCEPTS and never answers, so the driver is still working when it is killed.
node -e 'require("net").createServer(() => {}).listen(0, "127.0.0.1", function () { console.log(this.address().port); })' > "$TMP/port" &
srv=$!
for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
PORT="$(cat "$TMP/port" | tr -d ' \n')"

node "$SHOOTER" --url "http://127.0.0.1:$PORT/" --out "$TMP/shots" >/dev/null 2>&1 &
shot=$!

# Poll for the manifest. It must appear WHILE the run is still going: with the write back at
# the end of main() this loop times out, because the driver is stuck on a page that never answers.
found=0
for _ in $(seq 1 100); do
  [ -f "$TMP/shots/manifest.json" ] && { found=1; break; }
  kill -0 "$shot" 2>/dev/null || break
  sleep 0.1
done
status="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)}catch{console.log("")}' "$TMP/shots/manifest.json" 2>/dev/null)"
# The GROUP (-pid), never the bare pid, or chromium survives its parent.
kill -9 -"$shot" 2>/dev/null || kill -9 "$shot" 2>/dev/null
wait "$shot" 2>/dev/null
kill -9 -"$srv" 2>/dev/null || kill -9 "$srv" 2>/dev/null
wait "$srv" 2>/dev/null

if [ "$found" = "1" ]; then echo "ok   - the manifest exists while the capture is still running"; pass=$((pass+1));
else echo "FAIL - the manifest exists while the capture is still running"; fail=$((fail+1)); fi
if [ "$status" = "pending" ]; then echo "ok   - and it reads status pending, not the last run's verdict"; pass=$((pass+1));
else echo "FAIL - and it reads status pending, not the last run's verdict (got '$status')"; fail=$((fail+1)); fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
