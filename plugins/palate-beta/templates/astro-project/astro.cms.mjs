/**
 * CMS integrations for astro.config.mjs. EMPTY BY DEFAULT.
 *
 * The scaffold ships with NO CMS, so a brochure site never carries a CMS
 * dependency tree it will not use. Content lives in src/lib/content.ts and is
 * read through loadPage() (src/lib/load.ts).
 *
 * Adding a CMS is ADDITIVE, never a rebuild: `scripts/add-sanity.sh <dir>`
 * REPLACES this whole file with the Sanity-wired version. It replaces the file
 * rather than patching astro.config.mjs because the config is customised per
 * build (site, adapter options, motion plugins), and a sed patch against an
 * edited config is exactly the kind of thing that silently corrupts a live
 * project. Output stays "server", every page keeps calling loadPage(), and no
 * page is touched.
 *
 * See references/cms-and-draft-preview.md.
 */
export function cmsIntegrations(_env) {
  return [];
}
