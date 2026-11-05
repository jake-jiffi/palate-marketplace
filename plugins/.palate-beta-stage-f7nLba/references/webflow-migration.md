# Migrating a client from Webflow

The skill replaces Webflow. When a client is on Webflow:

1. **Inventory the Webflow site**: pages, content, assets, forms, CMS collections.
2. **Map Webflow CMS collections to Sanity schema**: each Webflow collection becomes a Sanity document type. Add to studio/schemas.
3. **Migrate content**: export Webflow CMS (CSV/API), transform, import to Sanity via the management API or a one-off script.
4. **Recreate the design**: use the client's brand package + reference library for the visual system. Do not pixel-copy Webflow; rebuild properly.
5. **Forms**: Webflow forms become the Worker + Resend + Sanity formSubmission flow.
6. **Redirects**: capture Webflow URLs, add redirects in the Worker or _redirects so SEO is preserved.
7. **DNS cutover**: build and verify on workers.dev first, then cut DNS over from Webflow with the domain attach step.

The win for the client: they own the code, the CMS is more powerful, hosting is cheaper and faster, and the brand is now versioned code reusable across decks, docs, and future sites.
