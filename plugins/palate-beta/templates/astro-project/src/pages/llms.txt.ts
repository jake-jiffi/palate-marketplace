import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { business } from "../lib/business";

/**
 * llms.txt - a concise, structured summary for answer engines.
 *
 * Built from the SAME sources the site renders from: the business record and
 * the posts collection. Nothing here is retyped, so it cannot go stale the way
 * a hand-maintained summary always does, and a fact corrected once is corrected
 * here too.
 */
export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection("posts", ({ data }) => data.draft !== true))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf())
    .slice(0, 10);

  const lines: string[] = [
    `# ${business.name}`,
    "",
    `> ${business.description}`,
    "",
  ];

  if (business.services.length) {
    lines.push("## What we do", ...business.services.map((s) => `- ${s}`), "");
  }

  if (business.serviceAreas.length) {
    lines.push("## Where we work", ...business.serviceAreas.map((a) => `- ${a}`), "");
  }

  if (posts.length) {
    lines.push(
      "## Recent writing",
      ...posts.map((p) => `- [${p.data.title}](/blog/${p.id}): ${p.data.description}`),
      "",
    );
  }

  lines.push("## Contact", business.email);
  if (business.telephone) lines.push(business.telephone);
  if (business.openingHours.length) {
    lines.push("", "## Hours", ...business.openingHours);
  }
  if (site) lines.push("", `## Canonical`, site.toString());

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
