import sanity from "@sanity/astro";

/**
 * CMS integrations for astro.config.mjs. SANITY WIRED.
 *
 * ALSO decides the render mode for a CMS build: production prerenders, the visual-editing
 * preview does not. See the block in cmsIntegrations().
 *
 * Installed over the no-op default by `scripts/add-sanity.sh`. astro.config.mjs
 * itself is never edited: it already spreads `...cmsIntegrations(env)`.
 *
 * projectId falls back to a harmless placeholder before a Sanity project is
 * provisioned, so pages still render: loadPage() falls back to
 * src/lib/content.ts whenever the fetch misses or fails.
 *
 * The client, the embedded Studio and the stega flag are all resolved at BUILD
 * time (that is how @sanity/astro works), so CI must supply SANITY_* and
 * PUBLIC_SANITY_VISUAL_EDITING_ENABLED as build vars. The scaffold's ci.yml
 * already passes them. See references/cms-and-draft-preview.md.
 */
export function cmsIntegrations(env) {
  // THE PREVIEW DEPLOYMENT RENDERS ON DEMAND; PRODUCTION DOES NOT.
  //
  // Production wants files on a CDN: published content, no overlay, nothing to recompute per
  // visitor. The preview deployment exists so an editor sees their DRAFT, and a prerendered
  // preview freezes that draft at build time, which defeats the Presentation tool entirely.
  //
  // Astro 5 REMOVED dynamic `prerender` exports: only a literal boolean compiles, so this
  // cannot be `export const prerender = import.meta.env.PUBLIC_SANITY_...` in a page. The
  // supported mechanism is the astro:route:setup hook, and it belongs here rather than in
  // astro.config.mjs, which is customised per build and must never be patched by
  // add-sanity.sh. This file is already the CMS seam, already swapped wholesale, and already
  // the only place that knows the flag.
  //
  // Verified on a real scaffold with the Sanity tree installed: flag off -> 8 static pages,
  // flag on -> 0, everything on demand.
  const visualEditing = env.PUBLIC_SANITY_VISUAL_EDITING_ENABLED === "true";

  return [
    {
      name: "palate:cms-preview-on-demand",
      hooks: {
        "astro:route:setup": ({ route }) => {
          if (visualEditing) route.prerender = false;
        },
      },
    },
    sanity({
      projectId: env.SANITY_PROJECT_ID || "preview",
      dataset: env.SANITY_DATASET || "production",
      useCdn: false,
      apiVersion: "2025-02-19",
      studioBasePath: "/studio",
      stega: { studioUrl: "/studio" },
    }),
  ];
}
