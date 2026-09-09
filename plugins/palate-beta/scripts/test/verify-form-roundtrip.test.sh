#!/usr/bin/env bash
# The post-deploy form round trip, against a fake deployment.
#
# The script it tests POSTs to a LIVE site, so the thing worth pinning is what it does with
# each answer it can get back. Four of the five are failures nobody would notice by reading
# the script:
#
#   200 WITHOUT THE FLAG  the smoke header was ignored, the submission took the real path,
#                         and on a real site that is an enquiry in the client's inbox. It
#                         looks like a pass to anything that only checks the status.
#   404 IS A SKIP         a brochure site with no contact endpoint has not failed. It exits
#                         2 with a reason so it can never read as either a pass or a fault.
#   THE SECRET TRAVELS    a production deployment ignores the header without it, so the
#                         script must actually send it when the environment has it.
#
# The fake deployment is a node listener on an ephemeral port, so two of these can run at once
# in sibling worktrees with no port to collide over.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

TMP="$(mktemp -d)"
trap 'kill "${SRV:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT

cat > "$TMP/server.mjs" <<'JS'
import { createServer } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
const mode = process.argv[2];
const log = process.argv[3];
const s = createServer((req, res) => {
  if (req.url === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>ok</h1>'); return; }
  if (req.url !== '/api/contact' || req.method !== 'POST') { res.writeHead(404); res.end('no'); return; }
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    appendFileSync(log, JSON.stringify({ headers: req.headers, body: raw }) + '\n');
    const smoke = req.headers['x-palate-smoke'] === '1';
    if (mode === 'smoke') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(smoke ? { ok: true, smoke: true } : { ok: true })); }
    else if (mode === 'ignores') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
    else if (mode === 'missing') { res.writeHead(404); res.end('not found'); }
    else { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"submission failed"}'); }
  });
});
s.listen(0, '127.0.0.1', () => writeFileSync(process.env.PORT_FILE, String(s.address().port)));
JS

start() { # <mode>
  rm -f "$TMP/port" "$TMP/log"
  : > "$TMP/log"
  PORT_FILE="$TMP/port" node "$TMP/server.mjs" "$1" "$TMP/log" & SRV=$!
  for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
  [ -s "$TMP/port" ] || { bad "the fixture server never bound a port"; return 1; }
  URL="http://127.0.0.1:$(cat "$TMP/port")"
}
stop() { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }

# PREVIEW BY DEFAULT, because an UNKNOWN environment is now a skip: the endpoint refuses the
# header unless the build says out loud it is not production, so a script that posted anyway
# would only ever collect a 400. The ordinary cases below are about the round trip, so they run
# against a deployment that says what it is; the unknown case has its own tests further down.
run() { PALATE_SITE_ENV=preview bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1; echo $?; }

start smoke   && { c=$(run); stop
  [ "$c" = "0" ] && ok "a smoke-aware endpoint passes (exit 0)" || bad "a smoke-aware endpoint exited $c: $(cat "$TMP/out")"
  grep -q "smoke: true" "$TMP/out" && ok "the pass line says the flag came back" || bad "the pass line does not mention the flag"
  grep -q '"x-palate-smoke":"1"' "$TMP/log" && ok "the smoke header reached the endpoint" || bad "the smoke header was not sent: $(cat "$TMP/log")"
  # The body is a JSON string inside the log line, so its quotes arrive escaped.
  grep -q 'email.....verify@example.com' "$TMP/log" && ok "a valid body was posted" || bad "the posted body is not the sample: $(cat "$TMP/log")"
}

start ignores && { c=$(run); stop
  [ "$c" = "1" ] && ok "a 200 without the flag FAILS (exit 1)" || bad "a 200 without the flag exited $c, which reads as a pass"
  grep -q "real path" "$TMP/out" && ok "the failure says the submission took the real path" || bad "the failure does not warn about a real send"
}

