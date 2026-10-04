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

## Three tracks, and the lines between them

There are three plugins in this marketplace and exactly one source repo.

| Plugin | Who installs it | Vendored from | Built by | Moves when |
|---|---|---|---|---|
| `palate-website-builder` | customers, including paying ones | skill repo `main` | `sync-plugin.sh` (build-beta.mjs, prod track) | a deliberate promotion, never otherwise |
| `palate-beta` | testers who opted in | skill repo `beta` | `sync-beta.sh` (build-beta.mjs, beta track) | any time; it is expected to have bugs |
| `palate-classic` | customers who prefer the 1.16 builder | skill repo `classic` | `sync-classic.sh` | security, install or MCP-compatibility fixes only |

2.0.0 (4 October 2026) promoted the live-design builder and kept 1.16 as classic. Classic is
frozen: its version stays 1.16.x and `check-tracks.sh` fails if it moves.

**The customer install path never changes.** `claude plugin marketplace add
jake-jiffi/palate-marketplace` then `claude plugin install
palate-website-builder@palate`, in a terminal. Beta is the same marketplace and
a different plugin: `claude plugin install palate-beta@palate`. Every surface
gives the terminal commands, never the `/plugin` chat commands: typed into the
desktop app's chat box those open the plugin browser instead of running (a real
tester, 2026-10-02).

### Hard rules

1. **Beta is vendored from the `beta` branch, prod from `main`, classic from `classic`.**
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
6. **Never two installed at once.** Both register hooks on plain
   `Write|MultiEdit`, so two manifest recorders write the same
   `build-manifest.json` and double-count MCP calls, corrupting the depth gate's
   own numbers. Install one, uninstall the other.
7. **Run `./scripts/check-tracks.sh` before every push to this repo.** It is
   fifteen invariants and it exits non-zero. Every failure it guards against is
   silent, which is why it is a script and not this paragraph. The last one reads
   the MCP's `lib/plugin-version.ts` from `~/dev/palate/mcp-server`, or from
   `PALATE_MCP_DIR`, and skips with the path printed when that clone is absent.

### Promoting beta to prod

Only when the beta track has been used in earnest and you are satisfied.

1. In the skill repo: merge `beta` into `main`, bump `VERSION` and
   `.claude-plugin/plugin.json` to the release version (drop `-beta.N`), push.
2. Here: `./scripts/sync-plugin.sh` to re-vendor prod from `main`. It sets the
   `palate-website-builder` entry's version; bump `metadata.version` to match.
3. Reset beta to equal `main`: on the skill repo's `beta` branch, merge `main` and set
   `VERSION` to the next minor (2.0.0 was followed by 2.1.0), then `./scripts/sync-beta.sh`,
   which adds `-beta.1`.
4. In `mcp-server`: bump `PLUGIN_VERSION` in `lib/plugin-version.ts` to the same
   release version, and deploy it. That constant is what `palate_setup` reads back
   to a customer asking what they are running, and it has drifted four times.
   Step 5 fails if you skip this, which is the point of it existing.
5. `./scripts/check-tracks.sh`, then commit and push.
6. Customers get it with `claude plugin marketplace update palate`. **No reinstall,
   and no change to any documented command**, which is the whole reason beta is
   a separate plugin rather than a rename.

## Release steps, in order

1. In the SKILL repo (`~/dev/palate/skill`): bump `VERSION`,
   `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`, run
   `node scripts/gen-skill-lite.mjs`, commit, push to main.
2. In THIS repo: run `./scripts/sync-plugin.sh` (packages the skill repo's main
   into `plugins/palate-website-builder` and sets its marketplace version).
3. Bump `metadata.version` in `.claude-plugin/marketplace.json` to match.
4. Bump the MCP's `PLUGIN_VERSION` and deploy it.
5. `./scripts/check-tracks.sh`, commit and push. Users get it with
   `claude plugin marketplace update palate` then a Claude Code restart.

## A classic fix

1. In the skill repo: commit the fix on the `classic` branch, bump `VERSION` and
   `.claude-plugin/plugin.json` to the next 1.16.x, run `node scripts/gen-skill-lite.mjs`,
   tag `classic-v1.16.x`, push the branch and the tag.
2. Here: `./scripts/sync-classic.sh` (archives `classic`, renames it, rewrites command
   references, sets its marketplace version), `./scripts/check-tracks.sh`, commit, push.

## Rules

- Never point `plugins[0].source` back at a git repo/URL: that reintroduces
  the SSH install failure for most users.
- Relative sources require users to add the marketplace as a git source
  (`claude plugin marketplace add jake-jiffi/palate-marketplace`), which every
  Palate surface instructs. Never distribute a bare `marketplace.json` URL:
  relative paths do not resolve from URL-added marketplaces.
- The vendored copy is generated: never hand-edit `plugins/`; fix things in
  the skill repo and re-sync.
