#!/usr/bin/env bash
# scripts/lib/gate-protocol.sh - ONE predicate for "what did that gate just say".
#
# THE FAULT THIS CLOSES. gate-done.sh runs eleven sub-gates and used to carry a bespoke parser
# for each, matching five different spellings of "I skipped":
#
#   seo, shipready, explore, fidelity, facts   exit 2, stderr `gate-<name>: skipped (<reason>)`
#   uniqueness                                 exit 2, stderr `uniqueness gate: skipped (...)`
#   novelty                                    exit 0, STDOUT `novelty gate skipped: <reason>`
#   customer-auth                              exit 0, stderr containing a fixed substring
#   headless                                   exit 2, reason discarded and hardcoded by the caller
#
# That has already been paid for once: an advisory line preceded gate-seo's verdict, the caller
# read the wrong one, and a failure surfaced as an empty string. Three more defects lived in the
# same place. The headless branch hardcoded "not a commerce build", so a real storefront with a
# corrupt catalogue was filed as a brochure site and sixty commerce checks were silently marked
# not applicable. Eight branches mapped an exit code the gate does not define to fail(), so a
# syntax error in gate-uniqueness.mjs printed "Boards are not distinct enough to show" over a
# Node stack trace, naming a property of boards nothing had looked at. And the reason a skip
# carries was cleaned three different ways across five branches, so one summary line could
# carry a 110-character absolute path mid-sentence and a neighbouring reason truncated mid-word.
#
# Every one of those is the caller guessing. So the guessing happens ONCE, here, and the table
# below is the only place the dialects are written down.
#
# THE CONTRACT a gate is expected to keep:
#   exit 0  pass          (stdout says how much it read)
#   exit 1  findings      (a real failure; the gate's own words are the verdict)
#   exit 2  cannot check  (stderr `gate-<name>: skipped (<reason>)`; never a pass)
#
# and the two documented exceptions, which are exceptions because changing them would break a
# different caller rather than because anybody prefers them:
#   gate-novelty        skips with exit 0, because scripts/eval-runner.mjs reads any non-zero
#                       from it as a novelty failure and would fail an eval on a skip.
#   gate-customer-auth  skips with exit 0 for the same reason: exit 2 from it means nothing to
#                       the run-time callers that ask it a yes/no question.
#
# AN UNEXPECTED EXIT IS A SKIP, NOT A VERDICT. hooks/palate-stop.mjs already states the rule for
# a missing bash: "A GATE THAT COULD NOT RUN IS NOT A GATE THAT FAILED." A gate that crashed
# measured nothing, so it cannot have an opinion about the site, and under PALATE_GATE_STRICT a
# crash used to block the stop with a sentence about the client's work.

# The reason a skip carries, cleaned exactly once for every gate.
#
# Three jobs: fold it onto one line, strip the absolute project path (gate-seo leads with the
# directory it looked in, which on a real machine is long enough to push the MEANING past the
# cap), and cap it. THE CAP LANDS ON A WORD BOUNDARY, because the previous one produced
# "...the index found no p…" in the line a person actually reads.
gate_reason_clean() { # <raw>
  local r="$1" proj="${PROJ:-}" cut
  r="${r//$'\n'/ }"
  r="${r//$'\r'/ }"
  if [ -n "$proj" ]; then
    r="${r//$proj\//}"
    r="${r//$proj/.}"
  fi
  # A trailing full stop is noise inside a semicolon-joined clause.
  r="${r%.}"
  if [ "${#r}" -gt 100 ]; then
    cut="${r:0:99}"
    case "$cut" in
      # Trim back to the last space, so the reader gets whole words. A single 99-character
      # token has no space to trim back to and is left alone rather than deleted.
      *' '*) cut="${cut% *}" ;;
    esac
    # BRACES ARE LOAD-BEARING. Bash reads `$cut…` as one identifier under `set -u` and the
    # caller dies with "cut...: unbound variable" instead of printing a summary.
    r="${cut}…"
  fi
  printf '%s' "$r"
}