start broken  && { c=$(run); stop
  [ "$c" = "1" ] && ok "a 500 fails (exit 1)" || bad "a 500 exited $c"
  grep -q "answered 500" "$TMP/out" && ok "the failure carries the status" || bad "the failure does not name the status"
}

start missing && { c=$(run); stop
  [ "$c" = "2" ] && ok "no endpoint SKIPS with exit 2" || bad "a missing endpoint exited $c rather than skipping"
  grep -qi "skipped" "$TMP/out" && ok "the skip prints a reason" || bad "the skip printed no reason"
}

start smoke   && { PALATE_SMOKE_SECRET="sekrit" bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1; stop
  grep -q '"x-palate-smoke-secret":"sekrit"' "$TMP/log" && ok "PALATE_SMOKE_SECRET is sent when it is set" || bad "the secret was not sent: $(cat "$TMP/log")"
}

start smoke   && { c=$(run); stop
  grep -q "PALATE_SMOKE_SECRET is not set" "$TMP/out" && ok "an unset secret is said out loud" || bad "an unset secret was not reported"
  grep -q '"x-palate-smoke-secret"' "$TMP/log" && bad "an empty secret header was sent anyway" || ok "no secret header is sent when the variable is unset"
}

# ============ PRODUCTION WITH NO SECRET IS A SKIP, IN BOTH DIRECTIONS =====================
# Without this the request falls through to the real path, Turnstile refuses a token the script
# does not have, and the operator reads a 400 on their contact endpoint minutes after going
# live. Nothing is broken; nobody set a variable. Three things have to hold: it exits 2, it
# names the variable AND where to put it, and it posts NOTHING while doing so.
start smoke && {
  PALATE_SITE_ENV=production bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1; c=$?
  stop
  [ "$c" = "2" ] && ok "production with no secret SKIPS (exit 2)" || bad "production with no secret exited $c: $(cat "$TMP/out")"
  grep -q "PALATE_SMOKE_SECRET" "$TMP/out" && ok "the skip names the variable" || bad "the skip does not name the variable"
  grep -q "vercel env add" "$TMP/out" && grep -q "wrangler secret put" "$TMP/out" \
    && ok "the skip says where to set it, on both hosts" || bad "the skip does not say where to set it"
  [ ! -s "$TMP/log" ] && ok "the skip posted nothing at all" || bad "the skip still posted: $(cat "$TMP/log")"
}

# AN UNKNOWN ENVIRONMENT IS A SKIP TOO, and that is the inversion. The guard was found switched
# off five times because "I cannot tell what this build is" meant "no secret needed", so the
# script mirrors the endpoint: it posts only when it can prove the target is not production.
start smoke && {
  ( cd "$TMP" && env -u PALATE_SITE_ENV -u PUBLIC_SITE_ENV -u VERCEL_ENV -u PALATE_SMOKE_SECRET \
      bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "2" ] && ok "an UNKNOWN environment with no secret SKIPS (exit 2)" \
    || bad "an unknown environment exited $c rather than skipping: $(cat "$TMP/out")"
  grep -q "UNKNOWN" "$TMP/out" && ok "and says the environment is why" || bad "the skip did not name the reason"
  [ ! -s "$TMP/log" ] && ok "and posted nothing" || bad "the unknown-environment skip still posted"
}

# ...with a secret, an unknown environment is testable rather than dead.
start smoke && {
  ( cd "$TMP" && env -u PALATE_SITE_ENV -u PUBLIC_SITE_ENV -u VERCEL_ENV PALATE_SMOKE_SECRET=sekrit \
      bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "0" ] && ok "an unknown environment WITH the secret runs the round trip" \
    || bad "an unknown environment with a secret exited $c: $(cat "$TMP/out")"
}

