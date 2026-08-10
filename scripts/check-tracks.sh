#!/usr/bin/env bash
# check-tracks.sh - the two-track invariants, enforced rather than documented.
#
#   ./scripts/check-tracks.sh [path-to-skill-clone]
#
# ============================== WHY THIS EXISTS ==============================
#
# Two plugins ship from one marketplace and one source repo:
#
#   palate-website-builder   what customers install. Moves ONLY on a deliberate
#                            promotion. Vendored from the skill repo's `main`.
#   palate-beta              the unstable track. Vendored from `beta`. Expected
#                            to have bugs. Never used for client work.
#
# Every failure mode here is silent, which is why it is a script and not a
# paragraph. Syncing the wrong branch into the prod vendor ships unproven work
# to paying customers and nothing looks wrong: the JSON is valid, the plugin
# installs, the version number even looks plausible. A rule in a README does not
# stop that at 11pm; a non-zero exit does.
#
# Run before every push to this repo.
#
# Exit: 0 all invariants hold, 1 one or more broken, 2 cannot check.
set -uo pipefail
cd "$(dirname "$0")/.."
SKILL="${1:-$HOME/dev/palate/skill}"
MJ=".claude-plugin/marketplace.json"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

command -v node >/dev/null 2>&1 || { echo "check-tracks: node is required." >&2; exit 2; }
[ -f "$MJ" ] || { echo "check-tracks: no $MJ; run from the marketplace repo." >&2; exit 2; }

read -r PROD_V BETA_V PROD_SRC BETA_SRC <<EOF
$(node -e "
const m=require('./$MJ');
const g=n=>m.plugins.find(p=>p.name===n)||{};
const p=g('palate-website-builder'), b=g('palate-beta');
console.log([p.version||'-', b.version||'-', p.source||'-', b.source||'-'].join(' '));
")
EOF

# 1. Both tracks exist, and only those two. A third entry is either a mistake or
#    a decision nobody wrote down.
n=$(node -e "console.log(require('./$MJ').plugins.length)")
[ "$n" = "2" ] && ok "marketplace declares exactly the two tracks" \
  || bad "marketplace declares $n plugin(s); expected palate-website-builder and palate-beta only"

# 2. Sources are vendored, never a git URL. A URL source reintroduces the SSH
#    install failure that made 4 of 5 early users unable to install at all.
case "$PROD_SRC" in ./plugins/*) ok "prod source is vendored ($PROD_SRC)";; *) bad "prod source is not vendored: $PROD_SRC";; esac
case "$BETA_SRC" in ./plugins/*) ok "beta source is vendored ($BETA_SRC)";; *) bad "beta source is not vendored: $BETA_SRC";; esac

# 3. THE VERSION SHAPES CANNOT BE CONFUSED. A prod version carrying -beta means
#    an unstable build reached the customer entry; a beta version WITHOUT it can
#    be mistaken for a release by anyone reading a changelog.
case "$PROD_V" in *-beta*|*-alpha*|*-rc*) bad "prod version '$PROD_V' is a prerelease; customers must never be on one";; *) ok "prod version is a release ($PROD_V)";; esac
case "$BETA_V" in *-beta*) ok "beta version is marked prerelease ($BETA_V)";; *) bad "beta version '$BETA_V' is not marked -beta; it can be mistaken for a release";; esac

# 4. Each vendored plugin.json agrees with its marketplace entry. The vendored
#    copy is what actually installs, so a mismatch means the marketplace is
#    advertising something other than what it ships.
for pair in "palate-website-builder:$PROD_V" "palate-beta:$BETA_V"; do
  name="${pair%%:*}"; want="${pair#*:}"
  f="plugins/$name/.claude-plugin/plugin.json"
  if [ ! -f "$f" ]; then bad "$name is declared but not vendored ($f missing)"; continue; fi
  got_n=$(node -e "console.log(require('./$f').name)")
  got_v=$(node -e "console.log(require('./$f').version)")
  [ "$got_n" = "$name" ] && ok "$name vendored plugin.json name matches" \
    || bad "$name vendored plugin.json says name='$got_n'; install keys would collide"
  [ "$got_v" = "$want" ] && ok "$name vendored version matches the marketplace ($want)" \
    || bad "$name vendored version '$got_v' != marketplace '$want'"
done

# 5. NEITHER TRACK REFERS TO THE OTHER'S COMMANDS. Commands namespace by plugin
#    name, so a leaked prefix is a command that silently does not exist.
leak_prod=$(grep -rl '/palate-beta:' plugins/palate-website-builder 2>/dev/null | head -3)
[ -z "$leak_prod" ] && ok "prod carries no /palate-beta: references" \
  || bad "prod references beta commands: $(echo "$leak_prod" | tr '\n' ' ')"
leak_beta=$(grep -rl '/palate-website-builder:' plugins/palate-beta/commands 2>/dev/null | head -3)
[ -z "$leak_beta" ] && ok "beta commands carry no /palate-website-builder: references" \
  || bad "beta references prod commands (the sync rewrite did not run): $(echo "$leak_beta" | tr '\n' ' ')"

# 6. PROD CORRESPONDS TO THE SKILL REPO'S MAIN. This is the one that catches the
#    expensive mistake: beta content synced into the prod vendor. If main and the
#    prod vendor disagree, prod is carrying something that was never released.
if [ -d "$SKILL/.git" ]; then
  main_v=$(git -C "$SKILL" show main:VERSION 2>/dev/null | tr -d '[:space:]')
  vend_v=$(tr -d '[:space:]' < plugins/palate-website-builder/VERSION 2>/dev/null)
  [ -n "$main_v" ] && [ "$main_v" = "$vend_v" ] \
    && ok "prod vendor matches skill main (VERSION $main_v)" \
    || bad "prod vendor is $vend_v but skill main is $main_v: prod is carrying unpromoted work"
  git -C "$SKILL" rev-parse --verify beta >/dev/null 2>&1 \
    && ok "skill repo has a beta branch" \
    || bad "skill repo has no 'beta' branch; beta must never be synced from main"
else
  echo "skip - no skill clone at $SKILL, cannot check prod/main correspondence"
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
