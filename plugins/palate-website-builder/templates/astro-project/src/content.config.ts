/**
 * Content collections - the repo-native content layer.
 *
 * ======================= WHAT LIVES WHERE, AND WHY =======================
 *
 * There are TWO content stores in this template and they are not interchangeable.
 *
 *   src/lib/content.ts   PAGE COPY. One typed export per page, read through
 *                        loadPage(). Singleton, hand-shaped, part of the design.
 *                        This is the seam a CMS plugs into (scripts/add-sanity.sh).
 *
 *   src/content/         CONTENT STREAMS. Things there are many of and more of
 *                        every month: posts, case studies, changelog entries.
 *                        Markdown in the repo, validated by the schemas below.
 *
 * A stream does not belong in page copy (you cannot hand-shape the fortieth
 * post) and page copy does not belong in a stream (a hero is not an entry in a
 * list). Putting a stream here is what makes the agent able to add to this site
 * forever without the site drifting: every entry is validated on the way in, and
 * the build fails on a bad one rather than rendering a broken page.
 *
 * ============================ SCHEMAS ARE DERIVED ============================
 *
 * These schemas describe the entries that exist, they are not a contract
 * imposed ahead of them. When a stream needs a new field, the field is added
 * here AND every existing entry is migrated in the SAME change. There is never
 * a state where half the content matches the model, because `astro check` and
 * the build both fail on a violation, which is exactly the property that lets a
 * non-developer be trusted with content.
 *
 * Adding a stream: define it below, register it in `collections`, create the
 * directory, and give it at least one real entry. An empty collection is a
 * broken listing page waiting to happen.
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { business } from "./lib/business";

/**
 * Posts: the blog, news, or whatever this site calls its stream of writing.
 *
 * `draft` is deliberate. A draft entry stays in the repo, reviewable in a diff
 * and visible in local preview, but is filtered out of every published listing
 * and returns 404 in production. That is the draft state a CMS sells, and here
 * it is one boolean and one filter.
 */
const posts = defineCollection({
  loader: glob({ base: "./src/content/posts", pattern: "**/[^_]*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(1).max(70),
    // Doubles as the meta description, so the length bound is an SEO bound, not
    // a style preference: past ~160 characters Google truncates it in results.
    description: z.string().min(1).max(160),
    // Coerced to a real Date. Note this does NOT reject an impossible date on
    // its own: see the future-date refine below for why, and what does.
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    // Real author, never "Admin" or "Team". An unattributed post is a weaker
    // entity signal and reads as filler.
    author: z.string().default(business.name),
    tags: z.array(z.string()).default([]),
    /**
     * Social and listing image. Relative to src/content/posts, so the asset sits
     * beside the entry it belongs to and moves with it. Omitted, the site
     * default is used rather than nothing.
     */
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  })
    // Alt text is not optional when there is an image. Enforced here rather than
    // left to a reviewer, because a missing alt is both an accessibility failure
    // and the kind of thing that is never caught by looking at the page.
    .refine((d) => !d.image || (d.imageAlt && d.imageAlt.trim().length > 0), {
      message: "imageAlt is required whenever image is set",
      path: ["imageAlt"],
    })
    /**
     * A publish date cannot be in the future, and this catches a trap that is
     * genuinely nasty because it never errors.
     *
     * YAML parses a date field into a Date, and it ROLLS OVER rather than
     * rejecting: `2026-13-01` becomes 2027-01-01, silently. Zod then sees a
     * perfectly valid Date and accepts it. Measured, not assumed. So a one-key
     * typo produces a published post dated next year, sorted to the top of every
     * listing, carrying a wrong `datePublished` into its structured data, and
     * nothing anywhere reports a problem.
     *
     * Two days of slack, because the build machine's clock and the author's
     * timezone are not the same thing. Genuinely scheduled publishing is
     * `draft: true` plus a merge when it is due, never a future date.
     */
    .refine((d) => d.publishedAt.valueOf() <= Date.now() + 2 * 86_400_000, {
      message:
        "publishedAt is in the future. If the month or day is out of range (e.g. 2026-13-01), YAML rolls it over into the next year instead of failing, so check the digits.",
      path: ["publishedAt"],
    }),
});

export const collections = { posts };