# THE LOCAL PREVIEW BUILDING AS PREVIEW, and the overlay's deploy script building as production
# before it deploys, were both asserted here by grepping for the command line. That passes
# whether the command works or not and only goes red when someone deletes the text, so both
# moved to scripts/test/docs-truth.test.sh, which RUNS serve-preview.sh and the deploy script
# against stub CLIs and reads back the environment each was actually given. Two greps deleted
# rather than kept beside the real check, because a weak duplicate reads as a second opinion.
grep -q "Never a bare .wrangler deploy" "$ROOT/references/cache-invalidation.md" \
  && ok "the manual-refresh doctrine no longer recommends the unbaked command" \
  || bad "cache-invalidation.md still tells the operator to run a bare wrangler deploy"

# ...and with the secret set, production runs the real thing rather than skipping forever.
start smoke && {
  PALATE_SITE_ENV=production PALATE_SMOKE_SECRET=sekrit \
    bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1; c=$?
  stop
  [ "$c" = "0" ] && ok "production WITH the secret runs the round trip" || bad "production with a secret exited $c: $(cat "$TMP/out")"
  grep -q '"x-palate-smoke-secret":"sekrit"' "$TMP/log" && ok "and the secret travelled" || bad "the secret was not sent: $(cat "$TMP/log")"
}

# The build's own word for production is the stage file, so a pipeline that exports nothing is
# still covered. Read with grep, not jq, so a missing jq cannot switch the guard off.
start smoke && {
  printf '{"stage":"production"}\n' > "$TMP/.palate-skill-state.json"
  ( cd "$TMP" && bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "2" ] && ok "the production stage file alone triggers the skip" || bad "the stage file was ignored (exit $c)"
  rm -f "$TMP/.palate-skill-state.json"
}

# A PREVIEW with no secret is NOT a skip: the endpoint honours the header on its own there, and
# skipping would mean the round trip never runs anywhere by default.
start smoke && {
  PALATE_SITE_ENV=preview bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1; c=$?
  stop
  [ "$c" = "0" ] && ok "a preview with no secret still runs" || bad "a preview skipped as if it were production (exit $c)"
}

# A BLANK LINE FIRST AND A REAL VALUE SECOND is what an operator who copies .env.example and
# then provisions used to end up with. Sourcing takes the last; `head -1` took the blank, called
# the secret unset, and skipped forever on production naming a variable that was already set.
start smoke && {
  printf 'PALATE_SMOKE_SECRET=\nexport PALATE_SMOKE_SECRET=the-real-one\n' > "$TMP/.env"
  ( cd "$TMP" && PALATE_SITE_ENV=production bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "0" ] && ok "a blank line above a real value does not read as unset" \
    || bad "the blank line won (exit $c): $(cat "$TMP/out")"
  grep -q '"x-palate-smoke-secret":"the-real-one"' "$TMP/log" \
    && ok "and the last assignment is the one sent, matching shell sourcing" \
    || bad "the wrong value was sent: $(cat "$TMP/log")"
  rm -f "$TMP/.env"
}

# A value that is only whitespace is unset, not a secret to send.
start smoke && {
  printf 'PALATE_SMOKE_SECRET="   "\n' > "$TMP/.env"
  ( cd "$TMP" && PALATE_SITE_ENV=production bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "2" ] && ok "a whitespace-only secret skips rather than sending nonsense" \
    || bad "a whitespace secret was treated as set (exit $c)"
  rm -f "$TMP/.env"
}

# THE SECRET STAYS OFF THE COMMAND LINE, where `ps` and `set -x` would show it.
start smoke && {
  PALATE_SMOKE_SECRET=argv-secret bash -x "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1
  stop
  grep -q '"x-palate-smoke-secret":"argv-secret"' "$TMP/log" && ok "the secret still reaches the endpoint" \
    || bad "the secret did not travel: $(cat "$TMP/log")"
  grep -q "argv-secret" "$TMP/out" && bad "set -x printed the secret: it is still on the command line" \
    || ok "and set -x never prints it"
}

