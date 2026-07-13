import { defineType, defineField } from "sanity";
export default defineType({
  name: "ctaSection", title: "ctaSection", type: "object",
  fields: [
    defineField({ name: "heading", type: "string" }),
    defineField({ name: "body", type: "text" }),
  ],
});
