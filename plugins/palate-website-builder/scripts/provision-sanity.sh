#!/usr/bin/env bash
# Phase B: provision Sanity. Creates project, dataset, TWO tokens (viewer for
# frontend reads, editor for the form handler writing to formSubmission),
# and CORS for the site origin. The Studio is EMBEDDED in the site via
# @sanity/astro (route /studio) - there is no separate Studio to deploy.
# Uses the Management API via curl (more reliable than sanity init --no-interactive).
# Requires: SANITY_AUTH_TOKEN (manage scope), SANITY_ORG_ID (your Sanity org id).
# Usage: provision-sanity.sh <slug> <display-name> <site-domain> [editors-csv]
set -euo pipefail
SLUG="${1:?slug}"; NAME="${2:?display name}"; SITE_DOMAIN="${3:?site domain}"; EDITORS="${4:-}"
API="https://api.sanity.io/v2021-06-07"
AUTH="Authorization: Bearer ${SANITY_AUTH_TOKEN:?set SANITY_AUTH_TOKEN}"
SANITY_ORG_ID="${SANITY_ORG_ID:-}"

# Idempotent (check-before-act, see references/idempotency.md): reuse an
# existing project with this displayName rather than creating a duplicate, so a
# resumed Phase B never spawns a second project.
echo "checking for an existing Sanity project '${NAME}'..."
PROJECT_ID=$(curl -s "${API}/projects" -H "$AUTH" \
  | jq -r --arg n "$NAME" 'map(select(.displayName==$n)) | .[0].id // empty' 2>/dev/null)
if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ]; then
  echo "  reusing existing projectId=$PROJECT_ID"
else
  echo "creating Sanity project '${NAME}'..."
  proj=$(curl -s -X POST "${API}/projects" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"displayName\":\"${NAME}\",\"organizationId\":\"${SANITY_ORG_ID:?set SANITY_ORG_ID (your Sanity organisation id, Settings then API in your Sanity dashboard)}\"}")
  PROJECT_ID=$(printf '%s' "$proj" | jq -r '.id // empty')
  [ -n "$PROJECT_ID" ] || { echo "project create failed: $proj" >&2; exit 1; }
  echo "  projectId=$PROJECT_ID"
fi

echo "creating production dataset..."
curl -s -X PUT "${API}/projects/${PROJECT_ID}/datasets/production" -H "$AUTH" \
  -H "Content-Type: application/json" -d '{"aclMode":"public"}' >/dev/null

# Two tokens. Viewer = read-only for the frontend. Editor = write for the form handler.
echo "creating viewer token (frontend reads)..."
viewer=$(curl -s -X POST "${API}/projects/${PROJECT_ID}/tokens" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"label\":\"astro-read-${SLUG}\",\"roleName\":\"viewer\"}")
READ_TOKEN=$(printf '%s' "$viewer" | jq -r '.key // empty')

echo "creating editor token (form handler writes)..."
editor=$(curl -s -X POST "${API}/projects/${PROJECT_ID}/tokens" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"label\":\"form-writer-${SLUG}\",\"roleName\":\"editor\"}")
WRITE_TOKEN=$(printf '%s' "$editor" | jq -r '.key // empty')

[ -n "$READ_TOKEN" ] && [ -n "$WRITE_TOKEN" ] || { echo "token creation failed" >&2; exit 1; }

# CORS: the embedded Studio calls the Sanity API from the browser at the SITE
# origin, so allow that plus the local dev origin.
echo "adding CORS origins..."
for origin in "http://localhost:4321" "https://${SITE_DOMAIN}"; do
  curl -s -X POST "${API}/projects/${PROJECT_ID}/cors" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"origin\":\"${origin}\",\"allowCredentials\":true}" >/dev/null
done

# Write the build-time vars to .env. The write token is NOT written here; it is
# emitted on stdout for the caller to push as a Cloudflare Worker secret.
# Idempotent: strip any existing line for each key before appending, so a
# re-run does not duplicate keys (see references/idempotency.md).
touch .env
for kv in "SANITY_PROJECT_ID=${PROJECT_ID}" "SANITY_DATASET=production" "SANITY_API_READ_TOKEN=${READ_TOKEN}"; do
  key="${kv%%=*}"
  grep -v "^${key}=" .env > .env.tmp 2>/dev/null || true
  mv .env.tmp .env
  echo "$kv" >> .env
done

echo "SANITY_PROVISIONED:${PROJECT_ID}"
echo "WRITE_TOKEN_FOR_WORKER_SECRET:${WRITE_TOKEN}"   # caller captures, pushes to CF, never logs
