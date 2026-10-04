import { defineType, defineField } from "sanity";
export default defineType({
  name: "seo", title: "SEO", type: "object",
  fields: [
    defineField({ name: "metaTitle", type: "string" }),
    defineField({ name: "metaDescription", type: "text" }),
    defineField({ name: "ogImage", type: "image" }),
    defineField({ name: "noindex", type: "boolean" }),
  ],
});
