---
description: Check the change against the contract, heal what is fixable, then commit, deploy, re-baseline and log it.
argument-hint: "[what changed, one line] [--dir <path>] [--yes]"
---

# /palate-website-builder:publish

Ship the working tree. The person's only decision is to agree: everything mechanical happens
without asking, and nothing reaches them that could have been fixed first.

Refuse on a block. A block is not a warning with a stronger adjective.

## 1. Orient

1. Resolve the project dir (`--dir`, else the cwd). Confirm `src/pages`.
2. The changed set:
   ```
   git -C <dir> diff --name-only HEAD
   git -C <dir> ls-files --others --exclude-standard
   ```
   Nothing changed means nothing to publish. Say so and stop.
3. Plan the check:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed <files...> --json
   ```
   It returns `diffClass`, `routes`, `scope`, `lanes` and `blocking`. **It prints the plan, it
   does not run the lanes.** Section 2 is what runs. Run the lanes it names on the routes it
   names, and nothing else: running the design ladder over a typo is a tax people remove.

   A change you thought was content coming back `structural` means it reaches more than you
   think. Read the route list before continuing.

## 2. Run the blocking lanes

**Run `/palate-website-builder:check` and consume its verdict. Do not reimplement the lanes here.**

There is exactly ONE lane runner and it lives in `check.md`. This command used to carry a second
copy, and the two had already drifted: this one ran `npm run typecheck` where check runs
`astro check`, passed different flags to `ux-lint.sh`, and never ran
`gate-scoped-style-escape.mjs` or `phantom-utility-check.mjs` at all. The consequence was the
thing a gate exists to prevent: **a structural change could pass `check` and then ship through
`publish` without its token lanes ever running.** Two runners will always drift, because nothing
makes them agree. One runner cannot.

If `check` returns:

- **merge** - continue to step 3.
- **heal** - it has already fixed and re-run. Continue only if it settled on merge; a stall is a
  stop, not a pass.
- **review** - stop and show the person the finding. This is the one case where the loop asks.
- **block** - stop. Nothing publishes. Clearing it needs a fix, or an explicit override commit
  carrying a written reason, which lands in the ledger and in the monthly report.

`drift` and `taste` are non-blocking and `check` does not run them. Report them as NOT RUN rather
than implying they passed.

**The ledger line comes from `check`, not from here.** It appends one entry to
`.palate/ledger.jsonl` on every run, which is what lets the monthly report say what was CAUGHT
rather than only what shipped. Do not add a second write in this command: two writers produce two
entries for one contribution, and the report then double-counts the work.
Never print a taste percentile that was not computed: drift is free and local and answers "has
this page moved", taste is paid and answers "was the move good", and blurring them is the one
thing this product cannot do.

## 3. Heal, before showing anything

Fix what is mechanically fixable and re-run the lane that failed. Contrast, tap targets, a
missing alt, an overflow, a lint finding on copy: all of these are yours, not theirs.

Bounded. `verify-rendered.sh` persists the prior score and reports improved, regressed or
unchanged, and a move inside its noise band reads as unchanged. Two flat iterations is a stall.
**A stall is reported and STILL blocks.** "It stopped improving" is not "it is good enough".

## 4. Fold to one verdict

Order is not negotiable: a cap outranks a block, a block outranks a heal, a heal outranks a
review.

- **block** or **cap**: refuse. Name the lane, the route, the number, the threshold and the
  smallest fix that clears it. Stop here.
- **review**: not broken, a threshold crossed. Name the same five things and carry it into the
  summary. It does not stop the publish.
- **merge**: go.

Then the grounding label, which is orthogonal and never folded in:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/gate-mcp-depth.sh" <dir>/build-manifest.json
```

Exit 3 is UNGROUNDED. It is a LABEL, never a block. Print it ONCE, with the recovery line
`claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`, and
carry on. An ungrounded merge is a real state and saying so is the point.

