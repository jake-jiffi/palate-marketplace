import { sanityClient } from "sanity:client";

/**
 * loadPage - the single content-fetch entry point for every page.
 *
 *   1. No Sanity project configured (the preview stage) -> return `fallback`.
 *   2. Otherwise query Sanity. Visual-editing builds use the `drafts`
 *      perspective + stega encoding so click-to-edit overlays work.
 *   3. If the query throws or returns nothing           -> return `fallback`.
 *
 * Content is authored ONCE, in src/lib/content.ts. The preview stage renders
 * entirely from those fallbacks (no Sanity account needed); production seeds
 * Sanity from the same file, and the fallback stays as a CMS-outage safety net.
 * See references/cms-and-draft-preview.md.
 *
 * `sanityClient` and the SANITY and PUBLIC_SANITY env values are resolved at
 * BUILD time (this is how @sanity/astro works), so CI must supply them as build vars.
 */
const configured = Boolean(import.meta.env.SANITY_PROJECT_ID);
const visualEditing = import.meta.env.PUBLIC_SANITY_VISUAL_EDITING_ENABLED === "true";
const token = import.meta.env.SANITY_API_READ_TOKEN;

export async function loadPage<T>(
  query: string,
  params: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  if (!configured) return fallback;
  if (visualEditing && !token) {
    console.warn("[loadPage] visual editing is on but SANITY_API_READ_TOKEN is missing");
  }
  try {
    const data = await sanityClient.fetch<T>(query, params, {
      perspective: visualEditing ? "drafts" : "published",
      stega: visualEditing,
      useCdn: !visualEditing,
      ...(visualEditing && token ? { token } : {}),
    });
    return (data ?? fallback) as T;
  } catch (err) {
    console.warn("[loadPage] Sanity fetch failed, using fallback:", (err as Error).message);
    return fallback;
  }
}
