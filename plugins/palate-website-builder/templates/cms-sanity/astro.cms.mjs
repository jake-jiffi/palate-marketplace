import sanity from "@sanity/astro";

/**
 * CMS integrations for astro.config.mjs. SANITY WIRED.
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
  return [
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