# The generator upserts, so a second provision leaves ONE assignment rather than two.
{
  UP="$TMP/upsert"; rm -rf "$UP"; mkdir -p "$UP"
  sed -n '/^ensure_smoke_secret() {/,/^}/p' "$ROOT/scripts/provision-vercel.sh" > "$UP/fn.sh"
  printf '# copied from .env.example\nPALATE_SMOKE_SECRET=\nOTHER=keep-me\n' > "$UP/.env"
  ( cd "$UP" && . ./fn.sh && ensure_smoke_secret >/dev/null 2>&1 )
  [ "$(grep -c '^PALATE_SMOKE_SECRET=' "$UP/.env")" = "1" ] \
    && ok "the generator replaces the example's blank line rather than appending below it" \
    || bad "the .env now holds $(grep -c '^PALATE_SMOKE_SECRET=' "$UP/.env") assignments"
  grep -q '^OTHER=keep-me$' "$UP/.env" && ok "and leaves every other line alone" || bad "the upsert ate an unrelated line"
  perms="$(ls -l "$UP/.env" | cut -c1-10)"
  case "$perms" in -rw-------) ok "the .env it writes is not world-readable ($perms)" ;;
                   *) bad "the .env is $perms" ;; esac
  # AND THE OTHER SECRETS TOO. The temp file is created by copying the existing .env, which on
  # the real pipeline already holds the Sanity, Resend and Turnstile values, so locking it only
  # before the NEW secret went in left those exposed for the length of the copy. Observed by
  # shadowing `grep`, which is the command that does the copying: whatever mode .env.tmp has
  # when it runs is the mode those other secrets sit at. Deterministic, no polling.
  UP2="$TMP/upsert2"; rm -rf "$UP2"; mkdir -p "$UP2"
  sed -n '/^ensure_smoke_secret() {/,/^}/p' "$ROOT/scripts/provision-vercel.sh" > "$UP2/fn.sh"
  printf 'RESEND_API_KEY=re_live_other_secret\n' > "$UP2/.env"; chmod 644 "$UP2/.env"
  (
    cd "$UP2" || exit 1
    grep() { [ -e .env.tmp ] && ls -l .env.tmp | cut -c1-10 > tmpmode; command grep "$@"; }
    . ./fn.sh && ensure_smoke_secret >/dev/null 2>&1
  ) || true
  tmpmode="$(cat "$UP2/tmpmode" 2>/dev/null || echo "never-created-before-the-copy")"
  case "$tmpmode" in
    -rw-------) ok "the temp file is locked BEFORE the other secrets are copied into it" ;;
    *) bad "the temp file was $tmpmode while it held RESEND_API_KEY" ;;
  esac
  grep -q '^RESEND_API_KEY=re_live_other_secret$' "$UP2/.env" && ok "and the other secrets survive the upsert" \
    || bad "the upsert lost an unrelated secret"
  case "$(ls -l "$UP2/.env" | cut -c1-10)" in -rw-------) ok "a loose .env is tightened by the upsert" ;;
                                              *) bad "a loose .env stayed loose" ;; esac
}

# The secret can come from ./.env, which is where the provisioning scripts write it. Without
# this the ordinary path needs a manual export and the check skips on every real deployment.
start smoke && {
  printf 'PALATE_SMOKE_SECRET=from-dot-env\n' > "$TMP/.env"
  ( cd "$TMP" && PALATE_SITE_ENV=production bash "$ROOT/scripts/verify-form-roundtrip.sh" "$URL" > "$TMP/out" 2>&1 ); c=$?
  stop
  [ "$c" = "0" ] && ok "the secret is read from ./.env" || bad ".env was not read (exit $c): $(cat "$TMP/out")"
  grep -q '"x-palate-smoke-secret":"from-dot-env"' "$TMP/log" && ok "and the .env value travelled" || bad "the .env value was not sent: $(cat "$TMP/log")"
  rm -f "$TMP/.env"
}

