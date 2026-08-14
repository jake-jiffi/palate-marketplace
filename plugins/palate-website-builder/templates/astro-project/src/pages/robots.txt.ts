import type { APIRoute } from "astro";

/**
 * robots.txt, environment aware.
 *
 * WHY THIS IS NOT A CONSTANT. This file used to emit `Allow: /` on every deployment. A Vercel
 * preview is a real, publicly fetchable origin, so that invited Google and every answer engine
 * to index a client's content at a URL the client does not own: duplicate content they cannot
 * see and cannot take down, competing with the site they paid for.
 *
 * TWO INDEPENDENT REASONS TO CLOSE, because each covers the other's blind spot:
 *
 *   1. the deployment says it is not production. Vercel sets VERCEL_ENV; astro.config.mjs
 *      surfaces it as PUBLIC_SITE_ENV so it survives into a static build.
 *   2. the host being asked is not the canonical host in `site`. Host derived, so it still
 *      works on a host that sets no env var at all, and it is the invariant that actually
 *      matters: content served at a non-canonical origin must not be indexed, wherever it
 *      happens to be deployed.
 *
 * FAIL DIRECTION IS DELIBERATE. An unknown env on the canonical host reads as production and
 * allows. The opposite default (block unless proven production) would silently deindex a live
 * site the first time it moved to a host that sets no VERCEL_ENV, and a deindexed production
 * site costs far more than an indexed preview. The host check is what keeps that default safe.
 *
 * The canonical check is skipped while `site` still holds the {{DOMAIN}} scaffold token, or
 * the placeholder itself would block every environment including production.
 */
export const GET: APIRoute = ({ site, url }) => {
  // BOTH sources, and the process fallback is NOT redundant: astro.config inlines
  // PUBLIC_SITE_ENV at BUILD time, so an SSR deploy whose build did not know the environment
  // still learns it at runtime from VERCEL_ENV. Removing it silently reopened preview
  // indexing on exactly that deploy shape, which the suite catches.
  const env = (import.meta.env.PUBLIC_SITE_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
  const nonProdEnv = env === "preview" || env === "development";

  const canonicalHost = site && !site.host.includes("{{") ? site.host.replace(/^www\./, "") : null;
  const askedHost = url.host.replace(/^www\./, "");
  const offCanonicalHost = canonicalHost !== null && askedHost !== canonicalHost;

  if (nonProdEnv || offCanonicalHost) {
    // No Sitemap: line either. Handing a crawler the map while telling it to stay out is the
    // mixed signal that gets the Disallow ignored.
    const why = nonProdEnv ? `environment is "${env}"` : `host ${askedHost} is not the canonical ${canonicalHost}`;
    return new Response(
      `# Not the canonical deployment (${why}). Indexing this origin would put the site's\n` +
        `# content at a URL nobody controls.\nUser-agent: *\nDisallow: /\n`,
      { headers: { "Content-Type": "text/plain", "X-Robots-Tag": "noindex" } },
    );
  }

  const body = `User-agent: *
Allow: /

# AI crawlers welcome (this is marketing content)
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /

Sitemap: ${site}sitemap-index.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
