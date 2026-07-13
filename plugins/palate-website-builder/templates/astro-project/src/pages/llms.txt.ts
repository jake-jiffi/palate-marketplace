import type { APIRoute } from "astro";
// llms.txt: a concise, structured summary for AI crawlers. Populated from Sanity
// siteSettings at build time in the real template; static fallback here.
export const GET: APIRoute = () => {
  const body = `# {{CLIENT_NAME}}

> {{ONE_LINE_DESCRIPTION}}

## Key pages
- /: Home
- /services: What we do
- /about: Who we are
- /contact: Get in touch

## Contact
hello@{{DOMAIN}}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
