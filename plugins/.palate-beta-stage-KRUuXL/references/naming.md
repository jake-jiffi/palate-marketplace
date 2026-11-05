# Naming and slug derivation

The slug drives everything: the worker name (`{slug}-site`), the GitHub repo (`palate-projects/{slug}`), the brand repo (`palate-projects/{slug}-brand`), and resource tags.

## Derivation
Run `scripts/derive-slug.sh "Client Name"`. It lowercases, strips non-alphanumerics, collapses spaces to hyphens, trims to 32 chars.

## The digit-start edge case
Cloudflare worker names and npm scopes must start with a letter. A client like "542 Partners" yields "542-partners" which is invalid. derive-slug.sh exits 2 with SLUG_NEEDS_CONFIRMATION rather than guessing. When this happens, ask the user for a letter-led slug (often the client's short name or an abbreviation).

## Availability check (before committing to a slug)
Check all four namespaces:
- Cloudflare: worker name `{slug}-site` not taken on the account
- Sanity: Studio hostname `{slug}` globally unique (this is the strict one; Sanity Studio hostnames are unique across ALL of Sanity, not just the org)
- GitHub: `palate-projects/{slug}` and `palate-projects/{slug}-brand` available (or empty)
- If any conflict, append a discriminator (`-web`, `-au`) consistently and re-check all four.

## Consistency rule
Whatever slug you settle on, it must be identical across all four namespaces. Never let the worker be `acme-site` while the repo is `acme-co`. The detection logic on resume depends on the slug being predictable.
