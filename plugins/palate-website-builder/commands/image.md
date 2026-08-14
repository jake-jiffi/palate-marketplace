---
description: Add or replace an image: resized, optimised, alt text written, wired to the right route, and kept out of git history.
argument-hint: "[path to the image, and where it goes]"
---

Put a picture on the site properly. Resize it to what is actually served, name it, write the alt
text, wire it into the route that shows it, and keep the bytes out of the repository's history.

`$ARGUMENTS` is a path to the source image and where it belongs. If either is missing, ask.

## 1. The rule about git

**The source file never enters the repository. Only the derivative does, and only once.**

Git stores every version of every binary forever. A superseded image is not deleted by deleting
it, it is permanent, and history cannot be un-fattened without a rewrite. This is how github/docs
ended up a 574MiB checkout inside a 2.23GiB repository. The same lesson is why the Palate
baselines store numbers instead of pixels.

Concretely:

- Keep the original wherever the person keeps their originals, OUTSIDE the project dir. If they
  hand you a file that already sits inside the repo but is not yet committed, move it out before
  you commit anything.
- Decide the final dimensions and the final format BEFORE the first commit. Do not commit a
  6MB export and optimise it in a follow-up: both copies are then permanent.
- Replacing an existing image at the same path still leaves the old bytes in history. That is
  acceptable once. It is not acceptable as an iteration loop, so get the size right first.
- `.palate-shots/` is throwaway: stills regenerated for the review, an output and not a record.
  Confirm it is in the project's `.gitignore` before committing, and add it if it is missing.
  Committing a run of full-page retina PNGs is the same mistake in a smaller costume.

## 2. Work out where it goes and how it is consumed

Read how this site actually renders images before choosing a destination, because the two modes
need the file in different places:

| The renderer does | Then the file goes | And the reference is |
|---|---|---|
| `<img src={image}>` with a plain string (what the shipped blog template does) | `public/images/` | the served path, `/images/<name>.<ext>` |
| `astro:assets` `<Image src={imported} />` | beside the entry, or `src/assets/` | an import, so Astro emits webp and avif at build |

Check `src/pages/blog/[slug].astro` (or the site's equivalent) and the component you are adding
to. Do not assume. Putting an `src/`-relative path into a raw `<img src>` produces a broken image
that looks fine in the diff.

## 3. Size and optimise

1. Measure the source: dimensions and bytes.
2. Work out the widest box it will ever render in, at 2x. A full-bleed hero is about 2880px
   wide; a post lead image inside a `max-w-3xl` column is about 1536px; a card thumbnail is far
   smaller. Resize to that. Serving a 4000px file into a 768px column is the single commonest
   cause of a slow page.
3. Convert and rename, **in an isolated staging directory holding only the new file**:
   ```
   mkdir -p .palate/tmp/img && cp <the new file> .palate/tmp/img/
   "${CLAUDE_PLUGIN_ROOT}/scripts/process-images.sh" .palate/tmp/img
   mv .palate/tmp/img/* public/images/ && rmdir .palate/tmp/img
   ```
   **Never point it at `public/images/`.** It walks RECURSIVELY and kebab-case-renames every
   image it finds, so aimed at the live directory it renames files the site already references
   and 404s them silently, which is the worst kind of breakage: nothing errors, the pages just
   lose their images.

   It converts AVIF to JPG and kebab-cases the filename. **Its AVIF conversion caps at 1200px**
   (`sips -Z 1200`), which contradicts the 2880px hero guidance above, so for a hero sourced from
   AVIF convert first and resize after. For the resize use `sips -Z <maxpx> <file> --out <file>`
   on macOS, or `magick <in> -resize <maxpx>x<maxpx>\> <out>`.
4. Budget: aim under 200KB for a lead image and under 100KB for anything inline. Those are a
   starting bound, not a measurement. **The perf lane is the actual arbiter**: if the throttled
   LCP moves, the image is too big regardless of what the budget said.
5. Name it for what it is, in kebab case. `richmond-workshop-exterior.jpg`, never `IMG_4821.jpg`
   and never `hero-final-v2.jpg`.

## 4. Alt text

Write it. It is not optional and it is not decoration:

- For a post, the schema in `src/content.config.ts` REFUSES the entry: set `image` without a
  non-empty `imageAlt` and the build fails with `imageAlt is required whenever image is set`.
- Everywhere else, the a11y lane catches it, and a missing alt is invisible on the page, which
  is why it only ever surfaces in someone else's audit.
- Describe what is in the frame and why it is on this page. Not "image of", not the filename,
  not the caption repeated. If the image is genuinely decorative, `alt=""` is the correct answer
  and you should say that is what you chose.

## 5. Wire it in

- Post: add `image` and `imageAlt` to the frontmatter.
- Page or component: add the element with explicit `width` and `height` attributes, plus
  `loading="lazy"` and `decoding="async"` for anything below the fold. The dimensions are not
  cosmetic: without them the browser cannot reserve the space and the page shifts as the image
  lands, which the perf lane scores. If the site's existing image component omits them, add
  them there rather than working around it.
- An above-the-fold hero image is the LCP element. It must NOT be lazy, and it should be
  preloaded.

## 6. Index, plan, check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed <files> --json
```

Then run the planned lanes, and pay attention to two in particular:

- **perf**, because this is the change most likely to move it:
  ```
  "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
    <SERVE_URL> --routes <planned routes> --out .palate-shots
  ```
  It measures vitals under slow 4G with 4x CPU throttling, which is the condition the public
  grade is taken in. An unthrottled local run reports a fast LCP for almost anything and would
  pass an image that is far too heavy.
- **a11y**, which fails on a missing or useless accessible name.
- **drift**, advisory, and genuinely useful here: adding a large image to a route with a
  baseline is one of the few content-class changes that legitimately moves appearance past 0.08.

## 7. Heal, then show

Fix and re-run before showing anything. Two flat iterations is a stall; report it.

Show: the final file path, dimensions and bytes (with the source's for comparison), the alt text
in full, the routes affected, the before and after throttled LCP, and confirmation that the
original is not in the repository.
