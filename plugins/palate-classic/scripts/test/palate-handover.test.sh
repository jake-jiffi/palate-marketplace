#!/usr/bin/env bash
# Tests scripts/palate-handover.sh. Hermetic: PALATE_HANDOVER_NO_NETWORK=1 for every run, so
# nothing reaches gh, Vercel or Sanity and the suite behaves the same on a plane as in CI.
#
# The four things worth proving, in the order they can hurt someone:
#   1. The dry run changes NOTHING. Asserted with a cksum of every file plus the directory
#      listing, taken before and after, because this command is demonstrated live in front of a
#      customer and a stray write would be a breach of the promise it exists to make.
#   2. Secrets are never printed. The fixture's .env holds real-looking values; the run must
#      name every variable and reveal no value.
#   3. The receipt lists every category, so nobody discovers a forgotten asset a month later.
#   4. It refuses cleanly on a directory that is not a site, rather than inventing a plan.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SUT="$DIR/../palate-handover.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/palate-handover-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export PALATE_HANDOVER_NO_NETWORK=1

pass=0; fail=0
ok()   { echo "ok   - $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL - $1"; fail=$((fail + 1)); }
check() { # <desc> <want-rc> <cmd...>
  local desc="$1" want="$2"; shift 2
  "$@" >/dev/null 2>&1; local rc=$?
  if [ "$rc" -eq "$want" ]; then ok "$desc (rc=$rc)"; else bad "$desc (rc=$rc, want $want)"; fi
}
has()  { # <desc> <needle> <file>
  if grep -qF -- "$2" "$3"; then ok "$1"; else bad "$1 (missing: $2)"; fi
}
hasnt() { # <desc> <needle> <file>
  if grep -qF -- "$2" "$3"; then bad "$1 (LEAKED: $2)"; else ok "$1"; fi
}

# A full site: git repo with a GitHub origin, Vercel link, Sanity, content, media, .palate state,
# and a .env carrying values that must never surface.
SITE="$TMP/acme"
mkdir -p "$SITE"/{src/pages,src/content/posts,public,.palate/baselines,.palate/brain,.vercel}
cd "$SITE" || exit 1
printf '{ "name": "acme-plumbing", "dependencies": { "astro": "5.1.1" } }\n' > package.json
printf 'import vercel from "@astrojs/vercel";\nexport default { site: "https://acmeplumbing.com.au" };\n' > astro.config.mjs
printf 'RESEND_API_KEY=re_live_SUPERSECRETVALUE\nexport TURNSTILE_SECRET=0xTOPSECRETVALUE\n# a comment\n' > .env
printf 'PUBLIC_EXPLORE_MODE=false\n' > .env.example
printf '{"projectId":"prj_abc123","orgId":"team_x"}\n' > .vercel/project.json
printf "export default { api: { projectId: '7x2k9abc' } }\n" > sanity.cli.ts
echo hi > src/pages/index.astro
echo p  > src/content/posts/one.md
echo i  > public/logo.svg
echo '{}' > .palate/baselines/root.json
echo '# facts' > .palate/brain/facts.md
printf '{"a":1}\n{"a":2}\n' > .palate/ledger.jsonl
git init -q . >/dev/null 2>&1
git add -A >/dev/null 2>&1
git -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1
git remote add origin git@github.com:palate-projects/acme-plumbing.git

# A directory that is emphatically not a site: an ordinary npm package.
NOTASITE="$TMP/notasite"; mkdir -p "$NOTASITE/lib"
printf '{ "name": "some-lib", "dependencies": { "lodash": "4" } }\n' > "$NOTASITE/package.json"
EMPTY="$TMP/empty"; mkdir -p "$EMPTY"

# Fingerprint: content of every file plus the listing, so a new, deleted or edited file all show.
fingerprint() { ( cd "$1" && find . -type f -not -path './.git/*' | sort | tee "$TMP/ls.$2" | \
                  xargs cksum 2>/dev/null ) ; }

# ---------------------------------------------------------------------------- 0. it parses
check "palate-handover.sh is valid bash"                    0 bash -n "$SUT"