## 5. Ask once

One screen, then the question. `--yes` skips it.

- Class, scope, the routes that change.
- Each lane with its number. Lanes not run, named as not run.
- What was healed, and what remains.
- What is about to happen: commit, push or deploy, re-baseline, log.

If they want changes, take them and go back to section 1. Never ship a tree whose last check ran
against different files.

## 6. Redirects, before the commit

If a route source was deleted or renamed, the old URL has to keep working. Add the pair to
`redirects` in `astro.config.mjs`, which issues a real 301 on the SSR adapter, and carry it into
the log line. A moved page with no redirect costs the most and shows the least: nothing on the
site looks wrong.

## 7. Re-baseline the changed routes

Do this BEFORE the commit, so the baselines ship in the same commit as the change they describe.
This is what the next contribution is judged against.

For each affected route write `<dir>/.palate/baselines/<slug>.json`, where `<slug>` is `_root`
for `/` and otherwise the path with the leading slash dropped and every remaining slash turned
into `_`. Shape is `{ route, ...measurements }`, which is what `writeBaseline` in
`scripts/palate-contract.mjs` produces if you script it.

Write ONLY what this run measured, from `.palate-shots/design.json`: `vitals`, `vitalsScored`,
`hygiene`, the axe violation counts, plus the commit subject and an ISO timestamp. Do not write a
field that was not measured, and in particular do not write an `embedding` you did not compute.
A fabricated number in a baseline is worse than a missing one, because every future change is
measured against it and nobody re-reads it.

Baselines are committed on purpose. The index is not: rebuild it, never commit it.

## 8. Commit, log, deploy

Two commits, one push, one deploy. The order is forced by the log line carrying the commit sha,
which cannot be known before the commit exists.

1. **The publish commit.** The changed files, plus `<dir>/.palate/baselines/*`, plus
   `<dir>/.palate/ledger.jsonl`. Name the files. Never `git add -A`, and never commit
   `.palate/index.json`, which is derived and gitignored.

   **The ledger is not optional here.** `check` appended a line to it in section 2, and that line
   is the only artefact proving the gate did anything: what it caught, what it healed, what it
   held. Leave it out of this commit and it sits dirty in the working tree until the next person
   discards it, and then `/palate-website-builder:report` opens a month with nothing to lead on
   and reports "no contributions were gated this period" about a month of gated contributions.
   Baselines and the ledger are the same class of thing: measured state that cannot be recomputed
   from source, so they ship in the commit they describe.
2. **The log commit.** Append one line to `<dir>/.palate/changelog.md` (create it with a one-line
   header if absent) carrying the sha from step 1, then commit that file alone as
   `log: <subject>`. Space separated, quoted last field, one line per publish so it stays
   greppable:
   ```
   2026-08-10T04:12:07Z  publish  a1b2c3d  content  verdict=merge  grounding=grounded  routes=/blog,/blog/spring-hours  "spring trading hours"
   ```
   The deployment identity is deliberately not in here. Vercel is the source of truth for
   deployments and `vercel ls` can be asked at any time; this file is the source of truth for
   what changed and why, which nothing else records.

   Do not amend step 1 instead. Amending changes the sha and the line would name a commit that no
   longer exists.
3. **Deploy.**
   - a git remote on `main`: push once. Both commits go together and Vercel's GitHub integration
     builds and promotes the result. Two pushes would be two deploys.
   - no remote: `npm run deploy` (`vercel deploy --prod`) from `<dir>`, or
     `vercel deploy --prod --yes`.

   Wait for READY and take the URL. A push that has not finished building is not a publish.
4. Rebuild the index: `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>`. Check
   `links.dead` in the output: a publish that leaves a dead internal link is not done.

## 9. Report

What is live, at which URL, which routes moved, the verdict, the grounding label, how long the
deploy took, and the undo:

```
/palate-website-builder:rollback --reason "..."
```
