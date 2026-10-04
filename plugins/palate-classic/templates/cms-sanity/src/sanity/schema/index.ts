import page from "./page";
import siteSettings from "./siteSettings";
import collectionItem from "./collection";

/**
 * The embedded Studio's schema. These ship so the Studio boots and is editable
 * immediately: `page` + `siteSettings` for the core site, `collectionItem` for
 * a blog / news feed / job board (page templates at src/pages/blog/*).
 *
 * Phase B extends this list with the project's real section types - build them
 * from the menu in the skill's templates/sanity-schema/, and keep every field
 * in step with the matching shape in src/lib/content.ts.
 */
export const schemaTypes = [page, siteSettings, collectionItem];
