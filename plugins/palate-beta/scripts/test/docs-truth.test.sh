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
# Same as `present`, with a PATTERN rather than a literal, for the one thing a literal cannot
# say: that a string is at the start of its own line, i.e. that a step heading is a step and not
# a mention of one inside somebody else's paragraph.
matches() { # <desc> <file> <basic regex that MUST match>
  local f="$ROOT/$2"
  [ -f "$f" ] || { bad "$1 ($2 does not exist, so nothing was checked)"; return; }
  grep -q -- "$3" "$f" && ok "$1" || bad "$1 ($2 has no line matching '$3')"
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

# A GREP CANNOT TELL A TRUE SENTENCE FROM A FALSE ONE. The claim above is about what a command
# DOES, so it is run: a page holding nothing but text is served on a loopback port and
# palate-pick is asked to record it as the motion proof. The refusal is the assertion.
probe_refuses_a_still_page() {
  local proj out rc
  proj="$(mktemp -d)"
  printf '%s\n' '{"schema":3,"explore":{"ran":true}}' > "$proj/build-manifest.json"
  out="$(node "$ROOT/scripts/test/fixtures/still-page-server.mjs" "$ROOT/scripts/palate-pick.mjs" "$proj" 2>&1)" && rc=0 || rc=$?
  rm -rf "$proj"
  [ "$rc" -ne 0 ] || { echo "palate-pick recorded a proof for a page where nothing moves: $out"; return 1; }
  printf '%s' "$out" | grep -qF "nothing measurable moves" || { echo "the refusal did not name the fault: $out"; return 1; }
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

# ============ 8. EXPLORE IS DRAWN, NOT BUILT ============================================
# Explore V3 made every board a real Astro route. It is now a hand-authored Claude Design
# artboard under `.palate/explore/seed/`, there is no `/boards/*` route to open, and the
# components that framed a board page (`BoardFrame`, `BoardNotes`, `SectionMark`,
# `ExploreSwitcher`) no longer ship. Doctrine that still sends a builder to write a board page
# sends them to write Astro nothing will ever serve, and the boards-are-Astro claim is exactly
# the one that cost a real build forty minutes before anything was shown.
present "SKILL.md A.4 names the artboard the board actually is" \
  "SKILL.md" ".palate/explore/seed/B<rung>.dc.html"
# A whole-file grep for the word "artboard" passes on one stray mention, so the registry's own
# declaration is the check that matters: the board IS the file, and `href` cannot be required
# again without this going red.
present "variants.ts requires the artboard" \
  "templates/astro-project/src/lib/variants.ts" "artboard: string;"
present "variants.ts keeps href optional and unused" \
  "templates/astro-project/src/lib/variants.ts" "href?: string;"
absent "SKILL.md no longer routes boards under src/pages/boards" \
  "SKILL.md" "src/pages/boards"
absent "SKILL.md no longer wraps board sections in SectionMark" \
  "SKILL.md" "SectionMark"
absent "explore-stage.md no longer sends anyone to a /boards/ route" \
  "references/explore-stage.md" "/boards/"
present "explore-stage.md names the mark every kit section carries on a board" \
  "references/explore-stage.md" "data-section-id"
present "explore-stage.md says the motion is written on the board" \
  "references/explore-stage.md" "data-palate-motion"
# The canvas is published or declined, never silently absent: gate-explore.mjs blocks a shown
# build whose manifest records neither, so the doctrine has to name both shapes.
present "explore-stage.md records a published canvas" \
  "references/explore-stage.md" "explore.canvas = { url }"
present "explore-stage.md records a declined canvas" \
  "references/explore-stage.md" "skipped: true, reason"
# A FIELD WITH A BLOCKING GATE AND NO WRITER is a field the model can only fill by hand-editing
# the manifest, which the doctrine forbids two lines earlier. `explore.canvas` had exactly that
# shape, so both surfaces name the flags that write it.
present "pick.md names the flag that records a published canvas" \
  "commands/pick.md" "--canvas-url"
present "pick.md names the flag that declines one" \
  "commands/pick.md" "--canvas-skipped"
present "explore-stage.md names the flag that records a published canvas" \
  "references/explore-stage.md" "--canvas-url"
present "explore-stage.md names the flag that declines one" \
  "references/explore-stage.md" "--canvas-skipped"
# The question round is a real refusal in gate-done.sh, so the command that answers it is named
# where the pick is recorded.
present "pick.md names the question round flags" \
  "commands/pick.md" "--answer motion="
present "explore-stage.md names the question round" \
  "references/explore-stage.md" "question_round"

# The donor half. The surveyor writes the file, boards-render draws from it, and the judge reads
# what boards-render wrote, so a doctrine that never names the file describes a board drawn from
# a slug.
present "explore-stage.md names the file the drawing brief is read from" \
  "references/explore-stage.md" "donor-heroes.json"
present "explore-stage.md names the flag that draws the donor row" \
  "references/explore-stage.md" "--donors"
present "explore-stage.md names the gate that judges a board against its donor" \
  "references/explore-stage.md" "gate-board-judge.mjs"
present "explore-stage.md names the rung a board is refused at" \
  "references/explore-stage.md" "clearly_worse"
# THE BAR ITSELF, in every place that states it. It moved on 2026-09-12 from "not clearly worse"
# to "comparable or better on every judged surface", and a doctrine still telling an agent that
# somewhat worse is shippable is a doctrine the gate will contradict at done-time.
present "explore-stage.md states the bar the judge refuses at" \
  "references/explore-stage.md" "THE BAR IS \`comparable\` OR \`better\`"
present "explore-stage.md says somewhat_worse is refused as clearly_worse is" \
  "references/explore-stage.md" "read \`somewhat_worse\` on any one"
present "SKILL.md A.4 states the bar the judge refuses at" \
  "SKILL.md" "THE BAR IS \`comparable\` OR \`better\` ON EVERY SURFACE"
present "palate-verifier.md states the bar the Explore gate refuses at" \
  "agents/palate-verifier.md" "comparable or better on every surface the direction was judged on"
present "build-manifest.md says both lower rungs refuse" \
  "references/build-manifest.md" "both somewhat_worse and clearly_worse refuse"
# A SURFACE NOBODY COULD JUDGE IS NOT A BAD READING, and a wider bar is exactly where that would
# be got wrong: the library holds no whole-page capture for some references.
present "explore-stage.md says a null surface refuses nothing" \
  "references/explore-stage.md" "reads null and refuses nothing"
present "SKILL.md A.4 names the judge that runs before the canvas" \
  "SKILL.md" "gate-board-judge.mjs"
# `^2c\.` and not any "2c." substring: the point is the STEP HEADING, and a mention of the step
# inside another paragraph would satisfy a loose grep while the step itself had been deleted.
matches "palate-verifier.md carries the judging step as a step" \
  "agents/palate-verifier.md" "^2c\."
present "palate-verifier.md names the file the judgements are collected into" \
  "agents/palate-verifier.md" "judgements.json"
# THE VERIFIER HAS NO Agent TOOL (its frontmatter is Bash, Read, Grep, Glob, Write, mcp__palate),
# so a doctrine telling it to dispatch a subagent describes a thing it cannot do. The main build
# agent dispatches, exactly as it does for the site ladder.
absent "palate-verifier.md never tells the verifier to dispatch a subagent" \
  "agents/palate-verifier.md" "ispatch"
present "SKILL.md A.4 says the main agent dispatches the judging subagents" \
  "SKILL.md" "YOU dispatch the judging subagents"
present "explore-stage.md owns the dispatch, one fresh subagent per comparison" \
  "references/explore-stage.md" "ONE FRESH general-purpose subagent per comparison"
present "build-manifest.md records what the judge wrote" \
  "references/build-manifest.md" "board_judgements"
# The release valve is in both scripts, so it is named where a build would reach for it.
present "explore-stage.md names the release valve for the judge" \
  "references/explore-stage.md" "PALATE_GATE_JUDGE=0"
present "palate-verifier.md names the release valve for the judge" \
  "agents/palate-verifier.md" "PALATE_GATE_JUDGE=0"
present "explore-stage.md names the deliberate skip of the donor row" \
  "references/explore-stage.md" "--no-donors"
present "explore-stage.md names the record a skipped donor row leaves" \
  "references/explore-stage.md" "donor_row"
present "explore-stage.md says two judgements are owed per pair" \
  "references/explore-stage.md" "two per pair"

# ================= THE PRESENTATION SET, PINNED ==========================================
# A direction stopped being a home page at beta.21: `boards-render.mjs` validates FOUR artboards
# per direction (KINDS: home, inner, mobile, sheet), refuses a registry with no `presentation`,
# and shoots five stills. Doctrine that still says "one artboard per rung" describes a client
# shown one board out of four, which is exactly the sign-off this change exists to widen.
present "explore-stage says a direction is four artboards" \
  "references/explore-stage.md" "A DIRECTION IS FOUR ARTBOARDS"
present "explore-stage names the inner-page artboard" \
  "references/explore-stage.md" "I<rung>.dc.html"
present "explore-stage names the phone artboard" \
  "references/explore-stage.md" "M<rung>.dc.html"
present "explore-stage names the detail sheet artboard" \
  "references/explore-stage.md" "S<rung>.dc.html"
present "explore-stage names the width a phone board is drawn at" \
  "references/explore-stage.md" "x-dc{width:390px}"
present "explore-stage names the mark the inner page's sections carry" \
  "references/explore-stage.md" "<id>-inner-<piece>"
# The pipeline table is where an agent grounds when it wants the whole shape in one screen, and
# it kept telling the agent to draw one board per rung, which boards-render now refuses.
present "pipeline.md says a direction is four artboards" \
  "references/pipeline.md" "{B,I,M,S}<rung>.dc.html"
# The sheet is the one board with a MINIMUM text budget in the validator (SHEET_MIN_TEXT), because
# the format it is most likely to collapse into is the type specimen Jake rejected on 9 September.
present "explore-stage bans the type specimen on the detail sheet" \
  "references/explore-stage.md" "never a type specimen"
# The registry fields boards-render and gate-explore both REFUSE a direction without.
present "explore-stage registers the other three artboards" \
  "references/explore-stage.md" "presentation: { inner:"
present "explore-stage registers where every piece came from" \
  "references/explore-stage.md" "pieces: { navigation:"
present "SKILL.md A.4 registers the other three artboards" \
  "SKILL.md" "presentation: { inner:"
present "SKILL.md A.4 registers where every piece came from" \
  "SKILL.md" "pieces: { navigation:"
present "explore-stage names the caption every sheet block prints" \
  "references/explore-stage.md" "Navigation: NavSimple, drawn from aesop"
# The five stills and the row. A row is a COMPARISON (the columns are constants in boards-render
# for that reason), so the doctrine names the order a client reads across.
present "explore-stage names the five stills a direction owes" \
  "references/explore-stage.md" "hero, full, inner, mobile and sheet"
present "explore-stage names the direction's own canvas row" \
  "references/explore-stage.md" "B, D, I, M, S"
present "explore-stage names the public stills /explore shows" \
  "references/explore-stage.md" "<id>-sheet.png"

# ================= THE JUDGE READS THREE SURFACES ========================================
# `SURFACES` in gate-board-judge.mjs is entrance, foot and inner: three pairs per direction, each
# judged in both orders, and `rung` is the LOWEST across the surfaces judged. Doctrine saying
# "two comparisons of its entrance still" describes a verdict about the top of a page recorded as
# a verdict about the page.
present "explore-stage says the judge states three pairs per direction" \
  "references/explore-stage.md" "THREE pairs per direction"
present "explore-stage says three pairs are six comparisons" \
  "references/explore-stage.md" "six comparisons"
present "explore-stage names the lowest surface as the one that stands" \
  "references/explore-stage.md" "lowest across the surfaces judged"
present "SKILL.md A.4 says the judge states three pairs per direction" \
  "SKILL.md" "THREE pairs per direction"
present "palate-verifier.md says the judge states three pairs per direction" \
  "agents/palate-verifier.md" "THREE pairs per direction"
# Each pair asks its OWN question. The request carries no top-level `question`, so a surface told
# to pass "the question" verbatim would ask the entrance's question over a page ending.
present "palate-verifier.md hands over each pair's own question" \
  "agents/palate-verifier.md" "each pair carries its own"
absent "palate-verifier.md no longer promises one question for every pair" \
  "agents/palate-verifier.md" "carries \`question\`, the four"
# A MISSING SURFACE AND A PASSING SURFACE MUST NOT LOOK ALIKE. sharp missing is a local fault with
# a named fix and phase 1 SKIPS on it; a donor with no whole-page capture is a fact about the
# library, so the ending is dropped, the pass line names only what was judged, and gate-explore
# warns rather than fails.
present "explore-stage says a missing sharp skips the judge rather than judging two surfaces" \
  "references/explore-stage.md" "sharp not installed"
present "explore-stage says a donor with no whole-page capture drops the ending" \
  "references/explore-stage.md" "no whole-page capture"
present "explore-stage says the unjudged ending is a warning, never a block" \
  "references/explore-stage.md" "WARNS rather than blocks"

# ================= WHAT GATE-EXPLORE NOW HOLDS ===========================================
# It checks the REGISTRY (every variation against src/lib/kit.ts, every donor against
# references_surveyed, the sheet's marks against the registry's variations); boards-render owns
# the missing FILES. Doctrine that credits either with the other's checks sends an operator to
# the wrong script with a real finding.
present "explore-stage says the kit is what a variation is checked against" \
  "references/explore-stage.md" "against src/lib/kit.ts"
present "explore-stage says a donor is checked against the survey" \
  "references/explore-stage.md" "references_surveyed"
present "SKILL.md A.4 says the gate checks the variations and the donors" \
  "SKILL.md" "references_surveyed"

# ================= MOMENT 2 NO LONGER PROMISES ROUTES ====================================
# `/v1`..`/vN` have not existed since canvas-first Explore (beta.17): a board is an artboard and
# there is no route to open. The checkpoint that told the agent to hand over those links was the
# last surface still promising them.
absent "SKILL.md's checkpoint no longer promises /v1../vN routes" \
  "SKILL.md" "The preview link is live with"
present "SKILL.md's checkpoint hands over the canvas, else /explore" \
  "SKILL.md" "the canvas is live (else \`/explore\`)"

# ================= THE CALIBRATION ANSWER IS ASKED ONCE AND RECORDED TWICE ================
# The intake asks it BEFORE the deep survey and the wall holds it on the checkpoint, so the old
# premise ("the ladder is built before anyone has said how bold they want to be") is false. But
# explore.astro draws the marker from `commission.intensity_asked`, which only
# `palate-pick.mjs --intensity` writes and only AFTER the boards were seen, so the page falls
# back to the intake position. The doctrine has to say so or an agent reading it expects a
# ladder with no marker on the one handover the doctrine actually describes.
absent "explore-stage no longer says the ladder is built before the question is asked" \
  "references/explore-stage.md" "The ladder is built BEFORE anyone has said how bold they want to be."
present "explore-stage says the calibration answer is asked at the checkpoint" \
  "references/explore-stage.md" "asked in the intake, before the deep survey"
present "explore-stage says the ladder marker falls back to the intake position" \
  "references/explore-stage.md" "falls back to \`plan_checkpoint.shown.intake.calibration.position\`"
present "explore-stage says the later record overwrites the marker" \
  "references/explore-stage.md" "overwrites the marker when it"

# ================= THE REGISTRY AND THE FILE MAP, PINNED =================================
present "build-manifest.md records the four artboards a direction registers" \
  "references/build-manifest.md" "presentation:{ inner, mobile, sheet }"
present "build-manifest.md records where every piece came from" \
  "references/build-manifest.md" "pieces:{ <piece>:{ variation, donor } }"
present "commands/README.md says the seed holds four artboards per direction" \
  "commands/README.md" "four hand-drawn artboards"
present "commands/README.md says the judge states three surfaces" \
  "commands/README.md" "three surfaces"

# ================= THE TWO TOOL RULINGS, PINNED ==========================================
# The surveyor WRITES its packet's two files (.palate/explore/refs.json and donor-heroes.json)
# and saves the reference stills beside them, so a frontmatter of read-only tools describes an
# agent that cannot do its own step 6 and step 7. The verifier is the opposite ruling: it has
# no Agent tool on purpose, because the judging subagents must know nothing about this build,
# so it STATES the comparisons and the main build agent dispatches them.
matches "palate-surveyor.md may write the packet files it is told to write" \
  "agents/palate-surveyor.md" "^tools:.*Write"
absent "palate-verifier.md is not given an Agent tool" \
  "agents/palate-verifier.md" "tools: Bash, Read, Grep, Glob, Write, mcp__palate, Agent"
matches "palate-verifier.md's tools line carries no Agent or Task tool" \
  "agents/palate-verifier.md" "^tools:[^A-Za-z]*\(Bash\|Read\|Grep\|Glob\|Write\|mcp__palate\|, \)*$"
present "explore-stage.md publishes the canvas only once the judge has passed" \
  "references/explore-stage.md" "once the board judge"

# THE ANSWER SHAPE THE JUDGE ACTUALLY VALIDATES. `scoreBoardPair` REQUIRES `candidate_is`, so a
# surface that still asks for `[{ id, verdict }]` sends every judgement back in a shape the gate
# refuses, after the subagents have been paid for. The old shape must appear nowhere.
for f in SKILL.md references/explore-stage.md agents/palate-verifier.md; do
  absent "$f asks for no judgement shape the judge refuses" "$f" "[{ id, verdict }]"
done
present "SKILL.md A.4 asks for the shape the judge validates" \
  "SKILL.md" "[{ id, candidate_is, verdict }]"
present "SKILL.md A.4 tells the subagent which letter is the candidate" \
  "SKILL.md" "candidate_is"

present "explore-stage holds board copy to the client's own facts" references/explore-stage.md "arithmetic is not a source"
present "explore-stage says gate-facts never reads an artboard" references/explore-stage.md "never reads an artboard"

# THE INTAKE. The v3 run asked the calibration question after the boards were drawn, so the
# answer could not steer anything it was for. The surveyor now runs in two acts and the wall
# holds the six answers on the checkpoint; these assertions pin the doctrine that says so.
present "the surveyor names its calibration-only first act" \
  "agents/palate-surveyor.md" "calibration only"
present "the surveyor names the intake it is handed for the deep survey" \
  "agents/palate-surveyor.md" "the intake"
present "the surveyor sets the intensity facet from the calibration answer" \
  "agents/palate-surveyor.md" "\`intensity\` facet from the calibration position"
present "the surveyor searches the admired sites with refs_for_business" \
  "agents/palate-surveyor.md" "\`refs_for_business\` on each site they admire"
present "the surveyor treats the avoid list as an exclusion" \
  "agents/palate-surveyor.md" "never a donor"
present "the surveyor names the primary action in the composition note" \
  "agents/palate-surveyor.md" "COMPOSITION NOTE: the primary action is"
present "SKILL.md's checkpoint names the recorded intake" "SKILL.md" "shown.intake"
present "SKILL.md's checkpoint says the intake comes before the deep survey" \
  "SKILL.md" "BEFORE THE DEEP SURVEY"
present "explore-stage step 1 asks which calibration reference is closest" \
  "references/explore-stage.md" "which of the calibration references is closest"
present "explore-stage step 1 asks for admired sites" \
  "references/explore-stage.md" "two or three sites in your field you admire"
present "explore-stage step 1 asks for one they do not admire" \
  "references/explore-stage.md" "one you do not"
present "explore-stage step 1 asks for the primary action" \
  "references/explore-stage.md" "call, a form, a booking or a purchase"
present "explore-stage step 1 asks for the wow moment" \
  "references/explore-stage.md" "the wow moment"
present "explore-stage step 1 asks for the avoid list" \
  "references/explore-stage.md" "the avoid list"
present "explore-stage step 1 says the six are asked in one round" \
  "references/explore-stage.md" "ONE round"
present "explore-stage step 1 records them on the checkpoint" \
  "references/explore-stage.md" "plan_checkpoint.shown.intake"

# ASKING THE PERSON. Prose questions in a terminal get prose answers, or none: the person has
# to type, so they answer the first and skip the rest. Where the harness has a structured
# question tool, every question the skill puts to a person goes through it.
matches "SKILL.md carries an Asking the person house rule" "SKILL.md" "^### Asking the person"
present "the rule names the tool" "SKILL.md" "AskUserQuestion"
present "the rule asks for 2 to 4 options per question" "SKILL.md" "two to four options"
present "the rule puts the recommended option first and labels it" "SKILL.md" "(Recommended)"
present "the rule caps a round at four questions in one call" "SKILL.md" "four questions in ONE call"
present "the rule asks for multi-select where answers are not exclusive" "SKILL.md" "multi-select"
present "the rule falls back to prose only where the tool is absent" "SKILL.md" "only where the tool is absent"
# ...and it is APPLIED at each checkpoint moment, pinned to that moment's own line. A single
# "AskUserQuestion appears in SKILL.md" is satisfied by the house rule alone, which is exactly
# the assertion that goes on passing after the application is deleted.
matches "checkpoint moment 2 asks the pick round through the tool" \
  "SKILL.md" "^2\. \*\*After Explore.*AskUserQuestion"
matches "checkpoint moment 3 asks the Compose confirm through the tool" \
  "SKILL.md" "^3\. \*\*After Compose.*AskUserQuestion"
matches "checkpoint moment 4 asks the provisioning confirm through the tool" \
  "SKILL.md" "^4\. \*\*Before production provisioning.*AskUserQuestion"
matches "A.5's question round is one call of the tool" \
  "SKILL.md" "A\.5 PAUSE.*AskUserQuestion"
present "explore-stage asks the intake through the tool" \
  "references/explore-stage.md" "AskUserQuestion"
present "explore-stage asks the question round through the tool" \
  "references/explore-stage.md" "as one AskUserQuestion call"

# THE MOTION PROOF IS A MEASUREMENT. A board is a still, so the motion note is the one promise
# the client cannot see before they choose, and until the probe existed the proof of it was a
# URL, a timestamp and the agent's word. On a real build that word was wrong by an order of
# magnitude: 0.6x promised, 7 per cent delivered, and the person said there was no motion. The
# doctrine has to say the command measures, or a model reads it as a stamp again.
present "explore-stage says the proof command measures the page" \
  "references/explore-stage.md" "MEASURES THE PAGE, it does not take your word for it"
present "explore-stage names the probe" \
  "references/explore-stage.md" "scripts/motion-proof.mjs"
present "explore-stage says a still page is refused" \
  "references/explore-stage.md" "A page where none of that moves is REFUSED"
present "explore-stage says the measurement must match the note in kind" \
  "references/explore-stage.md" "must match the board's motion note IN KIND"
present "explore-stage names the honest escape rather than a skip" \
  "references/explore-stage.md" "--proof-unmeasured"
present "SKILL.md A.6 says the proof is measured" \
  "SKILL.md" "THE PROOF IS MEASURED, NOT DECLARED"
present "SKILL.md A.6 names the field the gate reads" \
  "SKILL.md" "explore.proof.measured"
# ...where the browser it drives is installed. Without it the probe skips, and a skip is not a
# refusal: asserting on it would turn a missing dependency into a doctrine failure.
if node --input-type=module -e 'import { createRequire } from "node:module"; createRequire(process.argv[1]).resolve("playwright");' \
     "$ROOT/scripts/reference-capture/index.mjs" >/dev/null 2>&1; then
  runs "the probe refuses a page where nothing moves, so the doctrine is not describing an intention" \
    probe_refuses_a_still_page
else
  ok "the probe refusal is not checked here (the capture engine's browser is not installed)"
fi

# THE HAND-OFF IS WHAT THE AGENT SAYS TO THE CLIENT, and the client's word for an Explore
# option is "direction", never "rung" or "ladder" (those stay internal, in the gate code and
# the ladder module). The rest of this file legitimately says "rung" elsewhere, describing the
# registry and the artboard file names, so this check is scoped to the hand-off section alone
# rather than the whole file, which `absent` cannot do.
present "explore-stage's hand-off names the mistake as asking which direction, not which rung" \
  "references/explore-stage.md" 'ask "which direction?" and stop'
handoff="$(awk '/^## The hand-off/{flag=1} /^## The two surfaces/{flag=0} flag' "$ROOT/references/explore-stage.md")"
if [ -z "$handoff" ]; then
  bad "explore-stage.md has no hand-off section to check (the heading moved or was deleted)"
elif printf '%s' "$handoff" | grep -qi 'rung\|ladder'; then
  bad "the hand-off still says 'rung' or 'ladder' somewhere a client-facing script should say 'direction'"
else
  ok "the hand-off never says 'rung' or 'ladder'"
fi

# THE REPEATED SILHOUETTE IS A MEASUREMENT, NOT A NOTE TO THE VERIFIER. Two identical
# five-card grids back to back shipped to a client because rhythm was the one thing no gate
# read. The bug-class entry has to say all four criteria and say that it blocks, or the next
# reader takes it for another line in the visual rubric that somebody is meant to eyeball.
present "rendered-bug-classes names the repeated silhouette as its own class" \
  "references/rendered-bug-classes.md" "## (i) REPEATED SILHOUETTE"
present "rendered-bug-classes says the rule is about CONSECUTIVE sections" \
  "references/rendered-bug-classes.md" "no two CONSECUTIVE sections share a silhouette"
present "rendered-bug-classes says all four criteria have to hold" \
  "references/rendered-bug-classes.md" "only when ALL FOUR hold"
present "rendered-bug-classes names the deliberate escape hatch" \
  "references/rendered-bug-classes.md" 'data-palate-repeat="deliberate"'
# ...and the claim that it BLOCKS is a claim about a script, so it is checked against the
# script rather than against the sentence: the finding has to reach the file the Stop hook
# reads. `verify-rendered-silhouette.test.sh` drives the browser and proves the finding fires;
# this asserts the entry it pushes carries the rule the doc names.
if grep -qF "rule: 'repeated-silhouette'" "$ROOT/scripts/reference-capture/verify-rendered.mjs" \
   && grep -qF "interactionFailures.push" "$ROOT/scripts/reference-capture/verify-rendered.mjs"; then
  ok "the repeated-silhouette finding is written to the file the Stop hook blocks on"
else
  bad "rendered-bug-classes says the repeated silhouette blocks, but verify-rendered.mjs never files it as an interaction failure"
fi

# THE LOCAL GRADE'S LADDER IS A DONE SUB-GATE. On the eastcoast v3 build grade-local.mjs had
# already judged the home `somewhat_worse` than its exemplar, at the 12.9th taste percentile,
# with flattery.risk true, and nothing read the file. SKILL.md A.12 and local-grade.md both have
# to say it runs before done, not after, or the same silent skip happens again.
present "SKILL.md A.12 says the full local grade runs before done and gate-taste reads it" \
  "SKILL.md" "Run this before the done gate, not after"
present "local-grade.md says gate-done's taste sub-gate reads local-grade.json" \
  "references/local-grade.md" "\`gate-done.sh\`'s \`taste\` sub-gate"

# ============ COMPOSE IS A DESIGN ACT ====================================================
# A client build was handed over with a home page that was the picked board degraded by six
# safe-looking edits and eighteen inner pages assembled from kit pieces in one 22-minute burst
# with no board, no library call and nobody opening a page. Every gate passed, because after the
# pick nothing in the process was a design act. These sentences are what make it one, and every
# one of them is now carried by a script, so a doc that loses one is a doc describing a build
# step that still runs and is no longer written down.
present "SKILL.md A.6 says Compose is a design act" \
  "SKILL.md" "COMPOSE IS A DESIGN ACT"
present "SKILL.md A.6 says the home page lifts the picked board" \
  "SKILL.md" "LIFTS THE PICKED BOARD"
present "SKILL.md A.6 names the command that records a departure from the board" \
  "SKILL.md" '--override <route> --section'
present "SKILL.md A.6 marks the route the drawn inner page became" \
  "SKILL.md" "marked --primary when its look is recorded"
present "SKILL.md A.6 says the kit is parts and states" \
  "SKILL.md" "the kit is parts and states, never the page"
absent "SKILL.md A.6 no longer tells Compose to write the rest of the site's pages" \
  "SKILL.md" "the rest of the site's pages in the picked direction"
present "SKILL.md A.6 composes a page template once, as a designed page type" \
  "SKILL.md" "composed ONCE as a designed page type"
present "SKILL.md A.6 refuses the native-size fallback for a photograph" \
  "SKILL.md" '"inset at native size" is never a fallback'
present "SKILL.md A.6 records the look per page type" \
  "SKILL.md" '--looked <route> --shot'
present "SKILL.md A.6 says the page judge's subagents are dispatched by you" \
  "SKILL.md" "built pages are judged the way the boards were, and YOU dispatch"
present "SKILL.md A.6 says fidelity now measures the framing" \
  "SKILL.md" "the hero media's framing"

# THE RUBRIC IS NOT THE GATE. On that build all six axes came back 4 of 4 at both viewports with
# `defects: []` while the observations beside them named the duplication as defect 10 and marked
# it accepted. A score somebody awards themselves cannot be the thing that decides.
present "SKILL.md A.9 demotes the six axes to working notes" \
  "SKILL.md" "THE SIX AXES ARE WORKING NOTES, NOT THE GATE"
present "SKILL.md A.9 says nothing reads the self-scored axes" \
  "SKILL.md" "Nothing reads \`visual.iterations[].axes\`"
# ... AND A.9 NO LONGER SAYS THE OPPOSITE FOUR HUNDRED WORDS LATER. It listed the artefacts the
# Stop hook reads and ended the list with "every rubric axis cleared the bar", which gate-done.sh
# does not read at all: it reads `.visual.pass`, the console, the shot count and the iteration
# count. A demotion undone inside its own item is a demotion nobody can act on.
present "SKILL.md A.9 names what the done gate actually reads" \
  "SKILL.md" "zero console errors, the verifier's own \`visual.pass\`)"
absent "SKILL.md A.9 no longer claims the done gate reads the rubric axes" \
  "SKILL.md" "every rubric axis cleared the bar"

# THE JUDGE RUNS LAST, ON THE SETTLED BUILD. The visual loop rebuilds, and a page rebuilt after
# it was judged makes its comparison stale, so judging before the loop buys every comparison
# twice and passes none of them.
present "SKILL.md A.6 puts the page judge after the visual loop" \
  "SKILL.md" "THE PAGES ARE JUDGED LAST, ON THE SETTLED BUILD"
present "explore-stage.md says the judge runs on the settled build" \
  "references/explore-stage.md" "the judge runs on the settled build"
present "the verifier says its page judge runs last, on the settled build" \
  "agents/palate-verifier.md" "IT RUNS LAST, ON THE SETTLED BUILD"

# A SURFACE WITH NO PICTURE IS DROPPED, NOT THE RUN. The library holds no whole-page capture for
# some references, and requiring one switched the whole new instrument off, entrance comparisons
# included, on a condition the board judge documents as ordinary.
present "build-manifest.md says a missing surface is dropped rather than the run" \
  "references/build-manifest.md" "A SURFACE WITH NO PICTURE IS DROPPED, NEVER THE RUN"
present "the verifier says the six axes are working notes" \
  "agents/palate-verifier.md" "The six axes are WORKING NOTES"

# THE THREE NEW DONE SUB-GATES, named where the gates are listed, or a reader learns about them
# only when one blocks.
present "SKILL.md names the look gate" "SKILL.md" "scripts/gate-look.mjs"
present "SKILL.md names the page judge" "SKILL.md" "scripts/gate-page-judge.mjs"
present "SKILL.md names the taste gate" "SKILL.md" "scripts/gate-taste.mjs"
present "SKILL.md names the repeated-silhouette finding in the rendered gate" \
  "SKILL.md" "repeated-silhouette"

# COMPOSE READS THE SAME WAY IN THE FILE A BUILDER OPENS FOR EXPLORE.
present "explore-stage says Compose lifts the board rather than rebuilding it" \
  "references/explore-stage.md" "LIFT THE PICKED BOARD, do not rebuild it from the kit"
present "explore-stage names the override command" \
  "references/explore-stage.md" "--override <route> --section"
present "explore-stage records the look per page type" \
  "references/explore-stage.md" "--looked <route> --shot"
present "explore-stage composes a page template once, with photographs chosen per route" \
  "references/explore-stage.md" "chosen per route, not just its words"
present "explore-stage names the page judge" \
  "references/explore-stage.md" "gate-page-judge.mjs"

# THE VERIFIER STATES THE PAGE COMPARISONS AND DISPATCHES NOTHING, because its frontmatter
# carries no Agent tool. A doctrine sentence telling an agent to do something is only true if
# that agent has the tool for it, which is the lesson of 11 September.
present "the verifier carries the page judge as its own step" \
  "agents/palate-verifier.md" "5b. **The page judge**"
present "the verifier says the page comparisons are the main agent's to run" \
  "agents/palate-verifier.md" "the page comparisons are the main build agent's to run"

# THE PICK COMMAND'S OWN PAGE HAS TO CARRY ITS FLAGS, or the only way to find them is the source.
present "pick.md documents the recorded look" "commands/pick.md" "--looked"
present "pick.md documents the primary inner page mark" "commands/pick.md" "--primary"
present "pick.md documents the override" "commands/pick.md" "--override"

# THE PHOTO RULES. A width rule shipped ten of twelve service pages with a 423-572px picture box
# in a 1440px page, under the comment that it was never cropped, and the asset review was honest
# and complete throughout: the review was of the FILES, and nothing said the crop is a decision.
present "assets.md says the crop is decided by looking, per slot" \
  "references/assets.md" "A photograph enters a slot with a DECIDED CROP"
present "assets.md refuses the native-size fallback" \
  "references/assets.md" '"inset at native size" is never a fallback'
present "assets.md says a raw job snap never leads a page" \
  "references/assets.md" "A raw job snap never leads a page"

# RELEASING THE LOOK GATE NARROWS THE JUDGE. `gate-page-judge.mjs` takes its routes from
# `compose.pages[]`, which `--looked` writes, so `PALATE_GATE_LOOK=0` does not only switch off the
# look: it quietly shrinks what is judged to whatever somebody happened to look at.
present "build-manifest says releasing the look narrows the judge's coverage" \
  "references/build-manifest.md" "releasing the look narrows the judge's coverage"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