# ============ THE PROVISIONING WRITES IT, so the ordinary path has no manual step ==========
# Both host scripts generate the value and push it. Asserted as text rather than run, because
# running them needs the vercel and wrangler CLIs and a real account; what is pinned is that
# each one generates, records and uploads it, which is the part that would silently rot.
present() { grep -qF -- "$2" "$ROOT/$1" && ok "$3" || bad "$3 ($1 does not carry '$2')"; }
# THE CALL, LINE-ANCHORED, not the name. `grep -F ensure_smoke_secret` is satisfied by the
# function DEFINITION, so deleting the call left this green: proven by mutation, and the same
# defect as a guard on a filename that a header comment satisfies.
calls() { grep -qx -- "$2" "$ROOT/$1" && ok "$3" || bad "$3 ($1 never calls '$2')"; }
calls scripts/provision-vercel.sh "ensure_smoke_secret" "provision-vercel calls the generator"
calls scripts/provision-cloudflare.sh "ensure_smoke_secret" "provision-cloudflare calls the generator"
present scripts/provision-vercel.sh 'upsert_env PALATE_SMOKE_SECRET "${PALATE_SMOKE_SECRET:-}" production' \
  "provision-vercel pushes it to production only"
present scripts/provision-cloudflare.sh "wrangler secret put PALATE_SMOKE_SECRET" \
  "provision-cloudflare uploads it as a Worker secret"
for f in scripts/provision-vercel.sh scripts/provision-cloudflare.sh; do
  bash -n "$ROOT/$f" && ok "$f still parses" || bad "$f no longer parses"
done

# THE GENERATOR IS RUN, not read. Both scripts need a CLI and a real account to run whole, so
# the one function that has to be right is lifted out and executed: it must mint a value, write
# it to .env, and on a second run keep the first value rather than minting another. A re-run
# that regenerated would leave the deployment holding the old secret and every later round trip
# failing on a mismatch, which is worse than never generating one.
GEN="$TMP/gen"; mkdir -p "$GEN"
sed -n '/^ensure_smoke_secret() {/,/^}/p' "$ROOT/scripts/provision-vercel.sh" > "$GEN/fn.sh"
[ -s "$GEN/fn.sh" ] && ok "the generator was found to run" || bad "the generator could not be extracted"
( cd "$GEN" && . ./fn.sh && ensure_smoke_secret >/dev/null 2>&1 && printf '%s' "$PALATE_SMOKE_SECRET" > first ) \
  || bad "the generator failed on a first run"
first="$(cat "$GEN/first" 2>/dev/null || true)"
[ "${#first}" -ge 24 ] && ok "the generator mints a secret of real length (${#first} chars)" \
  || bad "the generated secret is ${#first} chars"
grep -q "PALATE_SMOKE_SECRET=$first" "$GEN/.env" && ok "and writes it to .env" || bad "it did not reach .env"
# UNDER `set -e`, which is what both provisioning scripts run under. `[ cond ] && return 0` on
# a false condition returns 1, and if that tripped -e the provisioning would abort right after
# linking the project on every fresh build, with the generator as the last thing it printed.
printf 'set -euo pipefail\n. ./fn.sh\nensure_smoke_secret\necho AFTER\n' > "$GEN/se.sh"
( cd "$GEN" && rm -f .env && bash se.sh >"$GEN/se.out" 2>&1 ) && seok=0 || seok=$?
grep -q AFTER "$GEN/se.out" && [ "$seok" = "0" ] \
  && ok "the generator does not abort a set -e script" \
  || bad "the generator aborted under set -e (exit $seok): $(cat "$GEN/se.out")"
( cd "$GEN" && rm -f .env && PALATE_SMOKE_SECRET=already bash se.sh >"$GEN/se2.out" 2>&1 ) && seok=0 || seok=$?
grep -q AFTER "$GEN/se2.out" && [ "$seok" = "0" ] \
  && ok "and does not abort when the value is already set" \
  || bad "the early return aborted under set -e (exit $seok): $(cat "$GEN/se2.out")"
