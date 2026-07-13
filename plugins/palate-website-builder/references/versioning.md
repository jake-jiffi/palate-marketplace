# Versioning

## The site
The site repo is versioned with git. Releases are deploys (push to main). No separate version number needed; the git SHA is the version.

## The brand package
Pinned EXACTLY in the site's package.json (e.g. "2.0.0"). Never a caret or latest. A brand update is a conscious act: bump the pin, review the visual diff, deploy. This means a brand change can never silently ride into a live site on the next content rebuild.

## Dependencies
All stack dependencies are pinned to exact versions in the template's package.json (Astro 6.0.0, not ^6). Upgrades are deliberate, tested, and committed. This is what makes the skill produce the same result every time.
