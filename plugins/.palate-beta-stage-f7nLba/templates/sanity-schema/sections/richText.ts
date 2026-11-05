import { defineType, defineField } from "sanity";
export default defineType({
  name: "richText", title: "richText", type: "object",
  fields: [
    defineField({ name: "heading", type: "string" }),
    defineField({ name: "body", type: "text" }),
  ],
});