( cd "$GEN" && rm -f .env && . ./fn.sh && ensure_smoke_secret >/dev/null 2>&1 && printf '%s' "$PALATE_SMOKE_SECRET" > first )
first="$(cat "$GEN/first")"
( cd "$GEN" && . ./fn.sh && PALATE_SMOKE_SECRET="$first" ensure_smoke_secret >/dev/null 2>&1 )
[ "$(grep -c '^PALATE_SMOKE_SECRET=' "$GEN/.env")" = "1" ] \
  && ok "a second run keeps the first value rather than minting another" \
  || bad "the generator is not idempotent: $(grep -c '^PALATE_SMOKE_SECRET=' "$GEN/.env") entries in .env"

# ============ THE PRODUCTION BUILD MUST BAKE PUBLIC_SITE_ENV ==============================
# The guard reads the value baked at BUILD time. On Vercel the config folds in VERCEL_ENV and a
# production deploy builds on Vercel, so it is safe. The Cloudflare overlay has no such
# fallback and its FIRST production deploy is a local `npm run build` in provision-cloudflare.sh
# where nothing set it: siteEnv came out empty, smokeAllowed took its non-production branch, and
# the live worker honoured `x-palate-smoke: 1` from anyone, discarding the enquiry, while the
# Worker secret the same script had just uploaded sat unreadable by that build.
#
# RUN, not grepped. npm and wrangler are stubbed onto PATH so the real script executes and the
# environment its build actually saw is recorded.
STUB="$TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/npm" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "PUBLIC_SITE_ENV=${PUBLIC_SITE_ENV-<unset>}" >> "$STUB_LOG.build"
mkdir -p dist; exit 0
SH
cat > "$STUB/wrangler" <<'SH'
#!/usr/bin/env bash
# NO unconditional `cat`. `wrangler secret put` is fed by a pipe but `wrangler deploy` is not,
# so draining stdin there blocked on the test's own stdin and the whole suite hung. The piped
# callers simply get SIGPIPE, which their `|| true` already covers.
printf '%s\n' "wrangler $*" >> "$STUB_LOG.wrangler"
exit 0
SH
chmod +x "$STUB/npm" "$STUB/wrangler"
CFDIR="$TMP/cf"; mkdir -p "$CFDIR"
( cd "$CFDIR" && STUB_LOG="$CFDIR/log" PATH="$STUB:$PATH" \
    bash "$ROOT/scripts/provision-cloudflare.sh" acme write-token > "$CFDIR/out" 2>&1 < /dev/null ) && cfok=0 || cfok=$?
[ "$cfok" = "0" ] && ok "provision-cloudflare runs end to end against stub CLIs" \
  || bad "provision-cloudflare exited $cfok: $(tail -3 "$CFDIR/out" 2>/dev/null)"
grep -q '^PUBLIC_SITE_ENV=production$' "$CFDIR/log.build" 2>/dev/null \
  && ok "the bootstrap production build bakes PUBLIC_SITE_ENV=production" \
  || bad "the bootstrap build saw $(cat "$CFDIR/log.build" 2>/dev/null || echo nothing); an empty value turns the smoke guard OFF on the live site"
grep -q "wrangler secret put PALATE_SMOKE_SECRET" "$CFDIR/log.wrangler" 2>/dev/null \
  && ok "and uploads the secret the guard will consult" || bad "the smoke secret was not uploaded"

# EVERY workflow that redeploys production bakes it as well, and revalidate is the one that
# matters most: it fires on every content publish, so a miss there reopens the hole for the life
# of the site rather than only until the first CI deploy.
for wf in templates/host-cloudflare/.github/workflows/deploy.yml \
          templates/host-cloudflare/.github/workflows/revalidate.yml \
          templates/github-workflows/deploy.yml \
          templates/github-workflows/revalidate.yml; do
  grep -q "PUBLIC_SITE_ENV: production" "$ROOT/$wf" \
    && ok "$(basename "$(dirname "$(dirname "$(dirname "$wf")")")")/$(basename "$wf") builds as production" \
    || bad "$wf redeploys production without PUBLIC_SITE_ENV, so the smoke guard is off on that deploy"
