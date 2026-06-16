# Palate marketplace

The Claude Code plugin marketplace for [Palate](https://palatemcp.com) — the taste layer for AI
website builders.

## Install (Claude Code)

Run these as two separate commands (slash commands run one at a time, so enter the first, wait, then the second):

```
/plugin marketplace add jake-jiffi/palate-marketplace
```

```
/plugin install palate-website-builder@palate
```

Then create a token at [app.palatemcp.com](https://app.palatemcp.com) and export it so the bundled
Palate MCP connector can read it:

```bash
echo 'export PALATE_MCP_TOKEN=plt_live_xxx' >> ~/.zshrc && source ~/.zshrc
```

Restart Claude Code; run `/mcp` to confirm the `palate` server is connected. Update later with
`/plugin marketplace update palate`.

## What you get

`palate-website-builder` — builds production-grade Astro websites grounded by the Palate MCP (real
design taste from deeply-analysed reference sites), plus brand packages. It bundles the skill, the
survey/verify agents, the MCP-depth enforcement hooks, and the Palate MCP connector. Full setup and
the manual/other-client paths: see the plugin's `INSTALL.md`.
