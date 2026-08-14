---
description: Answer any question about this site by reading its own artefacts on disk, never from memory.
argument-hint: "[question, e.g. which pages still say the old price]"
---

# /palate-website-builder:ask

The question: **$ARGUMENTS**

## The rule that makes this worth trusting

**Every answer is read off disk. Never from this session.** If the answer already appeared
earlier in the conversation, re-read the artefact anyway before repeating it. A remembered
answer is a guess wearing confidence, and the person asking cannot check the repo themselves.
That is the whole reason they are asking.

If no artefact holds the answer, say **"I don't have that recorded"**, name what would record
it, and stop. Do not infer it, estimate it, or fill the gap from what sites like this usually do.

Four of the five artefacts below need no account and no network. Only the library needs the MCP.

## 1. Locate the site, refresh the index

Work from the current directory unless the question names another. If there is no `src/pages`,
say this is not a Palate site and stop.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --out .palate/index.json
```

It prints a one-line summary and writes `.palate/index.json`. The index is derived from the repo
and rebuilds in milliseconds, so rebuild it every time rather than trusting the copy on disk.
Baselines and the brain are the opposite: measured and written by hand, never regenerated. If the
index exits 2 the directory is not an Astro site; say so and stop.

## 2. Route the question to an artefact

| The question is about | Artefact | Where it lives |
|---|---|---|
| what exists, what reads what, orphans, dead links, drafts, post dates | **INDEX** | `.palate/index.json` |
| voice, business facts, constraints, why a past call was made | **BRAIN** | `.palate/brain/*.md` |
| how a route is doing, whether it has moved | **BASELINES** | `.palate/baselines/*.json` |
| what changed, when, and by which commit | **CHANGELOG** | `.palate/changelog.md`, `CHANGELOG.md`, else `git log` |
| what good looks like on other sites | **LIBRARY** | Palate MCP, `mcp__palate__refs_*` |

Most real questions take two. Worked:

- *"Which pages still say the old price?"* Grep `src/` for the old figure, then `--blast` the
  hits to turn files into routes. If the price lives in the business record, `facts.readBy` is
  the complete answer and the grep is only there to catch a copy that escaped the record.
- *"When did we last post?"* `entries[]` in the index, filter `draft: false`, sort by
  `publishedAt`. Give the title and the date.
- *"Why does the pricing page have no photos?"* The brain first, then the route's `source` and
  `dependsOn`. If nothing recorded a reason, say so rather than deducing one from the code.
- *"What changed this month?"* Git, scoped to a month, with hashes and dates.

## 3. Read the artefact

**INDEX.** `.palate/index.json` holds `routes[]` (`path`, `source`, `kind`, `dependsOn`
transitively closed, `links`), `entries[]` (`id`, `collection`, `file`, `draft`, `publishedAt`,
`title`), `facts` (`source` plus `readBy`, every route that reaches the business record),
`links.orphans`, `links.dead`, and `counts`.

- Which routes read one thing:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --reads business.ts`
- Which routes a change touches:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --blast src/lib/business.ts`
- Which routes a file's text appears on: use Grep over `src/`, then feed the hits to `--blast`.
  A raw grep result is a file list; only the index turns it into pages a person recognises.

For anything that is a single-source business fact (price, phone, hours, address, name), quote
`facts.readBy` and say the record is `facts.source`. That is the propagation answer, and it is
transitive, so it includes routes that render the fact through a shared layout without ever
importing it. A grep would miss those.

**BRAIN.** `ls .palate/brain/` and read every markdown file there (by convention `voice.md`,
`facts.md`, `constraints.md`, `decisions.md`, the last being a dated log). Quote it, do not
paraphrase a constraint into something softer. If the directory does not exist, the brain has
nothing recorded: say so once, plainly, and answer from the other four.

**BASELINES.** `ls .palate/baselines/` then read the JSON for the route in question. A baseline
holds numbers, never pixels: throttled vitals, the appearance embedding, axe counts, a structure
hash. Report only the keys that are actually present. No baseline for a route means no recorded
history for it, which is a fact worth saying, not a gap to paper over.

**CHANGELOG.** Prefer `.palate/changelog.md`, then `CHANGELOG.md`. If neither exists, git is the
record:

```
git log --since="1 month ago" --no-merges --date=short --format='%cd %h %s' --name-only -- .
git log -1 --date=short --format='%cd %h %s' -- src/pages/pricing.astro
```

Name the commit hash and date. "Recently" is not an answer.

**LIBRARY (needs the MCP).** For "what do good sites do here", call `mcp__palate__refs_search`,
`refs_for_business`, `refs_match_brief` or `refs_insights`, then `refs_get` with an intent layer
(`signature_moves`, `do_dont`, `component_prompts`, `pages`, `concept`) or `format:"design"` for
tokens with the reasoning. Name the slugs you read. Never describe a reference you did not fetch.

## 4. When the MCP is not connected

Say it once, factually, then carry on:

> The Palate MCP is not connected, so I cannot compare this against the library. Reconnect with
> `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`
> and restart Claude Code. Everything else here reads off disk and still works.

Never repeat it in the same answer, never at the end, never as a nag. If the error text mentions
the cap (`used all … enriched requests`, `quota_exceeded`, `Upgrade to Pro`), it is the free-tier
wall, not an outage: the MCP is reachable and refusing. Stop calling `refs_*`, say so once, and
finish from disk.

## 5. Keep the three quality numbers apart

Do not blur these, and never print one that was not computed in this run.

- **Drift** is free and local: cosine distance from a route's own baseline. It answers "has this
  page moved", never "was the move good". Review threshold 0.08.
- **Taste percentile** is the library comparison and needs the MCP.
- **Build hygiene** (`verify-rendered.mjs`) is not a grade. The **local grade**
  (`grade-local.mjs`) is free, unlimited and fakeable, so it is never shareable. The **certified
  grade** at palatemcp.com/grade is the only one that can be shown to anyone else.

If asked "is the site good" and nothing is on disk, say which command produces the number rather
than producing an impression of one.

## 6. Answer

Lead with the answer in one or two sentences. Then the specifics: routes as paths, entries as
titles with dates, files as paths, commits as hashes. Close with one line naming your sources:

```
Read from: .palate/index.json (routes, facts.readBy), git log --since=1 month
```

Terse and unhedged. No preamble, no "great question", no summary of what you are about to say.
