#!/usr/bin/env bash
# scripts/ux-lint.sh - the deterministic aesthetic gate.
#
# Parses references/anti-patterns.md and runs each rule's PCRE pattern against
# the project files matching its `Files` glob. This is the aesthetic
# counterpart to verify-is-real-astro.sh (which is structural): a single hard
# gate that mechanically enforces house style, banned fonts / gradients, AI
# tells in copy, and the Vercel-derived code-level rules.
#
# Usage:
#   scripts/ux-lint.sh [project-dir]
#                      [--rules <file>]
#                      [--fail-on Critical|High|Medium|Cosmetic]   (default High)
#                      [--severity Critical|High|Medium|Cosmetic]  (display threshold, default Medium)
#                      [--mode always|variant-time|compose-time|production]
#                      [--disable rule-id,rule-id]
#                      [--ci]
#
# Exit codes:
#   0 - clean (no findings at or above --fail-on)
#   1 - findings at or above --fail-on
#   2 - could not check: bad args, missing rules, missing perl, or NOTHING TO INSPECT
#       (no file under the project matches any rule's Files glob). Never a pass.
#
# Per-line escape: add `ux-lint-disable <rule-id>` as a comment on the same or
# preceding line. `ux-lint-disable-all` skips every rule for that line.
#
# Rule format is documented in references/anti-patterns.md.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES_FILE="${SCRIPT_DIR}/../references/anti-patterns.md"
PROJECT_DIR="."
FAIL_ON="High"
SHOW_SEVERITY="Medium"
MODE_FILTER=""
DISABLED=""
CI=0

while [ $# -gt 0 ]; do
  case "$1" in
    --rules)    RULES_FILE="$2"; shift 2 ;;
    --fail-on)  FAIL_ON="$2"; shift 2 ;;
    --severity) SHOW_SEVERITY="$2"; shift 2 ;;
    --mode)     MODE_FILTER="$2"; shift 2 ;;
    --disable)  DISABLED="$2"; shift 2 ;;
    --ci)       CI=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "ux-lint: unknown flag $1" >&2; exit 2 ;;
    *)  PROJECT_DIR="$1"; shift ;;
  esac
done

[ -f "$RULES_FILE" ]  || { echo "ux-lint: rules not found at $RULES_FILE" >&2; exit 2; }
[ -d "$PROJECT_DIR" ] || { echo "ux-lint: project dir not found at $PROJECT_DIR" >&2; exit 2; }
command -v perl >/dev/null 2>&1 || { echo "ux-lint: perl is required" >&2; exit 2; }

