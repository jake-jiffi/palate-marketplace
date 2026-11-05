#!/usr/bin/env bash
# palate-handover.sh - the exit, as a command rather than a negotiation.
#
# ============================== WHY THIS EXISTS ==============================
#
# "Hosted, not rented" is a claim until someone can leave in an afternoon and the site keeps
# building without us. The dry run is what makes it credible, because it can be run live in a
# sales conversation: it reads the project, prints exactly what would move and who has to touch
# a dashboard to move it, changes nothing, and needs no network.
#
# The script's job is the deterministic half: inventory, plan, receipt. It deliberately does NOT
# pretend to complete cross-provider account transfers. Vercel has no CLI project transfer,
# Sanity organisation moves need the receiving admin to accept, Cloudflare workers do not move
# between accounts at all, and a GitHub transfer into an organisation waits on an invitation.
# Those are enumerated as a checklist the receipt carries. A handover that silently half-completes
# is worse than one that hands over a correct list.
#
# ================================== SECRETS ==================================
#
# Environment variables are reported BY NAME ONLY. The value side of every line is discarded by
# the extractor before anything is printed, so no secret can reach the terminal, the receipt, or
# a screen share. That is the whole reason the names are read with sed rather than by sourcing
# the file. Secrets do not travel: the customer re-mints each one in their own account, which is
# the correct outcome, not an obstacle. A handover that leaves them running on our keys is a
# longer leash, not an exit.
#
# Usage: palate-handover.sh <project-dir> [--dry-run] [--to <github-owner>]
#        --dry-run        default. Print the plan and the receipt, change nothing.
#        --receipt-only   write HANDOVER.md, move nothing (for when they moved things themselves).
#        --execute        attempt the one automatable move (the GitHub repo transfer), then write
#                         the receipt. Requires --to.
#        --to <owner>     the GitHub account or organisation receiving the repo.
#
# Env: PALATE_HANDOVER_NO_NETWORK=1  skip every network probe. Used by the test suite, and safe
#      to use when demonstrating the dry run with no connection.
#
# Exit: 0 plan printed / receipt written / handover steps done
#       2 usage error, or the directory is not a Palate site
#       3 execute blocked: a precondition failed and the script refuses to guess past it
set -uo pipefail

SELF="$(basename "$0")"

usage() {
  sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//'
}
die_usage() { echo "${SELF}: $1" >&2; echo >&2; usage >&2; exit 2; }
die_not_site() {
  echo "NOT_A_SITE: $1" >&2
  echo "  ${SELF} hands over a Palate site: a directory with a package.json and either an Astro" >&2
  echo "  source tree or .palate/ state. Point it at the project root." >&2
  exit 2
}
die_blocked() { echo "HANDOVER_BLOCKED: $1" >&2; exit 3; }

DIR=""; MODE="dry"; TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)      MODE="dry" ;;
    --receipt-only) MODE="receipt" ;;
    --execute)      MODE="execute" ;;
    --to)           TO="${2:-}"; [ -n "$TO" ] || die_usage "--to needs a GitHub owner"; shift ;;
    --to=*)         TO="${1#--to=}"; [ -n "$TO" ] || die_usage "--to needs a GitHub owner" ;;
    -h|--help)      usage; exit 0 ;;
    -*)             die_usage "unknown option: $1" ;;
    *)              [ -z "$DIR" ] || die_usage "unexpected argument: $1"; DIR="$1" ;;
  esac
  shift
done

[ -n "$DIR" ] || die_usage "no project directory given"
[ -d "$DIR" ] || die_not_site "no such directory: $DIR"
DIR="$(cd "$DIR" && pwd)"
cd "$DIR" || die_not_site "cannot enter $DIR"

# A site, not a folder. package.json alone is any npm project, so require a second marker.
[ -f package.json ] || die_not_site "no package.json in $DIR"
if ! grep -q '"astro"' package.json 2>/dev/null && [ ! -d src/pages ] && [ ! -d .palate ]; then
  die_not_site "$DIR has a package.json but no Astro source tree and no .palate/ state"
fi

