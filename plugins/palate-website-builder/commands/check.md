---
description: Run the contribution contract over what changed, heal what is mechanically fixable, and return one verdict.
argument-hint: "[files...] (defaults to the working tree diff)"
---

Run the contract over the changed routes and return a verdict. This is the gate that runs on
every contribution, so it is scoped to the diff and nothing else.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}`; if that variable is unset you are in a skill
checkout, so use the checkout root. `$SITE` is the project directory (the first argument if it
is a directory, else the current directory).

## 1. Work out what changed

Use `$ARGUMENTS` if it names files. Otherwise take the working tree:

```bash
git -C "$SITE" diff --name-only HEAD
git -C "$SITE" ls-files --others --exclude-standard
```

Paths must be repo-relative (`src/content/posts/x.md`), not absolute. If nothing changed, say
"nothing to check" and stop. Do not invent a diff.

This is the same pair `/palate-website-builder:preview` and `:publish` use, deliberately, so all
three see an identical change set. Do not substitute `git status --porcelain | awk '{print $NF}'`:
`$NF` takes only the last whitespace-delimited token, so it truncates any path containing a space,
and on a rename line (`R old -> new`) it yields only the destination, dropping the deleted source
that `publish` needs in order to write a redirect.

## 2. Get the plan before running anything

```bash
node "$PALATE/scripts/palate-contract.mjs" "$SITE" --changed <files...> --json
```

Exit 4 means there is no site at that path. The JSON gives you `diffClass`, `routes`, `lanes`,
`blocking` and `scope`. Print one line before you run a thing:

```
content change, 2 routes (narrow): /blog, /blog/welcome
lanes: caps schema voice functional a11y perf drift
```

If a content edit plans a wide scope, say so. That is a structural change wearing a content
change's clothes and the person should see it before they wait.

## 3. Run the lanes, cheapest first

Stop early only on a `cap`. Everything else runs so the report is complete in one pass.

**caps and schema (instant).**

```bash
node "$PALATE/scripts/palate-index.mjs" "$SITE"
cd "$SITE" && npx astro sync
```

A new entry in `links.dead`, or a route that disappeared from the index, is a `cap`. An
`astro sync` failure is a `cap`: the content collection schema in `src/content.config.ts`
rejected the frontmatter, so the site will not build.

**voice and tokens (seconds).**

```bash
bash "$PALATE/scripts/ux-lint.sh" "$SITE"
```

Exit 1 is a finding at High or above. On a structural change also run:

```bash
node "$PALATE/scripts/gate-scoped-style-escape.mjs" "$SITE"
node "$PALATE/scripts/phantom-utility-check.mjs" "$SITE"
```

**Then hold the diff against the token lock, which is the half no script can do.**

```bash
cat "$SITE/.palate/tokens.lock.md"
git -C "$SITE" diff -U0 HEAD -- '*.astro' '*.css' '*.ts' '*.tsx' | grep '^+'
```

`.palate/tokens.lock.md` is the site's design system written in words: the faces that carry
real weight, the type sizes that recur, the accent and its role, the radius, the border weight,
the spacing unit. `/palate-website-builder:adopt` measures it and writes it, and **this is the
command that reads it back**. For a long time nothing did, which made it a file that looked like
state and behaved like a note.

Read the ADDED lines only, and pull out every literal design value in them: a hex or `rgb()`, a
`font-family`, a `border-radius`, a `border-width`, a padding or margin value. Each one is a
finding at `review` unless the lock names it, or it is a token reference (`var(--...)`, a Tailwind
class backed by the preset) rather than a literal. Name the value, the file, the line, and the
locked value it should have been:

```
review  tokens  src/components/Card.astro:14  #2E7D5B is not in the lock; the accent is #E2553D
review  tokens  src/components/Card.astro:19  border-radius: 12px; the lock says 4px
```

The reason this is a lane and not a style opinion: a new value that nobody sanctioned does not
look wrong on the page it was added to. It looks wrong three pages later, and by then it is in
four components and the site has two design systems.

`.palate/tokens.json` is the raw measurement behind the lock, not an input to this check. Read
it only when you need the evidence for a lock entry someone is disputing.

If `.palate/tokens.lock.md` does not exist, this half did NOT run. Say so in the report as a
lane that was not measured, never as a pass, and name the fix:

```
not run  tokens  no .palate/tokens.lock.md; run /palate-website-builder:adopt to measure and lock it
```

**And hold the diff against the brain, for the same reason.**

```bash
cat "$SITE/.palate/brain/decisions.md" "$SITE/.palate/brain/constraints.md" 2>/dev/null
```

`/palate-website-builder:remember` promises that a contribution contradicting a recorded entry
comes back as a `review` named against that entry's date. **This command is where that promise is
kept**, and until it was written here it was kept nowhere: a decision saying "no testimonials
section" did not stop the next contribution adding one, because nothing in the gate had ever read
the file.

Read the entries, then read the diff. A change that puts back something an entry removed, or
breaks a rule a constraint states, is a `review`, never a silent pass and never a block. Name the
entry by its date so the person can weigh the two:

```
review  brain  src/pages/index.astro  adds a testimonials block; decisions.md 2026-08-10 removed it
                                      overrule it with a new dated entry, or drop the block
