# Build-verifier calibration (SPIKE)

This is the "eval the scorer" gate for the BUILD verifier. It is infrastructure, not a
result yet: the seed set is deliberately too thin to mean anything until Jake labels
more (see the caveat at the foot).

## What it is

`verifier-calibration.mjs` reads a labelled set (`verifier-calibration-labels.json`),
derives the verifier's preference order from the `verify-report.json` of each build, and
measures how often that order agrees with Jake's. The metric is **pairwise concordance**:
the fraction of decisive human comparisons the verifier orders the same way. It prints
the concordance, the chance baseline, and a deploy-gate verdict, and exits:

- `0` concordance at or above the gate (default 0.7),
- `1` below the gate,
- `2` not enough labels yet (under `PALATE_VC_MIN` decisive comparisons, default 5).

```
node verifier-calibration.mjs                 # uses verifier-calibration-labels.json
node verifier-calibration.mjs ./other.json    # an alternate label file
PALATE_VC_GATE=0.65 node verifier-calibration.mjs
```

Env overrides: `PALATE_VC_GATE` (gate threshold), `PALATE_VC_HOLDOUT` (held-out
fraction, default 0.3), `PALATE_VC_MIN` (minimum decisive comparisons, default 5),
`PALATE_VC_SEED` (the reproducible split seed, default 1).

## Why

The build verifier's six visual axes (philosophy, hierarchy, execution, specificity,
restraint, variety) plus the new v1.5 `pairwise` / `ambition` blocks are an
**uncalibrated LLM judgement**. Nothing checks that the verifier's scores track a human's
taste. The LIBRARY side already has this: `library/scripts/lib/calibrate.mjs` plus
`library/_meta/vlm/calibration.json` proved the library's VLM craft scorer orders Jake's
labelled comparisons at **0.716 concordance** versus **0.465** for the old deterministic
score (≈ chance). That gate is the moat's quality control. The build side has had no
equivalent. This spike is the missing piece.

The seed anchors are the three overnight bold builds (`ferrous-cast`, `lumen-cast`,
`monolith-no7`). All three self-scored Variety 5 (lumen/monolith) or 4-5 (ferrous) and
returned `verdict: pass`, yet all three collapsed Explore (no built variants, no pairwise
win recorded). The diagnosis labels them do-not-ship at the bold bar. They are anchored
`do-not-ship` precisely because a high self-score that did not earn the ambition gate is
the exact uncalibrated-judge failure this gate is meant to catch.

## How the verifier's preference is derived

For each comparison the script reads each build's `verify-report.json` and reduces it to
one scalar (higher = the verifier rates it better):

1. **Axis sum** is the primary signal: the six rubric axes from the last visual
   iteration. It handles both report shapes seen in the wild - flat numbers
   (`"variety": 5`) and per-viewport objects (`"variety": { "desktop": 5, "mobile": 4 }`,
   averaged).
2. **Verdict** (`pass` > `fail`) is a small always-present floor.
3. **The v1.5 bold-bar blocks** (`ambition.clears`, `pairwise.won`,
   `explore.built_routes`) are folded in as small tie-breakers, so two builds that both
   max the axes can still be separated by whether they actually cleared the bold bar
   (the failure mode of the three seed builds). Reports without these blocks (the seed
   three pre-date v1.5) simply skip that nudge.

The verifier prefers `a`, `b`, or `tie`; a report that cannot be scored at all is skipped
with a note (it is not counted against the gate).

## The metric (mirrors the library)

The library gate that actually shipped did NOT use kappa/pearson (both came back `null`
on that run). It used **pairwise concordance**: of the comparisons where BOTH the human
and the scorer expressed a non-tie preference (the "decisive" ones), the fraction where
they agree. The library counted 67 decisive of 101 total; ties are excluded from the
denominator. The chance baseline for a two-way decisive choice is **0.5**.

The script holds out a fraction (default 30%, reproducible via a seeded hash split) and
reports **train vs held-out concordance separately**, so the gate is judged on data the
verifier prompt was not tuned against (standard practice to avoid reading an overfit
number). When the held-out fold is still too small, the gate falls back to the all-data
concordance with a printed warning.

## How Jake adds labels

Edit `verifier-calibration-labels.json`. Two kinds:

- **Pairwise (the calibrated method, preferred):**
  ```json
  { "a": "/abs/or/relative/path/verify-report.json",
    "b": "/abs/or/relative/path/verify-report.json",
    "human_prefers": "a" }
  ```
  `human_prefers` is `"a"`, `"b"`, or `"tie"`. Paths are absolute, or relative to the
  label file.

- **Absolute anchors:**
  ```json
  { "report": "/path/verify-report.json", "human": "ship" }
  ```
  `human` is `"ship"` or `"do-not-ship"`. Absolutes are turned into derived pairwise
  comparisons across DIFFERING labels (a `ship` build ranks over a `do-not-ship` one), so
  a set of all-`do-not-ship` anchors (today's seed) yields zero comparisons by design -
  add at least one `ship` anchor, or pairwise rows, to produce any.

Add a free-text `comment` to any row to record the reasoning. Mark a row `"todo": true`
to have the script ignore it (the seed file ships three TODO pairwise placeholders).

## What graduates the spike

The same bar the library reached: **held-out concordance meaningfully above the 0.5
chance baseline, at or above the 0.7 gate, on enough decisive comparisons to trust it**
(the library cleared 0.716 on 67 decisive). Practically: aim for at least ~10 decisive
comparisons before the held-out number is worth reading at all, more before flipping any
real gate on it. When that holds, the build-verifier scoring can be trusted the way the
library's C1 rubric is, and this spike can graduate into a real gate (wired into the done
gate alongside the deterministic floors).

## Caveat (read this)

The seed set is THREE same-label anchors. With no `ship` label and no pairwise rows it
produces **zero comparisons**, so the script correctly exits `2` ("not enough labels
yet") - that is the intended behaviour on the thin seed, not a failure. The 0.716 figure
is the LIBRARY's result on Jake's 101 comparisons; this build-side gate has produced **no
result yet** and will not until Jake labels a real comparison set. This file and the
script are the plumbing; the number is future work.
