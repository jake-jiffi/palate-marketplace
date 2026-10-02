# Palate marketplace

The Claude Code plugin marketplace for [Palate](https://palatemcp.com) — the taste layer for AI
website builders.

## Install (Claude Code)

Run these in your terminal, one at a time. They work the same whether you use Claude Code in the
terminal, an IDE or the desktop app. (The `/plugin` chat commands only run in the terminal version of
Claude Code; typed into the desktop app they open the plugin browser instead.)

```bash
claude plugin marketplace add jake-jiffi/palate-marketplace
claude plugin install palate-website-builder@palate
```

Signed in at [app.palatemcp.com](https://app.palatemcp.com)? The dashboard gives you all of this as one
prompt with your token in it: paste it into Claude Code and it runs every command itself.

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

Then connect the Palate MCP, in the same terminal. With a token from
[app.palatemcp.com](https://app.palatemcp.com) it connects with no sign-in step:

```bash
claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp --header "Authorization: Bearer plt_live_xxx"
```

Or sign in with your browser instead, no token:

```bash
claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp
```

`--scope user` registers palate for your whole user account, not just the current directory. Without
it the connection only exists where you ran the command, so the skill (which builds client sites in
fresh directories) loses the Palate tools. Adding the server does not open the browser by itself: it
shows `! Needs authentication`, so finish in Claude Code by running `/mcp`, selecting `palate`,
choosing **Authenticate**, and clicking **Allow**.

Finally, fully quit and reopen Claude Code (in the desktop app, start a new session): the plugin and the
connection only load at start. Run `/mcp` to confirm `palate` is connected. Update later with
`claude plugin marketplace update palate`, then restart Claude Code so the refreshed plugin loads.

## What you get

`palate-website-builder` — builds production-grade Astro websites grounded by the Palate MCP (real
design taste from deeply-analysed reference sites), plus brand packages. It bundles the skill, the
survey/verify agents, the MCP-depth enforcement hooks, and the Palate MCP connector. Full setup and
the manual/other-client paths: see the plugin's `INSTALL.md`.

## Maintainers

Release process (versioning, the vendored plugin sync, why installs never git-clone): see [RELEASING.md](./RELEASING.md).