# NEVER GRADE THE PLUGIN'S OWN FILES.
#
# DUPLICATED FROM hooks/project-dir.mjs ON PURPOSE, and it is the one duplication here that is
# not drift waiting to happen: bootstrap.sh curls this script ALONE into a cache directory, so
# it has no sibling to import and must carry the predicate itself. Three conditions, matching
# pluginRootRefusal(): the directory is CLAUDE_PLUGIN_ROOT, it sits inside it, or it carries
# .claude-plugin/plugin.json, on the directory itself or on any ancestor up to the git toplevel.
# A test that needs a fixture linted copies it to a temporary directory first.
palate_plugin_refusal() { # <dir> -> prints the reason and returns 0 when it must be refused
  local d
  d="$(cd "$1" 2>/dev/null && pwd)" || return 1
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    local root
    root="$(cd "$CLAUDE_PLUGIN_ROOT" 2>/dev/null && pwd)" || root=""
    if [ -n "$root" ]; then
      case "$d" in
        "$root") echo "$d is CLAUDE_PLUGIN_ROOT, the Palate plugin itself, not a site"; return 0 ;;
        "$root"/*) echo "$d is inside CLAUDE_PLUGIN_ROOT ($root), so it is part of the Palate plugin, not a site"; return 0 ;;
      esac
    fi
  fi
  # Ancestors too, bounded by the git toplevel: checking the candidate alone still let a gate
  # run inside scripts/test or templates/astro-project measure the plugin. `.git` is a
  # directory in a clone and a FILE in a worktree, so -e rather than -d.
  local cur="$d" i=0
  while [ "$i" -lt 12 ]; do
    if [ -f "$cur/.claude-plugin/plugin.json" ]; then
      if [ "$cur" = "$d" ]; then
        echo "$d carries .claude-plugin/plugin.json, so it is a Claude Code plugin checkout, not a site"
      else
        echo "$d is inside the Claude Code plugin checkout at $cur (.claude-plugin/plugin.json), not a site"
      fi
      return 0
    fi
    [ -e "$cur/.git" ] && break
    local parent; parent="$(dirname "$cur")"
    [ "$parent" = "$cur" ] && break
    cur="$parent"; i=$((i + 1))
  done
  return 1
}

if refusal="$(palate_plugin_refusal "$PROJECT_DIR")"; then
  echo "ux-lint: refused: $refusal. Name the site directory explicitly. NOT a pass." >&2
  echo "  (Run from the plugin checkout it read 314 of the plugin's own files and returned 179 findings: its doctrine QUOTES the tells this lint hunts.)" >&2
  exit 2
fi

severity_rank() {
  case "$1" in
    Critical) echo 4 ;;
    High)     echo 3 ;;
    Medium)   echo 2 ;;
    Cosmetic) echo 1 ;;
    *)        echo 0 ;;
  esac
}
FAIL_RANK=$(severity_rank "$FAIL_ON")
SHOW_RANK=$(severity_rank "$SHOW_SEVERITY")

# Parse the rules markdown into a TSV stream: id\tseverity\tmode\tfiles\tregex
parse_rules() {
  awk '
    function flush() {
      if (id != "" && sev != "" && files != "" && pat != "") {
        printf "%s\t%s\t%s\t%s\t%s\n", id, sev, mode, files, pat;
      }
      id=""; sev=""; mode=""; files=""; pat="";
    }
    BEGIN { id=""; sev=""; mode="always"; files=""; pat=""; }
    /^### Rule: / {
      flush();
      id = $0; sub(/^### Rule: /, "", id); gsub(/[[:space:]]+$/, "", id);
      mode = "always";
      next;
    }
    /^- Severity:/ { sev   = $0; sub(/^- Severity:[[:space:]]*/, "", sev);   gsub(/[[:space:]]+$/, "", sev);   next; }
    /^- Mode:/     { mode  = $0; sub(/^- Mode:[[:space:]]*/, "", mode);     gsub(/[[:space:]]+$/, "", mode);  next; }
    /^- Files:/    { files = $0; sub(/^- Files:[[:space:]]*/, "", files);   gsub(/[[:space:]]+$/, "", files); next; }
    /^- Pattern: `/ {
      pat = $0;
      sub(/^- Pattern: `/, "", pat);
      sub(/`[[:space:]]*$/, "", pat);
      next;
    }
    END { flush(); }
  ' "$RULES_FILE"
}

# For a comma-separated glob list, return matching project files.
list_files() {
  local globs_csv="$1"
  local proj="$2"
  IFS=',' read -ra globs <<< "$globs_csv"
  for g in "${globs[@]}"; do
    g="$(echo "$g" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$g" ] && continue
    if [[ "$g" == */* ]]; then
      local fglob="${g//\*\*/*}"
      find "$proj" -path "$proj/$fglob" -type f 2>/dev/null
    else
      find "$proj" -type f -name "$g" 2>/dev/null
    fi
  # .palate holds GENERATED artefacts: the flattened canvas seed, the archived board renders,
  # the crawl. They are machine output, not this build's source, and the flattened seed inlines
  # a whole Tailwind reset, so linting it reported thousands of findings about somebody else's
  # stylesheet and buried the real ones. Same reason dist and .astro are here.
  done | grep -v -E '/(node_modules|\.git|\.claude|\.palate|dist|\.astro|\.vercel|\.wrangler|\.output|_explore-archive)/' | sort -u
}

# Run one rule against one file via perl PCRE. Emits TSV: file\tline\tseverity\trule\ttext
#
# requires_reason (5th arg, default 0): for the JUSTIFY-OR-FLAG rules (the banned-display-*
# faces incl. the trendy-default faces and this skill's own reflex pairing
# Bricolage Grotesque + Hanken Grotesk, the raw untuned accent colours, gradient-overuse,
# decorative glassmorphism, the serif-italic-in-a-heading treatment and AI-washing copy),
# a `ux-lint-disable <rule>` directive only suppresses the finding when it is ACCOMPANIED
# by a one-line reason (non-trivial text after the rule id). A bare disable with no reason
# is itself the default tell, so the rule still FIRES on it. For every other rule a bare
# disable suppresses as before (the existing behaviour is untouched).
run_rule() {
  local file="$1" rule="$2" severity="$3" regex="$4" requires_reason="${5:-0}"
  perl -e '
    my ($file, $rule, $severity, $regex, $requires_reason) = @ARGV;
    open(my $fh, "<", $file) or exit 0;
    my $rx;
    eval { $rx = qr/$regex/m; };
    if ($@) {
      print STDERR "ux-lint: bad regex in rule $rule: $@\n";
      exit 0;
    }
    # A disable counts as a JUSTIFIED disable only if a reason follows the rule id.
    # >=3 word chars of text after the directive (and not another ux-lint directive)
    # is the reason. A bare `ux-lint-disable <rule>` has no reason -> not justified.
    sub justified {
      my ($l) = @_;
      return 0 unless $l =~ /ux-lint-disable\s+\Q$rule\E\b(.*)$/;
      my $rest = $1;
      $rest =~ s/\*\///g;            # strip a trailing block-comment close
      $rest =~ s/-->//g;            # strip a trailing html-comment close
      $rest =~ s/[^a-zA-Z0-9]+/ /g; # collapse punctuation to spaces
      $rest =~ s/^\s+|\s+$//g;
      return ($rest =~ /\w{3,}/) ? 1 : 0;
    }
    my @lines = <$fh>;
    close($fh);
    my $inblock = 0;
    for (my $i = 0; $i < @lines; $i++) {
      my $line = $lines[$i];
      # A line that is only a comment cannot ship markup or a style: the words "img" or "button"
      # inside a <script> comment, a `<!-- -->` line or a JSX `{/* */}` line are prose about
      # code, and five kit files were flagged for prose. (Frontmatter comments were already
      # skipped one release ago; this covers the other three comment forms.) A block comment is
      # tracked across lines, because the body of a `/* ... */` block need not start with `*`:
      # the second pass of this fix skipped `*`-led lines only and left three findings standing
      # on plain-prose continuation lines.
      if ($inblock) {
        $inblock = 0 if $line =~ m{\*/|-->};
        next;
      }
      if ($line =~ m{^\s*(/\*|<!--|\{/\*)} && $line !~ m{\*/|-->}) {
        $inblock = 1;
        next;
      }
      next if $line =~ m{^\s*(//|/\*|\*\s|\*/|<!--|\{/\*)};
      my $disabled_here = ($line =~ /ux-lint-disable\s+\Q$rule\E\b/);
      my $disabled_prev = ($i > 0 && $lines[$i-1] =~ /ux-lint-disable\s+\Q$rule\E\b/);
      if ($requires_reason) {
        # Only a JUSTIFIED disable (with a reason) suppresses; a bare one does not.
        next if $disabled_here && justified($line);
        next if $disabled_prev && justified($lines[$i-1]);
      } else {
        next if $disabled_here;
        next if $disabled_prev;
      }
      next if $line =~ /ux-lint-disable-all\b/;
      if ($line =~ /$rx/) {
        chomp $line;
        $line =~ s/\t/    /g;
        printf("%s\t%d\t%s\t%s\t%s\n", $file, $i + 1, $severity, $rule, $line);
      }
    }
  ' "$file" "$rule" "$severity" "$regex" "$requires_reason" 2>&1
}

# Block-aware check: the tracked-mono "eyebrow" kicker (the worst-styled case of
# the kicker pattern).
#
# DOCTRINE: the kicker PATTERN itself - a small label above a section heading,
# however styled - is the generic-AI tell; the default is to drop the label and
# let the heading carry the section (references/anti-patterns.md). A precise
# deterministic heuristic for "a tiny label above a heading" is hard, so the
# doctrine in anti-patterns is the primary lever; this styling check stays the
# mechanical floor and keeps firing on the worst case.
#
# The markdown rules above match one line at a time, so they cannot catch a CSS
# rule block where uppercase, the mono font and the wide tracking each sit on
# their own declaration line (the way every such kicker is actually authored).
# This reads brace-delimited rule blocks and flags the co-occurrence of all
# three tell-properties: text-transform:uppercase + a mono font-family +
# letter-spacing >= 0.1em. It also flags any eyebrow / kicker / overline class
# still set in a mono font. Emits the same TSV as run_rule so it flows through
# the existing severity / exit logic. Documented as `ai-tell-tracked-eyebrow` in
# references/anti-patterns.md. Escape a block with `ux-lint-disable
# ai-tell-tracked-eyebrow` on its opening line.
run_tracked_eyebrow() {
  local file="$1" rule="ai-tell-tracked-eyebrow" severity="High"
  awk -v file="$file" -v rule="$rule" -v severity="$severity" '
    BEGIN { RS="}"; IGNORECASE=1; line=1 }
    {
      block=$0;
      start=line;                         # line of this blocks first declaration
      line += gsub(/\n/, "\n", block);    # advance the line counter past this block
      if (block ~ /ux-lint-disable-all/) next;
      if (block ~ /ux-lint-disable[[:space:]]+ai-tell-tracked-eyebrow/) next;

      has_upper = (block ~ /text-transform[[:space:]]*:[[:space:]]*uppercase/);
      has_mono  = (block ~ /font-family[^;{}]*(mono|monospace|JetBrains|--pl-font-mono|--font-mono)/);
      has_wide  = (block ~ /letter-spacing[[:space:]]*:[[:space:]]*(0?\.(1[0-9]|[2-9])[0-9]*|[1-9][0-9]*(\.[0-9]+)?)[[:space:]]*em/);
      is_kicker_class = (block ~ /\.(eyebrow|tracked-label|pl-eyebrow|kicker|overline)/);

      if (has_upper && has_mono && has_wide) {
        sel=block; sub(/\{.*/, "", sel); gsub(/^[[:space:]\n]+|[[:space:]\n]+$/, "", sel); gsub(/[[:space:]]*\n[[:space:]]*/, " ", sel);
        printf("%s\t%d\t%s\t%s\t%s\n", file, start, severity, rule, "kicker label above a heading (worst case: uppercase + mono + letter-spacing>=0.1em) -> " sel " { the kicker PATTERN is the AI tell - default to no label, let the heading carry the section }");
      } else if (is_kicker_class && has_mono) {
        sel=block; sub(/\{.*/, "", sel); gsub(/^[[:space:]\n]+|[[:space:]\n]+$/, "", sel); gsub(/[[:space:]]*\n[[:space:]]*/, " ", sel);
        printf("%s\t%d\t%s\t%s\t%s\n", file, start, severity, rule, "eyebrow/kicker class still set in a mono font -> " sel " { the kicker PATTERN is the AI tell - prefer dropping the label entirely }");
      }
    }
  ' "$file" 2>/dev/null
}

# Block-aware check: the sentence-case STATUS PILL / badge above the hero heading.
#
# DOCTRINE: the eyebrow / kicker PATTERN is the tell (see the tracked-eyebrow check
# above and the doctrine in references/anti-patterns.md). The tracked-mono variant is
# the worst STYLED case; the STATUS PILL is the worst PLACED case - a short label in a
# rounded pill (a border-radius + a border or background), often with a small status
# dot, sitting immediately above the hero <h1>. Jake's directive: on the HERO it must
# not appear at all, so this is a hard HIGH flag (hero-scoped, not every pill on the
# page). The eyebrow lint above only catches the uppercase+mono+tracked variant, so a
# sentence-case status pill slips through; this closes that gap.
#
# FALSE-POSITIVE DISCIPLINE: it fires ONLY when ALL hold, so an ordinary rounded button
# or a pill chip elsewhere on the page does not trip it:
#   - the element is a pill SHAPE: a `rounded-full` / `rounded-pill` class, a
#     pill/badge/chip/eyebrow/tag class, OR an inline border-radius of 999px+/9999px,
#   - it carries a border OR a background (`border`/`bg-`/`background`/`border:`),
#   - it sits within a short window (<= WINDOW lines) IMMEDIATELY BEFORE the FIRST <h1>
#     in the file (the hero heading), AND after the most recent <section/<header/<main,
#   - it is NOT an <a>/<button> (those are CTAs/links, not eyebrow chrome),
#   - its own text is short (a label, not a paragraph).
# Only the FIRST <h1> is considered, so legitimate pills lower down never fire.
# Emits the same TSV as run_rule. Documented as `hero-status-pill` in
# references/anti-patterns.md. Escape with `ux-lint-disable hero-status-pill` on the
# pill's line or the line before it.
run_hero_status_pill() {
  local file="$1" rule="hero-status-pill" severity="High" window="${HERO_PILL_WINDOW:-12}"
  awk -v file="$file" -v rule="$rule" -v severity="$severity" -v WINDOW="$window" '
    BEGIN { IGNORECASE=1; n=0 }
    { n++; L[n]=$0 }
    END {
      # Find the first <h1>.
      h1=0;
      for (i=1; i<=n; i++) { if (L[i] ~ /<h1[ >]/) { h1=i; break } }
      if (h1==0) exit 0;
      # Walk back from just above the h1, but stop at the section boundary so we only
      # look inside the hero block, and cap at WINDOW lines.
      lo = (h1-WINDOW > 1) ? h1-WINDOW : 1;
      for (i=h1-1; i>=lo; i--) {
        if (L[i] ~ /<(section|header|main|article)[ >]/) break;  # left the hero block
        line=L[i];
        if (line ~ /ux-lint-disable-all/) continue;
        if (line ~ /ux-lint-disable[[:space:]]+hero-status-pill/) continue;
        prev = (i>1) ? L[i-1] : "";
        if (prev ~ /ux-lint-disable[[:space:]]+hero-status-pill/) continue;

        # Must be an opening tag for a non-link, non-button element.
        if (line !~ /<(div|span|p|small)[ >]/) continue;
        if (line ~ /<(a|button)[ >]/) continue;

        # NB: BSD/macOS awk has no \b word boundary, so use [[:space:]"] anchors and
        # plain substrings (matches the portable style of run_tracked_eyebrow above).
        is_pill = (line ~ /rounded-full|rounded-pill/) \
               || (line ~ /class="[^"]*(pill|badge|chip|eyebrow|tag|status|kicker|overline)/) \
               || (line ~ /border-radius[[:space:]]*:[[:space:]]*(9999|999|100|50)/);
        if (!is_pill) continue;

        has_edge = (line ~ /(^|[[:space:]"])border([-:[:space:]"]|$)/) \
                || (line ~ /[[:space:]"]bg-/) \
                || (line ~ /background/);
        if (!has_edge) continue;

        # Short text only: strip the tag(s) on this line; a long paragraph is not a pill.
        txt=line; gsub(/<[^>]*>/, "", txt); gsub(/^[[:space:]]+|[[:space:]]+$/, "", txt);
        if (length(txt) > 60) continue;

        sel=line; gsub(/^[[:space:]]+|[[:space:]]+$/, "", sel);
        printf("%s\t%d\t%s\t%s\t%s\n", file, i, severity, rule, "status pill / badge above the hero heading -> " sel " { a rounded pill label above the hero h1 (often with a status dot) is the worst-placed eyebrow tell - on the hero it must not appear at all; delete it and let the heading carry the hero }");
        break;  # one finding per file is enough
      }
    }
  ' "$file" 2>/dev/null
}

# Block-aware check: the two-tone (two SOLID colours) hero heading.
#
# DOCTRINE: a heading whose inner spans use two or more DISTINCT solid text colours
# fakes hierarchy with colour instead of carrying it with weight / size / composition
# (references/ai-slop-tells.md, "two-tone, gradient or italic-and-colour headings").
# Gradient-clipped text is already caught by gradient-text-clip; this is the SOLID
# two-colour sibling that the gradient rule misses. JUSTIFY-OR-FLAG (a genuine brand
# two-colour wordmark passes with a one-line reason).
#
# It reads each <h1>...</h1> (joined across lines) and collects the distinct text
# colours its inner elements set, via three idioms:
#   - inline `color:#hex` / `color:rgb(...)` / `color:var(--token)`,
#   - Tailwind arbitrary `text-[#hex]` / `text-[var(--token)]`,
#   - Tailwind `text-{hue}-{shade}` utility classes (e.g. text-indigo-500).
# Two or more DISTINCT such colours inside one <h1> => flag. A single accent word, or
# the same colour repeated, does not fire (low false-positive). Documented as
# `two-tone-heading` in references/anti-patterns.md; escape with
# `ux-lint-disable two-tone-heading` on the heading's opening line or the line above it.
run_two_tone_heading() {
  local file="$1" rule="two-tone-heading" severity="Medium"
  awk -v file="$file" -v rule="$rule" -v severity="$severity" '
    BEGIN { IGNORECASE=1; n=0 }
    { n++; L[n]=$0 }
    END {
      for (i=1; i<=n; i++) {
        if (L[i] !~ /<h1[ >]/) continue;
        # Join from this <h1 to its </h1> (heading rarely spans many lines; cap at 12).
        blk=""; startline=i; opens=i;
        for (j=i; j<=n && j<i+12; j++) { blk = blk " " L[j]; if (L[j] ~ /<\/h1>/) break }

        if (blk ~ /ux-lint-disable-all/) { i=j; continue }
        if (blk ~ /ux-lint-disable[[:space:]]+two-tone-heading/) { i=j; continue }
        prev = (startline>1) ? L[startline-1] : "";
        if (prev ~ /ux-lint-disable[[:space:]]+two-tone-heading/) { i=j; continue }

        delete seen; c=0;
        # inline color:... (hex, rgb, var)
        s=blk;
        while (match(s, /color[[:space:]]*:[[:space:]]*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|var\(--[a-z0-9-]+\))/)) {
          tok=substr(s, RSTART, RLENGTH); sub(/^color[[:space:]]*:[[:space:]]*/, "", tok); tok=tolower(tok);
          if (!(tok in seen)) { seen[tok]=1; c++ }
          s=substr(s, RSTART+RLENGTH);
        }
        # Tailwind arbitrary text-[...]
        s=blk;
        while (match(s, /text-\[(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))\]/)) {
          tok=substr(s, RSTART, RLENGTH); tok=tolower(tok);
          if (!(tok in seen)) { seen[tok]=1; c++ }
          s=substr(s, RSTART+RLENGTH);
        }
        # Tailwind text-{hue}-{shade}
        s=blk;
        while (match(s, /text-(slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/)) {
          tok=substr(s, RSTART, RLENGTH); tok=tolower(tok);
          if (!(tok in seen)) { seen[tok]=1; c++ }
          s=substr(s, RSTART+RLENGTH);
        }

        if (c >= 2) {
          hl=L[startline]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", hl);
          printf("%s\t%d\t%s\t%s\t%s\n", file, startline, severity, rule, "two-tone hero heading: " c " distinct solid text colours inside one <h1> -> " hl " { two solid colours in a heading fake hierarchy - carry it with weight, size and composition, not a second colour; gradient text is already a separate flag }");
        }
        i=j;  # skip past this h1
      }
    }
  ' "$file" 2>/dev/null
}

TMP=$(mktemp)
# HOW MUCH DID IT ACTUALLY READ. Every file handed to a rule is recorded here, so the report
# can say what the lint covered. "0 finding(s)" over a directory holding nothing the rules
# match is not a clean build, it is a lint that never ran, and the two used to print the same.
INSPECTED=$(mktemp)
trap "rm -f $TMP $INSPECTED" EXIT

[ "$CI" = "0" ] && printf "ux-lint: rules=%s project=%s fail-on=%s\n" \
  "$(basename "$RULES_FILE")" "$PROJECT_DIR" "$FAIL_ON" >&2

while IFS=$'\t' read -r RULE_ID SEVERITY MODE FILES_GLOB REGEX; do
  [ -z "$RULE_ID" ] && continue
  case ",$DISABLED," in *",$RULE_ID,"*) continue ;; esac
  if [ -n "$MODE_FILTER" ] && [ "$MODE" != "always" ] && [ "$MODE" != "$MODE_FILTER" ]; then
    continue
  fi
  RANK=$(severity_rank "$SEVERITY")
  [ "$RANK" -lt "$SHOW_RANK" ] && continue

  # JUSTIFY-OR-FLAG: the banned-display-<face> rules are known no-opinion defaults,
  # not a hard ban. They keep FIRING on the face used as display; the pass condition
  # is a `ux-lint-disable banned-display-<face>` WITH a one-line reason. A bare disable
  # (no reason) is itself the default tell, so the rule still fires on it.
  REQUIRES_REASON=0
  case "$RULE_ID" in
    banned-display-inter|banned-display-roboto|banned-display-arial|banned-display-space-grotesk) REQUIRES_REASON=1 ;;
    banned-display-instrument-serif|banned-display-geist|banned-display-fraunces) REQUIRES_REASON=1 ;;
    banned-display-bricolage|banned-body-hanken) REQUIRES_REASON=1 ;;
    accent-indigo-default|accent-tailwind-class|accent-cyan-on-dark|accent-emerald-cta|accent-friendly-teal) REQUIRES_REASON=1 ;;
    gradient-overuse|glassmorphism-decorative|reseed-serif-italic-heading|ai-washing-copy) REQUIRES_REASON=1 ;;
    custom-cursor-not-gated) REQUIRES_REASON=1 ;;
  esac

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    printf '%s\n' "$f" >> "$INSPECTED"
    run_rule "$f" "$RULE_ID" "$SEVERITY" "$REGEX" "$REQUIRES_REASON" >> "$TMP"
  done < <(list_files "$FILES_GLOB" "$PROJECT_DIR")
