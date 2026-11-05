import { defineType, defineField } from "sanity";
// A standalone landing page for a specific ad campaign. Tied to a keyword group.
export default defineType({
  name: "campaignPage",
  title: "Campaign Landing Pages",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "slug", type: "slug", options: { source: "title" } }),
    defineField({ name: "keywordGroup", type: "string" }),
    defineField({ name: "hero", type: "reference", to: [{ type: "heroVariant" }] }),
    defineField({ name: "sections", type: "array", of: [{ type: "reference", to: [{ type: "page" }] }] }),
    defineField({ name: "seo", type: "seo" }),
  ],
});
