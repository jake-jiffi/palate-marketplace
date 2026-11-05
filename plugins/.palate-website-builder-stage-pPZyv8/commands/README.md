# The Palate commands

Every command, in five groups: know what is there, contribute a change, ship it, keep it good,
own the whole thing. They are shortcuts over a conversation, not a replacement for one.
Everything here can also be asked for in plain words. The commands exist because the same nine
steps happen every time, and naming them saves saying them.

## The loop

Every command that changes the site runs the same loop, and it is worth reading once because it
explains why nothing here asks you to review a diff.

**Ask** what is actually wanted, once, and never guess a business fact. **Ground** the work in
the site's own artefacts, its index, its brain, its baselines, its taste lineage
(`.palate/donors.json`, the library references the craft came from), and in the reference
library when it is connected. **Write** the change. **Render** the affected routes in a real browser at both
viewports, because a change that was never rendered was never checked. **Judge** it against the
contribution contract: the lanes that apply to this class of change, each with its own threshold.
**Heal** what is mechanically fixable, then re-run, before anybody is shown anything, bounded so
two flat iterations is a stall and a stall is reported rather than waved through. **Show** the
result as a before and an after, with every number named against the threshold it was measured
against. **Agree**, which is the only decision asked of a person. **Publish**, which commits,
deploys, reindexes, re-baselines and writes the change into the log.

The scoping is what makes it fast. A blog post is judged on schema, voice, accessibility and
performance across the two routes it touches. It is never judged on originality or signature
move, because those were decided at build time. A new component is judged on all of it. Running
the design ladder over a typo is not rigour, it is a tax on the most frequent action there is,
and a tax gets removed.

## Know

Read the site, never the session. Every answer comes off disk.

| Command | What it does |
|---|---|
| `/palate-website-builder:ask` | Anything about the site. Which pages still say the old price, when you last posted, why a page has no photos. Routed over the index, the brain, the baselines and the changelog. |
| `/palate-website-builder:status` | One site read cold: what is failing, what has drifted, what is stale, what changed, what is live. |
| `/palate-website-builder:why` | Explain a verdict or a past decision. Which lane, which route, which number against which threshold, and the smallest fix. |

## Contribute

Change the site. Each one runs the loop.

| Command | What it does |
|---|---|
| `/palate-website-builder:post` | A post, in the site's own voice, validated against its schema and healed before you see it. |
| `/palate-website-builder:page` | A new page or a substantial section. The one command where the library is decisive, so it grounds hard and says so when it cannot. |
| `/palate-website-builder:edit` | Change existing copy in plain language. Finds the file, makes the edit, checks only what moved. |
| `/palate-website-builder:fact` | Change a business fact once, in the record, and report every surface that changed with it, structured data and footer included. |
| `/palate-website-builder:image` | Add or replace an image. Resized, optimised, alt text written, wired to the route, kept out of git history. |
| `/palate-website-builder:campaign` | A landing page with its matched hero copy, its UTM destination and its tracking, created as one change. No campaign without its own copy. |

## Ship

Get it live, and get it back.

| Command | What it does |
|---|---|
| `/palate-website-builder:preview` | Serve locally, show before and after at 390 and 1440. Does not build. |
| `/palate-website-builder:publish` | Agree and it goes: check, heal, commit, deploy, re-baseline, log. |
| `/palate-website-builder:unpublish` | One page down now, with the right status code and an honest answer about how long it takes. |
| `/palate-website-builder:schedule` | Hold a post for a named instant, with the timezone stated, and publish it when the instant arrives. |
| `/palate-website-builder:rollback` | Undo the last publish, or a named one, with the reason recorded. |

## Keep good

The checks, and the numbers.

| Command | What it does |
|---|---|
| `/palate-website-builder:check` | Run the contribution contract over what changed, heal what is fixable, return one verdict. |
| `/palate-website-builder:drift` | How far each route has moved from its own baseline. Free, local, and not a judgement. |
| `/palate-website-builder:sweep` | The site-level checks no single contribution can trigger: crawlability, schema, orphans, dead links, stale content. |
| `/palate-website-builder:grade` | Grades locally and free by default, on a localhost preview, deployed or not. Certification is opt-in and is the only number that can be shared. |
| `/palate-website-builder:remember` | Record a decision, a voice note or a constraint in the brain, dated and reasoned, so a later session does not undo it. |
| `/palate-website-builder:report` | The monthly artefact: what shipped, what was caught before it shipped, what the numbers did, what to do next. |

