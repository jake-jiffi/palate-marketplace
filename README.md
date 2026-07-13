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

> **If the install fails with "Host key verification failed" / "No ED25519 host key is known for github.com":**
> this is a known Claude Code installer issue ([anthropics/claude-code#50725](https://github.com/anthropics/claude-code/issues/50725));
> it clones over SSH with strict host checking, which fails on machines that have never
> connected to GitHub over SSH. Fix it once with:
>
> ```bash
> mkdir -p ~/.ssh && ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
> ```
>
> then run the install command again. Updating Claude Code (`claude update`) also helps on recent versions.

After installing, run `/reload-plugins` (or restart Claude Code) so the website-builder skill loads. A
freshly installed plugin is not active until you do.

Then connect the Palate MCP. Easiest is to sign in with your browser, no token:

```bash
claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp
```

`--scope user` registers palate for your whole user account, not just the current directory. Without
it the connection only exists where you ran the command, so the skill (which builds client sites in
fresh directories) loses the Palate tools. Adding the server does not open the browser by itself: it
shows `! Needs authentication`, so finish in Claude Code by running `/mcp`, selecting `palate`,
choosing **Authenticate**, and clicking **Allow**. Prefer a token (CI, or other clients)? Create one at
[app.palatemcp.com](https://app.palatemcp.com) and add `--header "Authorization: Bearer plt_live_xxx"`
(it connects with no sign-in step). Run `/mcp` to confirm `palate` is connected; update later with
`/plugin marketplace update palate`, then restart Claude Code so the refreshed plugin loads.

## What you get

`palate-website-builder` — builds production-grade Astro websites grounded by the Palate MCP (real
design taste from deeply-analysed reference sites), plus brand packages. It bundles the skill, the
survey/verify agents, the MCP-depth enforcement hooks, and the Palate MCP connector. Full setup and
the manual/other-client paths: see the plugin's `INSTALL.md`.
