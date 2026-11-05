# Testing and verification

## The eval suite (run on every skill change AND every model upgrade)

The skill ships an eval pyramid. Run it whenever the skill changes, and again on every
model upgrade: a model swap shifts the VLM's taste and the sampling behaviour the
divergent spine (Move 1) and the visual loop (Move 3) depend on, so a suite that was
green on one model is not assumed green on the next.

**1. The deterministic gate tests (fast, no model in the loop) - the floor.** Run them
all; every one must be green:

```
for t in scripts/test/*.test.sh; do bash "$t"; done
```

These cover the gates the build leans on: `gate-mcp-depth` (the depth floor, fail-open
contract), `gate-uniqueness` (within-build distinctness), `gate-novelty` (the CONVERGE
concept pre-check + cross-build / type-face recurrence), `gate-done` (the visual +
verifier + novelty "done" gate, fail-open ladder), `ux-lint-eyebrow` (the kicker tell),
and `self-review-fired` (the keystone: a seeded visual defect BLOCKS "done", a clean
build is ALLOWED - `evals/12-self-review-fired.md`).

**2. The two-plane eval over a finished build.** `scripts/eval-runner.mjs` scores one
build on the PROCESS plane (did it draw on the library with depth, AND did DIVERGE
sample wide + CONVERGE score two axes) and the OUTPUT plane (uniqueness + slop + the
cross-build novelty gate):

```
node scripts/eval-runner.mjs --manifest <build>/build-manifest.json --variants <build>/*.html
```

**3. The golden + audacious sets (on-demand, one build per brief).** A full skill build
per brief is heavy, so these run out-of-band: build each brief once into
`<results>/<brief-id>/` (manifest + rendered variant HTML), then aggregate:

```
node scripts/eval-suite.mjs --briefs evals/golden-briefs.json    --results <results>
node scripts/eval-suite.mjs --briefs evals/audacious-briefs.json --results <results>
```

`evals/golden-briefs.json` over-represents the thin everyday verticals (the moat vs
generic slop); `evals/audacious-briefs.json` proves the other failure mode - that the
skill samples wide, advances from the low-typicality tail, decomposes ambition into
buildable mechanics, and still clears the visual loop + every gate
(`evals/11-novelty.md`). `eval-suite` reports a pass-rate and exits 0 only when every
PRESENT build passes (a not-yet-built brief is reported "missing", not failed; add
`--strict` to require every brief built for a CI gate). Run `>= 3` trials per brief and
end-state; every new failure becomes a new case.

## Per-phase verify scripts
Each phase has a verify-{phase}.sh that must pass before the phase is marked complete. See pipeline.md.

## Build-time checks (in CI)
- astro check (typecheck)
- npm run build (must succeed; a logic error here halts, never deploys broken)
- Lighthouse CI (baseline 100s for performance/SEO/best-practices/accessibility)

## Post-deploy smoke checks
- workers.dev returns 200
- robots.txt, sitemap, llms.txt return 200
- a test POST to /api/contact writes to Sanity formSubmission and returns ok

## The form round-trip test
The most important post-deploy check: submit the contact form with a test payload, confirm it (a) passes Turnstile, (b) writes to Sanity using the write token, (c) sends via Resend. If the write token is wrong, this 401s, which is exactly the failure the two-token heal prevents.