# The gate's own name, however it spells it, removed from the front of its reason. Five gates
# spell it `gate-<name>:` and three spell it `<name> gate`, and repeating either inside
# `<name>: <reason>` in the summary reads as a stutter.
gate_strip_name() { # <name> <line>
  local name="$1" r="$2"
  r="${r#gate-$name: }"
  r="${r#$name gate skipped: }"
  r="${r#$name gate: skipped (}"
  r="${r#skipped (}"
  printf '%s' "$r"
}

# DID THE GATE SPEAK AT ALL?
#
# THIS IS THE PREDICATE THAT SEPARATES A VERDICT FROM A CRASH, and it is not the exit code.
# Node exits 1 on an unhandled exception, and 1 is also gate-shipready's, gate-seo's and
# gate-fidelity's documented "I found something" exit. So a SyntaxError in a gate, a missing
# import, or a module that throws at load all arrive wearing the same code as a real finding,
# and the caller printed "Boards are not distinct enough to show" over a Node stack trace.
# Nothing had looked at the boards.
#
# A gate that reached a verdict says so in its own voice, on its own line: `gate-<name>: ...`
# or `<name> gate ...`. Every failure path in every gate in this repo prints one. A stack trace
# prints none. ANCHORED TO THE START OF A LINE on purpose: an ERR_MODULE_NOT_FOUND message
# carries the failing script's PATH, so an unanchored match reads `.../gate-shipready.mjs` in
# the traceback as the gate having spoken, which is the same "keyed on location rather than
# behaviour" mistake this programme has now made four times.
gate_spoke() { # <name> <out>
  printf '%s' "$2" | grep -qiE "^(gate-$1: |$1 gate )"
}