## Own

Getting in, and getting out.

| Command | What it does |
|---|---|
| `/palate-website-builder:setup` | Get this machine ready. Checks what is there, installs what needs no password, hands back one exact line for anything else. |
| `/palate-website-builder:adopt` | Bring an existing site under management, whether or not Palate built it. |
| `/palate-website-builder:handover` | Transfer everything to the customer's own accounts, write the ownership receipt, revoke our access, leave it building. |

## Three things worth knowing before you start

**Most of this is free and needs no account.** The content runtime, the index, the brain, the
baselines, drift, the accessibility and performance checks, the local grade: all local, all
offline. Only the reference library needs the Palate MCP. When it is not connected, commands say
so once, factually, with the one line that reconnects it, and then carry on doing what can be
done locally. They never nag and they never stop.

**Drift and taste are different questions.** Drift is the cosine distance from a route's own
baseline and answers *has this page moved*. It is free and it is local. Taste is the percentile
against the library and answers *was the move good*. It is paid. No command prints a taste number
it did not actually compute.

**There are three quality numbers and they are not interchangeable.** Build hygiene is free, runs
in seconds, and is not a grade: it has no predictive power over the public score and the name was
the bug. The local grade is free, unlimited and computed on your own machine, which makes it
fakeable and therefore never shareable, and that is fine because gaming yourself is pointless.
The certified grade costs about US$1.06 and is the only one that can go in a proposal. You do not
need certification to fix your own site. You need it to prove something to someone else.

## Where the artefacts live

Everything a command reads or writes sits in the customer's own repo, under `.palate/`.

**The third column is the important one.** A file that is written and never read is not state, it
is a note, and calling it state is how a command ends up trusting something nothing maintains. So
every row names what reads it back, and the rows that read "nothing" say so plainly rather than
looking load-bearing.

| Path | What it is | Read back by | Committed |
|---|---|---|---|
| `.palate/index.json` | the content graph: routes, entries, what reads what | `:check`, `:page`, `:ask`, `:why`, `:status`, `:sweep`, `:publish` | no, derived and rebuildable |
| `.palate/baselines/*.json` | per-route numbers: vitals, appearance embedding, axe counts | `:drift`, `:check`, `:publish` | yes, they cannot be recomputed |
| `.palate/brain/*.md` | facts, voice, constraints, dated decisions | `:check`, `:page`, `:edit`, `:post`, `:campaign`, `:ask`, `:why`, `:report` | yes |
| `.palate/donors.json` | the taste lineage: which library references this site's craft came from, spine first | `:post` (the spine's `copy_voice`), `:page` (prefer a recorded donor over a stranger), `:campaign` | yes, it cannot be recomputed once the manifest is gone |
| `.palate/tokens.lock.md` | the design system in words: faces, sizes, accent, radius, spacing | `:check` (the tokens lane), `:page` | yes |
| `.palate/tokens.json` | the raw measurement the lock was written from | **nothing.** Evidence for a disputed lock entry, not an input | yes |
| `.palate/changelog.md` | what changed, when, by which commit | `:report`, `:rollback`, `:ask` | yes |
| `.palate/ledger.jsonl` | what each check caught, including what never shipped | `:report`, the session-start hook, `palate-handover.sh` | yes, and `:publish` commits it |
| `.palate/schedule.md` | the register of held posts and their release dates | `:schedule --due`, and nothing else, so a due post goes out when a person runs it | **yes** |
| `.palate/reports/<YYYY-MM>.md` | the monthly artefact, as sent | **nothing.** Written for people, kept so the claim can be checked later | yes |
| `.palate/adoption/` | the first-run capture from `:adopt`, kept as the arrival record | **nothing.** The record of what the site was on the day it arrived | yes |
| `.palate/tmp/` | scratch for a single run | nothing | no |

`schedule.md` is the one people leave out, and it is the one that matters most: it is the only
record of whether a held post ever goes out. Uncommitted, a scheduled announcement exists on one
laptop and nowhere else.

Baselines hold numbers, never pixels. Stills are regenerated on demand for a before and after;
they are an output, not a record. A repo that commits screenshots cannot be un-fattened later
without rewriting its history.
