import type { APIRoute } from 'astro';

// Production invites crawlers and names the sitemap. Every other deployment refuses indexing:
// a preview is a public origin, and a client's content must not be indexed at a domain they do not own.
export const GET: APIRoute = ({ site }) => {
  const production = import.meta.env.PUBLIC_SITE_ENV === 'production';
  const body = production
    ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap-index.xml', site)}\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
