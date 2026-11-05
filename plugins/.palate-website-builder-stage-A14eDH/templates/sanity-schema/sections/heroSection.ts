import { defineType, defineField } from "sanity";
export default defineType({
  name: "heroSection", title: "heroSection", type: "object",
  fields: [
    defineField({ name: "heading", type: "string" }),
    defineField({ name: "body", type: "text" }),
  ],
});
