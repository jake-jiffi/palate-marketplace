# Palate Website Builder: install guide

One skill, two modes. It builds production-grade Astro websites grounded by the Palate MCP, and it builds brand packages that feed those builds.

## Install (the Claude Code plugin)

Palate ships as a Claude Code plugin that bundles the skill, the survey/verify agents, and the
MCP-depth enforcement hooks. You install the plugin, then connect the Palate MCP with one command.
Two short steps, no environment variables to manage.

1. In Claude Code, add the marketplace then install the plugin, as two separate commands
   (slash commands run one at a time, so enter the first, wait, then the second):
   ```
   /plugin marketplace add jake-jiffi/palate-marketplace
   ```
   ```
   /plugin install palate-website-builder@palate
   ```
   Then run `/reload-plugins` (or restart Claude Code) so the website-builder skill loads. A freshly
   installed plugin is not active until you do.
2. Connect the Palate MCP. Two paths, pick one. Both add the connector once and store everything in
   your Claude Code config (no environment variables).

   **Static token (deterministic, one header, works everywhere).** Get a token at
   https://app.palatemcp.com, then:
   ```bash
   claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp --header 'Authorization: Bearer plt_live_...'
   ```
   This is the predictable path: one bearer header, works the same in the terminal, the VS Code /
   JetBrains extension, the desktop app, and CI.

   **OAuth (no-copy convenience).** Sign in with your browser, no token to paste:
   ```bash
   claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp
   ```
   Adding the server does not open the browser by itself; it shows `! Needs authentication`. Finish in
   Claude Code: run `/mcp`, select `palate`, choose **Authenticate**, and click **Allow**.

   **`--scope user` is required either way.** Without it, `claude mcp add` defaults to local (project)
   scope, so `palate` only exists in the directory where you ran the command. The skill builds client
   sites in fresh directories, so a project-scoped server silently loses the `mcp__palate__*` tools
   there. Always use `--scope user`.
3. Confirm: run `/mcp` (the `palate` server shows connected), or ask Claude to call `refs_list_verticals`.

`brew install jq` once (the gate needs it) - see "One-time machine setup" below.

## The two modes

- **Build a website**: "Build a site for {client}, {domain}. Brand assets at {path}."
- **Build a brand package** (standalone): "Build a brand package for {client}, assets at {path}."

A website build calls the brand build in-process when the client has no brand package yet. The Palate MCP's reference library informs every build.

## What the plugin wires up

- The **skill** (`palate-website-builder`): build a site, or a brand package, grounded by the MCP.
- The **MCP connector** (`palate` / `mcp__palate`), giving the `refs_*` tools (refs_for_business,
  refs_search (hybrid: facets + a lexical query string), refs_get (layer:
  concept|pages|tokens|signature_moves|do_dont|component_prompts|astro_recipe; format:"design"
  returns a DESIGN.md), refs_get_tokens, refs_get_astro_recipe, refs_get_screenshot, refs_insights,
  refs_match_brief, refs_similar, refs_list_verticals). Added once with `claude mcp add --scope user`
  (your token is baked into your Claude Code config, no env var).
- Three **depth hooks** (`hooks/hooks.json`) that nudge a build to actually use the library:
  - **PreToolUse** / **Stop**: by DEFAULT they NUDGE (a non-blocking reminder), they do not block.
    So the plugin can't trap you when the Palate MCP isn't connected, when you're editing an existing
    app, or when the survey ran in a subagent. Set `PALATE_GATE_STRICT=1` to make them HARD-BLOCK an
    under-researched build instead (for agencies/CI that want enforcement).
  - **PostToolUse** records real tool telemetry to `build-manifest.json` (the gate reads this, so
    depth is measured, not claimed).
  The gate is a plain script (`scripts/gate-mcp-depth.sh`), so it also runs in CI / pre-commit. It
  fails OPEN whenever it cannot be satisfied (no manifest, no `jq`, or zero recorded Palate MCP
  calls). Depth thresholds default to 5 refs / 2 inner pages / 1 deep read / 1 rich layer; raise
  them (`PALATE_MIN_REFS=8 PALATE_MIN_INNER=3`) or disable entirely with `PALATE_GATE_OFF=1`.

