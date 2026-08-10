import type { APIRoute } from "astro";
export const GET: APIRoute = ({ site }) => {
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
