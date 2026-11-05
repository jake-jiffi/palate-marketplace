#!/usr/bin/env bash
# Derive a validated slug from a client name.
# Usage: derive-slug.sh "Addikted to Ink"  ->  prints "addikted-to-ink"
# Handles the digit-start edge case (Cloudflare/npm require a letter start) by
# emitting a suggestion to stderr rather than silently mangling.
set -euo pipefail
CLIENT_NAME="${1:?Usage: derive-slug.sh \"Client Name\"}"

slug=$(printf '%s' "$CLIENT_NAME" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9 -]+/ /g' \
  | tr -s ' ' \
  | sed -E 's/ +/-/g' \
  | sed -E 's/-+/-/g' \
  | sed -E 's/^-+//; s/-+$//' \
  | cut -c1-32 \
  | sed -E 's/-+$//')

if printf '%s' "$slug" | grep -Eq '^[a-z][a-z0-9-]{0,62}$'; then
  printf '%s\n' "$slug"
  exit 0
fi

# Digit-start or otherwise invalid. If it starts with a digit, the run should
# ask the user to confirm a letter-led alternative rather than guess.
if printf '%s' "$slug" | grep -Eq '^[0-9]'; then
  echo "SLUG_NEEDS_CONFIRMATION: '$slug' starts with a digit." >&2
  echo "  Cloudflare worker names and npm scopes must start with a letter." >&2
  echo "  Suggest a letter-led slug to the user, e.g. the client's short name." >&2
  exit 2
fi

echo "derived slug '$slug' is invalid (must start with a letter; lowercase, digits, hyphens only)" >&2
exit 1