# ---------------------------------------------------------------------------- 1. dry run is inert
fingerprint "$SITE" before > "$TMP/fp.before"
bash "$SUT" "$SITE" --to acmeplumbing > "$TMP/dry.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "dry run exits 0" || bad "dry run exits 0 (rc=$rc)"
fingerprint "$SITE" after > "$TMP/fp.after"
if diff -q "$TMP/fp.before" "$TMP/fp.after" >/dev/null; then
  ok "dry run changed nothing (cksum over every file identical)"
else
  bad "dry run MODIFIED the project"; diff "$TMP/fp.before" "$TMP/fp.after" | head
fi
[ -f "$SITE/HANDOVER.md" ] && bad "dry run wrote HANDOVER.md" || ok "dry run wrote no HANDOVER.md"
has "dry run is explicit that it is a dry run" "DRY RUN. Nothing moved" "$TMP/dry.out"
# --dry-run is the DEFAULT, so passing it must behave identically. This is the flag a customer
# watches you type, so a difference between stating it and omitting it would be a real defect.
bash "$SUT" "$SITE" --dry-run --to acmeplumbing > "$TMP/dry2.out" 2>&1
sed 's/^/x/' "$TMP/dry.out" > "$TMP/a"; sed 's/^/x/' "$TMP/dry2.out" > "$TMP/b"
diff -q "$TMP/a" "$TMP/b" >/dev/null && ok "--dry-run matches the default byte for byte" \
                                     || bad "--dry-run differs from the default"

# ---------------------------------------------------------------------------- 2. no secrets
hasnt "the RESEND value never printed"    "re_live_SUPERSECRETVALUE" "$TMP/dry.out"
hasnt "the TURNSTILE value never printed" "0xTOPSECRETVALUE"         "$TMP/dry.out"
has   "but RESEND_API_KEY is named"       "RESEND_API_KEY"           "$TMP/dry.out"
has   "and TURNSTILE_SECRET is named"     "TURNSTILE_SECRET"         "$TMP/dry.out"
has   "and the exported name is caught"   "PUBLIC_EXPLORE_MODE"      "$TMP/dry.out"

# ---------------------------------------------------------------------------- 3. every category
# Order matters: the exit-code check runs the command too, and without --to it writes a receipt
# with a different first line. Assert the code first, then write the one the assertions read.
check "--receipt-only exits 0"                              0 bash "$SUT" "$SITE" --receipt-only
bash "$SUT" "$SITE" --receipt-only --to acmeplumbing > "$TMP/receipt.out" 2>&1
R="$SITE/HANDOVER.md"
if [ -f "$R" ]; then ok "--receipt-only wrote HANDOVER.md"; else bad "--receipt-only wrote no HANDOVER.md"; fi
has "receipt: the repo"           "github.com/palate-projects/acme-plumbing" "$R"
has "receipt: the code history"   "full history"              "$R"
has "receipt: the content"        "| Content |"               "$R"
has "receipt: the media"          "| Media |"                 "$R"
has "receipt: the CMS"            "7x2k9abc"                  "$R"
has "receipt: the hosting"        "prj_abc123"                "$R"
has "receipt: the domain"         "acmeplumbing.com.au"       "$R"
has "receipt: the env var names"  "RESEND_API_KEY"            "$R"
has "receipt: the .palate state"  ".palate/ in the repo"      "$R"
has "receipt: what needs a person" "## What needs a person"   "$R"
has "receipt: the Vercel truth"   "no CLI transfer"           "$R"
has "receipt: the Sanity org step" "Sanity organisation"      "$R"
has "receipt: how to revoke us"   "gh secret delete"          "$R"
has "receipt: how to run it"      "npm run dev"               "$R"
has "receipt: what still needs Palate" "## What still needs Palate" "$R"
hasnt "receipt leaks no secret value" "re_live_SUPERSECRETVALUE" "$R"
# The preview a customer reads must be the document they get. Compare the dry run's preview
# block against the written file: a receipt that drifts from its preview is a bait and switch.
sed -n '/^# Ownership:/,/works with no account and no MCP\./p' "$TMP/dry.out" > "$TMP/preview.md"
diff -q "$TMP/preview.md" "$R" >/dev/null && ok "the dry-run preview is the receipt, byte for byte" \
                                          || bad "the preview and the written receipt differ"
rm -f "$R"

