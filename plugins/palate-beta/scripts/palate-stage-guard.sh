#!/usr/bin/env bash
# scripts/palate-stage-guard.sh - refuse to commit a working directory into a client's repo.
#
# ============================== WHY THIS EXISTS ==============================
#
# Ignores are the first defence and they only ever cover paths somebody thought of. An
# adoption run staged 874 MB of screenshots from a directory that had no rule yet, and
# nothing else stood between it and the client's repository. This is the second defence and
# it works on SIZE alone, so a directory nobody predicted is still caught.
#
# TWO LIMITS, deliberately different. One enormous file is usually a mistaken asset (a raw
# video, an unoptimised export) and 5 MB is generous for anything a site should carry. A
# DIRECTORY over 50 MB is the leak this exists for: 249 screenshots, none of them individually
# remarkable, which no per-file limit would ever catch. The repository root counts as a
# directory, and the whole staged tree is measured against the same 50 MB, so a dump beside
# package.json and a dump spread thinly over several folders are both caught.
#
# It reads the STAGED tree, not the working tree, because that is what the next commit will
# contain, so a file edited or deleted after `git add` is still measured as what the commit
# will hold. A deletion stages no content and is skipped. A blob that cannot be read at all is
# NAMED rather than passed over, because a guard that silently skips what it cannot read is the
# failure mode this repo has paid for repeatedly.
#
# Exit codes: 0 clean, 1 refused (with the offenders named), 2 skipped with a printed reason.
#
# Usage: palate-stage-guard.sh [repo-dir]     (default: cwd)
set -uo pipefail

DIR="${1:-.}"
FILE_MB="${PALATE_MAX_STAGED_FILE_MB:-5}"
DIR_MB="${PALATE_MAX_STAGED_DIR_MB:-50}"

root="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  echo "palate-stage-guard: $DIR is not a git repository, so there is no staged tree to inspect. NOT a pass." >&2
  exit 2
fi

# --diff-filter=ACMR: added, copied, modified, renamed. A deletion stages no content.
#
# core.quotePath=false OR EVERY ACCENTED FILENAME IS A FALSE REFUSAL. git escapes any byte
# above 0x7F by default, so `public/café.jpg` came back as `"public/caf\303\251.jpg"`,
# `git cat-file -s` could not resolve it, and a client's own photo blocked /publish with advice
# telling them to unstage it.
staged="$(git -C "$root" -c core.quotePath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null)"
if [ -z "$staged" ]; then
  echo "palate-stage-guard: nothing is staged (no added or modified files), so nothing was inspected. NOT a pass." >&2
  exit 2
fi

# The size of the CONTENT that will be committed. `git cat-file -s :path` reads the staged
# blob, so a file edited after `git add` is still measured as what the commit will hold.
report="$(
  cd "$root" || exit 2
  printf '%s\n' "$staged" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    if size="$(git cat-file -s ":$f" 2>/dev/null)"; then
      printf '%s\t%s\n' "$size" "$f"
    else
      printf 'UNREADABLE\t%s\n' "$f"
    fi
  done | awk -F'\t' -v file_mb="$FILE_MB" -v dir_mb="$DIR_MB" '
    BEGIN { mb = 1048576; file_max = file_mb * mb; dir_max = dir_mb * mb }
    $1 == "UNREADABLE" { unreadable[++u] = $2; next }
    {
      n++; total += $1
      if ($1 > file_max) big_file[$2] = $1
      # Charge the bytes to EVERY ancestor directory. A leak shows up as one directory that
      # has quietly grown, and which level of the tree it sits at is not knowable in advance.
      #
      # THE REPOSITORY ROOT IS A DIRECTORY TOO. The walk used to stop at the first path with
      # no slash, so eleven 5 MB screenshots dumped at the root were charged to nothing and
      # 55 MB passed as clean. That is the recorded leak shape: agents dump Playwright
      # screenshots beside package.json, and a full-page PNG sits well under the file limit.
      p = $2
      root_level = 1
      while (1) {
        cut = 0
        for (k = length(p); k >= 1; k--) if (substr(p, k, 1) == "/") { cut = k; break }
        if (cut == 0) break
        root_level = 0
        p = substr(p, 1, cut - 1)
        dir_total[p] += $1
      }
      if (root_level) dir_total["."] += $1
    }
    END {
      printf "INSPECTED\t%d\t%d\n", n, total
      for (f in big_file) printf "FILE\t%s\t%d\n", f, big_file[f]
      covered = 0
      for (d in dir_total) if (dir_total[d] > dir_max) {
        printf "DIR\t%s\t%d\n", d, dir_total[d]
        if (dir_total[d] >= total) covered = 1
      }
      # AND THE TOTAL, whatever the layout. 60 MB spread evenly over three directories is the
      # same leak as 60 MB in one, and no per-directory rule can see it. Reported only when no
      # single directory already accounts for all of it, so one dump is named once.
      if (total > dir_max && !covered) printf "TOTAL\t.\t%d\n", total
      for (i = 1; i <= u; i++) printf "UNREADABLE\t%s\t0\n", unreadable[i]
    }
  '
)"

human() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

count="$(printf '%s\n' "$report" | awk -F'\t' '$1=="INSPECTED"{print $2}')"
bytes="$(printf '%s\n' "$report" | awk -F'\t' '$1=="INSPECTED"{print $3}')"
offenders="$(printf '%s\n' "$report" | awk -F'\t' '$1=="FILE" || $1=="DIR" || $1=="TOTAL" || $1=="UNREADABLE"')"

if [ -z "$offenders" ]; then
  echo "palate-stage-guard: $count staged file(s), $(human "${bytes:-0}") in total. Under the ${FILE_MB} MB per-file and ${DIR_MB} MB per-directory limits."
  exit 0
fi

echo "palate-stage-guard: REFUSED. $count staged file(s), $(human "${bytes:-0}") in total." >&2
printf '%s\n' "$offenders" | sort -t"$(printf '\t')" -k3,3nr | while IFS="$(printf '\t')" read -r kind path size; do
  case "$kind" in
    FILE) echo "  file  $path is $(human "$size"), over the ${FILE_MB} MB limit." >&2 ;;
    DIR)  if [ "$path" = "." ]; then
            echo "  root  the repository root holds $(human "$size") of staged content, over the ${DIR_MB} MB limit." >&2
          else
            echo "  dir   $path holds $(human "$size") of staged content, over the ${DIR_MB} MB limit." >&2
          fi ;;
    TOTAL) echo "  total $(human "$size") staged across the whole tree, over the ${DIR_MB} MB limit, with no single directory holding it all." >&2 ;;
    UNREADABLE) echo "  ????  $path is staged but its blob could not be read, so it was NOT measured." >&2 ;;
  esac
done
echo "Unstage it (git restore --staged <path>), add the rule to .gitignore, and run scripts/palate-gitignore.sh so the next build is covered too. PALATE_MAX_STAGED_FILE_MB / PALATE_MAX_STAGED_DIR_MB raise the limits when a large file genuinely belongs in the repo." >&2
exit 1