# ------------------------------------------------------------------ helpers --
# Network probes are opt-out so the dry run works on a plane and the tests stay hermetic.
have_net() {
  [ "${PALATE_HANDOVER_NO_NETWORK:-0}" = "1" ] && return 1
  command -v "$1" >/dev/null 2>&1
}
count_files() { # <dir> [find-args...]
  local d="$1"; shift
  [ -d "$d" ] || { echo 0; return; }
  find "$d" -type f "$@" 2>/dev/null | wc -l | tr -d ' '
}
first_match() { grep -m1 -o "$1" "$2" 2>/dev/null | head -1; }
# A git remote can carry credentials in its userinfo (https://user:ghp_xxx@host/org/repo.git, or
# the bare-token https://ghp_xxx@host/... form). Both are ordinary for HTTPS remotes holding a PAT
# and for CI-provisioned clones, and both would otherwise be printed to the terminal and written
# into the receipt, which is exactly the breach this script promises cannot happen. So the URL is
# redacted at the moment it is read and the raw form is never kept: one variable, no chance of a
# later line reaching for the wrong one. Redacting first also hardens the host parsing below,
# since a credential containing "github.com" can no longer be mistaken for the host.
# `git@` is the one exemption: it is the universal SSH convention, never a secret.
redact_url() {
  case "$1" in
    *://git@*) printf '%s' "$1" ;;
    *://*@*)   printf '%s' "$1" | sed 's#://[^/@]*@#://<credentials-redacted>@#' ;;
    *)         printf '%s' "$1" ;;  # scp-style git@host:org/repo, or no userinfo at all
  esac
}
# "1 commits" in a document a customer keeps is the kind of detail that reads as unfinished.
plural() { # <n> <singular> [plural]
  if [ "$1" = "1" ]; then echo "$1 $2"; else echo "$1 ${3:-$2s}"; fi
}

AUTO=0; MANUAL=0
PLAN=""   # accumulated so the plan can be printed once, after everything is known
# %-46s pads a short field but does nothing to a long one, so a single long path (an enclosing
# repo, a deep project directory) shunts every column right of it out of alignment for that row
# and the table stops reading as a table. This is the artefact shown on a screen share to argue
# that leaving is easy, so it has to hold its shape. Truncation is display-only: the receipt is
# the durable document and carries every value in full.
fit() { # <string> <width>
  if [ "${#1}" -le "$2" ]; then printf '%s' "$1"
  else printf '%s...' "$(printf '%.*s' "$(( $2 - 3 ))" "$1")"; fi
}
plan_row() { # <category> <what> <destination> <automatic|person> [note]
  local kind="$4"
  case "$kind" in
    automatic) AUTO=$((AUTO + 1)) ;;
    person)    MANUAL=$((MANUAL + 1)) ;;
  esac
  PLAN="${PLAN}$(printf '  %-11s %-46s %-32s %s' "$(fit "$1" 11)" "$(fit "$2" 46)" "$(fit "$3" 32)" "${5:-$kind}")
"
}

