#!/usr/bin/env bash
# Phase C: provision Vercel (alternative to provision-cloudflare.sh when the
# build's host is Vercel). Links the project, pushes env vars scoped per
# environment, triggers the initial production deploy. Idempotent (env upserts;
# `vercel link --yes` reuses any existing link).
#
#   Usage:  provision-vercel.sh <slug>
#
# Requires the `vercel` CLI (npm i -g vercel) and `vercel login` already done.
# Reads env vars from ./.env (the build-time vars + runtime secrets it forwards
# to the Vercel project). See references/hosting-vercel.md and
# references/idempotency.md.
set -euo pipefail
SLUG="${1:?slug}"
PROJECT="${SLUG}-site"

command -v vercel >/dev/null 2>&1 \
  || { echo "vercel CLI not installed. Run: npm i -g vercel" >&2; exit 1; }

echo "linking Vercel project '${PROJECT}'..."
vercel link --yes --project "$PROJECT" >/dev/null

# Idempotent env upsert. `vercel env add` errors if the var exists, so remove
# first. Empty values are skipped (a missing optional secret should not blank
# the dashboard value).
upsert_env() {
  local key="$1" value="$2" target="$3"
  [ -n "$value" ] || return 0
  vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$target" >/dev/null
}

set -a; [ -f .env ] && . ./.env; set +a

# THE POST-DEPLOY FORM ROUND TRIP'S SECRET, generated here rather than read from .env like the
# others, because it is the one value nobody has a reason to invent: it exists only so
# verify-form-roundtrip.sh can reach /api/contact on a PRODUCTION deployment without the
# endpoint sending a real enquiry. Without it that check skips, and a check that always skips
# is a check nobody runs. Written back to .env (gitignored) so the verifier finds it with no
# manual step, and only generated when it is not already there, so a re-run keeps the value the
# deployment already holds.
ensure_smoke_secret() {
  [ -n "${PALATE_SMOKE_SECRET:-}" ] && return 0
  if command -v openssl >/dev/null 2>&1; then
    PALATE_SMOKE_SECRET="$(openssl rand -hex 24)"
  else
    PALATE_SMOKE_SECRET="$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 48)"
  fi
  export PALATE_SMOKE_SECRET
  [ -f .env ] || : > .env
  # UPSERT, the way provision-sanity.sh already does it here. Appending left a blank
  # `PALATE_SMOKE_SECRET=` from .env.example above a real one, and a reader taking the first
  # match then concluded the secret was unset.
  # THE TEMP FILE IS LOCKED BEFORE ANYTHING IS WRITTEN TO IT, not just before the new secret.
  # The grep copies the EXISTING .env into it, which on the normal pipeline already holds
  # SANITY_API_READ_TOKEN, RESEND_API_KEY and TURNSTILE_SECRET, so creating it by redirect at
  # the default umask left those world-readable for the length of the copy. mv then carries
  # this mode onto .env, which also tightens a .env that was already loose.
  : > .env.tmp
  chmod 600 .env.tmp 2>/dev/null || true
  { grep -v '^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}PALATE_SMOKE_SECRET[[:space:]]*=' .env || true; } >> .env.tmp
  printf '\n# Post-deploy form round trip (verify-form-roundtrip.sh). Production only.\nPALATE_SMOKE_SECRET=%s\n' "$PALATE_SMOKE_SECRET" >> .env.tmp
  mv .env.tmp .env
  echo "generated PALATE_SMOKE_SECRET and wrote it to ./.env"
}
ensure_smoke_secret

echo "pushing build-time vars (all environments)..."
for target in production preview development; do
  upsert_env SANITY_PROJECT_ID    "${SANITY_PROJECT_ID:-}"            "$target"
  upsert_env SANITY_DATASET       "${SANITY_DATASET:-production}"     "$target"
  upsert_env SANITY_API_READ_TOKEN "${SANITY_API_READ_TOKEN:-}"        "$target"
  # REQUIRED so Vercel's build can `npm ci` the private @palate-projects brand
  # package - the committed .npmrc reads ${GITHUB_PACKAGES_TOKEN}. Empty (e.g.
  # --vendor-brand) is skipped by upsert_env.
  upsert_env GITHUB_PACKAGES_TOKEN "${GITHUB_PACKAGES_TOKEN:-}"        "$target"
done

echo "pushing visual-editing flag (true on preview, false elsewhere)..."
upsert_env PUBLIC_SANITY_VISUAL_EDITING_ENABLED true  preview
upsert_env PUBLIC_SANITY_VISUAL_EDITING_ENABLED false production
upsert_env PUBLIC_SANITY_VISUAL_EDITING_ENABLED false development

echo "pushing runtime secrets (production + preview)..."
for target in production preview; do
  upsert_env SANITY_API_WRITE_TOKEN "${SANITY_API_WRITE_TOKEN:-}" "$target"
  upsert_env RESEND_API_KEY         "${RESEND_API_KEY:-}"         "$target"
  upsert_env TURNSTILE_SECRET       "${TURNSTILE_SECRET:-}"       "$target"
done

# Production only. On a preview the endpoint honours the smoke header without a secret, so a
# value there would be consulted by nothing.
upsert_env PALATE_SMOKE_SECRET "${PALATE_SMOKE_SECRET:-}" production

echo "deploying to production..."
URL=$(vercel deploy --prod --yes | tail -1)

# Connect the GitHub repo so every push to main auto-deploys and every PR gets a
# preview deployment (this is what makes "Vercel's Git integration owns the loop"
# true). Needs the repo remote to exist (Phase D). If it is not there yet, the
# flow runs `vercel git connect --yes` after Phase D pushes the repo.
if git remote get-url origin >/dev/null 2>&1; then
  echo "connecting Vercel project to the Git remote (auto-deploy on push)..."
  if vercel git connect --yes >/dev/null 2>&1; then
    echo "GIT_CONNECTED"
  else
    echo "GIT_CONNECT_SKIPPED: run 'vercel git connect --yes' in $(pwd) once the repo is reachable"
  fi
else
  echo "PENDING_GIT_CONNECT: no git remote yet - run 'vercel git connect --yes' here after Phase D pushes the repo"
fi

echo "VERCEL_PROVISIONED:${PROJECT}"
echo "PRODUCTION_URL:${URL}"