```

Overruling is a `/palate-website-builder:remember` entry that says so, not an argument in the
chat. If `.palate/brain/` is empty or absent, say nothing: a site with no recorded decisions is
the normal starting state, not a finding.

**functional, a11y, perf and geometry (tens of seconds, one render pass).**

```bash
bash "$PALATE/scripts/serve-preview.sh" "$SITE"        # prints SERVE_URL=...
bash "$PALATE/scripts/verify-rendered.sh" "$SERVE_URL" --routes <affected routes> --out .palate-shots
```

Pass only the routes the plan named. One run covers four lanes: route reachability, axe at
three viewports, tap targets and contrast, per-section overflow, and Core Web Vitals under
PageSpeed's slow-4G and 4x CPU lab conditions. Exit 3 means no browser could be launched, and
that is a `block`, never a pass.

**drift (non-blocking).** Do not run it here. Say `run /palate-website-builder:drift for the appearance move`.

**taste (non-blocking).** Not run locally by this command. It is the paid half and it is what
`/palate-website-builder:grade` answers.

## 4. Heal before showing anything

Fix what is mechanically fixable yourself and re-run only the lane that failed. A missing alt
attribute, a tap target under 24px, a banned face, an em dash, a phantom utility class: fix
them, do not report them.

Bounded, and the bound is not negotiable:

- A move of **1 point or less** on the hygiene score is **unchanged**, not improvement. That is
  `NOISE_BAND` in `hygiene-loop.mjs`, and it is the figure the tool itself applies: on a +2 move
  it prints `improved`, so calling 2 unchanged would have this command contradicting the number
  it is reading. (The 2.3-point figure is the CERTIFIED grade's run-to-run spread, a different
  instrument on different infrastructure. Do not carry it over.)
- Two iterations with no material gain is a **stall**. Report it, name the checks that have not
  moved, and stop. A stall still blocks. "It stopped improving" is not "it is good enough".

## 5. Grounding, once

```bash
bash "$PALATE/scripts/gate-mcp-depth.sh" "$SITE/build-manifest.json"
```

Exit 3 is UNGROUNDED. It is a label, not a block, and it is orthogonal to the verdict: an
ungrounded merge is a real state. Say it once and never repeat it:

> The Palate MCP was not used for this change, so it carries no taste layer.
> `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`

## 6. Report

Fold the findings the way the contract folds them: a cap outranks everything, then block, then
heal, then review, else merge. One line per finding, and every line carries the lane, the
route, the number against its threshold, and the smallest fix:

```
VERDICT: review (grounded)

review  a11y   /blog/welcome   contrast 4.1:1 on .post-meta, floor 4.5:1
                               darken --ink-muted one step; it clears at #6D6B65
healed  voice  /blog           em dash in the excerpt -> comma
merged  perf   /blog           LCP 1,740ms under slow-4G, budget 2,500ms
```

Then append one line to `.palate/ledger.jsonl` (measured state, commit it) so `/palate-website-builder:report`
can say what was caught rather than only what shipped:

```json
{"at":"<iso>","verdict":"review","grounding":"grounded","class":"content","routes":["/blog"],"caught":[{"lane":"a11y","route":"/blog/welcome","what":"contrast 4.1:1"}],"healed":["voice/em-dash"]}
```

Never print a taste percentile here. This command did not compute one.