# ---------------------------------------------------------------- inventory --
SITE_NAME="$(first_match '"name": *"[^"]*"' package.json | sed 's/.*: *"//; s/"$//')"
[ -n "$SITE_NAME" ] || SITE_NAME="$(basename "$DIR")"
DEST="${TO:-<their-github-owner>}"

# git + remote
GIT_OK=0; COMMITS="unknown"; REMOTE=""; GH_SLUG=""; GH_REPO=""; ENCLOSING=""; ENCLOSING_REMOTE=""
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Being INSIDE a work tree is not the same as BEING one. A site scaffolded into a subdirectory
  # of a larger checkout (a monorepo, or a template living inside this very skill repo) makes git
  # answer for the ENCLOSING repo: its remote, its history, its slug. Left unchecked, the plan
  # names somebody else's repository as the thing being handed over, and --execute would call
  # the transfer endpoint on it. Handing our own skill repo to a customer is the worst thing this
  # script could do, so the root is compared before any of git's answers are believed.
  # Both sides are resolved with `pwd -P`: on macOS /tmp is a symlink to /private/tmp, so the raw
  # strings differ for the same directory and a plain comparison would flag every site as nested.
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$GIT_ROOT" ] && [ "$(cd "$GIT_ROOT" 2>/dev/null && pwd -P)" != "$(pwd -P)" ]; then
    ENCLOSING="$GIT_ROOT"
    # Name the repository that would have been handed over. "It sits inside /some/path" is a
    # shrug; "it would have transferred palate-projects/OUR-OWN-REPO" is the sentence that stops
    # the person reading it.
    ENCLOSING_REMOTE="$(redact_url "$(git remote get-url origin 2>/dev/null || true)")"
  else
    GIT_OK=1
    COMMITS="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
    REMOTE="$(redact_url "$(git remote get-url origin 2>/dev/null || true)")"
    # The host must be github.com EXACTLY, matched at a boundary. A substring test is wrong in a
    # way that is easy to miss: "github.com" IS a substring of "github.company.com", so a GitHub
    # Enterprise remote parsed as GitHub, yielding the nonsense slug "pany.com:acme/site", marking
    # the row automatic, and sending --execute to the transfer endpoint with it. The three
    # patterns cover scp-style (git@host:org/repo), URL-style (scheme://host/org/repo) and
    # URL-style carrying userinfo, including our own <credentials-redacted> placeholder.
    case "$REMOTE" in
      *://github.com/*|*@github.com:*|*@github.com/*)
        GH_SLUG="${REMOTE#*github.com}"; GH_SLUG="${GH_SLUG#:}"; GH_SLUG="${GH_SLUG#/}"
        GH_SLUG="${GH_SLUG%.git}"; GH_SLUG="${GH_SLUG%/}"
        GH_REPO="${GH_SLUG#*/}"
        ;;
    esac
  fi
fi

# collaborators + Actions secrets, names only, and only when there is something to ask about
COLLABS=""; SECRET_NAMES=""; ACCESS_WHY=""
if [ -n "$ENCLOSING" ]; then
  ACCESS_WHY="not read (the site is not its own repo, see the repo row)"
elif [ -z "$GH_SLUG" ]; then
  ACCESS_WHY="origin is not a GitHub remote, so nothing here to read"
elif ! have_net gh; then
  ACCESS_WHY="not read (offline, or gh is not installed)"
else
  COLLABS="$(gh api "repos/${GH_SLUG}/collaborators" --jq '.[].login' 2>/dev/null | tr '\n' ' ')"
  SECRET_NAMES="$(gh secret list --json name --jq '.[].name' 2>/dev/null | tr '\n' ' ')"
  [ -n "$COLLABS$SECRET_NAMES" ] || ACCESS_WHY="none found, or gh is not authorised on this repo"
fi

# content + media travel inside the repo, so they are the easy half. Count them anyway: a
# customer asking "where are my photos" deserves a number, not a shrug.
CONTENT_FILES="$(count_files src/content)"
MEDIA_FILES=$(( $(count_files public) + $(count_files src/assets) ))
HAS_INLINE_CONTENT=0; [ -f src/lib/content.ts ] && HAS_INLINE_CONTENT=1

# CMS. projectId is public config, not a credential, so it is safe to print.
# The two seds must run prefix-then-suffix: one greedy `.*['"]` would eat the whole match,
# which is exactly how this reported every Sanity project as the word "present".
CMS=""; CMS_WHERE="content lives in the repo, no CMS wired"
for f in sanity.cli.ts sanity.cli.js sanity.config.ts sanity.config.js astro.cms.mjs; do
  [ -f "$f" ] || continue
  # astro.cms.mjs SHIPS IN EVERY SCAFFOLD as a documented no-op that returns [].
  # Treating its presence as a wired CMS put "Accept the Sanity administrator
  # invitation" into the ownership receipt of every site that has no CMS at all:
  # a fabricated obligation in a document the customer keeps, and an inflated
  # "needs a person" count. Presence is not configuration.
  if [ "$f" = "astro.cms.mjs" ] && grep -qE 'return[[:space:]]*\[\][[:space:]]*;?' "$f"; then
    continue
  fi
  pid="$(first_match "projectId: *['\"][^'\"]*['\"]" "$f" | sed "s/.*projectId: *['\"]//; s/['\"].*$//")"
  if [ -n "$pid" ]; then CMS="$pid"; else CMS="configured in $f, project id not found"; fi
  CMS_WHERE="manage.sanity.io"
  break
done

# hosting
HOSTING=""; HOST_KIND=""
if [ -f .vercel/project.json ]; then
  HOSTING="Vercel project $(first_match '"projectId": *"[^"]*"' .vercel/project.json | sed 's/.*: *"//; s/"$//')"
  HOST_KIND="vercel"
elif [ -f wrangler.toml ]; then
  HOSTING="Cloudflare worker $(first_match '^name *= *"[^"]*"' wrangler.toml | sed 's/.*= *"//; s/"$//')"
  HOST_KIND="cloudflare"
elif grep -q '@astrojs/vercel' astro.config.mjs 2>/dev/null; then
  HOSTING="Vercel (adapter configured, project not linked here)"; HOST_KIND="vercel"
elif grep -q '@astrojs/cloudflare' astro.config.mjs 2>/dev/null; then
  HOSTING="Cloudflare (adapter configured, not linked here)"; HOST_KIND="cloudflare"
else
  HOSTING="not detected"; HOST_KIND="unknown"
fi

# domain, from the built site URL. The template leaves a placeholder until it is set.
DOMAIN=""
if [ -f astro.config.mjs ]; then
  line="$(grep -m1 'site:' astro.config.mjs || true)"
  case "$line" in
    *'{{DOMAIN}}'*|*'${'*) DOMAIN="set at build time from SITE_DOMAIN" ;;
    *https://*) DOMAIN="$(printf '%s' "$line" | sed 's#.*https://##; s#[^A-Za-z0-9.-].*##')" ;;
  esac
fi
[ -n "$DOMAIN" ] || DOMAIN="not detected"

# Environment variable NAMES. Only the text left of the '=' survives, so a value cannot reach any
# output path.
#
# A line-by-line match is NOT sufficient, and this is the leak the whole "names only" promise
# turns on. A multi-line quoted value is ordinary dotenv: a key or certificate written across
# several lines between one pair of quotes. The continuation lines are base64, and base64 is
# [A-Za-z0-9+/=]. A chunk that happens to contain no '+' or '/' therefore reads as NAME=, and the
# key body gets printed as a variable name, into the plan and into the receipt the customer keeps
# and forwards. So quote state is tracked across lines and everything inside an open quote is
# skipped, whatever it looks like.
#
# The length cap is the second gate, for an unquoted multi-line value that no dotenv parser would
# accept but a hand-edited file can still contain. Real names are short; a 64-character unbroken
# run is payload, not a name. Skipped lines are COUNTED and reported rather than dropped quietly,
# because a silent skip could hide a real variable the customer then never sets.
env_names_in() { # <file>
  awk '
    function count(s, c,   i, n) { n = 0
      for (i = 1; i <= length(s); i++) if (substr(s, i, 1) == c) n++
      return n }
    # Inside an open quote: never a name. An odd number of that quote char closes it.
    inq { if (count($0, q) % 2 == 1) inq = 0; next }
    {
      line = $0
      sub(/^[ \t]*/, "", line)
      sub(/^export[ \t]+/, "", line)
      if (line !~ /^[A-Za-z_][A-Za-z0-9_]*[ \t]*=/) next
      name = line; sub(/[ \t]*=.*$/, "", name)
      if (length(name) > 64) { skipped++ } else { print name }
      val = line; sub(/^[^=]*=[ \t]*/, "", val)
      c = substr(val, 1, 1)
      # "\047" is a single quote, written octally to keep this awk out of shell quoting trouble.
      if (c == "\"" || c == "\047") { if (count(val, c) % 2 == 1) { q = c; inq = 1 } }
    }
    END { if (skipped) print "#skipped=" skipped }
  ' "$1"
}
ENV_RAW=""
for f in .env .env.local .env.production .env.development .env.example .dev.vars; do
  [ -f "$f" ] || continue
  ENV_RAW="${ENV_RAW}$(env_names_in "$f")
"
done
ENV_SKIPPED="$(printf '%s' "$ENV_RAW" | sed -n 's/^#skipped=//p' | awk '{t += $1} END {print t + 0}')"
ENV_NAMES="$(printf '%s' "$ENV_RAW" | grep -v '^#skipped=' | sed '/^$/d' | sort -u)"
# grep -c, not wc -l: the last name carries no trailing newline and wc undercounts it by one.
ENV_COUNT="$(printf '%s' "$ENV_NAMES" | grep -c . || true)"

# .palate/ state: the measured half of the site. It is committed, so it travels with the repo,
# but it is worth naming because it is the thing that makes the site maintainable by them.
BASELINES="$(count_files .palate/baselines -name '*.json')"
BRAIN="$(count_files .palate/brain -name '*.md')"
LEDGER=0; [ -f .palate/ledger.jsonl ] && LEDGER="$(wc -l < .palate/ledger.jsonl | tr -d ' ')"
PALATE_STATE="$(plural "$BASELINES" baseline), $(plural "$BRAIN" "brain note"), $(plural "$LEDGER" "ledger entry" "ledger entries")"
[ -d .palate ] || PALATE_STATE="none yet (nothing recorded)"

# -------------------------------------------------------------------- plan ---
CONTENT_DESC="$(plural "$CONTENT_FILES" "entry file")"
[ "$HAS_INLINE_CONTENT" = 1 ] && CONTENT_DESC="src/lib/content.ts plus ${CONTENT_DESC}"
# "unknown commits of history" is the sort of line that makes a customer stop reading. If there
# is no repo yet, say so: the files still move, they just have no history to carry.
if [ "$GIT_OK" = "1" ]; then
  CODE_DESC="$(plural "$COMMITS" commit) of history"
  CODE_DESC_RECEIPT="$(plural "$COMMITS" commit), full history"
elif [ -n "$ENCLOSING" ]; then
  CODE_DESC="history belongs to the enclosing repo, not to this site"
  CODE_DESC_RECEIPT="no history of its own yet"
else
  CODE_DESC="no git history yet, the files still move"
  CODE_DESC_RECEIPT="no git history yet"
fi

if [ -n "$ENCLOSING" ]; then
  plan_row "repo" "NOT ITS OWN REPO, sits inside ${ENCLOSING}" "$DEST" person \
           "needs a person (split it out first)"
elif [ "$GIT_OK" = "1" ] && [ -n "$GH_SLUG" ]; then
  plan_row "repo" "github.com/${GH_SLUG}" "$DEST" automatic "automatic (gh transfer)"
elif [ "$GIT_OK" = "1" ]; then
  plan_row "repo" "local git, remote ${REMOTE:-none}" "$DEST" person "needs a person (push it to their host)"
else
  plan_row "repo" "not a git repo" "$DEST" person "needs a person (git init, then push)"
fi
plan_row "code" "$CODE_DESC" "travels with the repo" automatic
plan_row "content" "$CONTENT_DESC" "travels with the repo" automatic
plan_row "media" "$(plural "$MEDIA_FILES" file) in public/ and src/assets" "travels with the repo" automatic
plan_row "palate" "$PALATE_STATE" "travels with the repo" automatic
if [ -n "$CMS" ]; then
  plan_row "cms" "Sanity ${CMS}" "their Sanity organisation" person "needs a person (manage.sanity.io)"
fi
case "$HOST_KIND" in
  vercel)     plan_row "hosting" "$HOSTING" "their Vercel team" person "needs a person (dashboard, or reimport)" ;;
  cloudflare) plan_row "hosting" "$HOSTING" "their Cloudflare account" person "needs a person (workers do not transfer)" ;;
  *)          plan_row "hosting" "$HOSTING" "their account" person "needs a person (identify the host first)" ;;
