# The local grade (`grade-local.mjs`) — a free self-check with design in it

There are THREE quality numbers in this product and they are not interchangeable. Using the
wrong one is how a customer ends up quoting a number that does not mean what they think.

| | what it measures | cost | shareable? |
| --- | --- | --- | --- |
| **1. Build hygiene** (`verify-rendered.sh`) | what is measurable on a rendered page: accents, tap targets, mobile body size, axe, vitals | free, seconds, every build | no, and it is not a grade |
| **2. Local grade** (`grade-local.mjs`) | the above **plus design craft**: the SigLIP appearance head and the pairwise ladder against library references | free, a few minutes | **no** |
| **3. Certified grade** (submit at palatemcp.com/grade) | everything, on our infrastructure, on a live URL | free to the submitter, ~US$1.06 to us | **yes, this is the only one** |

**You do not need certification to fix your own site. You need it to prove something to someone
else.** A local grade is computed on the customer's machine from inputs they control, so it can
be faked. That does not matter for self-healing, because gaming yourself is pointless. It
matters completely the moment a number is put in a proposal, on a slide, or next to a
competitor's. Never call a local grade certified, never imply it is comparable to anyone else's
score, and never publish it.

## Why a free local grade is possible at all

A certified grade costs roughly **US$1.06**: about $0.95 of Fly machine for ~100 seconds of
Chromium, plus ~$0.11 of vision calls. That price is why the real grader is a done-time check
and can never be an inner-loop one.

Almost none of that cost has to be ours, because the plugin runs where the expensive parts
already exist:

- **capture** — this plugin already drives a real browser at both viewports.
- **the appearance head** — SigLIP runs locally through transformers.js, ~540ms once cached.
- **the judge** — the agent doing the build *is* a vision model.
- **the rubric** — `rubric.mjs`, vendored here and byte-identical to the grader's.

What is left for the server is a row read and a dot product, and both are free:
`palate_grade_pack` (which references to judge against, their do/don't rules, and the judging
prompt) and `palate_taste_score` (projecting the local embedding onto the learned taste head,
which stays on our server because this repo is public).

## Running it

```bash
# 1. measure, embed, fetch the references, and write the judging request
node scripts/reference-capture/grade-local.mjs --url https://your-preview.vercel.app --vertical health

# 2. judge the six comparisons (see below), writing answers to a JSON file

# 3. score
node scripts/reference-capture/grade-local.mjs --judgements judgements.json
```

**First run downloads ~356MB** (the SigLIP vision tower), once. It is announced before it
starts and cached afterwards. Set `PALATE_MODEL_CACHE` to somewhere stable so a dependency bump
does not re-download it.

## Judging: the part only the agent can do

Three references, each judged **twice with the images swapped**, so six comparisons.

**Dispatch each comparison to a fresh subagent.** The two swapped runs must not see each
other's answer. Position bias is the best-documented failure of pairwise visual judging and
swapping is the only control that detects it; an agent judging both orderings in one context is
asking itself to agree with itself, which is not a control. If you genuinely cannot, pass
`--not-independent` and the result is marked low confidence and says why.

Use the `system` field from the request file **verbatim**. It is served by the MCP so that your
judgement and the public grader's are reading the same instructions. It is never invented
locally; if the pack cannot be fetched, the ladder does not run at all.

**Be blunt, and do not soften a verdict because you built the site.** Most real websites are
clearly worse than a library reference and saying so is the job.

## How close is it to the certified grade?

Measured 2026-08-07, seven sites spanning 36 to 90 on the certified instrument.

**The seven are not one clean sample and the table says which is which.** Four were captured
with the settle detector in place; three predate it, so their heroes may be frames of an
entrance animation — the very fault the detector was built for. They are pooled in the
headline statistics below, which is a real weakness of that headline.

| site | captured | certified | local | gap | local design | ladder verdict | taste |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nocturne-label.vercel.app | settled | 90 | 95 | +5 | 91 | better | p92 |
| palatemcp.com/web-design-mcp | **pre-detector** | 87 | 91 | +4 | 87 | better | p99 |
| palatemcp.com | settled (never settles, flagged) | 83 | 75 | −8 | 79 | comparable | p73 |
| jiffi.co | **pre-detector** | 73 | 67 | −6 | 66 | comparable | p94 |
| linear.app | settled | 60 | 56 | −4 | 71 | comparable | p57 |
| hightownpharmacy.co.uk | **pre-detector** | 41 | 58 | **+17** | 52 | somewhat worse | p22 |
| properly.sg | settled | 36 | 62 | **+26** | 51 | somewhat worse | p43 |

Three of the certified scores (palatemcp.com 83, linear.app 60, properly.sg 36) were supplied
rather than run by me: the MCP allows six grades per 24 hours and I spent mine. The one
overlapping check is nocturne, which I graded fresh at 90 against a supplied 91.

**r = +0.83 (95% CI roughly [0.21, 0.97] at n = 7), Spearman rho = +0.86, mean absolute gap 10.0
points, SD of the gap 12.6.** Carry the interval wherever the number goes: directionally strong,
numerically vague. The hygiene score that preceded this — the same rubric without the appearance
head or the ladder — measured **r = −0.074 over 23 sites**. So the vision half does transfer,
and it is what carries the correlation.

**The appearance head alone beats the whole local grade.** Across these seven, r(taste
percentile, certified) = **0.90**, against r(local grade, certified) = 0.83. That is consistent
with the head's 0.738 concordance against founder labels versus the ladder's 0.716: the head is
the better signal and combining it with the ladder currently dilutes it. Not acted on, recorded.

**THE ERROR IS NOT SPREAD EVENLY, AND WHERE IT LANDS IS THE PROBLEM.**