# gate_classify <name> <exit-code> <combined-output>
#
# Sets, and nothing else:
#   GATE_VERDICT  pass | partial | skip | fail
#   GATE_REASON   the cleaned reason (skip and partial only; empty otherwise)
#
# The caller composes its own note and its own failure sentence, because the unit a gate
# reports (files, routes, pages, boards, variants) is properly its own.
gate_classify() { # <name> <rc> <out>
  local name="$1" rc="$2" out="$3"
  local first line marker="" mode raw=""
  GATE_VERDICT=""
  GATE_REASON=""
  first="${out%%$'\n'*}"

  # THE TABLE. `any2` means every exit 2 from this gate is a cannot-check; `marked2` means
  # exit 2 is a skip only when the marker is present and a BLOCK otherwise, because that gate
  # uses 2 for both; `marked0` is a gate that skips with exit 0.
  case "$name" in
    explore)       mode=marked2; marker="gate-explore: skipped (" ;;
    fidelity)      mode=marked2; marker="gate-fidelity: skipped (" ;;
    uniqueness)    mode=marked2; marker="uniqueness gate: skipped (" ;;
    novelty)       mode=marked0; marker="novelty gate skipped: " ;;
    customer-auth) mode=marked0; marker="no customer-account surface" ;;
    *)             mode=any2 ;;
  esac

  case "$rc" in
    0)
      if [ "$mode" = "marked0" ]; then
        case "$out" in
          *"$marker"*)
            GATE_VERDICT=skip
            # The MARKED line, not the first line: a gate may print a banner above it.
            raw=""
            while IFS= read -r line; do
              case "$line" in *"$marker"*) raw="$line" ;; esac
            done <<< "$out"
            [ -n "$raw" ] || raw="$first"
            GATE_REASON="$(gate_reason_clean "$(gate_strip_name "$name" "$raw")")"
            return 0 ;;
        esac
      fi
      GATE_VERDICT=pass
      return 0 ;;
    1)
      if gate_spoke "$name" "$out"; then GATE_VERDICT=fail; return 0; fi
      GATE_VERDICT=skip
      raw="$first"
      [ -n "$raw" ] || raw="no output"
      GATE_REASON="$(gate_reason_clean "gate-$name exited 1 without reaching a verdict, so nothing was measured: $raw")"
      return 0 ;;
    2)
      if [ "$mode" = "marked2" ]; then
        case "$out" in
          *"$marker"*)
            GATE_VERDICT=skip
            raw=""
            while IFS= read -r line; do
              case "$line" in *"$marker"*) raw="$line" ;; esac
            done <<< "$out"
            [ -n "$raw" ] || raw="$first"
            raw="$(gate_strip_name "$name" "$raw")"
            raw="${raw%%)*}"
            GATE_REASON="$(gate_reason_clean "$raw")"
            return 0 ;;
          *)
            if gate_spoke "$name" "$out"; then GATE_VERDICT=fail; return 0; fi
            GATE_VERDICT=skip
            raw="$first"
            [ -n "$raw" ] || raw="no output"
            GATE_REASON="$(gate_reason_clean "gate-$name exited 2 without reaching a verdict, so nothing was measured: $raw")"
            return 0 ;;
        esac
      fi
      # any2: the gate's OWN verdict line, which is the LAST one it printed with its own
      # prefix. An advisory precedes the verdict by construction on gate-seo, and taking the
      # first line summarised an unbuilt site as a config problem: the operator was sent to
      # change their host over a missing dist.
      #
      # Read with a here-string rather than a pipe: a pipeline into an early-exiting reader
      # SIGPIPEs the producer under pipefail, which this repo has already paid for once.
      raw=""
      while IFS= read -r line; do
        case "$line" in
          "gate-$name: "*) raw="${line#gate-$name: }" ;;
        esac
      done <<< "$out"
      [ -z "$raw" ] && raw="$first"
      # THE HEADER IS NOT THE FINDING. A cannot-check report can open with "N thing(s) could
      # NOT be checked. These are unknown, not clean." and name the actual unknown two lines
      # later, so the header alone drops the only part that says WHAT was not checked. Take
      # the first bracketed entry instead. Pure bash, no pipe: a pipeline into an
      # early-exiting reader SIGPIPEs the producer under pipefail.
      case "$raw" in
        *"could NOT be checked"*)
          while IFS= read -r line; do
            case "$line" in
              *\[*\]*) raw="${line#"${line%%\[*}"}"; break ;;
            esac
          done <<< "$out"
          ;;
      esac
      case "$raw" in
        "skipped ("*) raw="${raw#skipped (}"; raw="${raw%%)*}" ;;
      esac
      # A GATE THAT READ THE SITE IS NOT A GATE THAT DID NOT RUN. gate-seo reaches this exit
      # with three routes inspected and every one of them clean, because one dynamic route has
      # no publishable entry. Filed as a skip, that reads as "SEO was never checked", which is
      # the mirror image of the defect this suite exists to close.
      case "$raw" in
        "partial ("*)
          GATE_VERDICT=partial
          # Just the counts, so the caller can write `seo=partial (3 route(s) checked,
          # 1 unknown)` rather than repeating a sentence the summary has no room for.
          #
          # SPLIT ON `); `, NEVER ON THE FIRST `)`. The counts themselves say "route(s)", so
          # cutting at the first close paren produced `seo=partial (3 route(s` in the one line
          # a person reads.
          raw="${raw#partial (}"
          GATE_REASON="$(gate_reason_clean "${raw%%\); *}")"
          return 0 ;;
      esac
      GATE_VERDICT=skip
      [ -n "$raw" ] || raw="gate-$name exited 2 without a reason"
      GATE_REASON="$(gate_reason_clean "$raw")"
      return 0 ;;
    *)
      # I5: AN EXIT CODE THE GATE DOES NOT DEFINE. It crashed, was killed, or was not found.
      # Nothing about the site was measured, so nothing about the site may be claimed. The old
      # `*)` arms mapped this to fail(), so a syntax error in gate-uniqueness.mjs printed
      # "Boards are not distinct enough to show" over a Node stack trace.
      GATE_VERDICT=skip
      raw="$first"
      [ -n "$raw" ] || raw="no output"
      GATE_REASON="$(gate_reason_clean "gate-$name exited $rc and measured nothing: $raw")"
      return 0 ;;
  esac
}