esac
plan_row "domain" "$DOMAIN" "theirs already, at the registrar" person "confirm (records move with the hosting)"
plan_row "env" "$(plural "$ENV_COUNT" name), values never move" "re-minted in their accounts" person "needs a person (one per service)"
if [ -n "$COLLABS$SECRET_NAMES" ]; then
  plan_row "our access" "collaborators: ${COLLABS:-none}; secrets: ${SECRET_NAMES:-none}" "removed after transfer" person "needs a person (see checklist)"
else
  plan_row "our access" "$ACCESS_WHY" "removed after transfer" person "needs a person (see checklist)"
fi

echo "PALATE HANDOVER  ${SITE_NAME}"
echo "  $DIR"
echo
echo "WHAT MOVES"
printf '%s' "$PLAN"
echo
echo "  ${AUTO} automatic, ${MANUAL} need a person. The manual ones are dashboard clicks and take"
echo "  about fifteen minutes between you, plus whatever the far side takes to accept."
echo

# Where the repo lives, as one string. --execute rewrites it after the transfer: a receipt
# written post-move that still names our organisation is a document that contradicts itself.
REPO_WHERE="${GH_SLUG:+github.com/}${GH_SLUG:-${REMOTE:-local git only}}"
[ -n "$ENCLOSING" ] && REPO_WHERE="not yet its own repo (sits inside ${ENCLOSING})"