### Updating

```
/plugin marketplace update palate
```
Then restart Claude Code (or run `/mcp` and reconnect) so the new tools load. Until you do, you may
see an `MCP server palate skipped` warning, especially when upgrading from an older bundled version.
The update picks up the new plugin version (or enable per-marketplace auto-update). No re-running an
installer.

### Uninstalling

```
/plugin uninstall palate-website-builder@palate
claude mcp remove palate
```
Your cross-build memory at `~/.config/palate/builds.log.json` is left in place.

### Other MCP clients (Cursor / Windsurf / Claude Desktop)

The plugin path is Claude Code. For other tools, add the MCP connector directly (token-bearing
form, so the dashboard can hand it to you pre-filled):

```json
{
  "mcpServers": {
    "palate": {
      "type": "http",
      "url": "https://mcp.palatemcp.com/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_PALATE_API_TOKEN" }
    }
  }
}
```
Cursor hooks are beta and only `deny` reliably blocks; point Cursor's PreToolUse hook at
`scripts/gate-mcp-depth.sh` with a `deny` decision (the portable gate is identical, only the wrapper differs).

## Legacy / manual install (deprecated)

Before the plugin, Palate installed as a standalone skill plus an installer script. This still works
but is deprecated; prefer the plugin above. Do NOT run both, the hooks would double-fire; if you have
the legacy install, remove it first with `./scripts/install.sh --uninstall`.

```bash
npx skills add -y https://github.com/jake-jiffi/palate-website-builder   # third-party installer (not first-party Claude Code)
# or: cp -r palate-website-builder ~/.claude/skills/
PALATE_TOKEN=plt_live_xxx ./scripts/install.sh   # adds the connector + jq + the hooks into ~/.claude/settings.json
```

## One-time machine setup

```bash
brew install gh jq
npm i -g vercel
gh auth login

# The brand GitHub Packages token (REQUIRED for a build unless you pass --vendor-brand).
# A build consumes the private brand package, so it needs a read:packages token in ~/.npmrc.
export GITHUB_PACKAGES_TOKEN=ghp_...   # classic PAT, read:packages scope (consuming the brand package)
cat >> ~/.npmrc <<NPMRC
@palate-projects:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=\${GITHUB_PACKAGES_TOKEN}
NPMRC

# Build mode: Vercel + Sanity + email
# Vercel CLI: `vercel login` handles auth
export SANITY_AUTH_TOKEN=...           # Sanity management token (manage scope)
export SANITY_ORG_ID=...               # your Sanity org id (Settings then API in your Sanity dashboard)
export RESEND_API_KEY=...
```
`scripts/preflight.sh` (build) and `scripts/brand-preflight.sh` (brand) check what each mode needs.

### PAT scope: read vs write

The GitHub Packages PAT needs different scopes for the two things you might do:

- **Consuming the brand package** (a website build, the common case): `read:packages` is enough. `scripts/preflight.sh` only installs the private package, so a read-only token works. This token is REQUIRED for a build unless you pass `--vendor-brand` (which uses bundled brand defaults and needs no GitHub Packages token at all).
- **Publishing / authoring a brand package** (BUILD BRAND mode): `write:packages` is required, since that mode pushes a new package version. `scripts/brand-preflight.sh` checks the write capability.

A read-only PAT for builds is the least-privilege default; only mint `write:packages` when you actually author brand packages.

## Build sequence

1. Install the skill and set up the `palate` MCP connector.
2. Brand mode pilot on your own brand.
3. Full build pilot on a test site. The gate: does the private brand package install in CI and deploy to Vercel? If yes, package path validated; if no, use --vendor-brand.
4. First real client.