# ---------------------------------------------------------------------------- 4. refusals
check "refuses a plain npm package (not a site)"            2 bash "$SUT" "$NOTASITE"
check "refuses an empty directory"                          2 bash "$SUT" "$EMPTY"
check "refuses a path that does not exist"                  2 bash "$SUT" "$TMP/nope"
check "refuses with no directory at all"                    2 bash "$SUT"
check "refuses an unknown option"                           2 bash "$SUT" "$SITE" --transfer-everything
check "refuses --to with no value"                          2 bash "$SUT" "$SITE" --to
bash "$SUT" "$NOTASITE" > "$TMP/refuse.out" 2>&1
has "the refusal says why, and where to point it" "NOT_A_SITE" "$TMP/refuse.out"

# ---------------------------------------------------------------------------- 5. execute guards
# --execute must never half-complete. With no --to it is a usage error; with no reachable gh it
# blocks (3) and writes nothing, rather than writing a receipt for a transfer that never ran.
check "--execute without --to is a usage error"             2 bash "$SUT" "$SITE" --execute
check "--execute blocks when gh is unreachable"             3 bash "$SUT" "$SITE" --execute --to acmeplumbing
[ -f "$SITE/HANDOVER.md" ] && bad "a blocked --execute still wrote a receipt" \
                           || ok "a blocked --execute wrote nothing"
bash "$SUT" "$SITE" --execute --to acmeplumbing > "$TMP/blocked.out" 2>&1
has "the block hands over the manual command" "gh api -X POST" "$TMP/blocked.out"

# A site whose origin is not GitHub cannot be transferred by this script, and must say so
# instead of silently doing nothing.
NOGH="$TMP/nogh"; cp -R "$SITE" "$NOGH"
git -C "$NOGH" remote set-url origin /srv/git/acme.git 2>/dev/null
check "--execute blocks on a non-GitHub remote"             3 bash "$SUT" "$NOGH" --execute --to acmeplumbing

# ---------------------------------------------------------------------------- 6. thin site
# A site with no CMS, no Vercel link and no .palate state still has to produce a usable plan:
# the exit works for the simplest build we ship, not only the fully-wired one.
THIN="$TMP/thin"; mkdir -p "$THIN/src/pages"
printf '{ "name": "thin", "dependencies": { "astro": "5.1.1" } }\n' > "$THIN/package.json"
echo hi > "$THIN/src/pages/index.astro"
bash "$SUT" "$THIN" > "$TMP/thin.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "a bare Astro site still plans" || bad "a bare Astro site failed (rc=$rc)"
has "thin site reports no CMS"        "none wired"              "$TMP/thin.out"
has "thin site reports no env vars"   "None found in this repo" "$TMP/thin.out"
has "thin site still carries the checklist" "## What needs a person" "$TMP/thin.out"

# ---------------------------------------------------------------------------- 7. hostile input
# A project directory is customer data. A path with spaces, and file contents holding shell
# metacharacters, must be reported literally and must never be evaluated.
ODD="$TMP/jo's site (v2)"; mkdir -p "$ODD/src/pages"
printf '{ "name": "$(touch %s/PWNED)", "dependencies": { "astro": "5.1.1" } }\n' "$TMP" > "$ODD/package.json"
printf 'export default { api: { projectId: %s } }\n' "'\`touch $TMP/PWNED2\`'" > "$ODD/sanity.cli.ts"
printf 'DB_URL=postgres://u:p@h/db?x=1#frag\nEMPTY_ONE=\n  SPACED  =  value\nnot-a-var\n' > "$ODD/.env"
echo x > "$ODD/src/pages/i.astro"
bash "$SUT" "$ODD" > "$TMP/odd.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "a path with spaces and an apostrophe still plans" || bad "odd path failed (rc=$rc)"
[ -e "$TMP/PWNED" ] || [ -e "$TMP/PWNED2" ] && bad "file contents were EVALUATED as shell" \
                                            || ok "shell metacharacters in files are printed, never run"
has   "an env name with a URL value is listed"  "DB_URL"       "$TMP/odd.out"
hasnt "and that URL value never appears"        "postgres://"  "$TMP/odd.out"
hasnt "nor does a password-shaped fragment"     "u:p@h"        "$TMP/odd.out"
has   "an empty-valued name is still listed"    "EMPTY_ONE"    "$TMP/odd.out"

