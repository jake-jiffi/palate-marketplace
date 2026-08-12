/**
 * Content - the single source of truth for page copy.
 *
 * This build has NO CMS, so this file IS the content: every page renders from
 * it, via loadPage(). Never read it directly from a page - always go through
 * loadPage(), which is the seam that lets a CMS be added later without editing
 * a single page.
 *
 * If a CMS is added (scripts/add-sanity.sh), this file keeps two jobs: the seed
 * script populates the dataset from it, and it stays as the CMS-outage safety
 * net that loadPage() falls back to. So it is never deleted.
 *
 * Claude fills this with the REAL page copy during Phase A. One typed export
 * per page. The shapes here are the starting skeleton - extend them to match
 * the site's actual sections, and (once a CMS exists) keep them in step with
 * the Sanity schemas.
 */

export interface HomeContent {
  hero: {
    heading: string;
    sub: string;
    cta: { label: string; href: string };
  };
  // extend: sections, stats, features, etc.
}

export const home: HomeContent = {
  hero: {
    heading: "{{HEADING}}",
    sub: "{{SUB}}",
    cta: { label: "{{CTA_LABEL}}", href: "{{CTA_HREF}}" },
  },
};

// export const about: AboutContent = { ... };
// export const contact: ContactContent = { ... };
// one export per page - all consumed via loadPage() in the page components.
