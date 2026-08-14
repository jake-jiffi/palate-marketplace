---
description: The monthly artefact. What shipped, what was caught before it shipped, what the numbers did, what to do next.
argument-hint: "[month, e.g. 2026-07] (defaults to the last 30 days)"
---

Lead with what was **caught**, not with a score delta.

A score that moved two points sits inside its own run-to-run spread and says nothing, and the
grader refuses to show a delta across mismatched rubric versions anyway. The defensible thing
this month produced is the list of faults that never reached the live site. That is the work.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}` (or the skill checkout root). `$SITE` is the
project directory.

## 1. Gather, from records rather than memory

```bash
SINCE="30 days ago"   # or the first of the named month

# what shipped: the changelog is the record, git is the fallback
cat "$SITE/.palate/changelog.md" 2>/dev/null
git -C "$SITE" log --since="$SINCE" --pretty='%ad %s' --date=short

# what was caught (written by /palate-website-builder:check)
cat "$SITE/.palate/ledger.jsonl" 2>/dev/null

# hygiene trend, same instrument each time
cat "$SITE/.palate-shots/hygiene-history.json" 2>/dev/null

# decisions taken
cat "$SITE/.palate/brain/decisions.md" 2>/dev/null

# the site as it stands
node "$PALATE/scripts/palate-index.mjs" "$SITE"
```

If `.palate/ledger.jsonl` is missing or empty, say so plainly: no contributions were gated this
period, so there is no caught list. Do not reconstruct one from commit messages. A commit
message is a claim; the ledger is a record.

## 2. Caught, first

Group the ledger by lane and lead with what each fault would have cost had it shipped. Be
specific: a lane, a route, the number against its threshold.

```
CAUGHT BEFORE IT SHIPPED - 11 findings across 23 contributions

  a11y       4   contrast on /services (4.1:1), three tap targets under 24px on /contact
  functional 3   a dead link to /pricing after the page was renamed
  voice      3   em dashes, and "bespoke solutions" in a services blurb
  perf       1   a 1.2MB unoptimised hero image on /about, LCP 4.9s under slow-4G

  Healed automatically: 7. Held for review: 3. Blocked: 1.
```

Healed and blocked are different facts and must stay separate. Seven things the agent fixed
before anyone looked is the labour saving; one thing that could not ship is the gate working.

## 3. Shipped

`.palate/changelog.md` is the record of what changed and why. One line per publish or rollback:

```
2026-08-10T04:12:07Z  publish  a1b2c3d  content  verdict=merge  grounding=grounded  routes=/blog,/blog/spring-hours  "spring trading hours"
```

Report it in the language of the site rather than the repo: pages added, sections rebuilt, posts
published, facts changed. Count rollbacks separately and never bury them. Cross-reference the
index: if `counts.entries` rose by four, four posts shipped. Name any orphan a new page created.

Fall back to `git log` only when the changelog is absent, and say that you did. A commit subject
is a claim about a change; the changelog line carries the verdict and the grounding with it.

## 4. The numbers, honestly

**Drift.** Per route, the cosine distance from its baseline, and whether the baseline was
accepted this period. Free and local. Say what it is: the page moved, or it did not. It is not a
quality judgement.

**Hygiene.** From `hygiene-history.json`, and only across entries with the same scored basis. A
run measured with different flags or routes is not comparable and reports no delta. A move of
**1 point or less is unchanged**, which is `NOISE_BAND` in `hygiene-loop.mjs` and the figure the
tool applies itself. Do not use 2.3 here: that is the certified grade's spread, measured on
different infrastructure, and mixing the two makes a real move read as noise.

**Certified grade.** Only if one was taken this period, and only with a delta when both grades
carry the same `rubric_version`. Otherwise report the number alone and say why there is no
delta: the grader changed between the two runs, so the ruler moved and the site did not.

Never print a certified number that was not certified, and never print a taste percentile that
was not computed. If none was taken, the line reads:

```
Certified grade: none taken this period. The last one was 71 on 2026-06-14.
```

## 5. Traffic, when there is an export to read

Only if the person supplies a Search Console export. Do not invent one and do not report traffic
you have not been given.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-traffic.mjs" <dir> --export <the CSV>
```

Search Console, Performance, Pages, then Export. A comparison export (previous period against
last) is enough; a date-series export is better, because only a series has a real onset date, and
without one nothing can be called a strong candidate.

It joins the pages that declined to the merges that touched what those routes depend on, and
reports **suspects, never a cause**. Present it that way: the decline, the candidate commits, and
what would confirm or rule each one out. This is correlation over a short window, and a confident
wrong attribution is worse than a ranked list, because someone acts on it.

## 6. Decisions

Every entry added to `.palate/brain/` this period, one line each with its date. This is the part
someone reads in a year to understand why the site is shaped the way it is.

## 7. What to do next

Three items, ranked by cost, each with the command that starts it. Not a wishlist.

Draw them from evidence already in the report: a lane that keeps catching the same fault is a
build problem, not a contributor problem, and should be fixed at the template. A route whose
drift keeps climbing has not been looked at. An orphan that has survived two reports should be
linked or deleted.

```
NEXT

1. /services has failed contrast three months running. Fix the token, not the page:
   --ink-muted is 4.35:1 on ivory and needs 4.5:1.        /palate-website-builder:check after
2. Nothing published since 2026-06-30. The blog is the reason this site has a
   content runtime.
3. Two orphans are now three months old (/v1, /lp2). Link them or delete them.  /palate-website-builder:sweep
```

## 8. Handing it over

Write the month's artefact to `$SITE/.palate/reports/<YYYY-MM>.md` so it sits with the other
measured state and commits with the repo. If the person wants something to hand to a client,
publish that file as an artifact and give them the link.

Do not put a local grade in anything client-facing, under any circumstances. The only number
that leaves the machine is the certified one.
