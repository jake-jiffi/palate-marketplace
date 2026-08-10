---
description: Add a new page or a substantial section, grounded in the reference library, with the full structural lane set.
argument-hint: "[the page or section, e.g. \"a services page\" or \"a pricing table on /pricing\"]"
---

A new page or a substantial new section. This is a STRUCTURAL diff: it changes what the site
looks like, not only what it says, so the full lane set runs including tokens, geometry and the
taste ladder.

This is the one high-volume command where the library is decisive. Everything else in the
content runtime works fine without it. This does not: composing a section from nothing is
exactly how a site drifts to the average, and the references are what stop that.

## 1. Orient

1. Resolve the project dir. Confirm it is a real site.
2. Read the conventions before writing anything. The layout and its head/SEO wiring, the token
   source (`tailwind.config.ts`, the brand package, or the CSS custom properties, whichever this
   site uses), the existing components in `src/components/`, the routing shape, the nav.
3. **Identity is locked.** Never pick a colour, a face, a radius or a spacing value by hand.
   Every value comes from the site's own token vocabulary. A new page must read as though it was
   always part of this site, and a parallel design language bolted on is the failure mode here.
4. Build the index so you know what you are joining:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>`.

## 2. Ground it in the library

Probe once: `mcp__palate__refs_list_verticals`.

**Grounded path.** Do all four, in order. Naming the exact surface in `query` is what separates
a useful donor from a generic one:

1. `mcp__palate__refs_search { vertical, pageType, uxPattern, conversionPrimitive, query }` for
   references that build THIS surface well. Not references that look nice.
2. `mcp__palate__refs_get_screenshot { slug, page: "<the inner page>" }` on the two or three best.
   View the real inner page, not the home hero. Design from the pixels.
3. `mcp__palate__refs_get { slug, layer: ["signature_moves", "do_dont", "component_prompts"] }`
   for the move, the discipline and the component anatomy. Use a rich layer: a thin read tells
   you nothing you could not have guessed, and the depth gate counts it.
4. Re-skin every donor move into the locked brand. Take the composition, the rhythm, the
   restraint. Never take the donor's colours, faces or copy.

**Ungrounded path.** If the tools are absent or error, say ONCE what is missing: no reference
grounding, no taste percentile, no judging exemplars, and the recovery line
`claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`.

Then compose from the site's OWN existing section patterns instead. Read three sections this
site already ships, take their spacing rhythm, their heading scale, their component structure,
and build the new one in that vocabulary. On an established site this is a genuinely strong
signal, because the site is the reference. Label the result ungrounded in the summary and move
on. Do not nag.

## 3. Build it

Real code in the existing project. A new page is a real route under `src/pages/`, never a loose
HTML file. Page copy goes in `src/lib/content.ts` as one typed export and is read through
`loadPage()`, never imported straight into the page: that indirection is the seam a CMS plugs
into later without touching a single page.

Every business fact comes from `src/lib/business.ts`. SEO is part of the page, not a follow-up:
a real title, a real description, canonical, social card, and the page added to the nav and the
sitemap where it belongs.

Touch only what the change needs. Do not re-theme the surrounding site.

## 4. Plan the check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed <every file you touched> --json
```

Expect `structural`, and expect the route count to be larger than you think: a shared component
or a token file reaches every page that imports it transitively. If `scope` comes back `wide`,
that is the honest signal that this is a redesign wearing a page's clothes. Say so before
running the lanes, not after someone has waited.

## 5. Run the lanes

Structural runs everything: caps, schema, voice, functional, a11y, perf, tokens, geometry,
drift, taste.

- **schema + functional**: `npx astro check`, then `npm run build`.
- **voice + tokens**: `"${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" <dir>`, then
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-scoped-style-escape.mjs" <dir>` and
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/phantom-utility-check.mjs" <dir> --no-build`. A hardcoded
  hex or a utility class that resolves to nothing is a token failure, not a style opinion.
  `--no-build` is only safe because the build in the previous bullet has already run: the check
  compares source classes against `dist`, so a stale `dist` reads every new class as phantom.
- **a11y + perf + geometry**: serve and verify at all three viewports.
  ```
  "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
    <SERVE_URL> --routes <the planned routes> --out .palate-shots
  ```
  Exit 3 means no browser launched: BLOCKED, never a pass. This is the lane that catches
  horizontal overflow, a section stuck at opacity 0 after a real scroll, a pinned element
  overprinting the footer, an invisible focus ring, and axe violations at 390, 834 and 1440. It
  also measures vitals under slow 4G with 4x CPU, which is the only measurement that predicts
  what the page will score in public. An unthrottled local LCP passes everything.
- **geometry, read the stills**: `node
  "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/screenshot-build.mjs" --url <SERVE_URL> --out
  .palate-shots --sections`, then Read the PNGs. A number cannot tell you the section is
  cramped at 834.
- **caps**: sitewide noindex, robots disallowing everything, no content before JavaScript runs,
  LCP over 15 seconds. Any one of these caps the site regardless of the rest.
- **taste**: non-blocking, and only meaningful grounded. Run the local grade if you want the
  vision read: `node "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/grade-local.mjs" --url
  <SERVE_URL>`, then judge the ladder it hands back and score with `--judgements <file>`. Call
  the result what it is: a free local self-check, run on inputs you control, therefore fakeable,
  and never shareable. It is not a certified grade and must never be reported as one.
- **drift**: only where `.palate/baselines/<route>.json` already carries an `embedding`. On a
  structural change drift above 0.08 is expected and correct on the routes you meant to change,
  and is a finding on the routes you did not.

## 6. Heal

Fix and re-run before showing anything. Two iterations inside the noise band is a stall. Report
the stall; do not release on it.

## 7. Show

- The route or section, and every route the contract said it touches.
- Desktop and mobile stills.
- Each lane with its numbers, and which references grounded it (slug and what you took from
  each), or the single ungrounded line.
- The one decision left to them: agree, or name what to change.
