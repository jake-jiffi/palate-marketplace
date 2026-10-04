---
description: Grade the site. Defaults to the free local grade, which works on a localhost preview and needs no public URL. Certification is opt-in, costs about US$1.06, and is the only number that can be shared.
argument-hint: "[url or path] [--certified to buy the shareable number] [--vertical health]"
---

## A site can always be graded

**Never tell anyone their site cannot be graded.** There is no such state. If it is not
deployed, if the URL is behind SSO, if there is no domain yet, if the MCP is not connected: none
of that blocks a grade, because the local grade serves the build on this machine and measures
that. What those conditions block is **certification**, which is a different sentence and must
be said as one:

> Graded locally: 74. It is not deployed anywhere public yet, so I cannot certify it. That is the
> shareable number and it needs a reachable URL.

Grading an undeployed build is the normal case, not a fallback. It is the entire point of a loop
that measures before it ships.

Three numbers exist and they are not interchangeable. Get this wrong and the product is
disproving itself on a customer's site.

| | cost | speed | shareable |
|---|---|---|---|
| **build hygiene** | free | seconds | no, and it is **not a grade**. It measures faults, and it correlated with the certified grade at r = -0.074 |
| **local grade** | free, unlimited | ~2 minutes | **no.** It runs on inputs the builder controls, so it can be faked |
| **certified grade** | ~US$1.06 | ~100 seconds | **yes.** The only one |

You do not need certification to fix your own site. You need it to prove something to someone
else: a client, a proposal, a comparison against anyone at all.

**Paths.** `$PALATE` is `${CLAUDE_PLUGIN_ROOT}` (or the skill checkout root). `$SITE` is the
project directory.

## 1. The local grade, which is the default

**This is what runs unless they asked to certify.** Certification is a purchase, and a purchase
is opt-in: it happens when they pass `--certified`, or say in words that they want the shareable
number, and never merely because they said "grade it".

It is free, so there is no reason to spend a dollar on a number you could have predicted. It
uses the grader's own `rubric.mjs`, the same SigLIP appearance head, and the same pairwise
ladder, all on this machine.

```bash
bash "$PALATE/scripts/serve-preview.sh" "$SITE"           # or use the deployed URL
node "$PALATE/scripts/reference-capture/grade-local.mjs" --url "$URL" [--vertical <vertical>]
```

That is phase one. It writes a judgement request to `.palate-shots/ladder-request.json` naming
six comparisons against library exemplars. **You are the vision model.** Open the hero and each
exemplar image, answer the comparisons honestly, write the answers to a JSON file, then:

```bash
node "$PALATE/scripts/reference-capture/grade-local.mjs" --judgements <file>
```

Read what comes back in this order and act on it in this order:

- **A cap.** A capped score prints the cap, the reason, and the underlying six-dimension number.
  A 20-second LCP caps a well-designed page at 60; that is a performance fix, not a design one,
  and the design number underneath tells you which.
- **`measuredWeight`.** How much of the rubric's 100 weight the number actually rests on. A grade
  computed without the appearance head is a different object from one computed with it, and it
  says so rather than quietly scoring around the gap.
- **A withheld number.** Below the corpus median this instrument is measured to flatter a weak
  page by up to 26 points, so it refuses to publish a point estimate there. **The withholding is
  the finding.** Do not go hunting for a number to report instead.
- **Findings**, in the order given.

Fix, rebuild, re-run. It costs nothing, so it belongs in the loop.

Then stop here, which is the default ending for this command. `--local` is accepted and means
the same thing. Say plainly what they have:

> Local grade 82. This is a self-check. It ran on this machine on inputs you control, so it can
> be faked, and it must not be quoted to a client or put in a proposal. The shareable number is
> the certified one.

## 2. The certified grade, only when asked for

Reached only via `--certified`, or because they asked for a number to show someone. Never as the
automatic next step after section 1: a command that quietly spends a dollar every time someone
says "grade it" is a command people stop running.

**`palate_grade` is allowlisted, not sold.** `mayStartGrade` admits the `internal` plan plus an
explicit list of customer ids, and it fails closed, so on an ordinary account the tool refuses
and charges nothing no matter what plan they are on. Do not offer it as something a subscription
buys. **The route to a shareable number for everyone else is the free public grader at
palatemcp.com/grade**, which returns the same certified score and the PDF. Say that first, not
as a fallback after a refusal they did not need to see.

If they are on the allowlist, confirm the cost before spending it:

> A certified grade costs about US$1.06 and charges 10 units against your monthly allowance
> (free 2, pro 4, studio 25 per month). It is the only number you can show anyone. Go ahead?

Then:

```
mcp__palate__palate_grade  { url: "<the public URL>" }
```

The URL must be publicly reachable. A localhost preview cannot be certified, and that is the
point: a grade computed on inputs the builder controls proves nothing to a third party.

**If the tool refuses, print its refusal verbatim** and give the fallback rather than guessing
at the cause:

- Out of monthly allowance, or gated: say which, and that the ceiling exists because a per-day
  limit times thirty is not a spend limit.
- Not connected:
  `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`
- Refused for any other reason: the person can submit the URL themselves at
  **palatemcp.com/grade**, free, and get the same certified number and the PDF.

## 3. Reporting a re-grade

Only show a delta when both grades came from the **same `rubric_version`**. When the grader
itself changes, the ruler moved and the site did not: a backfill of real grades had one domain
swing 71 to 78 to 38 to 78 across two days of grader fixes. Telling a customer they are "up 40
points" for work they never did is the failure this rule exists to prevent.

- Mismatched rubric versions: show no delta at all. Say the grader changed between the two runs.
- A move of 2 points or less: **held steady**. One standard deviation of run-to-run spread is
  2.3 points, and a band boundary sitting inside that spread is why the same page has reported
  both "B Strong" and "C Solid".
- A first grade renders **nothing**, not a zero.

## 4. The line that must not blur

Never write "certified", "verified" or "official" next to a local number. Never put a local
number in anything that leaves the machine. If someone asks for a number to send a client, the
answer is the certified grade or nothing.
