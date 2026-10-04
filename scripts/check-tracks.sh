#!/usr/bin/env bash
# check-tracks.sh - the three-track invariants, enforced rather than documented.
#
#   ./scripts/check-tracks.sh [path-to-skill-clone]
#
# ============================== WHY THIS EXISTS ==============================
#
# Three plugins ship from one marketplace and one source repo:
#
#   palate-website-builder   what customers install. Moves ONLY on a deliberate
#                            promotion. Vendored from the skill repo's `main`.
#   palate-beta              the unstable track. Vendored from `beta`. Expected
#                            to have bugs. Never used for client work.
#   palate-classic           the 1.16 builder kept installable after 2.0. Frozen.
#                            Vendored from `classic`, fixes only.
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

read -r PROD_V BETA_V PROD_SRC BETA_SRC CLASSIC_V CLASSIC_SRC <<EOF
$(node -e "
const m=require('./$MJ');
const g=n=>m.plugins.find(p=>p.name===n)||{};
const p=g('palate-website-builder'), b=g('palate-beta'), c=g('palate-classic');
console.log([p.version||'-', b.version||'-', p.source||'-', b.source||'-', c.version||'-', c.source||'-'].join(' '));
")
EOF

# 1. All three tracks exist, and only those. A fourth entry is either a mistake or
#    a decision nobody wrote down.
n=$(node -e "console.log(require('./$MJ').plugins.length)")
[ "$n" = "3" ] && ok "marketplace declares exactly the three tracks" \
  || bad "marketplace declares $n plugin(s); expected palate-website-builder, palate-beta and palate-classic only"

# 2. Sources are vendored, never a git URL. A URL source reintroduces the SSH
#    install failure that made 4 of 5 early users unable to install at all.
case "$PROD_SRC" in ./plugins/*) ok "prod source is vendored ($PROD_SRC)";; *) bad "prod source is not vendored: $PROD_SRC";; esac
case "$BETA_SRC" in ./plugins/*) ok "beta source is vendored ($BETA_SRC)";; *) bad "beta source is not vendored: $BETA_SRC";; esac
case "$CLASSIC_SRC" in ./plugins/*) ok "classic source is vendored ($CLASSIC_SRC)";; *) bad "classic source is not vendored: $CLASSIC_SRC";; esac

# 3. THE VERSION SHAPES CANNOT BE CONFUSED. A prod version carrying -beta means
#    an unstable build reached the customer entry; a beta version WITHOUT it can
#    be mistaken for a release by anyone reading a changelog.
case "$PROD_V" in *-beta*|*-alpha*|*-rc*) bad "prod version '$PROD_V' is a prerelease; customers must never be on one";; *) ok "prod version is a release ($PROD_V)";; esac
case "$BETA_V" in *-beta*) ok "beta version is marked prerelease ($BETA_V)";; *) bad "beta version '$BETA_V' is not marked -beta; it can be mistaken for a release";; esac
# Classic is frozen at 1.16: a release, never a prerelease, and never anything but 1.16.x. A classic
# version that moved off 1.16 means a newer tree was synced into the plugin people chose to avoid it.
case "$CLASSIC_V" in 1.16.*-*) bad "classic version '$CLASSIC_V' is a prerelease";; 1.16.*) ok "classic version is a frozen 1.16 release ($CLASSIC_V)";; *) bad "classic version '$CLASSIC_V' is not 1.16.x; classic is frozen at 1.16";; esac

# 4. Each vendored plugin.json agrees with its marketplace entry. The vendored
#    copy is what actually installs, so a mismatch means the marketplace is
#    advertising something other than what it ships.
for pair in "palate-website-builder:$PROD_V" "palate-beta:$BETA_V" "palate-classic:$CLASSIC_V"; do
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

# 5. NO TRACK REFERS TO ANOTHER'S COMMANDS. Commands namespace by plugin name, so
#    a leaked prefix is a command that silently does not exist.
leak_prod=$(grep -rlE '/palate-(beta|classic):' plugins/palate-website-builder 2>/dev/null | head -3)
[ -z "$leak_prod" ] && ok "prod carries no /palate-beta: or /palate-classic: references" \
  || bad "prod references another track's commands: $(echo "$leak_prod" | tr '\n' ' ')"
leak_beta=$(grep -rlE '/palate-(website-builder|classic):' plugins/palate-beta/commands 2>/dev/null | head -3)
[ -z "$leak_beta" ] && ok "beta commands carry no /palate-website-builder: or /palate-classic: references" \
  || bad "beta references another track's commands (the sync rewrite did not run): $(echo "$leak_beta" | tr '\n' ' ')"
leak_classic=$(grep -rlE --include='*.md' '/palate-(website-builder|beta):' plugins/palate-classic 2>/dev/null | head -3)
[ -z "$leak_classic" ] && ok "classic docs carry no /palate-website-builder: or /palate-beta: references" \
  || bad "classic references another track's commands (the sync rewrite did not run): $(echo "$leak_classic" | tr '\n' ' ')"

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
  classic_v=$(git -C "$SKILL" show classic:VERSION 2>/dev/null | tr -d '[:space:]')
  vend_c=$(tr -d '[:space:]' < plugins/palate-classic/VERSION 2>/dev/null)
  [ -n "$classic_v" ] && [ "$classic_v" = "$vend_c" ] \
    && ok "classic vendor matches the skill classic branch (VERSION $classic_v)" \
    || bad "classic vendor is ${vend_c:-missing} but the skill classic branch is ${classic_v:-missing}"
else
  echo "skip - no skill clone at $SKILL, cannot check prod/main correspondence"
fi

# 7. THIS CLONE IS NOT BEHIND ORIGIN. There is more than one clone of this repo on
#    a typical machine (the plugin cache under ~/.claude/plugins/marketplaces, plus
#    however many working clones), and they drift. Releasing from a stale one
#    pushes marketplace.json BACKWARDS and silently clobbers whatever pin the last
#    release set: a customer's `/plugin marketplace update palate` then quietly
#    downgrades them. This has already been documented as a near-miss once.
if git rev-parse --git-dir >/dev/null 2>&1; then
  git fetch -q origin 2>/dev/null || true
  behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  if [ "${behind:-0}" -eq 0 ]; then
    ok "this clone is up to date with origin"
  else
    bad "this clone is $behind commit(s) BEHIND origin/main. Pull before releasing, or you will push the pin backwards. Clone: $(pwd)"
  fi
fi

# 8. THE MCP REPORTS THE VERSION CUSTOMERS ARE ACTUALLY ON. `palate_setup` answers "what am I
#    running?", and its constant is the fifth hand-maintained version string across three
#    repos. It has drifted FOUR times: 1.1.0 while 1.4.x shipped, then 1.4.3, then stuck at
#    1.7.0 against a shipped 1.9.0, and last at 1.10.0 against 1.16.0, six releases stale. A
#    stale answer here is worse than none, because it is the number an agent reads back to a
#    customer. The constant lives in one place now (mcp-server lib/plugin-version.ts) and this
#    is what makes the next promotion move it: bump the pin without the constant and this
#    fails, by name.
#
#    The MCP clone is not on every machine that runs this script, so its absence is a SKIP with
#    the path printed, never a failure and never silence.
MCP="${PALATE_MCP_DIR:-$HOME/dev/palate/mcp-server}"
PV="$MCP/lib/plugin-version.ts"
if [ -f "$PV" ]; then
  mcp_v=$(node -e "
    const s=require('fs').readFileSync(process.argv[1],'utf8');
    const m=s.match(/PLUGIN_VERSION\s*=\s*process\.env\.PALATE_PLUGIN_VERSION\s*\?\?\s*[\"'\`]([^\"'\`]+)/);
    console.log(m ? m[1] : '');
  " "$PV")
  if [ -z "$mcp_v" ]; then
    bad "cannot read PLUGIN_VERSION out of $PV; the constant moved or its shape changed"
  else
    [ "$mcp_v" = "$PROD_V" ] \
      && ok "the MCP reports the prod plugin version ($mcp_v)" \
      || bad "the MCP's PLUGIN_VERSION is '$mcp_v' but the prod pin is '$PROD_V': palate_setup will tell customers the wrong version. Fix $PV"
  fi
else
  echo "skipped: mcp-server not found at $MCP (set PALATE_MCP_DIR to check the MCP's PLUGIN_VERSION)"
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
