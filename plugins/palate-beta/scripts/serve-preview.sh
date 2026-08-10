#!/usr/bin/env bash
# Start a preview server for a scaffolded site and print a working local URL.
# Delivers the link instead of telling the person to run commands themselves.
#
# The site is SSR (Astro server output on the Cloudflare adapter), so a plain
# static file server cannot serve it. Two modes (auto-picked):
#   dev   - `npm run dev` (Astro dev server, full SSR + hot-reload). Default.
#   built - `npm run build` then `npm run preview` (wrangler dev runs the built
#           worker). Fallback - production-parity, no hot reload.
#
# Starts the server in the BACKGROUND, captures the URL it prints, polls until
# it actually responds, then prints SERVE_URL=... and leaves the server running.
# Usage: serve-preview.sh [project-dir] [--built]   (--static accepted as alias)
set -euo pipefail
PROJ="${1:-.}"
MODE="dev"
for a in "$@"; do case "$a" in --built|--static) MODE="built";; esac; done
cd "$PROJ"

[ -f package.json ] || { echo "SERVE_FAIL: no package.json in $PROJ (not a scaffolded site)" >&2; exit 1; }
LOG=".palate-devserver.log"
PIDFILE=".palate-devserver.pid"

# If a previous server is recorded and alive, reuse it.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  url=$(grep -oE 'https?://(localhost|127\.0\.0\.1):[0-9]+' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "$url" ] && { echo "SERVE_URL=$url"; echo "SERVE_PID=$(cat "$PIDFILE")"; echo "(reused already-running server)"; exit 0; }
fi

# Kill a leaked dev server by what is actually listening, not by name.
#
# THERE IS NO `astro dev stop`. This script used to call it, and so did both CI
# workflows and two reference docs. Astro 7.2.0's supported commands are add,
# sync, telemetry, preferences, dev, build, preview, check, create-key, docs and
# info, read out of its own CLI source. The extra positional is ignored, so
# `npx astro dev stop` STARTS a dev server. In a `trap cleanup EXIT` that means
# the job never exits: it hung CI to the six-hour timeout on every run, pass or
# fail, and `|| true` cannot help a process that never returns.
#
# Killing the recorded PID alone is not enough either: it is npm's wrapper, and
# astro survives it. So kill the whole process group, then anything still bound
# to the port.
kill_dev() {
  if [ -f "$PIDFILE" ]; then
    local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  # The lock is held by whatever is listening, whoever started it.
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"${PORT:-4321}" 2>/dev/null | xargs -r kill 2>/dev/null || true
  fi
}

start_dev() {
  # Astro 7 keeps a dev-server LOCK. If a previous run leaked a server, the next
  # `astro dev` REFUSES to start and prints "Dev server already running at
  # <url>", which the URL scrape below would otherwise hand over as if it were
  # this build. On Astro 6 it just picked a free port. So clear the lock first.
  kill_dev
  ( npm run dev > "$LOG" 2>&1 & echo $! > "$PIDFILE" )
}
start_built() {
  # SSR site: build it, then run the built worker with wrangler dev (npm run
  # preview). A static file server cannot run server-rendered pages.
  [ -d dist ] || npm run build > "$LOG" 2>&1
  ( npm run preview > "$LOG" 2>&1 & echo $! > "$PIDFILE" )
}

echo "starting preview server (${MODE})..."
if [ "$MODE" = "dev" ]; then start_dev; else start_built; fi

# Poll up to ~20s for a URL in the log, then confirm it responds.
url=""
for i in $(seq 1 40); do
  url=$(grep -oE 'https?://(localhost|127\.0\.0\.1):[0-9]+' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "$url" ] && break
  # If the process died, surface the log and fail
  if [ -f "$PIDFILE" ] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "SERVE_FAIL: server exited. Last log lines:" >&2; tail -5 "$LOG" >&2
    # If dev failed, try the built worker once as a fallback
    if [ "$MODE" = "dev" ]; then echo "falling back to built worker (wrangler dev)..." >&2; MODE=built; start_built; else exit 1; fi
  fi
  sleep 0.5
done
[ -n "$url" ] || { echo "SERVE_FAIL: no URL appeared in log within timeout" >&2; tail -8 "$LOG" >&2; exit 1; }

# Belt and braces: never hand over a URL that came from Astro's "already
# running" notice rather than from a server this script started.
if grep -qi "already running" "$LOG" 2>/dev/null; then
  echo "SERVE_FAIL: an existing Astro dev server holds the lock; $url is NOT this build." >&2
  echo "  Clear it and re-run:  (cd $PROJ && lsof -ti tcp:${PORT:-4321} | xargs kill)" >&2
  exit 1
fi

# Confirm it actually responds before handing it over
code="000"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break
  sleep 0.5
done

echo "SERVE_URL=$url"
echo "SERVE_PID=$(cat "$PIDFILE")"
echo "SERVE_HTTP=$code"
[ "$code" = "200" ] && echo "preview is live and responding at $url" || echo "started at $url (HTTP $code; give it a moment to finish booting)"
if [ "$MODE" = "dev" ]; then
  # `kill` on the recorded PID hits npm's wrapper and can leave astro running,
  # so stop the group and then whatever still holds the port.
  echo "to stop later: (cd $PROJ && kill -- -\$(cat $PIDFILE) 2>/dev/null; lsof -ti tcp:${PORT:-4321} | xargs kill)"
else
  echo "to stop later: kill \$(cat $PROJ/$PIDFILE)"
fi
