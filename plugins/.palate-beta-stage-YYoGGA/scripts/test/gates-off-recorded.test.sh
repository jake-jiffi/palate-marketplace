#!/usr/bin/env bash
# PALATE_GATE_OFF=1 is RECORDED, never silent.
#
# THE FAULT THIS PINS. Both hooks read the variable as their very first act and exited before
# touching anything, so a build run with every gate disabled left no trace at all. Weeks later
# the manifest, the check report and the local grade all read exactly like a build that had been
# gated and passed. The bypass is legitimate and stays; it just has to be on the record.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
STOP="$DIR/../../hooks/palate-stop.mjs"
PRE="$DIR/../../hooks/palate-pretooluse.mjs"
pass=0; fail=0

want() { # <desc> <file> <needle>
  if [ -f "$2" ] && grep -qF "$3" "$2"; then echo "ok   - $1"; pass=$((pass+1));
  else echo "FAIL - $1 (no '$3' in $2)"; fail=$((fail+1)); fi
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- the Stop hook ------------------------------------------------------------------
# HOME is redirected: this path now appends to the cross-build log, and a test must not write
# into the operator's real one.
HOME_DIR="$TMP/home"; mkdir -p "$HOME_DIR"
LOG="$HOME_DIR/.config/palate/builds.log.json"

S="$TMP/stop"; mkdir -p "$S"
cp "$DIR/fixtures/manifest-deep.json" "$S/build-manifest.json"
printf '{"hook_event_name":"Stop","cwd":"%s"}' "$S" \
  | env PALATE_GATE_OFF=1 HOME="$HOME_DIR" node "$STOP" >/dev/null 2>&1
want "the Stop hook records gates-off in the manifest" "$S/build-manifest.json" '"state": "off"'
want "and stamps when"                                 "$S/build-manifest.json" '"at":'

# --- the PreToolUse hook ------------------------------------------------------------
W="$TMP/write"; mkdir -p "$W/src/pages"
cp "$DIR/fixtures/manifest-deep.json" "$W/build-manifest.json"
printf '{"hook_event_name":"PreToolUse","cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
  "$W" "$W/src/pages/index.astro" \
  | env PALATE_GATE_OFF=1 HOME="$HOME_DIR" node "$PRE" >/dev/null 2>&1
want "the PreToolUse hook records gates-off in the manifest" "$W/build-manifest.json" '"state": "off"'

# AND IT MUST NOT APPEND A LOG ENTRY. The write wall fires on every matched tool call, so an
# entry per Write would put thousands into cross-build memory for one build.
entries_after="$(node -e '
try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length); }
catch { console.log("0"); }' "$LOG" 2>/dev/null)"
if [ "$entries_after" = "1" ]; then
  echo "ok   - the write wall adds no build-log entry of its own"; pass=$((pass+1))
else
  echo "FAIL - the write wall adds no build-log entry of its own (log has $entries_after)"; fail=$((fail+1))
fi

# --- THE BUILD LOG IS WRITTEN ON THE PATH THAT ACTUALLY HAPPENS ----------------------
# The stamp reached the manifest, and the log entry only ever arrived through a LATER gated
# Stop on the same build. An operator who sets the variable for a session and never runs a
# gated Stop, which is the ordinary way it is used, left no trace in cross-build memory at all.
if [ -f "$LOG" ]; then
  echo "ok   - the gates-off Stop writes a build-log entry"; pass=$((pass+1))
else
  echo "FAIL - the gates-off Stop writes a build-log entry (no $LOG)"; fail=$((fail+1))
fi
logged="$(node -e '
try {
  const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const last = e[e.length - 1] || {};
  console.log(JSON.stringify({ n: e.length, gates_off: last.gates_off === true, ts: typeof last.ts === "string", donors: Array.isArray(last.donors) }));
} catch { console.log("{}"); }' "$LOG" 2>/dev/null)"
if printf '%s' "$logged" | grep -qF '"gates_off":true'; then
  echo "ok   - and the entry says the gates were off"; pass=$((pass+1))
