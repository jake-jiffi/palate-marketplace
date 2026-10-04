#!/usr/bin/env bash
# Publish the brand package to GitHub Packages, but check the registry first.
# Skip if the current version is already published with identical content.
# Bump patch if the version exists but content changed.
# Run from inside the brand repo (where package.json lives).
set -euo pipefail

[ -f package.json ] || { echo "no package.json here" >&2; exit 1; }
PKG=$(jq -r '.name' package.json)
VERSION=$(jq -r '.version' package.json)
REGISTRY="https://npm.pkg.github.com"

# Compute a content hash over the things that define the package output
content_hash=$(find tokens fonts components styles 2>/dev/null -type f -exec sha256sum {} \; \
  | sort | sha256sum | cut -d' ' -f1)

# Is this version already in the registry?
if npm view "${PKG}@${VERSION}" version --registry="$REGISTRY" >/dev/null 2>&1; then
  stored_hash=""
  [ -f .palate-brand-state.json ] && stored_hash=$(jq -r '.package.contentHash // ""' .palate-brand-state.json)
  if [ "$content_hash" = "$stored_hash" ]; then
    echo "SKIP: ${PKG}@${VERSION} already published with identical content."
    exit 0
  fi
  # Content changed: bump patch
  new_version=$(node -p "const [a,b,c]=require('./package.json').version.split('.');\`\${a}.\${b}.\${+c+1}\`")
  jq --arg v "$new_version" '.version=$v' package.json > package.json.tmp && mv package.json.tmp package.json
  echo "Content changed; bumped ${VERSION} -> ${new_version}"
  VERSION="$new_version"
fi

echo "publishing ${PKG}@${VERSION} to ${REGISTRY}..."
npm publish --access restricted
echo "PUBLISHED:${PKG}@${VERSION}:${content_hash}"