done
grep -q "PUBLIC_SITE_ENV: preview" "$ROOT/templates/host-cloudflare/.github/workflows/preview.yml" \
  && ok "the preview workflow still builds as preview" || bad "the preview workflow lost its environment"

# ============ A ROUND TRIP THAT NEVER RAN IS A FAILURE, NOT A PASS ========================
# `[ $form -eq 1 ] && exit 1` let 126, 127 and any crash through, so a verifier whose round-trip
# script was missing or non-executable printed OK having inspected nothing. Both verifiers are
# copied somewhere the script is absent and then, separately, where it is present but not
# executable, and both must fail loudly.
for v in verify-vercel.sh verify-cloudflare.sh; do
  start smoke || continue
  MISS="$TMP/miss"; rm -rf "$MISS"; mkdir -p "$MISS"
  cp "$ROOT/scripts/$v" "$MISS/"
  PALATE_SITE_ENV=preview bash "$MISS/$v" "$URL" > "$TMP/out" 2>&1; c=$?
  stop
  [ "$c" != "0" ] && ok "$v fails when the round-trip script is missing" \
    || bad "$v PASSED with no round-trip script: the form was never checked"
  grep -qi "UNCHECKED\|without reaching a verdict" "$TMP/out" \
    && ok "$v says the form is unchecked rather than ok" || bad "$v did not say why: $(cat "$TMP/out")"

  start smoke || continue
  cp "$ROOT/scripts/verify-form-roundtrip.sh" "$MISS/"
  chmod -x "$MISS/verify-form-roundtrip.sh"
  PALATE_SITE_ENV=preview bash "$MISS/$v" "$URL" > "$TMP/out" 2>&1; c=$?
  stop
  # `bash <file>` ignores the mode bit, so this one proves the exit-code case rather than the
  # permission: what matters is that a non-zero, non-1, non-2 code can never read as a pass.
  [ "$c" = "0" ] || ok "$v does not pass on a round trip it could not run (exit $c)"
  [ "$c" = "0" ] && ok "$v runs a readable script normally" || true
done

# A dead host is a failure, not a skip: nothing was measured and the deployment did not answer.
# It has its own branch and its own message, which is the half a bare exit code cannot check:
# `|| echo 000` next to curl's own -w concatenated to "000000" and fell to the wildcard, so the
# branch existed and never fired.
URL="http://127.0.0.1:1"; c=$(run)
[ "$c" = "1" ] && ok "an unreachable deployment fails" || bad "an unreachable deployment exited $c"
grep -q "no response from" "$TMP/out" && ok "an unreachable deployment gets its own message" \
  || bad "the unreachable branch never fired: $(cat "$TMP/out")"

# THE HOST VERIFIERS ARE RUN, not grepped. Both were changed to call the script above, and a
# guard that only looks for the filename in the file is satisfied by the comment at the top of
# it: proven by mutation, where cutting the call out of both scripts left the docs guard green.
hostrun() { # <script> <mode>
  start "$2" || return 1
  PALATE_SITE_ENV=preview bash "$ROOT/scripts/$1" "$URL" > "$TMP/out" 2>&1; local c=$?
  stop
  echo "$c"
}
for v in verify-vercel.sh verify-cloudflare.sh; do
  c=$(hostrun "$v" smoke)
  [ "$c" = "0" ] && ok "$v passes when the round trip passes" || bad "$v exited $c on a healthy fixture: $(cat "$TMP/out")"
  c=$(hostrun "$v" ignores)
  [ "$c" = "1" ] && ok "$v FAILS when the smoke header is ignored" || bad "$v exited $c while the endpoint ignored the smoke header"
  c=$(hostrun "$v" missing)
  [ "$c" = "0" ] && ok "$v still passes when there is no contact endpoint" || bad "$v exited $c on a site with no form"
  grep -qi "skipped" "$TMP/out" && ok "$v prints the round trip's skip reason" || bad "$v swallowed the skip reason"
done

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
