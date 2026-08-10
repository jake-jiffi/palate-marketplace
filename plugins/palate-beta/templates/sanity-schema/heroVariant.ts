import { defineType, defineField } from "sanity";
// A hero variant tied to a campaign slug / UTM, for per-ad landing pages.
export default defineType({
  name: "heroVariant",
  title: "Hero Variants (campaigns)",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "slug", type: "slug", options: { source: "title" } }),
    defineField({ name: "headline", type: "string" }),
    defineField({ name: "subhead", type: "text" }),
    defineField({ name: "ctaText", type: "string" }),
    defineField({ name: "ctaHref", type: "string" }),
  ],
});