done < <(parse_rules)

# Block-aware rules (cannot be expressed as a per-line markdown Pattern).
# ai-tell-tracked-eyebrow: High, mode always. Honour --disable and --severity.
if [ "$(severity_rank High)" -ge "$SHOW_RANK" ]; then
  case ",$DISABLED," in
    *",ai-tell-tracked-eyebrow,"*) : ;;
    *)
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        printf '%s\n' "$f" >> "$INSPECTED"
        run_tracked_eyebrow "$f" >> "$TMP"
      done < <(list_files "*.css" "$PROJECT_DIR")
      ;;
  esac
fi

# hero-status-pill: High, mode always. The sentence-case status pill above the hero
# heading (a gap the tracked-mono eyebrow rule misses). Markup files only.
if [ "$(severity_rank High)" -ge "$SHOW_RANK" ]; then
  case ",$DISABLED," in
    *",hero-status-pill,"*) : ;;
    *)
      # ON A PRODUCT TEMPLATE, A STATUS PILL ABOVE THE HEADING IS THE CORRECT PATTERN.
      #
      # This rule exists for decorative eyebrow chrome above a HERO heading. On a product detail
      # page the pill above the <h1> is "In stock", "Sale", "Low stock" or a badge: it is product
      # state the buyer needs, every serious storefront in the reference library does it, and this
      # fired High on all of them. That is one of the three gates that false-fail a correct
      # storefront.
      #
      # Scoped by BOTH conditions, never one: the file must sit under a products/ directory AND a
      # commerce catalogue must exist. A brochure site with a /products page keeps the rule in
      # full, because without .palate/catalogue.json nothing here changes at all.
      _pill_commerce=0
      if [ -f "$PROJECT_DIR/.palate/catalogue.json" ] \
         && grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$PROJECT_DIR/.palate/catalogue.json" 2>/dev/null; then
        _pill_commerce=1
      fi
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        if [ "$_pill_commerce" -eq 1 ]; then
          case "$f" in */products/*) continue ;; esac
        fi
        printf '%s\n' "$f" >> "$INSPECTED"
        run_hero_status_pill "$f" >> "$TMP"
      done < <(list_files "*.astro,*.html,*.tsx" "$PROJECT_DIR")
      ;;
  esac
fi

# two-tone-heading: Medium, mode always. The solid two-colour hero heading (gradient
# text is a separate flag). Markup files only.
if [ "$(severity_rank Medium)" -ge "$SHOW_RANK" ]; then
  case ",$DISABLED," in
    *",two-tone-heading,"*) : ;;
    *)
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        printf '%s\n' "$f" >> "$INSPECTED"
        run_two_tone_heading "$f" >> "$TMP"
      done < <(list_files "*.astro,*.html,*.tsx" "$PROJECT_DIR")
      ;;
  esac
fi

FILES_READ=$(sort -u "$INSPECTED" 2>/dev/null | grep -c . || true)
FILES_READ="${FILES_READ:-0}"
# A LINT THAT READ NOTHING IS A SKIP, NOT A CLEAN BILL. Exit 2 is this script's "could not
# check" code and this is that case: the rules never saw a file, so nothing about the project
# has been established. Said even under --ci, because it is a verdict and not display.
if [ "$FILES_READ" -eq 0 ]; then
  echo "ux-lint: skipped (nothing to inspect: no file under $PROJECT_DIR matches any rule's Files glob). NOT a pass." >&2
  exit 2
fi

VIOLATIONS=$(wc -l < "$TMP" | tr -d ' ')
if [ "$VIOLATIONS" -gt 0 ]; then
  if [ "$CI" = "1" ]; then
    cat "$TMP"
  else
    while IFS=$'\t' read -r fname lineno sev rid text; do
      printf "%s:%s  [%s %s]  %s\n" "$fname" "$lineno" "$sev" "$rid" "$text"
    done < "$TMP"
  fi
fi

HIGHEST=0
while IFS=$'\t' read -r _ _ sev _ _; do
  r=$(severity_rank "$sev")
  [ "$r" -gt "$HIGHEST" ] && HIGHEST="$r"
done < "$TMP"

[ "$CI" = "0" ] && printf "ux-lint: %d finding(s) at severity %s or above (inspected %d file(s))\n" \
  "$VIOLATIONS" "$SHOW_SEVERITY" "$FILES_READ" >&2

if [ "$HIGHEST" -ge "$FAIL_RANK" ]; then
  exit 1
fi
exit 0
