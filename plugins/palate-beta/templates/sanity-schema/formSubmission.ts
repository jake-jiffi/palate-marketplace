import { defineType, defineField } from "sanity";
// Durable record of every form submission. Written by the contact API using the
// editor token. Read-only in Studio (submissions come from the site, not editors).
export default defineType({
  name: "formSubmission",
  title: "Form Submissions",
  type: "document",
  readOnly: true,
  fields: [
    defineField({ name: "name", type: "string" }),
    defineField({ name: "email", type: "string" }),
    defineField({ name: "message", type: "text" }),
    defineField({ name: "source", type: "string" }),
    defineField({ name: "submittedAt", type: "datetime" }),
  ],
  preview: { select: { title: "name", subtitle: "email" } },
});
