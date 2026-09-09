#!/usr/bin/env bash
# The docs may not promise what the code does not do.
#
# Every claim below was in the doctrine and false: "Lighthouse 100 is the baseline" with no
# Lighthouse anywhere in the plugin, a post-deploy form round-trip test that nothing runs, a
# WCAG 2.2 AA promise over eleven axe rules, a route cap no customer-facing page mentioned,
# and a hygiene line that led with the number rather than with what the number is.
#
# HOW TO ADD A CASE, and READ THIS BEFORE REACHING FOR `present`. `absent <desc> <file>
# <string>` and `present <desc> <file> <string>` take a path relative to the repo root and a
# literal string. Add the pair when you delete a claim and when you land the thing that makes a
# claim true again, so the doc and the code can only drift with a red test in between.
#
# BUT A GREP ONLY TESTS WHETHER SOMEONE WROTE A SENTENCE. It returns the same pass whether the
# sentence is true or false, and goes red only when the sentence is deleted. That is the right
# check for a claim about a DOCUMENT'S WORDING and it is not a check at all for a claim about
# what a SCRIPT DOES. Four assertions of the second kind shipped here in one epic; one of them
# certified a false claim for a whole review round.
#
# So: if the claim's subject is a command line, RUN IT. `runs <desc> <function>` further down
# does that, with a stubbed `npm`, `astro` and `wrangler` that record the environment each was
# given, which needs no network and no real build. Where a claim genuinely cannot be executed,
# or is executed by another suite, say so in one line at the assertion rather than leaving a
# grep that looks like verification.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

# `--` before the pattern: a string starting with a dash (`--max-routes`) is otherwise read
# as a grep option, and the check dies instead of failing.
absent() { # <desc> <file> <literal string that must NOT appear>
  local f="$ROOT/$2"
  [ -f "$f" ] || { bad "$1 ($2 does not exist, so nothing was checked)"; return; }
  grep -qF -- "$3" "$f" && bad "$1 ($2 still says '$3')" || ok "$1"
}
present() { # <desc> <file> <literal string that MUST appear>
  local f="$ROOT/$2"
  [ -f "$f" ] || { bad "$1 ($2 does not exist, so nothing was checked)"; return; }
  grep -qF -- "$3" "$f" && ok "$1" || bad "$1 ($2 does not say '$3')"
}

# ============ 1. LIGHTHOUSE. Nothing in this plugin runs it. =============================
absent "testing.md does not promise a Lighthouse baseline" \
  "references/testing.md" "Lighthouse CI (baseline 100s"
absent "connective-tissue.md does not promise a Lighthouse baseline" \
  "references/connective-tissue.md" "Lighthouse 100 is the baseline"
# What IS measured, named as what it is: a throttled lab run of the vitals, on one route.
present "testing.md says what performance IS measured" \
  "references/testing.md" "vitals.mjs"

# ============ 2. THE FORM ROUND-TRIP, which is now real and has to stay described =========
# It was promised for months and nothing ran it. E3 deleted the promise; E5 built the test, so
# the pairs flip: the placeholder must be gone, and every load-bearing part of the contract has
# to be findable in the doc AND present in the code it describes.
absent "testing.md no longer carries the E5 placeholder" \
  "references/testing.md" "Implemented by E5"
absent "testing.md no longer says the round trip is not implemented" \
  "references/testing.md" "**Not implemented."
present "the smoke-check list promises the POST, now that something makes it" \
  "references/testing.md" "a test POST to /api/contact"
present "testing.md names the smoke header" \
  "references/testing.md" "x-palate-smoke: 1"
present "testing.md names the production secret" \
  "references/testing.md" "PALATE_SMOKE_SECRET"
present "testing.md says a 2xx without the flag is a failure" \
  "references/testing.md" "A 2xx WITHOUT it is a failure, not a pass"