# ----------------------------------------------------------------- receipt ---
# One writer for both paths, so the preview a customer sees in the dry run is byte-identical to
# the document they end up with. The variable parts are computed HERE rather than inline in the
# heredoc: a conditional `$( ... )` that yields nothing still leaves a blank line behind, and the
# receipt is a document the customer keeps.
TODAY="$(date +%Y-%m-%d)"

if [ "$ENV_COUNT" = "0" ]; then
  ENV_BLOCK="None found in this repo. Check the hosting dashboard for variables set only there."
else
  ENV_BLOCK="$(printf '%s\n' "$ENV_NAMES" | sed 's/^/- /')"
fi
# Say so when something was skipped. The skipped lines are almost always the continuation of a
# multi-line value, but "almost always" is not a thing to leave unsaid in a document whose job is
# to be complete: a variable nobody sets is a site that does not build on the far side.
if [ "${ENV_SKIPPED:-0}" != "0" ]; then
  ENV_BLOCK="${ENV_BLOCK}

Skipped $(plural "$ENV_SKIPPED" line): did not look like a variable declaration, almost always the
continuation of a multi-line value, which is deliberately never read. If a variable you expected
is missing above, open the file and check it by hand."
fi
[ "$HOST_KIND" = "vercel" ] && ENV_BLOCK="${ENV_BLOCK}