# A site scaffolded INSIDE a bigger checkout (a monorepo, or the template that ships inside the
# skill repo). git happily answers for the enclosing repo, so an unguarded run names someone
# else's repository as the thing being handed over, and --execute calls the transfer endpoint on
# it. This is the most expensive mistake available to this script, so it gets the most tests.
PARENT="$TMP/parent"; mkdir -p "$PARENT"
git -C "$PARENT" init -q . >/dev/null 2>&1
git -C "$PARENT" remote add origin git@github.com:palate-projects/OUR-OWN-REPO.git
echo readme > "$PARENT/README.md"
git -C "$PARENT" add -A >/dev/null 2>&1
git -C "$PARENT" -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1
NESTED="$PARENT/sites/acme"; mkdir -p "$NESTED/src/pages"
printf '{ "name": "nested", "dependencies": { "astro": "5.1.1" } }\n' > "$NESTED/package.json"
echo x > "$NESTED/src/pages/i.astro"
bash "$SUT" "$NESTED" --receipt-only > "$TMP/nested.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "a nested site still plans" || bad "a nested site failed (rc=$rc)"
hasnt "a nested site does not claim the enclosing repo as its own" \
      "github.com/palate-projects/OUR-OWN-REPO" "$TMP/nested.out"
has   "it says the site is not its own repo"    "NOT ITS OWN REPO"        "$TMP/nested.out"
has   "and the receipt says so too"             "not yet its own repo"    "$NESTED/HANDOVER.md"
hasnt "the receipt does not claim the enclosing history" "full history"   "$NESTED/HANDOVER.md"
# The one that would actually cost money: --execute must refuse rather than transfer the parent.
check "--execute refuses on a nested site"                  3 bash "$SUT" "$NESTED" --execute --to acmeplumbing
bash "$SUT" "$NESTED" --execute --to acmeplumbing > "$TMP/nested-x.out" 2>&1
has   "the refusal names the repo it would have taken" "OUR-OWN-REPO" "$TMP/nested-x.out"
has   "and says what to do instead"                    "Split the site into its own repo" "$TMP/nested-x.out"
hasnt "and it never reached the transfer endpoint"     "transferring"  "$TMP/nested-x.out"
rm -f "$NESTED/HANDOVER.md"
# The guard must not misfire on a normal site. On macOS /tmp is a symlink to /private/tmp, so a
# naive root comparison flags every fixture as nested; SITE is a real repo and must stay one.
has "a real repo is still recognised as its own" "github.com/palate-projects/acme-plumbing" "$TMP/dry.out"

# A remote URL carrying credentials. This is the leak the "no secrets" promise is most likely to
# spring in real life: an HTTPS remote holding a PAT is ordinary, and both the plan and the
# receipt print the remote when it is not a GitHub URL. A receipt is a document the customer
# keeps and forwards, so a token reaching it is worse than one reaching the terminal.
CREDS="$TMP/creds"; mkdir -p "$CREDS/src/pages"
printf '{ "name": "creds", "dependencies": { "astro": "5.1.1" } }\n' > "$CREDS/package.json"
echo x > "$CREDS/src/pages/i.astro"
git -C "$CREDS" init -q . >/dev/null 2>&1
git -C "$CREDS" add -A >/dev/null 2>&1
git -C "$CREDS" -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1
git -C "$CREDS" remote add origin 'https://jake:ghp_TOKENINTHEURL@gitlab.com/acme/site.git'
bash "$SUT" "$CREDS" --receipt-only > "$TMP/creds.out" 2>&1
hasnt "a PAT in the remote URL never reaches the plan"    "ghp_TOKENINTHEURL" "$TMP/creds.out"
hasnt "and never reaches the receipt"                     "ghp_TOKENINTHEURL" "$CREDS/HANDOVER.md"
has   "the redaction is visible, not silent"              "credentials-redacted" "$CREDS/HANDOVER.md"
has   "and the host survives so the line is still useful" "gitlab.com/acme/site.git" "$CREDS/HANDOVER.md"
rm -f "$CREDS/HANDOVER.md"
# The bare-token form has no colon, so a redactor that only looks for user:pass would miss it.
git -C "$CREDS" remote set-url origin 'https://ghp_BARETOKEN@gitlab.com/acme/site.git'
bash "$SUT" "$CREDS" > "$TMP/creds2.out" 2>&1
hasnt "a bare-token remote is redacted too" "ghp_BARETOKEN" "$TMP/creds2.out"
# Redaction must not break host parsing: a token-bearing GitHub remote still has to resolve to
# the right slug, or the fix would trade a leak for a wrong transfer target.
git -C "$CREDS" remote set-url origin 'https://ghp_BARETOKEN@github.com/palate-projects/creds.git'
bash "$SUT" "$CREDS" > "$TMP/creds3.out" 2>&1
has   "a token-bearing GitHub remote still resolves its slug" "github.com/palate-projects/creds" "$TMP/creds3.out"
hasnt "and still does not print the token"                    "ghp_BARETOKEN" "$TMP/creds3.out"
# ssh://git@host is userinfo but not a credential, so it must survive intact.
git -C "$CREDS" remote set-url origin 'ssh://git@github.com/palate-projects/creds.git'
bash "$SUT" "$CREDS" > "$TMP/creds4.out" 2>&1
has "ssh://git@ is left alone, it is a convention not a secret" "github.com/palate-projects/creds" "$TMP/creds4.out"

