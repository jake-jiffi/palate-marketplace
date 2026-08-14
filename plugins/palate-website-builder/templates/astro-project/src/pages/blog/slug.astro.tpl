---
// SCAFFOLD STEP: rename this file to `[slug].astro` (with the square brackets).
// Astro dynamic routes require the bracket syntax; the skill ships it
// bracket-free as `slug.astro.tpl` only so the skill zip uploads cleanly.
//
// The detail page for one entry in the `posts` collection. SSR, so the slug
// resolves per request and a new post needs no getStaticPaths and no rebuild
// of every other route.
//
// Content comes from the collection, so the markdown IS the source: no CMS, no
// Portable Text, no rendering a body the repo cannot see.
import { getEntry, render } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { business } from "../../lib/business";

const { slug } = Astro.params;
const post = slug ? await getEntry("posts", slug) : undefined;

// A draft is a 404 in production and readable everywhere else, so a post can be
// written, reviewed in a preview and merged without ever being publicly live.
// import.meta.env.PROD is the build-time flag, so this costs nothing at runtime.
if (!post || (post.data.draft && import.meta.env.PROD)) {
  return new Response(null, { status: 404 });
}

const { Content } = await render(post);
const { title, description, publishedAt, updatedAt, author, image, imageAlt } = post.data;

// Article structured data, built from the same frontmatter the page renders, so
// the two can never disagree. `publisher` comes from the single business record.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: title,
  description,
  datePublished: publishedAt.toISOString(),
  ...(updatedAt ? { dateModified: updatedAt.toISOString() } : {}),
  author: { "@type": "Person", name: author },
  publisher: { "@type": business.schemaType, name: business.name },
  mainEntityOfPage: new URL(Astro.url.pathname, Astro.site).toString(),
};

const fmt = (d: Date) => d.toLocaleDateString("en-AU", { dateStyle: "long" });
---
<BaseLayout title={`${title} - ${business.name}`} description={description} noindex={post.data.draft}>
  <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} slot="head" />

  <article class="bg-brand-bg mx-auto max-w-2xl px-6 py-20">
    {post.data.draft && (
      <p class="border-brand-muted text-brand-muted mb-8 border px-4 py-2 text-sm">
        Draft. Not published, not indexed, and a 404 in production.
      </p>
    )}

    <h1 class="font-display text-brand-text text-4xl md:text-5xl">{title}</h1>

    <p class="text-brand-muted mt-3 text-sm">
      <time datetime={publishedAt.toISOString()}>{fmt(publishedAt)}</time>
      {author && <span> &middot; {author}</span>}
      {updatedAt && (
        <span> &middot; updated <time datetime={updatedAt.toISOString()}>{fmt(updatedAt)}</time></span>
      )}
    </p>

    {image && (
      <img
        src={image}
        alt={imageAlt}
        class="mt-8 w-full"
        loading="lazy"
        decoding="async"
      />
    )}

    <div class="prose prose-brand mt-8 max-w-none">
      <Content />
    </div>
  </article>
</BaseLayout>
