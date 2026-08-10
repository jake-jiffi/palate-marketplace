---
description: One site, read cold: what is failing, what drifted, what is stale, what changed, what is live.
argument-hint: "[optional path to the site, defaults to the current directory]"
---

# /palate-beta:status

Site: **$ARGUMENTS** (default: the current directory).

A portfolio read for one site, from what is recorded. **Nothing here launches a browser and
nothing here calls the network**, so it stays fast and works offline. Numbers come off disk; if a
number is not on disk, say it is not recorded and name the command that produces it. Never
estimate one.

Target length: about 25 lines. Red first. Someone should be able to scan it and know whether to
open the laptop.

## 1. Gather

Run these, in this order. Each is instant or seconds.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" . --out .palate/index.json
bash "${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" . --fail-on High --severity High
bash "${CLAUDE_PLUGIN_ROOT}/scripts/gate-mcp-depth.sh" build-manifest.json
git log --no-merges --date=short --format='%cd' --name-only -- src public
git log --since="1 month ago" --no-merges --date=short --format='%cd %h %s' -- .
```

Exit codes matter, so check them rather than reading the text:

- `palate-index.mjs`: 2 means no `src/pages`. Not a Palate site. Say so and stop.
- `ux-lint.sh`: 0 clean, 1 findings at High or above, 2 internal error (a broken lint is not a
  clean lint, report it as a hole in the check). `--severity High` is there so the printed list
  matches the list that fails; without it the display floor is Medium and the block fills with
  findings that are not blocking anything.
- `gate-mcp-depth.sh`: 0 pass, 2 block, **3 ungrounded**. Three is a label, never a failure: the
  recorded build made no Palate MCP calls, so it carries no taste layer. Exit 0 has two meanings
  and they are not the same, so read the line it printed: `passed` is a real pass, `skipped` means
  there was nothing to gate (no `jq`, no `build-manifest.json`, or a manifest that is not readable
  JSON). Report a skip as unknown grounding, never as grounded.

Then read, if present: `.palate/baselines/*.json`, `.palate-shots/hygiene-history.json`,
`verify-report.json`, `.palate-shots/interaction.json`, `.palate/brain/decisions.md`.

For last-touched dates, walk the `git log --name-only` output once: the first date a file appears
under is its most recent commit. Do not run a git call per file.

## 2. Report, in this order

**FAILING** (red, first, or the single word `none`)

- ux-lint findings at High or above: rule id, file, line. Cap the list at five and count the rest.
- `links.dead` from the index: every internal href pointing at a path no route serves.
- `verify-report.json` with `.visual.pass` not true, or a non-empty `interaction_failures` in
  `.palate-shots/interaction.json`.
- `hygiene-history.json`: a `regressed` last entry, or a stall (two flat iterations). A stall is
  reported, never waved through: "it stopped improving" is not "it is good enough".
- Gate exit 2 from the depth gate, with its stderr reason verbatim.

**DRIFTED**

Report only recorded drift. A live drift number needs a fresh render, which this command does not
do. So: for each route with a baseline, give the baseline's date and which measurements it holds.
Flag any route whose source has commits newer than its baseline, and say plainly that its drift is
unmeasured since then. Review threshold is 0.08 cosine distance from the route's own baseline.

Routes with no baseline at all are listed under one line: "no baseline recorded".

Drift is free and local, and it answers "has this page moved", never "was the move good". Do not
put a taste percentile or a grade in this block.

**STALE** (nothing touched in 60 days)

Routes whose source file, and every entry whose markdown file, has no commit inside 60 days.
Include the date. If the newest post is older than 60 days, say when the last one went up.

**CHANGED THIS MONTH**

Commit count, and the three to five that touched `src/`, each as `date hash subject`. Published
entries added this month, by title. If nothing changed, say nothing changed.

**LIVE**

One block of counts from the index: routes (static, dynamic, endpoint), entries with drafts
called out separately, orphans (a published page nothing links to, which is reportable, not an
error, since a campaign landing page is legitimately unlinked), and the business fact record with
how many routes read it.

## 3. Grounding line

Close with one line, always, even when it is fine:

```
Grounding: grounded (build-manifest.json records N Palate MCP calls)
```

or, on exit 3:

```
Grounding: ungrounded. The recorded build made no Palate MCP calls, so it carries no taste layer.
Reconnect: claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp
```

or, on a skip:

```
Grounding: unknown. No readable build-manifest.json, so there is no record of whether this build
used the library at all.
```

Say it once. Grounding is orthogonal to everything above: a site can be entirely green and
ungrounded at the same time, and saying so is the point.

## 4. Rules

- No preamble and no closing summary. Blocks only.
- An empty block prints `none`, it is not omitted. A missing block reads as a check that did not
  run.
- A check that could not run is named as a hole, never counted as a pass.
- Do not print a taste percentile, a local grade or a certified grade here. Those need a render
  or the network. If asked for one, name the command: `grade-local.mjs` for the free local
  self-check, palatemcp.com/grade for the only number that may be shown to anyone else.
