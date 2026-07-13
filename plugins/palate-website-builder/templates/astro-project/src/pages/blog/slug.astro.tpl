---
// SCAFFOLD STEP: rename this file to `[slug].astro` (with the square brackets).
// Astro dynamic routes require the bracket syntax; the skill ships it
// bracket-free as `slug.astro.tpl` only so the skill zip uploads cleanly.
//
// Collection detail page. SSR: the slug resolves per request, so publishing a
// new item in the CMS needs no rebuild. Rename the folder per project to match
// the index route. See references/cms-and-draft-preview.md.
import BaseLayout from "../../layouts/BaseLayout.astro";
import { loadPage } from "../../lib/load";
import { toHTML } from "@portabletext/to-html";

type Item = {
  title: string;
  excerpt?: string;
  publishedAt?: string;
  body?: unknown;
  applyUrl?: string;
};

const { slug } = Astro.params;
const item = await loadPage<Item | null>(
  `*[_type == "collectionItem" && slug.current == $slug][0]`,
  { slug },
  null,
);

if (!item) return new Response(null, { status: 404 });

const bodyHtml = item.body ? toHTML(item.body as never) : "";
---
<BaseLayout title={`${item.title} - {{CLIENT_NAME}}`} description={item.excerpt}>
  <article class="bg-brand-bg mx-auto max-w-2xl px-6 py-20">
    <h1 class="font-display text-brand-text text-4xl md:text-5xl">{item.title}</h1>
    {item.publishedAt && (
      <time class="text-brand-muted mt-3 block text-sm">
        {new Date(item.publishedAt).toLocaleDateString("en-AU", { dateStyle: "long" })}
      </time>
    )}
    {bodyHtml && <div class="prose prose-brand mt-8 max-w-none" set:html={bodyHtml} />}
    {item.applyUrl && (
      <a
        href={item.applyUrl}
        class="rounded-brand bg-brand-accent text-brand-inverse mt-10 inline-flex px-6 py-3 font-semibold"
      >
        Apply now
      </a>
    )}
  </article>
</BaseLayout>