present "testing.md says a deployment with no endpoint skips with exit 2" \
  "references/testing.md" "2 with a printed reason"
present "testing.md says the attribute alone would never match the template" \
  'references/testing.md' 'has no action at all and posts with `fetch`'
present "testing.md says the endpoint is in the global digest" \
  'references/testing.md' 'src/pages/api` is part of the global digest'
# ...and the code that makes each of those true.
# EXECUTED BY scripts/test/contact-smoke.test.mjs, not by the line(s) below: a grep here pins the WORDING and would pass
# just as happily if the behaviour it names were reversed.
for f in templates/astro-project/src/pages/api/contact.ts templates/cms-sanity/src/pages/api/contact.ts; do
  present "$f honours the smoke header" "$f" 'SMOKE_HEADER = "x-palate-smoke"'
  present "$f gates the header on the build's own environment" "$f" "const siteEnv = import.meta.env.PUBLIC_SITE_ENV"
  present "$f opens only for an explicit non-production build" "$f" 'known && siteEnv.trim().toLowerCase() !== "production"'
  present "$f fails closed with no secret" "$f" "if (!secret) return false;"
done
# THE SECRET HAS TO BE SETTABLE. A production guard whose value nobody is told to set is a
# feature that cannot be used, and the failure it produces reads as a broken endpoint.
present "the template env example carries the smoke secret" \
  "templates/astro-project/.env.example" "PALATE_SMOKE_SECRET"
present "the Vercel env table carries the smoke secret" \
  "references/hosting-vercel.md" "PALATE_SMOKE_SECRET"
present "the Cloudflare worker config carries the smoke secret" \
  "templates/host-cloudflare/wrangler.toml" "PALATE_SMOKE_SECRET"
present "the production handover carries the smoke secret" \
  "references/production-handoff.md" "PALATE_SMOKE_SECRET"
# EXECUTED BY scripts/test/verify-form-roundtrip.test.sh, not by the line(s) below: a grep here pins the WORDING and would pass
# just as happily if the behaviour it names were reversed.
present "the deployed round trip exists" \
  "scripts/verify-form-roundtrip.sh" "x-palate-smoke: 1"
present "the deployed round trip skips with exit 2" \
  "scripts/verify-form-roundtrip.sh" "exit 2"
# THE INVOCATION, not the filename. Both scripts name the round trip in their header comment,
# so a guard on the bare filename stayed green with the call cut out of both of them, proven by
# mutation. What the call actually does is executed in verify-form-roundtrip.test.sh.
# EXECUTED BY scripts/test/verify-form-roundtrip.test.sh, not by the line(s) below: a grep here pins the WORDING and would pass
# just as happily if the behaviour it names were reversed.
for f in scripts/verify-vercel.sh scripts/verify-cloudflare.sh; do
  present "$f runs the form round trip" "$f" 'verify-form-roundtrip.sh" "$URL"'
done
# EXECUTED BY scripts/test/verify-rendered-forms.test.mjs, not by the line(s) below: a grep here pins the WORDING and would pass
# just as happily if the behaviour it names were reversed.
present "the verifier submits the form against the preview" \
  "scripts/reference-capture/verify-rendered.mjs" "form round trip"
present "the verifier works the mobile nav" \
  "scripts/reference-capture/verify-rendered.mjs" "mobile-nav-escape-dismiss"
present "the verifier works a dialog too, which the spec asks for alongside the nav" \
  "scripts/reference-capture/verify-rendered.mjs" "commandfor="
present "testing.md says which trigger shapes are discoverable" \
  "references/testing.md" "data-dialog-target"
# THE SEVERITY SPLIT. A doc that called the Escape finding blocking would send an operator
# hunting a build failure that never happens, and one that called the dead-control finding
# advisory would let a dead burger ship.
present "testing.md says the Escape finding does not block" \
  "references/testing.md" "a **Medium and does not block**"