# A git repo with no commits at all: real on a site scaffolded minutes ago.
FRESH="$TMP/fresh"; mkdir -p "$FRESH/src/pages"
printf '{ "name": "fresh", "dependencies": { "astro": "5.1.1" } }\n' > "$FRESH/package.json"
echo x > "$FRESH/src/pages/i.astro"; git -C "$FRESH" init -q . >/dev/null 2>&1
check "a git repo with no commits still plans"              0 bash "$SUT" "$FRESH"

# ---------------------------------------------------------------------------- 8. execute path
# The transfer branch cannot be exercised against real GitHub, so gh is stubbed. PATH is pinned
# to the stub directory and the fixture points at an owner that does not exist, so a stub that
# failed to shadow would 404 rather than move somebody's repository.
BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "api -X")    exit 0 ;;                                   # the transfer call
  "repo view") [ "${GH_VIEW_FAILS:-0}" = "1" ] && exit 1; echo '{}'; exit 0 ;;
  "secret list") echo "PALATE_DEPLOY_TOKEN"; exit 0 ;;
esac
case "$*" in *collaborators*) echo "palate-ops"; exit 0 ;; esac
exit 0
STUB
chmod +x "$BIN/gh"

XFER="$TMP/xfer"; cp -R "$SITE" "$XFER"
git -C "$XFER" remote set-url origin "git@github.com:palate-handover-fixture-not-real/acme.git"
export GH_LOG="$TMP/gh.log"; : > "$GH_LOG"
( PATH="$BIN:/usr/bin:/bin"; unset PALATE_HANDOVER_NO_NETWORK; \
  bash "$SUT" "$XFER" --execute --to acmeplumbing ) > "$TMP/xfer.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "--execute exits 0 on a verified transfer" || bad "--execute rc=$rc"
has "it calls the transfer endpoint with the new owner" \
    "api -X POST repos/palate-handover-fixture-not-real/acme/transfer -f new_owner=acmeplumbing" "$GH_LOG"
has "it verifies from the far side"        "repo view acmeplumbing/acme" "$GH_LOG"
has "it reports the verification"          "TRANSFER_VERIFIED"           "$TMP/xfer.out"
has "it repoints origin at the new owner"  "acmeplumbing/acme" \
    <(git -C "$XFER" remote get-url origin)
[ -f "$XFER/HANDOVER.md" ] && ok "--execute writes the receipt" || bad "--execute wrote no receipt"
has "the receipt names our collaborator to remove" "palate-ops"          "$TMP/xfer.out"
has "the receipt names the secret to recreate"     "PALATE_DEPLOY_TOKEN" "$XFER/HANDOVER.md"
# The document is written after the move, so it must describe where the repo is NOW. A receipt
# that still names our organisation contradicts the transfer it is the record of.
has   "the receipt names the NEW home" "| Repo | the site, its history and its config | github.com/acmeplumbing/acme |" "$XFER/HANDOVER.md"
hasnt "and not the old one"            "github.com/palate-handover-fixture-not-real/acme |"                              "$XFER/HANDOVER.md"
has "it does not revoke access itself"     "Access was NOT revoked"      "$TMP/xfer.out"

