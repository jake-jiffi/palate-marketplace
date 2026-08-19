#!/usr/bin/env bash
# scripts/state-init.sh and scripts/brand-state-init.sh used to `cat >` over whatever was
# already there, so re-running either on a resumed or repeated build silently destroyed the
# build state. For the site build that is two separate losses: every phase reverts to
# "pending" (which is how a partial build is resumable at all), and brandMode reverts to its
# brand-creation default, which is read by the DIVERGE wall in hooks/palate-pretooluse.mjs to
# decide WHICH axes the build must diverge on. A brand-provided build re-armed on the
# brand-creation bar is then told to vary the colours of a brand it was handed.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

cd "$T"

# --------------------------------------------------------------------------- site state
bash "$DIR/state-init.sh" acme "Acme Pty Ltd" acme.test preview brand-provided >/dev/null 2>&1 \
  || bad "first init should succeed"
[ -f .palate-skill-state.json ] && ok "first init writes the state file" || bad "first init writes the state file"

# Simulate a build in progress: a completed phase and a brand mode that must not be lost.
node -e '
const fs=require("fs");const p=".palate-skill-state.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));
s.phases.scaffold.status="complete";fs.writeFileSync(p,JSON.stringify(s,null,2));'

if bash "$DIR/state-init.sh" acme "Acme Pty Ltd" acme.test preview brand-creation >/dev/null 2>&1; then
  bad "a second init must be refused"
else
  ok "a second init is refused (non-zero exit)"
fi

stage="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-skill-state.json","utf8")).phases.scaffold.status)')"
mode="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-skill-state.json","utf8")).brandMode)')"
[ "$stage" = "complete" ] && ok "the refused init left the phase progress intact" || bad "the refused init left the phase progress intact (got $stage)"
[ "$mode" = "brand-provided" ] && ok "the refused init left brandMode intact" || bad "the refused init left brandMode intact (got $mode)"

# The refusal has to say what to do instead, or it is just an obstacle.
msg="$(bash "$DIR/state-init.sh" acme "Acme Pty Ltd" acme.test 2>&1 >/dev/null || true)"
case "$msg" in
  *state-resume*--force*) ok "the refusal names both the resume path and --force" ;;
  *) bad "the refusal names both the resume path and --force (got: $msg)" ;;
esac

if bash "$DIR/state-init.sh" acme "Acme Pty Ltd" acme.test preview brand-creation --force >/dev/null 2>&1; then
  ok "--force overwrites deliberately"
else
  bad "--force overwrites deliberately"
fi
mode="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-skill-state.json","utf8")).brandMode)')"
[ "$mode" = "brand-creation" ] && ok "--force really did rewrite the file" || bad "--force really did rewrite the file (got $mode)"

# --force must not be mistaken for a positional argument.
rm -f .palate-skill-state.json
bash "$DIR/state-init.sh" --force zed "Zed" zed.test production brand-provided >/dev/null 2>&1
slug="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-skill-state.json","utf8")).client.slug)')"
st="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-skill-state.json","utf8")).stage)')"
[ "$slug" = "zed" ] && [ "$st" = "production" ] && ok "--force is stripped wherever it sits, positionals keep their order" \
  || bad "--force is stripped wherever it sits (slug=$slug stage=$st)"

# Argument validation must still fire.
rm -f .palate-skill-state.json
if bash "$DIR/state-init.sh" a b c nonsense >/dev/null 2>&1; then
  bad "an invalid stage is still rejected"
else
  ok "an invalid stage is still rejected"
fi

# -------------------------------------------------------------------------- brand state
rm -f .palate-brand-state.json
bash "$DIR/brand-state-init.sh" acme "Acme" >/dev/null 2>&1
node -e '
const fs=require("fs");const p=".palate-brand-state.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));
s.steps.packagePublished="complete";fs.writeFileSync(p,JSON.stringify(s,null,2));'
if bash "$DIR/brand-state-init.sh" acme "Acme" >/dev/null 2>&1; then
  bad "a second brand init must be refused"
else
  ok "a second brand init is refused"
fi
pub="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".palate-brand-state.json","utf8")).steps.packagePublished)')"
[ "$pub" = "complete" ] && ok "published work is not marked pending again" || bad "published work is not marked pending again (got $pub)"
bash "$DIR/brand-state-init.sh" acme "Acme" --force >/dev/null 2>&1 && ok "brand --force overwrites" || bad "brand --force overwrites"

echo "----"; echo "hook-state-init-force.test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