present "the verifier files the Escape finding as a Medium" \
  "scripts/reference-capture/verify-rendered.mjs" "'escape-dismiss': { check: 'dialog-escape-dismiss', sev: 'Medium' }"
present "the verifier still files a dead control as a High" \
  "scripts/reference-capture/verify-rendered.mjs" "open: { check: 'mobile-nav-open', sev: 'High' }"
# THE PRODUCTION SKIP, and the provisioning that makes it rare.
present "testing.md says production with no secret skips rather than fails" \
  "references/testing.md" "production and \`PALATE_SMOKE_SECRET\` is not set"
present "testing.md says the secret is provisioned rather than asked for" \
  "references/testing.md" "The secret is provisioned, not asked for"
present "the round trip skips instead of posting in that case" \
  "scripts/verify-form-roundtrip.sh" "PALATE_SMOKE_SECRET is not set"
# EXECUTED BY scripts/test/verify-form-roundtrip.test.sh, not by the line(s) below: a grep here pins the WORDING and would pass
# just as happily if the behaviour it names were reversed.
for f in scripts/provision-vercel.sh scripts/provision-cloudflare.sh; do
  present "$f provisions the smoke secret" "$f" "ensure_smoke_secret"
done
# THE BUILD THAT BAKES THE GUARD. Empty is safe for indexing and unsafe for the smoke header,
# and the comment that only said the first half is what let the bootstrap deploy ship with it off.
# EXECUTED ELSEWHERE, not here: verify-form-roundtrip.test.sh RUNS provision-cloudflare.sh
# against stub CLIs and reads the environment the bootstrap build was actually given. This line
# only pins the command's wording, which is why it is not the guard that would catch a
# regression.
present "the Cloudflare bootstrap deploy builds as production" \
  "scripts/provision-cloudflare.sh" "PUBLIC_SITE_ENV=production npm run build"
present "the Cloudflare config says an empty value disables the smoke guard too" \
  "templates/host-cloudflare/astro.config.mjs" "EMPTY IS NOT SAFE IN EVERY DIRECTION"
present "testing.md says an unbaked build is closed" \
  "references/testing.md" "an unbaked one is CLOSED"
# THE CONTRADICTION THIS GUARD MISSED. The bullet kept the paragraph the inversion replaced, so
# it asserted both that a forgotten build costs a skip and that it ships a live hole. Only the
# first is true, and a reader could not tell which behaviour shipped.
absent "testing.md no longer claims an empty value ships an open endpoint" \
  "references/testing.md" "ships a live site whose endpoint honours the smoke header from anyone"
# ...and the serve-preview claim is RUN rather than grepped, for the reason in the block below.
present "testing.md says both serve-preview modes bake it" \
  "references/testing.md" "sets \`preview\` in BOTH modes"
# ...and it names the one local path that is still not covered, because the finding names it too
# and a doc that stopped short would read as though baking both modes closed the whole class.
present "testing.md says the built mode reuses an existing dist" \
  "references/testing.md" "REUSES an existing \`dist/\`"
present "the refusal finding names the build environment before Turnstile" \
  "scripts/reference-capture/verify-rendered.mjs" "PUBLIC_SITE_ENV was set at BUILD time first"
absent "cache-invalidation.md no longer lists serve-preview as leaving it unbaked" \
  "references/cache-invalidation.md" "\`serve-preview.sh\`, \`phantom-utility-check.mjs\`"
# R4: which environment the secret is read from, said where the operator sets it.
# ============ EXECUTED, NOT GREPPED ======================================================
# `present <file> <string>` returns the same pass whether the sentence it finds is TRUE or
# FALSE. It only goes red when someone DELETES the sentence. For a claim about a document's
# wording that is the correct check and the only one available. For a claim about what a
# SCRIPT DOES it is not verification at all, and this file shipped four of those in one epic.
#
# So the claims below RUN the script and read back what it actually did. Every one of them
# has an executable subject: a command line whose effect is a value in an environment. The
# stub records that value, which is the thing the doctrine promises, and no Astro, no network
# and no real build are needed to read it.
runs() { # <desc> <function name>
  local out
  if out="$("$2" 2>&1)"; then ok "$1"; else bad "$1 ($out)"; fi
}