else
  echo "FAIL - and the entry says the gates were off (got: $logged)"; fail=$((fail+1))
fi
if printf '%s' "$logged" | grep -qF '"ts":true'; then
  echo "ok   - and it is stamped"; pass=$((pass+1))
else
  echo "FAIL - and it is stamped (got: $logged)"; fail=$((fail+1))
fi
# MINIMAL, deliberately: gate-novelty reads these entries to judge later builds, and an
# ungated build must not certify a future one as different from it.
if printf '%s' "$logged" | grep -qF '"donors":false'; then
  echo "ok   - and it is minimal, carrying no donors for the novelty gate to read"; pass=$((pass+1))
else
  echo "FAIL - and it is minimal, carrying no donors (got: $logged)"; fail=$((fail+1))
fi

# --- ONCE PER BUILD, NOT ONCE PER STOP ------------------------------------------------
# A session that keeps the variable set appends one entry per turn otherwise, and the second
# entry says nothing the first did not: the manifest already carries the stamp by then.
printf '{"hook_event_name":"Stop","cwd":"%s"}' "$S" \
  | env PALATE_GATE_OFF=1 HOME="$HOME_DIR" node "$STOP" >/dev/null 2>&1
printf '{"hook_event_name":"Stop","cwd":"%s"}' "$S" \
  | env PALATE_GATE_OFF=1 HOME="$HOME_DIR" node "$STOP" >/dev/null 2>&1
n_after="$(node -e '
try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length); }
catch { console.log("0"); }' "$LOG" 2>/dev/null)"
if [ "$n_after" = "1" ]; then
  echo "ok   - three gates-off Stops on one build leave one entry"; pass=$((pass+1))
else
  echo "FAIL - three gates-off Stops on one build leave one entry (log has $n_after)"; fail=$((fail+1))
fi

# --- AND NOT AT ALL WHEN NO SOURCE WAS WRITTEN ----------------------------------------
# The gated path exits on !wroteSource before it records anything. A bypass must not record
# more than the gate it bypassed, or standing near any stale manifest logs a build that is not
# happening.
NOSRC="$TMP/no-source"; mkdir -p "$NOSRC"
printf '{"schema":3,"mcp_calls":[],"files_written":[]}' > "$NOSRC/build-manifest.json"
printf '{"hook_event_name":"Stop","cwd":"%s"}' "$NOSRC" \
  | env PALATE_GATE_OFF=1 HOME="$HOME_DIR" node "$STOP" >/dev/null 2>&1
n_nosrc="$(node -e '
try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length); }
catch { console.log("0"); }' "$LOG" 2>/dev/null)"
if [ "$n_nosrc" = "1" ]; then
  echo "ok   - a manifest with no source written logs nothing"; pass=$((pass+1))
else
  echo "FAIL - a manifest with no source written logs nothing (log has $n_nosrc)"; fail=$((fail+1))
fi

# --- and it travels to the cross-build log entry -------------------------------------
entry="$(node -e '
import("'"$DIR"'/../../hooks/build-log-entry.mjs").then((m) => {
  const e = m.buildLogEntry({ gates: { state: "off", at: "2026-09-09T00:00:00.000Z" } }, []);
  console.log(JSON.stringify(e));
});
')"
if printf '%s' "$entry" | grep -qF '"gates_off":true'; then
  echo "ok   - the build log entry carries gates_off"; pass=$((pass+1))
else
  echo "FAIL - the build log entry carries gates_off (got: $entry)"; fail=$((fail+1))
fi

# A gated build must NOT carry the flag, or the field means nothing.
entry2="$(node -e '
import("'"$DIR"'/../../hooks/build-log-entry.mjs").then((m) => {
  console.log(JSON.stringify(m.buildLogEntry({}, [])));
});
')"
if printf '%s' "$entry2" | grep -qF 'gates_off'; then
  echo "FAIL - a gated build must not carry gates_off (got: $entry2)"; fail=$((fail+1))
else
  echo "ok   - a gated build carries no gates_off"; pass=$((pass+1))
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