# An organisation destination holds the transfer as an invitation. That is a pending state, not
# a failure, and it must be reported as such without repointing a remote that has not moved.
PEND="$TMP/pend"; cp -R "$SITE" "$PEND"
git -C "$PEND" remote set-url origin "git@github.com:palate-handover-fixture-not-real/acme.git"
( PATH="$BIN:/usr/bin:/bin"; unset PALATE_HANDOVER_NO_NETWORK; export GH_VIEW_FAILS=1; \
  bash "$SUT" "$PEND" --execute --to acmeplumbing ) > "$TMP/pend.out" 2>&1
has "an unaccepted transfer reads as pending, not broken" "TRANSFER_PENDING" "$TMP/pend.out"
has "the pending run still leaves a receipt"              "RECEIPT_WRITTEN"  "$TMP/pend.out"
has "and the receipt says the move is not final yet"      "awaiting acceptance" "$PEND/HANDOVER.md"
if [ "$(git -C "$PEND" remote get-url origin)" = "git@github.com:palate-handover-fixture-not-real/acme.git" ]; then
  ok "the pending run leaves origin alone"
else
  bad "the pending run repointed origin at a repo that has not moved"
fi

# ---------------------------------------------------------------------------- 9. regressions
# Four defects found by attacking the script after its own suite was green. Each one is here
# because the original suite passed while the bug was live: a test written beside the code tests
# what the author was already thinking about.

# (a) "github.com" is a SUBSTRING of "github.company.com", so a GitHub Enterprise remote parsed as
# GitHub, produced the slug "pany.com:acme/site", marked the row automatic, and sent --execute to
# the transfer endpoint with it.
GHE="$TMP/ghe"; mkdir -p "$GHE/src/pages"
printf '{ "name": "ghe", "dependencies": { "astro": "5.1.1" } }\n' > "$GHE/package.json"
echo x > "$GHE/src/pages/i.astro"
git -C "$GHE" init -q . >/dev/null 2>&1
git -C "$GHE" add -A >/dev/null 2>&1
git -C "$GHE" -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1
git -C "$GHE" remote add origin 'git@github.company.com:acme/site.git'
bash "$SUT" "$GHE" > "$TMP/ghe.out" 2>&1
hasnt "a GitHub Enterprise host is not read as github.com" "github.com/pany" "$TMP/ghe.out"
has   "and it is not promised as an automatic transfer"    "needs a person"  "$TMP/ghe.out"
check "--execute refuses a GitHub Enterprise remote"        3 bash "$SUT" "$GHE" --execute --to acme
# The far more common form must keep working, or the boundary fix has traded one bug for another.
has "a real github.com remote still parses" "github.com/palate-projects/acme-plumbing" "$TMP/dry.out"

# (b) A multi-line quoted value is ordinary dotenv. Its continuation lines are base64, and a chunk
# with no '+' or '/' reads as NAME=, so the key body was printed as a variable name into the
# receipt the customer keeps. Nothing between the quotes may ever be read.
MULTI="$TMP/multi"; mkdir -p "$MULTI/src/pages"
printf '{ "name": "multi", "dependencies": { "astro": "5.1.1" } }\n' > "$MULTI/package.json"
echo x > "$MULTI/src/pages/i.astro"
{ printf 'STRIPE_KEY=sk_live_abc\n'
  printf 'SIGNING_KEY="first-line-of-the-value\n'
  printf 'MIIEvQIBADANBgkqhkiGSMTHATLOOKSLIKEBASE64PAYLOADANDMOREOFIT=\n'
  printf 'last-line-of-the-value"\n'
  printf 'AFTER_THE_BLOCK=plain\n'; } > "$MULTI/.env"
bash "$SUT" "$MULTI" > "$TMP/multi.out" 2>&1
hasnt "a multi-line value's body is never printed as a name" \
      "MIIEvQIBADANBgkqhkiGSMTHATLOOKSLIKEBASE64PAYLOADANDMOREOFIT" "$TMP/multi.out"
