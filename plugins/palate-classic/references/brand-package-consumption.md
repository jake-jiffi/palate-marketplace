# Consuming the brand package

## In the site
package.json gets `"@palate-projects/{slug}-brand": "{exact-version}"`. The committed .npmrc maps `@palate-projects` to `https://npm.pkg.github.com`. BaseLayout imports `tokens.css` and `fonts.css`; tailwind.config imports the preset; components compose from `components/*`.

**The scope in .npmrc must match the scope in package.json.** They drifted: the scaffold's .npmrc mapped `@jiffi-projects` while the dependency was `@palate-projects`, so the scope resolved to the public registry (404) and a handed-over client site depended on a scope in OUR org. `scripts/test/scaffold-brand-wiring.test.sh` now fails if they disagree.

**A partial brand is a real brand.** If the client gave colours and no type, the package publishes `tokens.css` and no `fonts.css`; `verify-brand-exports.sh` reports `OK:PARTIAL:type-free` rather than calling it broken, BaseLayout drops the `fonts.css` import, and the brand record carries `"locked": { "colour": true, "type": false }` so the next build knows type is the axis it may vary. See `references/phase-0-brand-detection.md`.

## Wired is not used
Being a dependency proves nothing about the built site. `scripts/gate-brand-token-usage.mjs` reads `dist/` and checks that the shipped CSS resolves its colours and faces from the brand's own vocabulary: a hex used in a colour property that no custom property declares is a finding, and so is a `font-family` naming a face with no `--*-font-*` token and no `@font-face` behind it. It runs inside `verify-is-real-astro.sh`. Repeated off-token colours and undeclared faces block; a couple of distinct one-off literals are advisory (thresholds and their calibration are documented at the top of the script).

## Auth, three contexts
- Local dev: ~/.npmrc with GITHUB_PACKAGES_TOKEN (read:packages PAT). One-time machine setup, checked by preflight.
- CI: native GITHUB_TOKEN via actions/setup-node (registry-url + scope) and `permissions: packages: read`. No PAT, no rotation.
- Cloudflare: never. The build happens in CI; Cloudflare only receives the built artifact.

## Updating the brand later
Deliberate, three steps: `npm install @palate-projects/{slug}-brand@latest`, review the visual diff, deploy. Documented in the site CLAUDE.md and handover.md.

## Vendored alternative
With --vendor-brand, assets live in src/brand/ and sync-brand.sh re-pulls. No registry, no auth, manual updates.
