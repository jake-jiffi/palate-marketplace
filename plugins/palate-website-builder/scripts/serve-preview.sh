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

start_dev() {
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
echo "to stop later: kill \$(cat $PROJ/$PIDFILE)"
