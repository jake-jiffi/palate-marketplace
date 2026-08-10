# Consuming the brand package

## In the site
package.json gets `"@palate-projects/{slug}-brand": "{exact-version}"`. The committed .npmrc maps the scope. BaseLayout imports `tokens.css` and `fonts.css`; tailwind.config imports the preset; components compose from `components/*`.

## Auth, three contexts
- Local dev: ~/.npmrc with GITHUB_PACKAGES_TOKEN (read:packages PAT). One-time machine setup, checked by preflight.
- CI: native GITHUB_TOKEN via actions/setup-node (registry-url + scope) and `permissions: packages: read`. No PAT, no rotation.
- Cloudflare: never. The build happens in CI; Cloudflare only receives the built artifact.

## Updating the brand later
Deliberate, three steps: `npm install @palate-projects/{slug}-brand@latest`, review the visual diff, deploy. Documented in the site CLAUDE.md and handover.md.

## Vendored alternative
With --vendor-brand, assets live in src/brand/ and sync-brand.sh re-pulls. No registry, no auth, manual updates.
