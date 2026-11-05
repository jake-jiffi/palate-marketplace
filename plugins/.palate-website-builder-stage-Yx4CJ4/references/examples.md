# Example invocations

## Fresh build with brand assets (most common)
> "Build a site for Addikted to Ink, atink.com.au. Brand assets are at ~/Downloads/atink-brand."

Phase 0 finds no brand repo, sees assets, invokes brand-as-code (composed), publishes @palate-projects/atink-brand, then scaffolds the site consuming it. Style inferred (service or consumer), mode inferred from the brand.

## Existing brand repo
> "Build the site for Acme. Brand repo already at palate-projects/acme-brand."

Phase 0 finds the repo, verifies exports, pins the exact version, skips brand-as-code, scaffolds straight away.

## Full ecosystem with CRO and ads
> "Build everything for Acme: brand repo, site, and the CRO module. We're running Google Ads on 5 keyword groups. Assets at ~/Downloads/acme-brand."

Brand-as-code runs, site scaffolds, --with-cro installs the dormant module, campaignPage types ready for the 5 keyword groups. handover.md notes the CRO warm-up.

## Direct reference
> "Build a site for Tallystone, tallystone.com. Make it feel like Linear. Brand repo exists."

`refs_get { slug:"linear", layer:"signature_moves" }` reads the move to reproduce (its calm, evenly-spaced section rhythm and quiet motion) and `refs_get { slug:"linear", format:"design" }` pulls the DESIGN.md so you reproduce Linear's token scale with the WHY of each choice; the brand package supplies the actual hues. Respect `doNotCopy`: re-skin the craft, never lift Linear's literal dot-grid.

## Webflow migration
> "Migrate Enviz from Webflow to our stack. enviz.com.au, brand repo exists."

Follows references/webflow-migration.md: inventory, map CMS to Sanity, migrate content, rebuild design, set redirects, DNS cutover.

## Brand-only mode
> "Build a brand package for Enviz. Assets at ~/Downloads/enviz-brand."

Runs the BUILD BRAND mode standalone (interactive): inventories assets, generates four-format tokens, writes fonts.css and components, publishes @palate-projects/enviz-brand. No website. Useful when the brand package is needed for decks, Figma, or v0 before any site exists.

(The internal library-curation mode is not part of the public skill.)
