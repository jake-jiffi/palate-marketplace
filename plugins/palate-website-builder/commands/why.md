---
description: Explain a verdict or a past decision: the lane, the route, the number against its threshold, what changed, and the smallest fix.
argument-hint: "[a verdict, a route, a lane, a rule id, or a plain question]"
---

# /palate-website-builder:why

Asked about: **$ARGUMENTS**

A blocking gate is only tolerable if it can explain itself. So this command is never allowed to
be vague. Every answer names a lane, a route or file, a number, the threshold that number was
measured against, the change that moved it, and the smallest fix. If any of those five is not on
disk, say which one is missing and which command produces it. Do not substitute a plausible
reason for a measured one.

## 1. Work out what is being explained

Three kinds. Read the argument and pick one.

- **A verdict or gate result** ("why was this blocked", "why review", "why ungrounded").
- **A specific finding** (a rule id, a route, a check id, a lane name).
- **A past decision** ("why does pricing have no photos", "why are we on this font").

## 2. A verdict

Rebuild the plan from the real diff rather than recalling it.

```
git diff --name-only HEAD
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" . --changed <files> --json
```

That prints the **plan**, not the verdict: `diffClass`, `routes`, `scope`, `lanes`, `blocking`.
The verdict is folded from the findings the lanes produced, so to explain one you need both the
plan and the lane that fired.

**Diff class** decides which lanes run at all.

| Class | What lands in it | Why it matters |
|---|---|---|
| content | `src/content/**`, `src/lib/business.ts` | changes what a page says |
| structural | other `src/**` source and style files | changes what every page looks like |
| config | `package.json`, lockfiles, `astro.config`, `tsconfig`, `*.config.*`, `.github/` | can change anything |

The class of a change as a whole is the most dangerous class present. A post that also touched a
layout is structural, and saying so is usually the whole explanation.

**Lanes**, with cost and whether they block:

`caps`, `schema` (instant, blocking) · `voice`, `functional` (seconds, blocking) · `a11y`, `perf`
(tens of seconds, blocking) · `tokens`, `geometry` (structural only, blocking) · `drift`
(seconds, advisory) · `taste` (a minute, structural only, advisory).

Two things get asked about constantly and are worth stating outright:

- **Taste does not run on a content change.** Originality and signature move were decided at
  build time. Running the design ladder on a copy edit is a tax on the most frequent action in
  the product.
- **A wide blast radius on a small edit is usually correct.** Two causes, and both are the
  design working. A content entry reaches its own detail route plus every listing that reaches
  the collection, because a new post changes the post and the index that lists it. And an
  unrecognised or dynamically imported file returns *every* route rather than none, because a
  gate that checks too much is slow while a gate that checks too little passed the change that
  broke the site. Run `--blast` and read it before calling the width a bug.

**Verdict precedence**, in order and not negotiable: a **cap** outranks everything, then
**block**, then **heal**, then **review**, else **merge**. Heal sits above review because a
mechanically fixable problem should never reach a person, and two flat heal iterations is a
stall, which is reported rather than waved through.

**Grounding is orthogonal.** `ungrounded` is not a quality verdict. It means the taste layer was
unreachable, so the report cannot imply a judgement it did not make. A change can be `merge` and
`ungrounded` at the same time.

## 3. The numbers and their thresholds

Quote the real one. Never round, never soften, never invent a threshold to fit the finding.

- **Drift**: cosine distance from the route's own baseline in `.palate/baselines/`. Review at
  **0.08**. Advisory, and it stays advisory until it is calibrated on real edits: blocking on an
  uncalibrated perceptual distance is how a gate earns a reputation for crying wolf in week one.
- **ux-lint** (`scripts/ux-lint.sh`): fails at **High** by default. 0 clean, 1 findings, 2
  internal error. Escape is per line: `ux-lint-disable <rule-id>` on the same or preceding line.
  Quote the rule id and the line, and say what the rule is for.
- **MCP depth** (`scripts/gate-mcp-depth.sh`): 5 references surveyed, 2 inner pages, 3 distinct
  Palate tools, at least 1 `refs_get`, at least 1 rich layer (`signature_moves`, `do_dont`,
  `component_prompts`, `pages`, or `format:"design"`). Exit 0 pass, 2 block, **3 ungrounded**
  (a label, never a block). Overridable per threshold by env; `PALATE_GATE_OFF=1` turns it off.
- **Rendered verify** (`verify-rendered.mjs`): fails at High. **Exit 3 means a browser could not
  launch, and that is BLOCKED, not a pass.** Say so if you see it.
- **Build hygiene** (`hygiene-history.json`): the noise band is **1 point**. A move inside it
  reads `unchanged`, not `improved`. Two iterations with no gain past the band is a stall.
- **The rubric** (`rubric.mjs`, the grader's own): design craft carries weight **40** of 100, and
  **overall cannot exceed design craft + 15**. So a report can be held down by design while every
  hygiene finding is already clean, and spending effort on the findings will move nothing. Hard
  caps: sitewide noindex 55, robots disallow-all 55, no content without JavaScript 65, LCP over
  15 seconds 60. A capped score prints the cap, the reason, and the underlying six-dimension
  number. `measuredWeight` says how much of the 100 the number actually rests on.

Keep the three quality numbers apart, always. Build hygiene is not a grade. The local grade is
free, unlimited and fakeable, so it is never shareable. Only palatemcp.com/grade is certified,
and it is the one to use when the point is proving something to someone else.

## 4. What changed to cause it

Name the commit, not the vibe.

```
git log -1 --date=short --format='%cd %h %s' -- <the file the finding names>
git log -S '<the token or string in the finding>' --oneline -- src
git blame -L <line>,<line> -- <file>
```

If the finding is on a route rather than a file, get the file from `.palate/index.json`
(`routes[].source`, and `routes[].dependsOn` for the shared layout or token file that actually
carries it). A finding on five routes at once is nearly always one shared dependency, and naming
it is more useful than listing the five.

## 5. A past decision

Read `.palate/brain/decisions.md` (dated log) and the rest of `.palate/brain/`. Quote the entry
with its date. If the brain does not record it, fall back to git: the commit that introduced the
code, with its message. If neither has it, say **"I don't have that recorded"** and say what
would record it. Do not reconstruct a rationale that nobody wrote down. An invented reason is
worse than a missing one, because it will be repeated as fact.

## 6. Answer in this shape

```
Verdict   block, ungrounded
Lane      a11y (blocking, tens of seconds)
Where     /pricing, from src/layouts/BaseLayout.astro (shared by 8 routes)
Number    contrast 3.74:1 against the 4.5:1 minimum, desktop 1440 only
Cause     a1b2c3d 2026-08-04 "tighten nav CTA colour"
Fix       Darken the CTA token this site already defines until it clears 4.5:1 on its ground.
          One token, all 8 routes.
```

Use the site's own token names, read out of its stylesheet. Never name a token from another
project, and never invent one to make the fix line read well.

Then, at most, three sentences on why the rule exists, if the person is likely to think it
arbitrary. Nothing else. No preamble, no reassurance, no offer to fix it unless asked.

If the verdict has more than one finding, order them by what is blocking, then explain only the
blocking ones in full. A person clearing a gate needs the wall, not the wallpaper.
