import { defineType, defineField } from "sanity";
export default defineType({
  name: "navItem", title: "Nav Item", type: "object",
  fields: [
    defineField({ name: "label", type: "string" }),
    defineField({ name: "href", type: "string" }),
  ],
});
