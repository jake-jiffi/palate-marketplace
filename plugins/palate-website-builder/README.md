# Palate Website Builder

A Claude Code skill that builds production-grade Astro websites, grounded by the Palate MCP. The Palate MCP serves a library of 268 deeply-analysed real websites (with inner-page depth, design tokens, do/don't rules, component prompts, and a taste layer), so the sites this skill builds carry real design craft instead of generic AI output.

## Two modes

**Build a website.** Brief plus domain in, deployed Astro site out: Sanity CMS, Vercel hosting (Cloudflare as backup), GitHub repo, CI/CD, custom domain, full SEO and AI-crawler readiness, forms, search, analytics, the client's brand package, and an optional CRO + Ads module.

**Build a brand package.** Raw brand assets in, published private npm package `@palate-projects/{slug}-brand` out: four-format design tokens, unified fonts.css, reference components, examples, brand docs. Usable standalone (feeds Claude Design, v0, Cursor, Figma) or as the brand step of a website build.

## How the modes connect

```
Palate MCP (268 references)  ──informs──>  BUILD SITE
                                                │ calls when needed
                                                ▼
                                            BUILD BRAND ──> brand package ──> BUILD SITE consumes
```

A website build can trigger a brand build in-process (Phase 0, when the client has no brand package yet). The Palate MCP's reference library feeds every build with real design taste.

## Install

Palate is a Claude Code plugin (it bundles the skill, the agents, and the MCP-depth enforcement
hooks). In Claude Code, run these as two separate commands (slash commands run one at a time):
```
/plugin marketplace add jake-jiffi/palate-marketplace
```
```
/plugin install palate-website-builder@palate
```
Then connect the Palate MCP. Two equal paths (always with `--scope user`, so the connector exists in
every directory the skill builds in, not just the current one). Static token (deterministic, one
header, works in CLI / IDE / Desktop / CI), token from https://app.palatemcp.com:
```bash
claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp --header 'Authorization: Bearer plt_live_...'
```
Or OAuth (no-copy convenience, browser sign-in):
```bash
claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp
```
Claude Code opens your browser to sign in and click Allow. Full steps, updating, and the
legacy/manual path: see `INSTALL.md`.

## Layout

- `SKILL.md`: mode dispatch + the two mode workflows
- `references/`: build operational + detail docs, `brand/` (the brand-package docs), `reference-library/` (library machinery)
- `scripts/`: build scripts, brand scripts (brand- prefixed where they'd collide), all tested bash
- `templates/`: `astro-project/` (the site, build-in-CI workflows), `brand-repo-skeleton/` (the brand package shape), `sanity-schema/`, `github-workflows/`, `cro/` (dormant sub-skills as .tpl)

## Setup required once per machine

`gh`, `node` 22+, `npm`, `jq`, plus env for the modes you use:

- **Build a website**: Vercel CLI (`vercel`), `SANITY_AUTH_TOKEN`, `SANITY_ORG_ID` (your Sanity org id, from Settings then API in the Sanity dashboard), `RESEND_API_KEY`. The brand GitHub Packages token (`GITHUB_PACKAGES_TOKEN` in `~/.npmrc`, `read:packages` scope) is **Required unless you pass `--vendor-brand`**, since a build consumes the private brand package.
- **Build a brand package**: `GITHUB_PACKAGES_TOKEN` with `write:packages` scope (this mode publishes a package).

`scripts/preflight.sh` (build) and `scripts/brand-preflight.sh` (brand) check what's needed.

## The Palate MCP

The skill reads the reference library through the Palate MCP (`palate` connector, `refs_*` tools) at `https://mcp.palatemcp.com/api/mcp` (http transport), authenticated with your `plt_live_...` token. You add the connector once with `claude mcp add --scope user` (see Install); the token is baked into your Claude Code config, so there is no env var to manage and the tools resolve as `mcp__palate__*` for the skill and the depth gate.
