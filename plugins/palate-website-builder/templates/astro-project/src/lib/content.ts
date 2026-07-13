/**
 * Fallback content - the single source of truth for page copy.
 *
 * The PREVIEW stage renders entirely from this file (no Sanity project needed).
 * PRODUCTION seeds the Sanity dataset from it (scripts/seed-content.mjs). Never
 * delete it - it is also the CMS-outage safety net.
 *
 * Claude fills this with the REAL page copy during Phase A. One typed export
 * per page. The shapes here are the starting skeleton - extend them to match
 * the site's actual sections, and keep them in step with the Sanity schemas.
 */

export interface HomeContent {
  hero: {
    eyebrow: string;
    heading: string;
    sub: string;
    cta: { label: string; href: string };
  };
  // extend: sections, stats, features, etc.
}

export const home: HomeContent = {
  hero: {
    eyebrow: "{{EYEBROW}}",
    heading: "{{HEADING}}",
    sub: "{{SUB}}",
    cta: { label: "{{CTA_LABEL}}", href: "{{CTA_HREF}}" },
  },
};

// export const about: AboutContent = { ... };
// export const contact: ContactContent = { ... };
// one export per page - all consumed via loadPage() in the page components.