# A throwaway project whose `npm` is a stub: it writes down the environment each script was
# given, and for a long-running script serves one 200 so serve-preview.sh can finish and hand
# over a URL the way it does for a real site.
#
# TWO THINGS IN HERE ARE DELIBERATE AND BOTH ARE ABOUT NOT HARMING THE MACHINE OR THIS SUITE.
# `lsof` is stubbed to nothing, because serve-preview.sh's kill_dev kills whatever holds
# ${PORT:-4321} and on a machine running several agents that is somebody else's dev server;
# choosing a free port instead would still hand kill_dev a port some other process could take
# between the choosing and the killing. And the server binds port 0 and prints the port it was
# GIVEN, so there is no window in which a port picked in advance can be taken by someone else
# and turn this into a flaky check in the fast suite.
make_stub_project() { # <dir>
  mkdir -p "$1/bin" "$1/witness"
  printf '%s\n' '{"name":"stub","private":true,"scripts":{"dev":"astro dev","build":"astro build","preview":"wrangler dev"}}' > "$1/package.json"
  cat > "$1/bin/npm" <<'STUB'
#!/bin/sh
# Called as `npm run <script>`.
printf '%s' "${PUBLIC_SITE_ENV-<unset>}" > "$WITNESS/$2.env"
if [ "$2" = "build" ]; then exit 0; fi
exec node -e 'const s=require("http").createServer((q,r)=>r.end("ok"));s.listen(0,()=>console.log("Local    http://localhost:"+s.address().port+"/"));'
STUB
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$1/bin/lsof"
  chmod +x "$1/bin/npm" "$1/bin/lsof"
}
stop_stub() { # <dir>
  local pid; pid="$(cat "$1/.palate-devserver.pid" 2>/dev/null || true)"
  [ -n "$pid" ] && { kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; }
  return 0
}
# <dir> <witness> <extra serve-preview args...>; echoes nothing on success.
run_serve_preview() {
  local d="$1" w="$2"; shift 2
  ( cd "$d" && WITNESS="$w" PATH="$d/bin:$PATH" \
      bash "$ROOT/scripts/serve-preview.sh" . "$@" > "$d/out" 2>&1 )
  local rc=$?
  stop_stub "$d"
  [ "$rc" = "0" ] || { echo "serve-preview.sh exited $rc: $(tail -3 "$d/out" 2>/dev/null | tr '\n' ' ')"; return 1; }
  grep -q "SERVE_HTTP=200" "$d/out" || { echo "the preview never answered 200: $(tail -3 "$d/out" | tr '\n' ' ')"; return 1; }
  return 0
}

