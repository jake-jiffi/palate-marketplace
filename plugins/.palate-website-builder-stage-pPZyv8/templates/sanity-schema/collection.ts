import { defineField, defineType } from "sanity";

/**
 * MENU ITEM - generic CMS collection (blog / news / case studies / job board).
 *
 * This is the canonical reference copy. The same schema ships live in a built
 * project at studio/schemas/collection.ts, with page templates at
 * src/pages/blog/index.astro and src/pages/blog/[slug].astro.
 *
 * Adding "a blog" or "open roles" to a site is wiring THIS pattern - rename the
 * type and route per project (e.g. `jobListing` + /jobs). For SEO the detail
 * page should emit JSON-LD: `Article` for posts, `JobPosting` for roles.
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
