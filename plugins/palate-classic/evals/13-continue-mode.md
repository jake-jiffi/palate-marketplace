# Eval 13 - CONTINUE SITE mode extends an existing site without a rebuild

### Brief (verbatim)

> Here is an existing Astro marketing site (already built, live). Add a
> new `/pricing` page that matches the rest of the site. Do not rebuild it.

### Setup

An existing site the plugin is handed, EITHER a Palate scaffold (has
`.palate-skill-state.json` + `build-manifest.json`) OR an external site the
plugin has never seen (no state, its own `BaseLayout`, its own Tailwind preset /
design-token file / CSS custom properties, a nav and a sitemap). No new scaffold
is created; the work happens in the existing project.

### Expected behaviour

The request routes to **CONTINUE SITE** mode (SKILL.md dispatch), not a fresh
BUILD SITE. The mode locks the existing identity, grounds the new page in the
Palate MCP per section, builds it in the site's own layout and tokens, wires its
SEO + sitemap + nav, gates the changed page, and skips the scaffold / identity /
provisioning machinery. `references/continue-mode.md` is the doctrine.

### Checklist

- [ ] The skill enters CONTINUE SITE mode (does not scaffold a new project, does
      not run `verify-is-real-astro.sh` on a fresh copy, does not provision Sanity
      / hosting / a domain).
- [ ] Identity is LOCKED: no DIVERGE / CONVERGE / EXPLORE runs; colour and type
      come from the site's existing tokens, never re-invented. The DIVERGE
      PreToolUse wall does NOT block the edit.
- [ ] Provenance is detected: a Palate scaffold inherits its brand-record + state;
      an external site has its tokens / preset / CSS vars read and locked.
- [ ] The MCP liveness probe (`refs_list_verticals`) runs first; if the
      `mcp__palate__*` tools are absent the build STOPS with the
      `claude mcp add --scope user` remediation (it does not build ungrounded).
- [ ] The page is MCP-grounded per the section-build recipe:
      `refs_search { pageType:"pricing" }`, a donor's real pricing page viewed via
      `refs_get_screenshot { page:"pricing" }`, and the build drawn from the
      donor's `layer: component_prompts / do_dont / signature_moves`, re-skinned to
      the locked brand.
- [ ] The new page is a real route in the existing project, built in the site's
      `BaseLayout` and reusing its components + tokens (no parallel design
      language, no loose `.html` file).
- [ ] SEO is present: real title / description / canonical / social card, a
      sitemap entry, a nav entry where it belongs, and the site's structured data.
- [ ] The CHANGE is gated: `scripts/ux-lint.sh` clean on the changed files, and
      the rendered gates (`verify-rendered.sh` + the visual rubric via
      `screenshot-build.mjs` at 1440 + 390) pass on the pricing page only.
- [ ] The added page carries no AI-default tell (eyebrow kicker above a heading,
      vanity stat strip, three-icon-card row, two-tone heading, centred-hero
      formula), per `references/ai-slop-tells.md`.
- [ ] A tiny edit ("fix this heading", "restyle this one section") skips the plan
      checkpoint; a whole new page or a nav / IA change shows a short plan first.

### Regression signals

CONTINUE routes into BUILD SITE and tries to scaffold or diverge; the DIVERGE wall
blocks a legitimate edit; the new page invents a new palette / font instead of the
site's; the page ships with no SEO or no sitemap entry; the change is not gated
(ux-lint / rendered / rubric skipped) and a tell ships; the mode re-provisions
infrastructure that already exists.
