import { defineField, defineType } from "sanity";

/**
 * A page document. This shape mirrors `HomeContent` in src/lib/content.ts -
 * the two MUST stay in step: content.ts is the fallback the site renders when
 * Sanity is empty or unreachable, and `npm run seed` pushes content.ts into
 * documents of this type. Extend both together.
 */
export default defineType({
  name: "page",
  title: "Page",
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
    defineField({
      name: "hero",
      title: "Hero",
      type: "object",
      fields: [
        defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
        defineField({ name: "heading", title: "Heading", type: "string", validation: (r) => r.required() }),
        defineField({ name: "sub", title: "Subheading", type: "text", rows: 3 }),
        defineField({
          name: "cta",
          title: "Call to action",
          type: "object",
          fields: [
            defineField({ name: "label", title: "Button label", type: "string" }),
            defineField({ name: "href", title: "Button link", type: "string" }),
          ],
        }),
      ],
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "slug.current" },
  },
});