- On the five sites certified 60 and above, the gap is +5, +4, −8, −6, −4: **mean absolute 5.4,
  never worse than 8**.
- On the two sites certified below 45, the gap is **+17 and +26, both positive**.

A local path that agrees at the top and flatters at the bottom is close to useless for the
people who need it most, so the mechanism is worth naming exactly. Two things combine:

1. **The design ceiling converts a design disagreement straight into the overall gap.** Overall
   cannot exceed design craft by more than 15. hightownpharmacy is certified design 26, so its
   certified overall is *capped* at 41. Locally its design scored 52, the ceiling never bound,
   and the overall came out 58. The whole gap is one design judgement.
2. **The appearance head is not allowed to correct it.** The taste prior lifts above p85 and
   pulls below p10. hightownpharmacy sits at p22 and properly.sg at p43 — the head ranks both
   correctly in the bottom half, and is forbidden from doing anything about it. The lift fires
   for the top 15% and the pull for the bottom 10%, so the asymmetry systematically flatters
   the middle and lower-middle.

Underneath both: the local ladder returned "somewhat worse" where the certified judge returned
something harsher. **An agent judging a site is gentler than the grader's judge**, and that is
exactly the direction that hurts.

**This has NOT been tuned away, deliberately.** Widening the pull threshold would move these two
numbers and prove nothing. It is a finding, not a defect to paper over.

**Instead, the number is WITHHELD where it is known to flatter.** When the appearance head puts
a page below the library median (p50), `grade-local.mjs` refuses to publish a point estimate. It
prints the computed number as suspect, the honest range (the computed score minus the 17-to-26
over-score measured in that band), the findings, and an instruction to get the certified grade
before concluding anything.

The gate is on the **taste percentile, not the score**, and that is the whole trick: the failure
mode is that the score is too *high*, so the two flattered sites came out 58 and 62 — comfortably
mid-table and invisible to any threshold on the score itself. The head is the only signal
available at grade time that separates them, and it earns the job by out-predicting the grade.

On both measured sites the published range contained the certified score (properly.sg: range
36–45, certified 36; hightownpharmacy: range 32–41, certified 41). Two observations, and the
message says so.

**Why this matters more than a calibration issue:** this is a self-check for someone deciding
whether their site needs rebuilding. Flattering a bad site is the one error that costs them the
decision — they read 62, conclude they are mid-pack, and do nothing.

**Two caveats on the measurement itself.**

- **The certified side was measuring design on 4 of its 11 checks** when this ran, because
  `capture.mjs` drops the computed-style facts on the way out of the capture. The fix is
  committed but needs a `fly deploy`. Until then the two sides are not scoring design from the
  same inputs, and **these numbers will move**. Re-run after the deploy.
- **The judgements were not independent** (one context, `--not-independent`). The designed path
  dispatches each of the six comparisons to a fresh subagent.

**There is no band letter on a local grade, deliberately.** The bands are 10 points wide and
this runs 10 out on average: web-design-mcp is 91 locally and 87 certified, which is "A
Exceptional" against "B Strong" on one page.

## What it will not do

- **It refuses rather than guessing.** A blank hero, a full-page composite, a mobile still or a
  broken capture is named and dropped. 33 of the 2,194 library heroes never rendered and this
  head scores them at a median percentile of 86.7, so an ungated head reports a blank page as
  top-13% taste.
- **It waits for the page to stop moving, and says whether it did.** A fixed delay is not a
  settle. The first version shot the hero 1400ms after load; linear.app needs **7,349ms**, and
  came back with its headline still blurred mid-entrance and its cards as empty outlines. No gate
  could catch it — right aspect, varied pixels — so the head scored a frame of an animation as
  though it were the design, and it landed 15 percentiles low (p41 against the settled p57). The
  capture now shoots repeatedly and compares encoded bytes. A page that never settles
  (palatemcp.com, whose reel animates continuously) is **reported as unsettled**, not silently
  scored. This generalises: a fixed delay that happens to produce a plausible-looking frame is
  the silent-skip shape this codebase keeps getting caught by.
- **It never scores a missing check as zero.** Anything it could not measure leaves the
  denominator, and `measuredWeight` reports how much of the 100 the number rests on.
- **It does not measure content, technical foundations or AI readiness** — 34 of the 100
  weight. The public grader reads those from the fetched HTML, robots.txt and sitemap. The
  output says so explicitly rather than quietly scoring on 66 weight and presenting it as 100.
  Closing that gap means vendoring the grader's `checks.mjs` the way `design-measure.mjs` was
  vendored, not writing a third implementation of the same checks.

## The arithmetic, and why it is the way it is

Identical to the grader worker's `ladder.mjs`, because a local number computed differently is a
different quantity wearing the same units.

- **Three comparisons, always.** The exemplar pack once carried two per vertical and the ladder
  silently ran on two. Design craft is 40% of the grade and the ladder owns 45 of its 100
  points, so a third less evidence measurably widened the spread: one site moved 40 points
  across three runs without changing.
- **Swapped comparisons that disagree collapse to the lower rung.** An unstable verdict is not
  evidence of quality.
- **Score from the mean, not the median rung.** With three comparisons and rung values
  0.15/0.4/0.7/0.9 the median either does not move or moves a whole rung, which is 3.6 points of
  the final grade decided by two judges landing on the other side of a near-tie.
- **The signature move is a fraction, not a vote.** As a boolean it was a 4.2-point step turning
  on one judge changing its mind, the largest single source of run-to-run movement in the rubric.
- **The taste head is a prior, not a score.** It may move the verdict by one rung and only at
  the extremes (top 15% lifts, bottom 10% pulls). It is a 384px hero-appearance model; it is
  allowed to express doubt and a little confidence, never to be published as a grade.