has   "but the variable holding it is named"          "SIGNING_KEY"     "$TMP/multi.out"
has   "and parsing resumes after the closing quote"   "AFTER_THE_BLOCK" "$TMP/multi.out"
has   "and the ordinary name beside it survives"      "STRIPE_KEY"      "$TMP/multi.out"
# The second gate: an unquoted run too long to be a name is payload, and a skip is reported, never
# silent, because a variable nobody sets is a site that does not build on the far side.
LONG="$TMP/long"; mkdir -p "$LONG/src/pages"
printf '{ "name": "long", "dependencies": { "astro": "5.1.1" } }\n' > "$LONG/package.json"
echo x > "$LONG/src/pages/i.astro"
printf 'REAL_NAME=ok\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n' > "$LONG/.env"
bash "$SUT" "$LONG" > "$TMP/long.out" 2>&1
hasnt "an over-long unquoted run is not listed as a name" "AAAAAAAAAAAAAAAAAAAAAAAAAAAA" "$TMP/long.out"
has   "the skip is reported rather than silent"           "Skipped 1 line"               "$TMP/long.out"
has   "and the real name beside it survives"              "REAL_NAME"                    "$TMP/long.out"

# (c) HANDOVER.md was overwritten without warning. It can hold the negotiated terms of the very
# handover being run, and destroying it with a trust command is unacceptable. Ours is overwritable
# (re-running is normal); anything else blocks BEFORE the transfer, not at the moment of writing.
FOREIGN="$TMP/foreign"; mkdir -p "$FOREIGN/src/pages"
printf '{ "name": "foreign", "dependencies": { "astro": "5.1.1" } }\n' > "$FOREIGN/package.json"
echo x > "$FOREIGN/src/pages/i.astro"
printf '# Handover terms\nAgreed with the client on the 3rd.\n' > "$FOREIGN/HANDOVER.md"
check "refuses to overwrite a HANDOVER.md it did not write"  3 bash "$SUT" "$FOREIGN" --receipt-only
has "the foreign HANDOVER.md is untouched" "Agreed with the client" "$FOREIGN/HANDOVER.md"
check "and refuses before --execute can move anything"       3 bash "$SUT" "$FOREIGN" --execute --to acme
# Our own receipt must stay overwritable, or a second handover run is impossible.
OURS="$TMP/ours"; mkdir -p "$OURS/src/pages"
printf '{ "name": "ours", "dependencies": { "astro": "5.1.1" } }\n' > "$OURS/package.json"
echo x > "$OURS/src/pages/i.astro"
bash "$SUT" "$OURS" --receipt-only >/dev/null 2>&1
check "re-running over our own receipt still works"          0 bash "$SUT" "$OURS" --receipt-only
# A dry run must never be blocked by the guard: it writes nothing, so it has nothing to protect.
check "a dry run is never blocked by an existing receipt"    0 bash "$SUT" "$FOREIGN"

# (d) %-46s pads a short field and does nothing to a long one, so one long path shunted every
# column right of it out of line. This table is shown on a screen share to argue that leaving is
# easy, so it has to hold its shape.
DEEP="$TMP/a-very-long-directory-name-that-keeps-going/and-another-level/deeper-still/site"
mkdir -p "$DEEP/src/pages"
printf '{ "name": "deep", "dependencies": { "astro": "5.1.1" } }\n' > "$DEEP/package.json"
echo x > "$DEEP/src/pages/i.astro"
git -C "$DEEP" init -q . >/dev/null 2>&1
git -C "$DEEP" remote add origin "git@github.com:palate-projects/a-repo-with-a-deliberately-very-long-name-indeed.git"
bash "$SUT" "$DEEP" > "$TMP/deep.out" 2>&1
# Every row's third column must begin at the same offset. The format is two spaces, an 11-wide
# category, a space, a 46-wide field and a space, so column 61 is always the separator and the
# destination starts at column 62. Truncation is what keeps that true when a field runs long.
misaligned=0
while IFS= read -r row; do
  [ "$(printf '%s' "$row" | cut -c61)" = " " ] || misaligned=$((misaligned + 1))
  col62="$(printf '%s' "$row" | cut -c62)"
  { [ -n "$col62" ] && [ "$col62" != " " ]; } || misaligned=$((misaligned + 1))
done < <(sed -n '/^WHAT MOVES/,/^$/p' "$TMP/deep.out" | grep '^  [a-z]')
[ "$misaligned" -eq 0 ] && ok "a very long field is truncated, so the table stays aligned" \
                        || bad "the plan table misaligns on long fields ($misaligned columns off)"
has "and truncation is visible rather than silent" "..." "$TMP/deep.out"
# The receipt is the durable document and must NOT be truncated.
has "the receipt carries the untruncated value" \
    "a-repo-with-a-deliberately-very-long-name-indeed" "$TMP/deep.out"

echo "----"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
