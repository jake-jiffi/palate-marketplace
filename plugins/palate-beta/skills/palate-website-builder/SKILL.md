---
name: palate-website-builder
description: Build and improve websites with Palate's real design reference library. Start with an existing website, brand guides or assets, an idea, or nothing prepared. Develop expressive, working Astro design options and carry the selected direction into a complete site. Motion is part of the normal experience. Recognise the product and preserve its customer journeys; use Shopify only for Shopify commerce or an explicit migration. Also maintain existing sites, manage site content and create brand packages.
---

# Palate website builder

Make the website worth opening. Use whatever the client brings, study real composition and interaction in the Palate MCP, and show a working design early. A website, brand guide, logo or photography is not a prerequisite. When even the site's purpose is unknown, establish that with one focused question, then develop the identity and website through live options.

Resolve the local project before changing it. A source website URL or captured assets are rebuild inputs, not an existing local codebase. In an empty target, a request to improve or redesign that website uses the new Astro workflow while preserving its backend and external app destinations. Keep an existing stack when its local project is supplied for in-place work or the user explicitly requests maintenance.

- **Explicit jury review or `/palate-beta:jury`:** use [the jury entry point](../../commands/jury.md), including for an existing non-Palate codebase. This takes precedence over the legacy build route for that request; preserve the current stack. Jury uses the same shared four-round allowance as automatic escalation, with early stopping. These are internal design judgements, separate from the optional grading instrument.
- **New site or a rebuild in a new empty directory:** read [live-build.md](../../references/live-build.md). Create the neutral Astro project with the package's `../../scripts/palate.mjs init`, then use that project's portable `scripts/palate.mjs`. Do not initialise over an existing site.
- **Existing `palate.project.json` with `workflow: "live-design"`:** read [live-build.md](../../references/live-build.md), run the project's `node scripts/palate.mjs status` and continue from its saved source, choice and unresolved work. Do not restart discovery or generate options for a small edit.
- **Existing local codebase without that marker, BUILD BRAND, or explicit legacy BUILD/CONTINUE/RUN SITE work:** read [LEGACY.md](../../LEGACY.md) and follow the relevant mode or command. Preserve its stack, identity, state and working integrations. For an explicitly chosen legacy build before any project exists, first establish that intent with `node <package>/hooks/palate-manifest.mjs --init-legacy --project <working-directory>`, then follow the legacy reference survey.
- **Unknown, corrupt or conflicting project markers:** report the conflict and leave state untouched. Do not guess a version or run a legacy reset.

Expressive motion is part of a new design's composition, including on touch devices. Honour a visitor's reduced-motion preference with a considered alternative. Do not make reduced motion the design default, infer a quiet style from the industry, or replace a stated motion preference with generic fades.

For design options, show the first useful live option immediately and continue the others. Default to three distinct compositions when options are requested, honour an explicit count and accept an early choice. Selection happens in chat and is saved with the project CLI. It leads to the full website in the same codebase.

Use copy and imagery grounded in the available brief and material. With no supplied identity, propose one within the design options and label it as provisional; a separate brand package is only needed when requested. Keep observed facts separate from design proposals and missing information. Avoid invented reviews, claims and product data, generic stock filler, decorative dashboards, repeated card grids and reference identities copied onto the client.

At the start of new live work, run `node <package>/scripts/palate.mjs media detect` once. When it reports `available: true`, or Higgsfield MCP tools are present, read [generated-media.md](../../references/generated-media.md) before composing options: it asks once and spends only within the agreed cap. Otherwise never mention Higgsfield, generated media or installing anything.

Both Codex and Claude use the same project commands and hosted `palate` MCP connection. Use actual tool results and inspect the supporting screenshots or motion clips. Never claim that a search, process exit or screenshot proves a complete customer journey.

Use an independent critic after the chosen live direction is viewable, before extending its design across the site, and again before full-site handover. Follow [critic-review.md](../../references/critic-review.md): start focused, then autonomously escalate to deeper critic/builder work whenever observed design, creativity or motion gaps need stronger execution. The coordinator owns this decision; no manual jury request or rating event is needed. Use actual separate agents and independently recheck each revision, within one shared four-round allowance. Keep the first option handoff prompt. Small edits do not restart this process.