# R1, and this is the assertion that would have caught it. The old guard grepped a string that
# lives in --built while the DEFAULT path, the one every operator takes, shipped unbaked.
serve_preview_default_bakes() {
  local d; d="$(mktemp -d)" || return 1
  make_stub_project "$d"
  run_serve_preview "$d" "$d/witness" || { rm -rf "$d"; return 1; }
  local got; got="$(cat "$d/witness/dev.env" 2>/dev/null || echo '<npm run dev never ran>')"
  rm -rf "$d"
  [ "$got" = "preview" ] || { echo "the default mode ran the dev server with PUBLIC_SITE_ENV=$got"; return 1; }
}
# ...and --built has to bake it at BUILD, because that is the value Vite substitutes into the
# endpoint. Baking it only on the preview server would prove nothing about the built handler.
serve_preview_built_bakes() {
  local d; d="$(mktemp -d)" || return 1
  make_stub_project "$d"
  run_serve_preview "$d" "$d/witness" --built || { rm -rf "$d"; return 1; }
  local b p; b="$(cat "$d/witness/build.env" 2>/dev/null || echo '<npm run build never ran>')"
  p="$(cat "$d/witness/preview.env" 2>/dev/null || echo '<npm run preview never ran>')"
  rm -rf "$d"
  [ "$b" = "preview" ] || { echo "the build ran with PUBLIC_SITE_ENV=$b, so the endpoint is baked unknown"; return 1; }
  [ "$p" = "preview" ] || { echo "the preview server ran with PUBLIC_SITE_ENV=$p"; return 1; }
}
# ...and the caveat is executed too, since a doc that only said "both modes bake it" would read
# as though the whole class were closed: an existing dist/ is REUSED and never rebuilt, so a
# directory left by a bare `npm run build` is still served unbaked.
serve_preview_built_reuses_dist() {
  local d; d="$(mktemp -d)" || return 1
  make_stub_project "$d"; mkdir -p "$d/dist"
  run_serve_preview "$d" "$d/witness" --built || { rm -rf "$d"; return 1; }
  local built=no; [ -f "$d/witness/build.env" ] && built=yes
  rm -rf "$d"
  [ "$built" = "no" ] || { echo "it rebuilt an existing dist/, so the documented caveat is stale"; return 1; }
}
runs "serve-preview.sh bakes a non-production environment in its DEFAULT mode" serve_preview_default_bakes
runs "serve-preview.sh --built bakes it at BUILD and on the preview server" serve_preview_built_bakes
runs "serve-preview.sh --built reuses an existing dist/ rather than rebuilding it" serve_preview_built_reuses_dist

# The templates' own `dev` script, run rather than read, because the docs send people straight
# to `npm run dev` and an unbaked dev server refuses the smoke header exactly as a build does.
template_dev_script_bakes() { # <package.json path>
  local d script got; d="$(mktemp -d)" || return 1
  mkdir -p "$d/bin"
  script="$(node -e 'process.stdout.write((require(process.argv[1]).scripts||{}).dev||"")' "$ROOT/$1" 2>/dev/null)"
  [ -n "$script" ] || { rm -rf "$d"; echo "$1 has no dev script at all"; return 1; }
  printf '%s\n' '#!/bin/sh' 'printf "%s" "${PUBLIC_SITE_ENV-<unset>}" > "$WITNESS/astro.env"' > "$d/bin/astro"
  chmod +x "$d/bin/astro"
  ( cd "$d" && WITNESS="$d" PATH="$d/bin:$PATH" sh -c "$script" ) >/dev/null 2>&1
  got="$(cat "$d/astro.env" 2>/dev/null || echo '<astro was never reached>')"
  rm -rf "$d"
  [ "$got" = "preview" ] || { echo "$1 ran astro with PUBLIC_SITE_ENV=$got"; return 1; }
}
astro_template_dev_bakes() { template_dev_script_bakes templates/astro-project/package.json; }
cloudflare_template_dev_bakes() { template_dev_script_bakes templates/host-cloudflare/package.json; }
runs "the astro-project dev script runs astro with an explicit environment" astro_template_dev_bakes
runs "the host-cloudflare dev script runs astro with an explicit environment" cloudflare_template_dev_bakes

