/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// No CMS is wired in this build. scripts/add-sanity.sh replaces this file with
// the Sanity version, which adds the @sanity/astro module reference (enabling
// the sanity:client and sanity:studio virtual modules) and the SANITY_* env
// types.

interface ImportMetaEnv {
  /** "true" turns on CMS draft-preview behaviour (no-store, noindex, no analytics). */
  readonly PUBLIC_SANITY_VISUAL_EDITING_ENABLED: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
