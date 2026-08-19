# Continue an existing site - the ongoing-build mode

The mode for everything that happens to a site AFTER it first ships: add a page,
add or restyle a section, extend or fix copy, add a feature, wire a new
conversion surface. It is the plugin being the ongoing partner, not just the
scaffolder. It runs with the SAME taste rigour as a fresh build (MCP-grounded per
page, the anti-slop + rendered + visual-rubric gates, SEO on every page), MINUS
the identity + scaffold machinery that only a new site needs.

It works whether or not the plugin built the site. A Palate-scaffolded project, a
Webflow migration the plugin shipped, or a hand-built site the plugin has never
seen (e.g. an existing Astro marketing site) are all valid inputs. The plugin
reads the site it is handed and extends it in its own language.

## Match the site you are in, never the current default

**Read the project's `astro.config.mjs` before writing a page, and write for the mode you find.**
A site built before the static default is `output: "server"` and is working. Retrofitting it is a
change to a live deployment that was already handed over, and on a store it needs `getStaticPaths`
on every dynamic route, which is exactly where product pages go missing. The same applies in
reverse: do not add `prerender` declarations to a server-output site, where they are no-ops that
read as intent.

If the site would genuinely benefit (a dead `astro-pagefind` search box is the usual reason, see
SKILL.md rule 7), say so plainly, price it as its own piece of work, and let the client decide. It
is never a side effect of adding a page.

## The one rule that defines this mode: identity is LOCKED

Continue mode is ALWAYS brand-provided. It NEVER runs DIVERGE / CONVERGE on
colour, type or identity, because the identity already exists and every addition
must look like it was always part of the site. When a new section genuinely needs
options, diverge only WITHIN the locked brand (layout / composition / section
logic / motion / density), the way BUILD SITE's brand-provided mode does, never
the brand itself. The existing site's brand always wins, exactly like the client's
brand wins in a fresh build (`references/reference-library-usage.md`, the
two-layer doctrine).

This is why the mode can skip the DIVERGE wall: there is no identity to invent.

## Step 1 - orient (read the site before you touch it)

1. **Resolve the project dir** and confirm it is a real site (a `package.json`, a
   framework, real pages). Detect the environment / a writable root the normal way
   (`scripts/detect-environment.sh`) only if you are working in a fresh checkout.
2. **Detect provenance**, which sets where the brand comes from:
   - **Palate-scaffolded**: `.palate-skill-state.json` (and usually
     `build-manifest.json`) present. Inherit the recorded brand-record / tokens /
     stage / state. The site's conventions are the template's.
   - **External** (hand-built, migrated, or otherwise not plugin-made): no state.
     LOCK the site's own identity by reading it: its brand package / Tailwind
     preset / design-token file / CSS custom properties, its `BaseLayout` (or
     equivalent), and its component patterns. These tokens are now non-negotiable.
3. **Read the conventions the addition must match**: the framework and version, the
   layout + head/SEO wiring, the token source (never hand-pick hex), the component
   library and naming, the routing shape, the nav, and the sitemap. New work is
   surgical and native: it reuses the site's own components and tokens and reads as
   part of the site, never a parallel design language bolted on.

## Step 2 - the change loop (per page or section)

1. **MCP liveness probe FIRST.** Call `mcp__palate__refs_list_verticals` once
   (cheap, ungated). If the `mcp__palate__*` tools are absent or it errors,
   continue in UNGROUNDED mode and state it ONCE: the Palate MCP is not
   connected, so this addition gets no reference grounding, no taste percentile,
   no judging exemplars and no certified grade; reconnect with `claude mcp add
   --scope user --transport http palate https://mcp.palatemcp.com/api/mcp` and
   restart. Everything else is unchanged - the addition is still built, still
   ux-linted, still put through the rendered verifier, vitals and accessibility,
   and still bound to the site's own extracted token vocabulary, which in this
   mode is the strongest signal available anyway: the existing site is the
   reference. The depth gate records UNGROUNDED, so the absence is labelled, not
   silent. Say it once and do not repeat it per section. Probe again if the tools
   appear later in the session; grounded is always the better addition. Honour
   the free-cap / upgrade wall the same as a build (SKILL.md 6.1): stop calling
   `refs_*`, offer the upgrade once, finish local-only.
