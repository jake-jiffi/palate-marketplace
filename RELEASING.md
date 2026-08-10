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

## Two tracks, and the line between them

There are two plugins in this marketplace and exactly one source repo.

| Plugin | Who installs it | Vendored from | Moves when |
|---|---|---|---|
| `palate-website-builder` | customers, including paying ones | skill repo `main` | a deliberate promotion, never otherwise |
| `palate-beta` | testers who opted in | skill repo `beta` | any time; it is expected to have bugs |

**The customer install path never changes.** `/plugin marketplace add
jake-jiffi/palate-marketplace` then `/plugin install
palate-website-builder@palate`. Beta is the same marketplace and a different
plugin: `/plugin install palate-beta@palate`.

### Hard rules

1. **Beta is vendored from the `beta` branch. Prod is vendored from `main`.**
   Never sync one from the other's branch. `./scripts/check-tracks.sh` fails if
   the prod vendor and skill `main` disagree, because that is what carrying
   unpromoted work to customers looks like from the outside: valid JSON, a
   plausible version, an install that works.
2. **`main` stays equal to what is vendored for customers.** Experimental work
   lives on `beta` until promoted. That correspondence is the thing that makes
   "what are customers running" answerable without reading a diff.
3. **Beta versions carry `-beta.N`. Prod versions never do.** A prod version
   with a prerelease tag means an unstable build reached the customer entry; a
   beta version without one gets mistaken for a release in a changelog.
4. **`plugins/` is generated. Never hand-edit either vendored copy.** Fix it in
   the skill repo on the right branch and re-sync. `sync-beta.sh` rewrites the
   plugin name, the version and every `/palate-website-builder:` command
   reference into `/palate-beta:`, because commands namespace by plugin name and
   a leaked prefix is a command that silently does not exist.
5. **Beta appears on no customer-facing surface.** Not the docs, the FAQ, the
   dashboard connect card, `palate_setup`, this README, or the skill's
   `INSTALL.md`. Testers are told; nobody discovers it in the funnel.
6. **Never both installed at once.** Both register hooks on plain
   `Write|MultiEdit`, so two manifest recorders write the same
   `build-manifest.json` and double-count MCP calls, corrupting the depth gate's
   own numbers. Install one, uninstall the other.
7. **Run `./scripts/check-tracks.sh` before every push to this repo.** It is
   thirteen invariants and it exits non-zero. Every failure it guards against is
   silent, which is why it is a script and not this paragraph.

### Promoting beta to prod

Only when the beta track has been used in earnest and you are satisfied.

1. In the skill repo: merge `beta` into `main`, bump `VERSION` and
   `.claude-plugin/plugin.json` to the release version (drop `-beta.N`), push.
2. Here: `./scripts/sync-plugin.sh` to re-vendor prod from `main`.
3. Bump `metadata.version` and the `palate-website-builder` entry to match.
4. `./scripts/check-tracks.sh`, then commit and push.
5. Customers get it with `/plugin marketplace update palate`. **No reinstall,
   and no change to any documented command**, which is the whole reason beta is
   a separate plugin rather than a rename.

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
