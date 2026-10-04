import type { APIRoute } from 'astro';
import { site } from '../site';

/**
 * llms.txt: a short summary for answer engines, built from src/site.ts and the page files, so it
 * lists exactly the pages that exist and cannot drift from a hand-kept copy.
 */
const pages = Object.keys(import.meta.glob('./**/*.{astro,md,mdx}'))
  .filter((file) => !file.includes('[') && !/\/_|\/404\./.test(file))
  .map((file) => file.slice(1).replace(/\.(astro|md|mdx)$/, '').replace(/\/index$/, '/') || '/')
  .map((path) => (path.endsWith('/') ? path : `${path}/`))
  .sort();

export const GET: APIRoute = ({ site: origin }) => {
  const lines = [`# ${site.name}`, '', `> ${site.description}`, '', '## Pages', ...pages.map((p) => `- [${p}](${p})`)];
  if (origin) lines.push('', '## Canonical', origin.toString());
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
