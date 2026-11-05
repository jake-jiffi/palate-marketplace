# Copy-verifier calibration (W8, measure-first)

The copy twin of the build-verifier calibration. `copy-verifier-calibration.mjs` reads
`copy-verifier-calibration-labels.json` (hero-line pairs + the copy verifier's 4-axis read +
Jake's preference) and reports **pairwise concordance** (the fraction of decisive human
comparisons the verifier orders the same way; chance 0.5; gate `PALATE_CVC_GATE`, default 0.7).

## How Jake adds labels
Add rows of the shape in the seed file, remove `"todo": true`. Each needs two hero lines, the
verifier's per-axis scores (specificity / voiceFit / momentum / restraint), and `human_prefers`.

## Status (read this)
The seed rows are ILLUSTRATIVE of the format, not founder labels, so the harness correctly exits
`2` ("not enough labels"). The only on-disk copy-quality signal (the W6 `marketingTellScore`) has
too little variance to be a meaningful ground truth on its own, so the real number awaits Jake's
copy labels - this file + the script are the plumbing, exactly like the build-side spike. W9 (the
copy verifier arm) produces the per-axis reads this harness scores.