2. **Ground the addition in the MCP, per page/section** - the section-build recipe
   (`references/reference-library-usage.md`, "The section-build recipe"):
   `refs_search { pageType, uxPattern, uiElement, conversionPrimitive, query }` to
   find donors that build THIS surface well, `refs_get_screenshot { slug, page }`
   to SEE their real inner page, then build from their
   `refs_get { layer: signature_moves | do_dont | component_prompts }` and
   `refs_get_astro_recipe` to make it buildable. Name the exact thing in `query`
   (the pageType, the pattern, a technique). Re-skin every donor move to the LOCKED
   brand. This is the "right MCP references for the page" that keeps an addition
   from defaulting to the average.
3. **Build it as real code IN the existing project**, matching its conventions: its
   layout, its tokens, its component style, its routing. Touch only what the change
   needs (surgical); do not refactor or re-theme the surrounding site. A new page is
   a real route, not a loose HTML file (the freestyle anti-pattern is forbidden here
   too).
4. **SEO is part of the page, not an afterthought.** The new page gets a real title,
   description, canonical and social card, is added to the sitemap and the nav where
   it belongs, and carries the structured data the site already uses. A page that
   ships without its SEO is unfinished.
5. **Gate the CHANGE** (only the gates that apply to an edit; the full list is in
   `references/anti-patterns.md`, `references/rendered-bug-classes.md` and
   `references/visual-rubric.md`):
   - `scripts/ux-lint.sh <project-dir>` (the mechanical anti-slop gate) must pass on
     the changed files: no em dashes, no banned / default-of-the-moment faces, no
     purple-pink or many-stop gradients, no AI-tell copy.
   - The **rendered gates on the CHANGED page(s) only**: `scripts/verify-rendered.sh`
     (the bug-class gate) plus the visual rubric via
     `scripts/reference-capture/screenshot-build.mjs --url <served> --sections` at
     1440 + 390, judged against `references/visual-rubric.md` (the six axes + the
     defect checklist) and the anti-slop QA (`references/ai-slop-tells.md`). Spawn
     `palate-verifier` for this in an isolated context, the same as a build; it just
     scopes to the changed page.
   - **Anti-default check**: the added surface must not read as the AI default -
     eyebrow kicker above a heading, vanity stat strip, three-icon-card row, two-tone
     heading, the centred-hero-plus-two-buttons formula. Any hit is a revise
     (`references/ai-slop-tells.md`).
6. **Record + finish.** For a Palate-scaffolded project, append what changed to
   state. Content changes need no redeploy on an SSR site; a new page deploys the
   way the site already deploys (do not re-provision).

## What this mode SKIPS, and why

- **DIVERGE / CONVERGE / COMMISSION / EXPLORE** - the identity exists; you are
  extending a direction, not inventing one. The DIVERGE PreToolUse wall
  (`hooks/palate-pretooluse.mjs`) only fires inside an active BUILD SITE (a
  `.palate-skill-state.json` marker), and it never matches `Edit` or a write over an
  existing non page/section file - so editing an existing site, and every external
  (non-Palate) site, is structurally exempt. Adding a brand-new page/section to a
  Palate-scaffolded project passes because that project's original build already
  recorded a valid `diverge` in `build-manifest.json`. If an OLD scaffolded project
  has the marker but no recorded diverge, the wall asks for a within-brand
  (brand-provided) diverge on the new section, which is legitimate here: sample
  layout / motion options WITHIN the locked brand (colour + type stay locked), never
  the identity. `PALATE_GATE_OFF=1` is the escape hatch for a surgical edit. Never
  re-invent the brand to satisfy a gate.
- **Scaffold + `verify-is-real-astro.sh`** - the project already is a real project.
- **Phases B-F** (Sanity provision, hosting, domain, optional services) - the
  infrastructure already exists. A new page uses the site's existing deploy path.

## The plan checkpoint (careful additions only)

Show a short plan and get a go for a SUBSTANTIAL addition: a whole new page (name
the route, its `pageType`, the donors, where it slots into the nav + sitemap), a
nav / IA change, or anything touching money, forms or auth. SKIP the checkpoint for
tiny reversible work (one section, a copy fix, a restyle) - do not make a quick edit
wait on a confirmation (SKILL.md, the plan checkpoint).

## Examples

- "Add a pricing page to my site." Orient, `refs_search { pageType:"pricing" }`,
  view a donor's real pricing page, graft its component prompts + do/don't, build
  it in the site's BaseLayout with the site's tokens, add it to the nav + sitemap
  with real SEO, gate the page.
- "This section looks generic, make it feel designed." Read the section, find the
  stronger donor move for that pattern, re-skin it to the brand, gate the change.
- "Continue building our marketing site: add a private /creators brief page,
  noindex." Lock the site's brand, ground the page's sections in editorial donors,
  build it in the existing layout, keep it out of the sitemap, gate it.
