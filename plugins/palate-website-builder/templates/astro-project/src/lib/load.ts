/**
 * loadPage - the single content-fetch entry point for every page.
 *
 * NO CMS IS WIRED IN THIS BUILD, so every call returns its `fallback`: the
 * content authored in src/lib/content.ts, which is the only content source the
 * default scaffold has.
 *
 * Pages MUST still go through loadPage() rather than importing content.ts
 * directly. That indirection is the seam: it is what lets a CMS be added later
 * without editing a single page. Read content.ts straight from a page and you
 * have quietly signed up for a rewrite of every page the day a client wants to
 * edit their own copy.
 *
 * To wire Sanity in:  scripts/add-sanity.sh <project-dir>
 * That replaces this file with the Sanity-backed version (query Sanity, fall
 * back to content.ts on a miss, an error, or an unconfigured project) and
 * leaves every caller untouched. See references/cms-and-draft-preview.md.
 */
export async function loadPage<T>(
  _query: string,
  _params: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  return fallback;
}
