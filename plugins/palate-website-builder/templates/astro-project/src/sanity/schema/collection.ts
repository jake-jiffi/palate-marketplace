import { defineField, defineType } from "sanity";

/**
 * A generic CMS collection item - the single pattern behind a blog, a news
 * feed, case studies, or a job board. The site templates that consume it are
 * src/pages/blog/index.astro and src/pages/blog/[slug].astro.
 *
 * Per project: rename the type and the route folder to suit (e.g. `jobListing`
 * + /jobs), and drop the fields the project does not use. The job-board fields
 * at the bottom are inert for a blog - leave them or remove them.
 */
export default defineType({
  name: "collectionItem",
  title: "Collection item",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Title", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title" },
      validation: (r) => r.required(),
    }),
    defineField({ name: "excerpt", title: "Excerpt / summary", type: "text", rows: 3 }),
    defineField({ name: "coverImage", title: "Cover image", type: "image", options: { hotspot: true } }),
    defineField({
      name: "publishedAt",
      title: "Published date",
      type: "datetime",
      initialValue: () => new Date().toISOString(),
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [{ type: "block" }, { type: "image", options: { hotspot: true } }],
    }),

    // --- Job-board fields (ignore / remove for a blog) ---
    defineField({ name: "location", title: "Location", type: "string", group: "job" }),
    defineField({
      name: "employmentType",
      title: "Employment type",
      type: "string",
      group: "job",
      options: { list: ["Full-time", "Part-time", "Contract", "Casual"] },
    }),
    defineField({ name: "applyUrl", title: "Apply link", type: "url", group: "job" }),
  ],
  groups: [{ name: "job", title: "Job listing" }],
  orderings: [
    { name: "newest", title: "Newest first", by: [{ field: "publishedAt", direction: "desc" }] },
  ],
  preview: {
    select: { title: "title", subtitle: "publishedAt", media: "coverImage" },
  },
});
