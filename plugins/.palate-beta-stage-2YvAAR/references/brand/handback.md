# Hand-back format

End every run with this, adapted to mode.

## Standalone (interactive) hand-back
```
Brand repo built and published.

Repo:    https://github.com/palate-projects/{slug}-brand
Package: @palate-projects/{slug}-brand@{version}

What went in:
- tokens/       four-format design tokens from {n} colours, {m} type styles
- fonts/        {families} with unified fonts.css
- logo/         {n} variants, kebab-cased
- components/   {list}
- examples/     landing, proposal cover, title slide, content slide
- brand/        overview, voice, visual-system, messaging, photography, services, team
{photography line if applicable}

Brand assumptions to confirm:
{any defaults used for missing assets}

Ready to paste into Claude Design:
"Use the brand repo at github.com/palate-projects/{slug}-brand as the canonical
design system input. On the setup screen, link this repo. Use tokens/, fonts/,
and components/. Skip imagery if you want to supply your own. Non-negotiables
are in CLAUDE.md: {the key ones}."
```

## Composed (from website-builder) hand-back
Shorter. Update `.palate-brand-state.json`, update the website-builder's state with the package name and exact version, return control to Phase A. Log brand assumptions in the eventual handover.md rather than surfacing mid-flow.
