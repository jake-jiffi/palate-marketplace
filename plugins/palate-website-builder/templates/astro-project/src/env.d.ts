/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// No CMS is wired in this build. scripts/add-sanity.sh replaces this file with
// the Sanity version, which adds the @sanity/astro module reference (enabling
// the sanity:client and sanity:studio virtual modules) and the SANITY_* env
// types.

interface ImportMetaEnv {
  /** "true" turns on CMS draft-preview behaviour (no-store, noindex, no analytics). */
  readonly PUBLIC_SANITY_VISUAL_EDITING_ENABLED: string;
  /**
   * "preview" | "development" | "production" | "". Inlined at build time by astro.config.mjs,
   * which resolves it from PUBLIC_SITE_ENV, then VERCEL_ENV, then process.env.VERCEL_ENV.
   * robots.txt.ts reads it to serve Disallow: / on a preview deploy. Declared here because
   * `astro check` is the template's own `typecheck` script, and an undeclared env key fails it
   * on a freshly scaffolded site before anyone has written a line.
   */
  readonly PUBLIC_SITE_ENV: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