# And the overlay's `deploy`, which is the command that ships the guard ON or OFF. Two facts,
# both executed: the build carries `production`, and the deploy happens AFTER it. A deploy that
# ran first would upload the previous dist/ and the ordering is the whole point.
cloudflare_deploy_builds_as_production() {
  local d script b order; d="$(mktemp -d)" || return 1
  mkdir -p "$d/bin"
  script="$(node -e 'process.stdout.write((require(process.argv[1]).scripts||{}).deploy||"")' "$ROOT/templates/host-cloudflare/package.json" 2>/dev/null)"
  [ -n "$script" ] || { rm -rf "$d"; echo "host-cloudflare has no deploy script"; return 1; }
  printf '%s\n' '#!/bin/sh' 'printf "%s" "${PUBLIC_SITE_ENV-<unset>}" > "$WITNESS/$2.env"' 'echo "npm-$2" >> "$WITNESS/order"' > "$d/bin/npm"
  printf '%s\n' '#!/bin/sh' 'echo "wrangler-$1" >> "$WITNESS/order"' > "$d/bin/wrangler"
  chmod +x "$d/bin/npm" "$d/bin/wrangler"
  ( cd "$d" && WITNESS="$d" PATH="$d/bin:$PATH" sh -c "$script" ) >/dev/null 2>&1
  b="$(cat "$d/build.env" 2>/dev/null || echo '<npm run build never ran>')"
  order="$(tr '\n' ',' < "$d/order" 2>/dev/null || true)"
  rm -rf "$d"
  [ "$b" = "production" ] || { echo "the deploy built with PUBLIC_SITE_ENV=$b, so the guard ships off"; return 1; }
  [ "$order" = "npm-build,wrangler-deploy," ] || { echo "build and deploy ran in the order: $order"; return 1; }
}
runs "the host-cloudflare deploy script builds as production BEFORE wrangler deploys" cloudflare_deploy_builds_as_production

present "hosting-vercel.md says the smoke secret is read at runtime" \
  "references/hosting-vercel.md" "is read at RUNTIME on both hosts"
present "the endpoint layers process.env over the baked object" \
  "templates/astro-project/src/pages/api/contact.ts" "...import.meta.env, ...process.env"
present "production-handoff.md stops claiming every secret comes from locals.runtime.env" \
  "references/production-handoff.md" "on Vercel there is no \`locals.runtime\`"
# R3: a form the probe could not read is named rather than reported as absent.
present "the verifier names a visible form it did not recognise" \
  "scripts/reference-capture/verify-rendered.mjs" "recognise as a contact form and did not submit"
present "the verifier skips a form with nothing visible to submit rather than failing it" \
  "scripts/reference-capture/verify-rendered.mjs" "have no submit control visible at desktop"
# THE INVERSION, in the code and in the doc. The guard shipped off five times because the test
# was "is this production"; it is "does this build say it is not production" now.
present "the endpoint requires the secret unless the build says it is not production" \
  "templates/astro-project/src/pages/api/contact.ts" "AN UNKNOWN ENVIRONMENT REQUIRES THE SECRET"
present "testing.md says the test is not is-this-production" \
  "references/testing.md" 'The test is not "is this production"'
present "the round trip skips on an unknown environment too" \
  "scripts/verify-form-roundtrip.sh" "environment is UNKNOWN"
present "the local preview build says it is a preview" \
  "scripts/serve-preview.sh" "PUBLIC_SITE_ENV=preview npm run build"
present "the Cloudflare deploy script builds before deploying" \
  "templates/host-cloudflare/package.json" "PUBLIC_SITE_ENV=production npm run build && wrangler deploy"
present "the manual-refresh doctrine stops recommending a bare wrangler deploy" \
  "references/cache-invalidation.md" "Never a bare"
# N2: the secret rides one request, and the probe refuses a cross-origin redirect itself.
present "the secret is attached to the contact POST alone" \
  "scripts/reference-capture/verify-rendered.mjs" "smokeSecret && isEndpoint"
# THE CALL SITE, not the string. `maxRedirects: 0` also appears in the docblock above it, so
# deleting the option left this green: the third time a guard has been satisfied by a comment in
# this epic. The behaviour is proven by the browser suite; this is the cheap redundancy.
present "the probe follows the POST itself rather than letting the browser follow a redirect" \
  "scripts/reference-capture/verify-rendered.mjs" "        maxRedirects: 0,"
present "testing.md says a redirect defeats a per-origin check" \
  "references/testing.md" "never reaches a Playwright route handler"
