# Publishing to GitHub Packages

## The package.json fields that matter
```json
{
  "name": "@palate-projects/{slug}-brand",
  "version": "1.0.0",
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "repository": { "type": "git", "url": "https://github.com/palate-projects/{slug}-brand.git" },
  "exports": {
    "./tokens.css": "./tokens/tokens.css",
    "./fonts.css": "./fonts/fonts.css",
    "./tailwind.preset": "./tokens/tailwind.preset.ts",
    "./tokens.json": "./tokens/tokens.json",
    "./tokens": "./tokens/tokens.ts",
    "./components/*": "./components/*"
  },
  "files": ["tokens", "fonts", "components", "styles", "logo", "characters", "brand"]
}
```

The `exports` map is the contract palate-website-builder depends on. `verify-brand-exports.sh` in the website-builder checks these exact entries.

## The .npmrc (committed, no token)
```
@palate-projects:registry=https://npm.pkg.github.com
```
The token comes from the environment (`GITHUB_PACKAGES_TOKEN` locally, `GITHUB_TOKEN` in CI), never from the committed file.

## Publishing
Use `scripts/publish-package.sh`. It checks the registry first: skips if the current version is already published with identical content, bumps the patch if the version exists but content changed, otherwise publishes. This makes re-runs safe (heal for the republish-conflict failure mode).

## Scope and access
`npm publish --access restricted` keeps it private to the palate-projects org. Team members with read access to the org can install it.
