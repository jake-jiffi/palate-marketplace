import { defineField, defineType } from "sanity";

/** Site-wide settings: title, default meta description, default social image. */
export default defineType({
  name: "siteSettings",
  title: "Site settings",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Site title", type: "string" }),
    defineField({ name: "description", title: "Default meta description", type: "text", rows: 2 }),
    defineField({ name: "ogImage", title: "Default social image", type: "image" }),
  ],
});
