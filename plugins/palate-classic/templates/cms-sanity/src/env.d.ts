/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@sanity/astro/module" />

// The @sanity/astro module reference enables the virtual modules:
//   sanity:client  -> the configured SanityClient
//   sanity:studio  -> the embedded Studio config

interface ImportMetaEnv {
  /** Empty during the preview stage (no Sanity project yet). Build-time var. */
  readonly SANITY_PROJECT_ID: string;
  readonly SANITY_DATASET: string;
  /** Read token (Viewer). Build-time var - serves draft content + visual editing. */
  readonly SANITY_API_READ_TOKEN: string;
  /** Write token (Editor). Worker secret - used by /api/contact and the seed scripts. */
  readonly SANITY_API_WRITE_TOKEN: string;
  /** "true" turns on visual-editing overlays. Set on the preview deployment only. */
  readonly PUBLIC_SANITY_VISUAL_EDITING_ENABLED: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
