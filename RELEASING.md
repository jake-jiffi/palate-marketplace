# Releasing a new plugin version

The plugin is developed in `jake-jiffi/palate-website-builder` but **shipped
vendored** in this repo at `plugins/palate-website-builder` (source
`"./plugins/palate-website-builder"` in `.claude-plugin/marketplace.json`).

Why vendored: Claude Code's `/plugin install` clones git plugin sources over
SSH with strict host checking and no HTTPS fallback
(anthropics/claude-code#50725, #29722, #52234), which fails for any user who
has never connected to GitHub over SSH. `/plugin marketplace add` DOES fall
back to HTTPS, so shipping the plugin inside the marketplace makes install a
local file copy: no second clone, no SSH, works on every machine. Proven with
`GIT_SSH_COMMAND=/usr/bin/false` clean-room tests (add, install and update
all succeed).

## Release steps, in order

1. In the SKILL repo (`~/dev/palate/skill`): bump `VERSION` and
   `.claude-plugin/plugin.json` version, commit, push to main.
2. In THIS repo: run `./scripts/sync-plugin.sh` (re-archives the skill repo's
   main into `plugins/palate-website-builder`).
3. Bump the two versions in `.claude-plugin/marketplace.json`
   (`metadata.version` and `plugins[0].version`) to match.
4. Commit and push. Users get it with `/plugin marketplace update palate`
   then a Claude Code restart (`/reload-plugins` also works).

## Rules

- Never point `plugins[0].source` back at a git repo/URL: that reintroduces
  the SSH install failure for most users.
- Relative sources require users to add the marketplace as a git source
  (`/plugin marketplace add jake-jiffi/palate-marketplace`), which every
  Palate surface instructs. Never distribute a bare `marketplace.json` URL:
  relative paths do not resolve from URL-added marketplaces.
- The vendored copy is generated: never hand-edit `plugins/`; fix things in
  the skill repo and re-sync.