Run \`vercel env ls\` against the hosting project for anything set there and not in the repo."

CHECKLIST=""
add_task() { CHECKLIST="${CHECKLIST}- [ ] $1
"; }
add_task "Accept the GitHub repo transfer (an invitation, if the destination is an organisation you do not solely own)."
add_task "Recreate the repository secrets under the new owner: ${SECRET_NAMES:-run \`gh secret list\` to see the names}. The values are yours to mint, never ours to copy."
if [ "$HOST_KIND" = "vercel" ]; then
  add_task "Move the hosting. Vercel has no CLI transfer: either Project Settings, Advanced, Transfer Project, or (cleaner) import the repo into your own Vercel from scratch, which proves the build works from your side."
  add_task "Set the environment variables in your Vercel project. \`vercel env pull\` returns the literal string \`[SENSITIVE]\`, so no tool can copy them between accounts."
fi
if [ "$HOST_KIND" = "cloudflare" ]; then
  add_task "Deploy the worker into your own Cloudflare account (\`npx wrangler login\`, then deploy from the repo you now own). Workers do not transfer between accounts."
fi
if [ -n "$CMS" ]; then
  add_task "Accept the Sanity administrator invitation, then move the project into your own Sanity organisation. Holding an admin seat is not the same as owning the project, and this is the step most often left half done."
fi
add_task "Repoint DNS if the hosting moved, and confirm the registrar contact is yours. The site keeps serving from the old place until records update, so there is no outage."
add_task "Have us remove our access once the transfer verifies. The commands are below, and they are deliberately not run for you: which collaborators are ours is a judgement, and a wrong guess removes one of your own people."
receipt() {
  cat <<MD
# Ownership: ${SITE_NAME}

Handed over ${TODAY}${TO:+ to ${TO}}.

## What you now own

| Thing | What it is | Where it lives |
|---|---|---|
| Repo | the site, its history and its config | ${REPO_WHERE} |
| Code | ${CODE_DESC_RECEIPT} | in the repo |
| Content | ${CONTENT_DESC} | in the repo |
| Media | $(plural "$MEDIA_FILES" file) | public/ and src/assets, in the repo |
| CMS | ${CMS:-none wired} | ${CMS_WHERE} |
| Hosting | ${HOSTING} | your account once transferred |
| Domain | ${DOMAIN} | your registrar, it was always yours |
| Palate state | ${PALATE_STATE} | .palate/ in the repo |

## Environment variables

Named here, never printed. The values were not read by this handover and do not travel: each
one is re-minted by you, in your own account, which is the point.

${ENV_BLOCK}

## What needs a person

Cross-provider transfers need the receiving party to accept, and some need a human in a
dashboard. No script can complete these, so they are listed rather than pretended.

${CHECKLIST}
\`\`\`
gh api -X DELETE "repos/<new-owner>/${GH_REPO:-<repo>}/collaborators/<login>"
gh secret delete <NAME> --repo <new-owner>/${GH_REPO:-<repo>}
\`\`\`

## Running it

- Local: \`npm install\`, then \`npm run dev\`
- Deploy: push to \`main\`, CI builds and deploys
- Checks before publishing, in Claude Code: \`/palate-website-builder:check\`
- Checks before publishing, on any other tool, no install:
  \`curl -fsSL https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/main/scripts/palate-verify.sh | bash -s -- ./\`

## What still needs Palate

Nothing. The taste library (\`mcp__palate__refs_*\`) makes new pages better and is a paid
subscription, but the site builds, deploys and is maintainable without it. The content runtime
in this repo works with no account and no MCP.
MD
}

# Never destroy a HANDOVER.md we did not write. Re-running a handover is normal and overwriting
# our own receipt is correct, so the test is authorship, not existence: our receipts open with
# "# Ownership:". Anything else is the customer's or a colleague's, possibly the negotiated terms
# of this very handover, and losing it to a command whose whole purpose is trust is unacceptable.
# The check runs BEFORE the transfer, not at the moment of writing: refusing after the repo has
# moved would leave exactly the half-completed state this script exists to avoid.
if [ "$MODE" != "dry" ] && [ -f HANDOVER.md ] && ! head -1 HANDOVER.md | grep -q '^# Ownership:'; then
  die_blocked "HANDOVER.md already exists here and was not written by this command (it does not start with '# Ownership:'). Nothing was moved or overwritten. Move or rename it, then re-run."
fi

case "$MODE" in
  dry)
    echo "RECEIPT PREVIEW (HANDOVER.md, not written)"
    echo "-----------------------------------------"
    receipt
    echo "-----------------------------------------"
    echo
    echo "DRY RUN. Nothing moved, nothing written, no account touched."
    echo "Run with --execute --to <github-owner> to do it for real."
    exit 0
    ;;
  receipt)
    receipt > HANDOVER.md
    echo "RECEIPT_WRITTEN: ${DIR}/HANDOVER.md"
    echo "Nothing was transferred. Commit it: git add HANDOVER.md && git commit -m 'ownership receipt'"
    exit 0
    ;;
  execute)
    [ -n "$TO" ]      || die_usage "--execute needs --to <github-owner>"
    # Refuse before the transfer call, not after. git answers for the enclosing repo here, so the
    # only thing --execute could transfer is someone else's repository.
    [ -z "$ENCLOSING" ] || die_blocked "this directory is not its own git repo: it sits inside ${ENCLOSING}${ENCLOSING_REMOTE:+, which is ${ENCLOSING_REMOTE}}. Transferring would hand over THAT repository, not this site. Split the site into its own repo first (git init here, push it), then re-run."
    [ -n "$GH_SLUG" ] || die_blocked "origin is not a GitHub remote (${REMOTE:-none}), so there is no repo transfer to run. Push the repo to their host by hand, then re-run with --receipt-only."
    have_net gh       || die_blocked "gh is unavailable (or PALATE_HANDOVER_NO_NETWORK is set). Transfer by hand: gh api -X POST repos/${GH_SLUG}/transfer -f new_owner='${TO}'"

    echo "transferring ${GH_SLUG} to ${TO}..."
    if ! gh api -X POST "repos/${GH_SLUG}/transfer" -f new_owner="$TO" >/dev/null 2>&1; then
      die_blocked "the transfer call failed. Nothing else was touched and no receipt was written. Check: gh api repos/${GH_SLUG}"
    fi

    # Verify from the far side. An organisation destination holds the transfer as an invitation,
    # which is a normal pending state, not a failure, so it is reported rather than treated as one.
    if gh repo view "${TO}/${GH_REPO}" --json nameWithOwner >/dev/null 2>&1; then
      echo "TRANSFER_VERIFIED: github.com/${TO}/${GH_REPO}"
      REPO_WHERE="github.com/${TO}/${GH_REPO}"
      git remote set-url origin "git@github.com:${TO}/${GH_REPO}.git" 2>/dev/null \
        && echo "origin repointed at ${TO}/${GH_REPO}"
    else
      REPO_WHERE="github.com/${GH_SLUG} (transfer to ${TO} awaiting acceptance)"
      echo "TRANSFER_PENDING: ${TO} has an invitation to accept. Nothing is broken; wait for it,"
      echo "  then verify: gh repo view ${TO}/${GH_REPO}"
    fi

    receipt > HANDOVER.md
    echo "RECEIPT_WRITTEN: ${DIR}/HANDOVER.md"
    echo
    echo "Access was NOT revoked. Do that after the transfer verifies, using the commands in the"
    echo "receipt, and only for logins that are ours."
    exit 0
    ;;
esac
