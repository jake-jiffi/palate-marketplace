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

Then connect the Palate MCP. Easiest is to sign in with your browser, no token:

```bash
claude mcp add --transport http palate https://mcp.palatemcp.com/api/mcp
```

Claude Code opens your browser to sign in and click Allow. Prefer a token (CI, or other clients)?
Create one at [app.palatemcp.com](https://app.palatemcp.com) and add
`--header "Authorization: Bearer plt_live_xxx"`. Run `/mcp` to confirm `palate` is connected; update
later with `/plugin marketplace update palate`.

## What you get

`palate-website-builder` — builds production-grade Astro websites grounded by the Palate MCP (real
design taste from deeply-analysed reference sites), plus brand packages. It bundles the skill, the
survey/verify agents, the MCP-depth enforcement hooks, and the Palate MCP connector. Full setup and
the manual/other-client paths: see the plugin's `INSTALL.md`.
