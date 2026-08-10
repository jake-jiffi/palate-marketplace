# Gotchas

- **GitHub Packages needs write:packages scope.** This is a distinct classic-PAT scope, separate from `gh auth login`. Preflight tests it with `npm whoami --registry=https://npm.pkg.github.com`. Remediation: create a classic PAT with `write:packages` + `read:packages`, export as `GITHUB_PACKAGES_TOKEN`.
- **Scanned PDF brand guides are image-only.** Run OCR before parsing, or vision-review the pages directly.
- **Adobe Fonts are non-redistributable.** Document the kit ID in LICENSE; do not vendor the files. Load via the Adobe kit URL.
- **AVIF-only photography cannot be vision-reviewed directly.** Convert to JPG previews first: `sips -s format jpeg -Z 1200`.
- **Token name collisions.** Namespace palette primitives (`--palette-blue-500`) and semantic aliases (`--brand-text-primary`) differently. Collisions cause silent override bugs.
- **The registry rejects republishing the same version.** `publish-package.sh` checks first and bumps the patch if content changed, skips if identical.
- **Empty-repo detection.** `resolve-repo.sh` checks commit count via the API; a repo with a default README counts as non-empty. Create repos with `--private` and no auto-init, or the emptiness check trips.
- **Digit-leading slugs.** Client names like "542 Partners" produce slugs starting with a digit, which Cloudflare worker names and npm scopes reject. derive-slug.sh surfaces this for user confirmation rather than guessing.
