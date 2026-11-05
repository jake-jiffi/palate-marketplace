---
description: Write a post into src/content/posts, validate it, heal it, and publish it once you agree.
argument-hint: "[what the post is about, or a path to notes]"
---

Write one entry into the `posts` collection. A post is a CONTENT diff: it is never judged on
originality or signature move, because those were decided at build time. It is judged on the
schema, the voice, the facts, and whether the two routes it touches still render.

`$ARGUMENTS` is the subject, or a path to notes. If it is empty, ask for the subject in one
question and stop until answered.

## 1. Orient

1. Resolve the project dir (the argument, else the cwd). Confirm `src/pages` and
   `src/content.config.ts` exist. If there is no `posts` collection, say so and stop: adding a
   collection is a structural change, not a post.
2. Probe the MCP once: `mcp__palate__refs_list_verticals`. If the tools are absent or it errors,
   state ONCE that the taste layer is unreachable, give the recovery line
   `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`,
   and carry on. A post can be written without the library. Do not mention it again this session.
3. **When the MCP is up, pull the voice of the site's own lineage.** Read `.palate/donors.json`
   (written when the build passed its gates: the library references this site's craft actually
   came from). If it exists, `mcp__palate__refs_get { slug: <spine>, layer: "copy_voice" }`, and
   hold what comes back the way the whole skill holds a donor: it is the REGISTER the site
   already speaks (sentence length, headline anchoring, what the donor refuses to say), never
   copy to lift. A post written cold drifts toward blog-generic in a way nobody can name from one
   post; ten posts later the site sounds like everyone. No `donors.json` means an older or
   adopted build: skip silently, the brain's `voice.md` still leads either way.

## 2. Ground the writing

Read, in this order, and say in one line which sources you used:

- `.palate/brain/voice.md` if it exists. This is how the business writes and it wins over
  anything you would otherwise reach for.
- `.palate/brain/constraints.md` if it exists. Claims the business cannot make, words it does
  not use, regulatory limits. Treat every line as a hard rule.
- If neither exists, derive the voice from the three most recent non-draft entries in
  `src/content/posts/` plus `src/lib/content.ts`, and say that is what you did.
- `src/lib/business.ts` for every fact. Names, numbers, hours, service areas, addresses. If a
  fact is not in the record and not in the notes, ask for it or leave it out. Never invent one,
  and never type one into the markdown that already lives in the record.

## 3. Write the file

`src/content/posts/<kebab-slug>.md`. The frontmatter is enforced by Zod in
`src/content.config.ts`, so get it right the first time rather than discovering it at build:

- `title` 1 to 70 characters.
- `description` REQUIRED, 1 to 160 characters. It is the meta description, not a subtitle.
- `publishedAt` today's date, `YYYY-MM-DD`. Never a future date. An out-of-range month or day
  does not error: YAML rolls `2026-13-01` over into 2027 and the post sorts to the top of every
  listing with a wrong `datePublished`. Check the digits.
- `draft: true` on the first write, always. This is the publish gate, see step 8.
- `image` optional. If you set it, `imageAlt` is required and the build fails without it. Use
  `/palate-website-builder:image` rather than dropping a file in by hand.
- `tags` lowercase, reuse tags that already exist in the collection before minting a new one.

Then the body. Real `##` headings in order, no skipped levels. Specifics over adjectives: a
number, a date, a name, an outcome. If a sentence would survive being pasted onto a
<!-- ux-lint-disable ai-tell-leverage this line names the banned words in order to ban them ux-lint-disable ai-tell-game-changer same, the closed list has to be quotable in the rule that bans it ux-lint-disable ai-tell-seamless same, and a doc that cannot name a tell cannot teach it -->
competitor's site unchanged, cut it. No "leverage", "seamless", "elevate", "game-changer". No
em dashes.

## 4. Plan the check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed src/content/posts/<slug>.md --json
```

It returns the diff class (expect `content`), the routes affected (expect the post's own route
plus the listing) and the lanes. Run the lanes it names, on the routes it names, and nothing
else. If it returns `structural`, you edited something you should not have: go back.

## 5. Run the lanes

- **schema + functional**: `npx astro check` then `npm run build` in the project dir. A schema
  violation fails here with the field name. Fix it, do not loosen the schema.
- **voice**: `"${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" <dir>`. Exit 1 means findings at High
  or above. Fix the copy; do not add a `ux-lint-disable` comment to a post.
- **a11y + perf**: serve it and check the two routes.
  ```
  "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>          # prints SERVE_URL=...
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
    <SERVE_URL> --routes /blog,/blog/<slug> --out .palate-shots
  ```
  Use the default dev mode, not `--built`. A draft renders normally in dev and 404s only in
  production, so dev is the only mode where the post's own route can be checked before it is
  published. Note the post will NOT appear in `/blog` yet: drafts are filtered from every
  listing in every environment. That is expected here and is re-checked after the flip in step 8.
  Exit 0 clean, 1 findings at High or above, 3 the browser would not launch, which is a BLOCKED
  gate and never a pass. If it reports axe-core missing, run
  `"${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/setup.sh"` and re-run rather than reporting
  accessibility as clean.
- **caps**: the four things that cap a score no matter what else passes. Confirm the post did not
  introduce one: a sitewide noindex, a robots.txt disallowing everything, a page with no content
  before JavaScript runs, or an LCP over 15 seconds. The verifier covers the last two.
- **drift**: advisory only, and only where `.palate/baselines/<route>.json` already carries an
  `embedding`. A post rarely moves a page's appearance; if it does past `DRIFT_REVIEW_AT` (0.08)
  it usually means an image is reflowing the layout. Report it, never block on it.

## 6. Heal

Fix what is mechanically fixable yourself and re-run, BEFORE showing anything. Bounded: two
iterations with no improvement is a stall. Report the stall and stop. "It stopped improving" is
not "it is good enough", so a stall does not release the post.

## 7. Show

One screen, before any publish:

- The file path, and the routes it changes.
- The frontmatter as written.
- The first 150 words of the body.
- Each lane and its result, with the numbers. Where a lane did not run, say why.
- If the MCP was unreachable, the single ungrounded line, here and nowhere else.

## 8. Publish on agree

Only when they agree, change `draft: true` to `draft: false` and rebuild. That flip is the whole
publish action: drafts are filtered out of every listing and 404 in production, so until they
agree the post is real, reviewable in a diff, and unreachable.

Then re-check `/blog` once, because that route could not be verified with the post on it while
it was still a draft. Confirm the entry now appears, in the right position by date.

If they want changes, take them, and re-run steps 4 to 7 from the top. Never publish a post
whose last check ran against different text.