# The narrowing fixes, each pinned where a reader would look for them.
present "testing.md says a cross-origin POST is aborted" \
  "references/testing.md" "aborted at the wire"
present "the verifier aborts it" \
  "scripts/reference-capture/verify-rendered.mjs" "await route.abort('blockedbyclient')"
present "testing.md says the secret rides one request only" \
  "references/testing.md" "attached to one request, and the probe follows that request itself"
present "testing.md says the verifiers fail on any other exit code" \
  "references/testing.md" "Both verifiers fail on any other"
for f in scripts/verify-vercel.sh scripts/verify-cloudflare.sh; do
  present "$f fails on an exit code it cannot read as a verdict" "$f" "without reaching a verdict"
done
present "the contact endpoint is a global input, so an edit re-renders the pages" \
  "scripts/reference-capture/verify-rendered.mjs" "'src/pages/api'"

# ============ 3. THE AXE SUBSET is a subset, and says which rules =========================
present "audit-dimensions.md says the automated pass is a subset" \
  "references/audit-dimensions.md" "eleven axe rules"
present "audit-dimensions.md names a rule the automated pass does NOT run" \
  "references/audit-dimensions.md" "aria-"

# ============ 4. THE ROUTE CAP, where a customer will see it ==============================
for f in README.md references/testing.md; do
  present "$f documents the 14-route default" "$f" "14 routes"
  present "$f documents --max-routes" "$f" "--max-routes"
done

# ============ 5. THE CSP DOC MUST NOT ARGUE WITH THE POLICY IT DESCRIBES =================
# Both files said 'unsafe-inline' must never reach script-src, in the files where it does. A
# reader who trusted that removed the token and broke the contact form, which is the failure
# the live CSP test exists to catch.
for f in references/hosting-vercel.md templates/host-cloudflare/_headers; do
  absent "$f does not forbid what its own policy does" "$f" "must never reach"
  present "$f says the policy is a host allowlist" "$f" "host allowlist"
done

# ============ 7. INCREMENTAL RE-VERIFY, where the person re-running it will look ==========
# A gate that renders only the blast radius is a promise about what was NOT checked, so the
# escape hatch has to be documented in the same breath as the saving. Both halves are pinned:
# the flag that narrows, and the flag that stops narrowing before hand-over.
for f in README.md references/testing.md; do
  present "$f documents --changed" "$f" "--changed"
  present "$f documents the full sweep before hand-over" "$f" "--full"
  present "$f says an unknown file falls wide" "$f" "falls wide"
done
present "the verifier agent re-runs the blast radius after a fix" \
  "agents/palate-verifier.md" "--changed <the files you edited>"
present "the verifier agent rebuilds the index under --changed" \
  "agents/palate-verifier.md" "rebuilds \`.palate/index.json\` first"
present "testing.md says --changed rebuilds the index" \
  "references/testing.md" "rebuilds \`.palate/index.json\` first"
present "testing.md says the content a route renders is in the hash" \
  "references/testing.md" "the collection its \`getCollection\` call names"
# THE DOCTRINE'S FIRST COMMAND IS RUN, not just matched. It named a file list, and ux-lint
# takes a project directory and nothing else, so the cheap lane the re-run rule leads with
# exited 2 for anyone who followed it literally: a gate that did not run, reading as one that
# did. Pinning the sentence alone is what let that ship, so the sentence is executed.
present "the verifier agent lints the project directory, not a file list" \
  "agents/palate-verifier.md" "bash scripts/ux-lint.sh <project-dir>"
UXSITE="$(mktemp -d)"
mkdir -p "$UXSITE/src/pages"
printf '<h1>Hello</h1>\n' > "$UXSITE/src/pages/index.astro"
bash "$ROOT/scripts/ux-lint.sh" "$UXSITE" >/dev/null 2>&1; ux_dir=$?
bash "$ROOT/scripts/ux-lint.sh" "$UXSITE/src/pages/index.astro" >/dev/null 2>&1; ux_file=$?
rm -rf "$UXSITE"
[ "$ux_dir" -ne 2 ] && ok "the doctrine's ux-lint command runs (exit $ux_dir, not 2)" \
  || bad "the doctrine's ux-lint command exits 2, so the cheap lane never runs"
