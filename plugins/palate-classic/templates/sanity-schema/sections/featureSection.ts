import { defineType, defineField } from "sanity";
export default defineType({
  name: "featureSection", title: "featureSection", type: "object",
  fields: [
    defineField({ name: "heading", type: "string" }),
    defineField({ name: "body", type: "text" }),
  ],
});
