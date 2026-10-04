import { defineType, defineField } from "sanity";
export default defineType({
  name: "page", title: "Pages", type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "slug", type: "slug", options: { source: "title" } }),
    defineField({ name: "sections", type: "array", of: [
      { type: "heroSection" }, { type: "featureSection" }, { type: "ctaSection" }, { type: "richText" }
    ] }),
    defineField({ name: "seo", type: "seo" }),
  ],
});