[ "$ux_file" -eq 2 ] && ok "a file path still exits 2, which is why the doctrine names a directory" \
  || bad "ux-lint accepts a file path now, so the doctrine should say so (exit $ux_file)"

present "the verifier agent runs the cheap lane first" \
  "agents/palate-verifier.md" "ux-lint before rendered, rendered before vitals"
present "the verifier agent certifies on one full sweep" \
  "agents/palate-verifier.md" "THE LAST RUN BEFORE HAND-OVER IS ONE FULL SWEEP"
# The per-route record is the thing the skip rests on, so the doc names its fields.
present "testing.md names the per-route record" \
  "references/testing.md" "sourcesHash, renderedHash,"
present "testing.md names the shared inputs the hash covers" \
  "references/testing.md" "global inputs changed, all routes re-rendered"
present "testing.md says a 404 route is not failed for answering 404" \
  "references/testing.md" "is not failed for returning it"
present "testing.md says a real error on that route still fires" \
  "references/testing.md" "is still a High"
present "testing.md says the trend reads inside the loop" \
  "references/testing.md" "The hygiene trend reads inside the loop"
present "the verifier agent is told what the trend is a trend OF" \
  "agents/palate-verifier.md" "Read the trend line, and read what it is a trend OF"
present "the verifier agent is told not to act on a coverage difference" \
  "agents/palate-verifier.md" "Do not revert anything on this line"
present "testing.md says a verdict needs the same routes" \
  "references/testing.md" "It states a verdict only when the two runs swept the same routes"
present "testing.md names what the hash does NOT cover" \
  "references/testing.md" "so an unchanged source can still render differently"

# ============ 6. THE HYGIENE LINE leads with what the number is ===========================
# ASSERT THE RENDERED LINE, NOT THE SOURCE. The first draft grepped hygiene-loop.mjs for
# "clears the " and failed on a correct implementation, because the verb is a ternary and the
# words only meet at runtime. What a reader sees is the only thing worth pinning.
line() { # <minScore> <overall>
  node --input-type=module -e "
    import { summaryLine } from '$ROOT/scripts/reference-capture/hygiene-loop.mjs';
    process.stdout.write(summaryLine({
      scored: { overall: $2, measuredWeight: 52 },
      cmp: { verdict: 'first' }, stall: { iterations: 1 }, minScore: $1,
    }));" 2>/dev/null
}
saysline() { # <desc> <rendered> <literal>
  case "$2" in *"$3"*) ok "$1" ;; *) bad "$1 (the line reads: $(printf '%.90s' "$2"))" ;; esac
}
notline() { # <desc> <rendered> <literal>
  case "$2" in *"$3"*) bad "$1 (the line reads: $(printf '%.90s' "$2"))" ;; *) ok "$1" ;; esac
}
CLEARS="$(line 80 92)"; BELOW="$(line 80 61)"; UNGATED="$(line 0 92)"
[ -n "$CLEARS" ] || bad "the hygiene line could not be rendered, so nothing here was checked"
saysline "a passing hygiene line reads as agreed" "$CLEARS" "build hygiene: clears the 80 floor at 92 (not a grade)"
saysline "a failing hygiene line reads as agreed" "$BELOW" "build hygiene: is BELOW the 80 floor at 61 (not a grade)"
saysline "an ungated line still says it is not a grade" "$UNGATED" "(not a grade)"
notline "the score does not lead the line" "$CLEARS" "build hygiene 92/100"
notline "and the ungated line does not claim a pass" "$UNGATED" "clears the"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
