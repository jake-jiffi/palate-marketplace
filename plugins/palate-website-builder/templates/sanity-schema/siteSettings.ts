import { defineType, defineField } from "sanity";
export default defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "description", type: "text" }),
    defineField({ name: "defaultHero", type: "heroVariant" }),
    defineField({ name: "nav", type: "array", of: [{ type: "navItem" }] }),
    defineField({ name: "social", type: "array", of: [{ type: "object", fields: [
      { name: "platform", type: "string" }, { name: "url", type: "url" }
    ] }] }),
  ],
});
