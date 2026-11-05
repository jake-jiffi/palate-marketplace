---
title: The shape of a post, and what the build refuses to accept
description: A draft seed entry. It exercises the schema, documents the frontmatter contract, and can never reach production.
publishedAt: 2026-01-01
draft: true
tags:
  - meta
---

This entry ships with the scaffold so the collection is never empty, and it is
`draft: true` so it can never publish. Drafts are filtered from every listing and
return 404 in production, so this is visible in local preview and in a diff and
nowhere else. Copy it to start a real post, or delete it once there is one.

## What the schema refuses

`title` caps at 70 characters and `description` at 160, because that is roughly
where a search result truncates each of them. `description` is required, not
optional: without one, the search engine picks its own excerpt from the page and
usually picks badly.

`publishedAt` cannot be in the future, which sounds like a style rule and is
actually a trap guard. YAML rolls an out-of-range date over instead of rejecting
it, so `2026-13-01` quietly becomes 1 January 2027: a valid date, a published
post, sorted to the top of every listing, with the wrong `datePublished` in its
structured data and no error anywhere. The future-date check is what catches it.

If you set `image`, then `imageAlt` becomes required. That is enforced in the
schema rather than left to a reviewer, because a missing alt is invisible on the
page and only ever surfaces in an audit, usually someone else's.

## Writing

Write the way this business speaks, not the way a blog post is supposed to sound.
Specifics beat adjectives: a number, a date, a name and a real outcome carry more
than any amount of "leading" and "innovative". If a sentence would survive being
pasted onto a competitor's site unchanged, it is not doing any work.

Use real headings. They are how a reader scans, how an answer engine finds a
quotable chunk, and how the accessibility tree gets built, so keeping the order
unbroken matters more than it looks.
