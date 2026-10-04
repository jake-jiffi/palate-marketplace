# Eval 11 - the divergent spine produces (and advances) novelty

Audacity-flagged. This eval proves the concept spine actually diverges and converges,
not that it ritually fills in a manifest block. It is driven by the audacious golden
set (`evals/audacious-briefs.json`) - briefs that name a feeling and a concrete moment
so the model cannot dodge into the category default. Run it on every skill change AND
every model upgrade (sampling behaviour and VLM taste shift between models, and Moves 1
and 3 depend on exactly that).

The deterministic backstops are `scripts/gate-novelty.mjs` (the CONVERGE concept
pre-check + the cross-build / type-face recurrence check) and `scripts/eval-runner.mjs`
(the `divergeRan` / `convergeScored` process checks + the `novelty` output check).

### Brief (verbatim)

> Build a preview of a website for a suburban tide-and-bait shop that makes a city
> office worker feel the pull of the coast at 6pm on a Friday; the daily catch, the
> rigs, where to find us.

(Or any entry in `evals/audacious-briefs.json` - run >=3 trials per brief, end-state.)

### Expected behaviour

At Phase A.2 (DIVERGE) the build samples a WIDE set of concepts in one pass - not one
spine - each self-tagging its `conventionality`, the `lens` it came from, and a forced
cross-domain `analogical_seed`. At Phase A.3 (CONVERGE) each candidate is scored on TWO
separate axes (originality and craft-feasibility, never one creativity number), the best
1-2 are advanced from the low-typicality tail, and `scripts/gate-novelty.mjs --manifest`
is run as a pre-check so a safe-only converge is caught. The 8-10 Explore variants then
elaborate the 1-2 advanced concepts across the ambition spectrum, and the rendered set
is neither near-duplicate within the build (uniqueness gate) nor a near-repeat of a
recent build / riding a recurring display face (novelty gate).

### Checklist

#### DIVERGE produced a low-typicality tail (manifest.diverge)

- [ ] `build-manifest.json` `diverge.ran` is `true` and `diverge.concepts` has
      `n >= 6` entries.
- [ ] Every concept carries a numeric `conventionality` (0..1), a `lens`, and an
      `analogical_seed`; the set spans `>= 2` distinct `lens` values.
- [ ] At least 2 concepts have `conventionality <= 0.3` (the surprising tail exists,
      not just safe-warm variations of the category default).
- [ ] At least one `analogical_seed` is a genuine cross-domain analogy (a tide chart,
      a flight tracker, a relay baton), not a restatement of the category.

#### CONVERGE scored two axes and advanced from the tail (manifest.converge)

- [ ] `converge.ran` is `true`; `converge.scored` has one entry per candidate, EACH
      with both `originality` and `craft_feasibility` (two separate numbers, not a
      single blended score presented as creativity).
- [ ] `converge.advanced` holds 1-2 concept ids, and at least one advanced id has a
      `conventionality` below the diverged set's median (it advanced from the tail, not
      only the safe anchor).
- [ ] `node scripts/gate-novelty.mjs --manifest build-manifest.json; echo $?` exits 0
      (the advanced set's mean conventionality is at or below
      `PALATE_MAX_CONVENTIONALITY`, default 0.6).

#### The build commission was issued and carried (manifest.commission)

Fail-open: a calm brief writes a calm commission and its absence never blocks a build,
so check it only on the audacious set (these briefs name an ambitious moment, so a
commission with a real bar + chosen mechanisms is expected). Descriptive-only - the
ambition bar's pass/fail is the verifier's, judged from the render, not a manifest
boolean.

- [ ] `commission.bar` states the Awwwards / FWA ambition target ("competent is a
      fail"); `commission.concept` and `commission.vision` are present and match the
      advanced concept (the commission was written FROM the converged concept, not a
      fresh spine).
- [ ] `commission.chosen_mechanisms` names a FEW mechanisms (not the whole toolkit
      register), each with a `recipe` (a `references/motion-and-3d.md` recipe) and a
      `precedent_slug` that appears in `references_surveyed` (chosen to FIT and grounded
      in a real precedent, not ticked off from memory).
- [ ] `commission.proof` records the contract (viewports 1440 + 390, read pixels +
      console, mobile-friendly, holds 60fps, honours reduced-motion), and the rendered
      variants visibly elaborate the commission's chosen mechanisms spread across the
      set (not the same mechanism in every variant).
- [ ] The verifier's `verify-report.json` `gates.commission` is `pass` (or `skip` only
      when the build could not be served / shot) - the build cleared the ambition bar +
      the restraint clause against the render, augmenting the 6 axes.

#### The signature move is sourced, and the build is novel (output)

- [ ] The signature move is sourced from a surveyed reference
      (`signature_move.source_slug` is present in `references_surveyed`), so originality
      is in the CONCEPT layer and craft is from the donor - the two-layer doctrine.
- [ ] `node scripts/gate-uniqueness.mjs <variant-1.html> ...` exits 0 (no
      near-duplicate pair within this build).
- [ ] `node scripts/gate-novelty.mjs --variants <variant-1.html> ...` exits 0 (the
      build is not a near-repeat of a recent build, and no display face recurs across
      the last N builds - the face is chosen fresh for this brand's voice).
- [ ] `node scripts/eval-runner.mjs --manifest build-manifest.json --variants ...`
      exits 0 with `process.checks.divergeRan`, `process.checks.convergeScored` and
      `output.novelty` all `true`.

### How to run

```
# Per brief, after one finished skill build into <results>/<brief-id>/:
node scripts/eval-runner.mjs \
  --manifest <results>/tide-bait-shop/build-manifest.json \
  --variants <results>/tide-bait-shop/*.html

# The whole audacious set in one command (one folder per brief id):
node scripts/eval-suite.mjs --briefs evals/audacious-briefs.json --results <results>
```

Repeatable, deterministic-gate level (no model in the loop): the novelty gate itself
is covered by `scripts/test/gate-novelty.test.sh` - distinct -> pass, safe-only converge
-> block, type-face recurrence -> block, nothing-to-compare -> skip.

### Regression signals

DIVERGE recording exactly one concept (it did not diverge, it narrated the spine);
every concept at `conventionality >= 0.6` (the tail was never sampled - the model
collapsed to the mode); CONVERGE scoring one number instead of two axes (originality
and craft-feasibility conflated); `converge.advanced` holding only the highest-
conventionality safe anchor (it threw away the tail DIVERGE produced - `gate-novelty`
must block this); the signature move not sourced from a surveyed reference (originality
faked, craft un-grounded); the same display face recurring build-to-build across
unrelated briefs (the no-opinion default tell - `gate-novelty` must block it); two
variants that share hero pattern AND skin (uniqueness must block). A diverge/converge
block present but with no effect on the variants (the spine ran on paper, the build
ignored it) is the subtlest regression: the variants must visibly elaborate the
advanced concepts, not the discarded safe anchor. A commission that lists the whole
toolkit register rather than a few mechanisms chosen to fit (familiarity over fit, the
exact failure the doctrine guards against), names mechanisms with no precedent in
`references_surveyed` (claimed but un-grounded), or is recorded but never realised in
the render (the verifier's `gates.commission` should catch this) is the commission
analogue of the spine-on-paper regression.
