# Palate Website Builder

Palate helps Claude and Codex turn an existing website, brief and assets into working Astro designs. It uses real reference sites for composition and interaction, keeps motion in the normal experience, and carries the chosen direction into the finished site.

## Live design beta

New builds start in an empty directory. The first useful design appears as a live page while the remaining options are being made. Choose in chat, then continue in the same project. Its saved choice and runtime work across sessions and hosts.

- Start with [the builder skill](SKILL.md) and [live build instructions](references/live-build.md).
- Run the generated project's `npm run preview:live` to open its development gallery. The gallery and discarded draft routes are excluded from production builds.
- Use `node scripts/palate.mjs status` to resume. The project owns a pinned runtime; it does not search another host's plugin cache.
- Existing Shopify stores can use the optional buying integration. Service, portfolio, editorial and SaaS marketing websites retain their own journeys. A Shopify CDN image alone does not make a website a shop.
- Reduced motion is a visitor preference, with an alternative interaction. It is not the design default.

A new design preview needs Node 22.12 or later and the Palate MCP connection. Hosting, email delivery, CMS, private brand packages and commerce persistence are configured when the actual project needs them. A local preview does not establish production delivery or deployment.

The beta package includes conventional skill discovery for Claude and Codex. Install only one Palate plugin at a time. Connect the existing `palate` MCP server through the host's supported settings, keep its token in the environment, and start a fresh session after updating. Hook installation and hook trust are separate; the explicit project commands remain available without hooks.

Existing projects without `palate.project.json`, brand packages and legacy maintenance use [LEGACY.md](LEGACY.md). They are not automatically migrated. The details below apply to those retained workflows, including their older scaffold and deployment setup.

Live builds include an independent critic after the chosen direction is viewable and before full-site handover. The coordinator autonomously deepens the critic/builder effort when observed design, creativity or motion gaps need stronger work; a manual request or rating is not required. You can also ask for a **jury review** or use `/palate-beta:jury`. [The critic protocol](references/critic-review.md) shares four revision rounds across corrections, escalation and final repairs, with early stopping, stable Palate references and actual motion checks. It preserves identity and product facts, stays separate from the grading instrument and does not restart for small edits.

# Legacy website and brand workflows

A Claude Code skill that builds production-grade Astro websites, grounded by the Palate MCP. The Palate MCP serves a library of analysed real websites (with inner-page depth, design tokens, do/don't rules, component prompts, and a taste layer), so the sites this skill builds carry real design craft instead of generic AI output.

## Two modes

**Build a website.** Brief plus domain in, deployed Astro site out: Vercel hosting (Cloudflare as backup), GitHub repo, CI/CD, custom domain, full SEO and AI-crawler readiness, forms, search, analytics, the client's brand package, an optional Sanity CMS (opt-in, added only when the client will edit their own copy), and an optional CRO + Ads module.

**Build a brand package.** Raw brand assets in, published private npm package `@palate-projects/{slug}-brand` out: four-format design tokens, unified fonts.css, reference components, examples, brand docs. Usable standalone (feeds Claude Design, v0, Cursor, Figma) or as the brand step of a website build.

## How the modes connect

```
Palate MCP references  ──informs──>  BUILD SITE
                                                │ calls when needed
                                                ▼
                                            BUILD BRAND ──> brand package ──> BUILD SITE consumes
```

A website build can trigger a brand build in-process (Phase 0, when the client has no brand package yet). The Palate MCP's reference library feeds every build with real design taste.

## Requirements

**macOS or Linux.** The gates are shell scripts, so on Windows run Claude Code inside WSL or
Git Bash. Without a shell the plugin still builds but every deterministic gate is skipped, and
it says so rather than reporting a pass. Details in `INSTALL.md`.

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
- `templates/`: `astro-project/` (the site, build-in-CI workflows), `brand-repo-skeleton/` (the brand package shape), `cms-sanity/` (the opt-in CMS overlay, applied by `scripts/add-sanity.sh`), `sanity-schema/`, `github-workflows/`, `cro/` (dormant sub-skills as .tpl)

## Setup required once per machine

`gh`, `node` 22+, `npm`, `jq`, plus env for the modes you use:

- **Build a website**: Vercel CLI (`vercel`), `RESEND_API_KEY`. `SANITY_AUTH_TOKEN` + `SANITY_ORG_ID` (your Sanity org id, from Settings then API in the Sanity dashboard) are needed **only if the build adds a CMS**; the default scaffold has none. The brand GitHub Packages token (`GITHUB_PACKAGES_TOKEN` in `~/.npmrc`, `read:packages` scope) is **Required unless you pass `--vendor-brand`**, since a build consumes the private brand package.
- **Build a brand package**: `GITHUB_PACKAGES_TOKEN` with `write:packages` scope (this mode publishes a package).

`scripts/preflight.sh` (build) and `scripts/brand-preflight.sh` (brand) check what's needed.

## What the verifier measures, and on how much of the site

`scripts/verify-rendered.sh` renders the first **14 routes** by default, at 390, 834 and 1440
wide, and prints how many it dropped. On a larger site raise the cap with `--max-routes <n>`
or name the routes that matter with `--routes /a,/b`. A 3,400-page site is measured on 14
pages unless you say otherwise.

After a fix, `--changed src/components/Nav.astro,src/pages/about.astro` renders only the
routes those files can reach. A file the index has never heard of falls wide, renders
everything and says which file did it. A route whose sources have not changed since it last
passed is skipped and named. On a thirty-route fixture that is 25s against 187s.

The hash covers a route's own source, its import closure, the content entries it renders, and
the shared inputs no closure has to name: the config, `package.json` and the lockfile,
`src/styles`, `src/layouts` and the CSS those layouts import. Edit your brand tokens and every
record goes, with the reason printed. `--changed` rebuilds `.palate/index.json` first, because
that is where both the blast radius and the hashes come from.

**The run before hand-over is `--full`**, which ignores those records. Remote content,
`public/` assets and environment values stay outside the hash, so an unchanged source can
still render differently.

Accessibility is a subset of axe rather than a WCAG pass, and performance is a throttled local
lab run of Core Web Vitals on the home route. `references/testing.md` says exactly what each
one covers; nothing here runs Lighthouse.

## The Palate MCP

The skill reads the reference library through the Palate MCP (`palate` connector, `refs_*` tools) at `https://mcp.palatemcp.com/api/mcp` (http transport), authenticated with your `plt_live_...` token. You add the connector once with `claude mcp add --scope user` (see Install); the token is baked into your Claude Code config, so there is no env var to manage and the tools resolve as `mcp__palate__*` for the skill and the depth gate.
