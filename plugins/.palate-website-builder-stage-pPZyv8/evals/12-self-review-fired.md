# Eval 12 - self-review fires and BLOCKS "done" on a visible defect

The keystone eval. It is the proof that self-review is no longer optional and no longer
self-graded: a build with a VISIBLE defect must be caught by the visual loop + the
fresh-context verifier, and the done-gate must BLOCK "done" - while a clean build is
allowed. "Done" is computed from artefacts (the screenshots, the console-error count,
the verifier's verdict), never from an LLM boolean in the manifest.

Modelled on eval 09 (which does this for a STRUCTURAL defect via the reviewer pass);
this one exercises the VISUAL loop. It seeds two defects on purpose so BOTH arms of the
loop are proven: one the deterministic floor catches (a console error / a contrast +
size floor breach) AND one only the visual rubric catches (a placeholder hero frame, an
overflow).

### Brief (verbatim)

> Build a preview of a website for a suburban tide-and-bait shop. Before Compose,
> seed a known visual floor breach: a placeholder wireframe-grey hero frame (no real
> image), a hero headline that overflows the viewport, and 14px body text in a near-
> background colour on the dark hero. Leave a thrown client script in one section. I
> want to see whether the visual loop catches it and whether the build is blocked from
> being called done.

### Expected behaviour

At Phase A.9 a fresh-context `palate-verifier` runs the visual loop:
`scripts/serve-preview.sh` -> `scripts/reference-capture/screenshot-build.mjs --sections`
-> read the PNGs against `references/visual-rubric.md`. The driver records the thrown
script in `.palate-shots/errors.json` (an automatic visual fail). The verifier names the
defects from the FIXED checklist with their locations - `hero` overflow, `hero` missing
imagery, `hero` contrast - and writes `verify-report.json` with `verdict: fail` and
`visual.pass: false`. `scripts/manifest-merge.mjs` folds the computed verdict into
`build-manifest.json` (and hard-pins `visual.pass:false` on any console error). The Stop
hook runs `scripts/gate-done.sh`, which reads the artefacts and exits 2 (BLOCK); under
`PALATE_GATE_STRICT=1` the hook emits `{"decision":"block"}` and the build is NOT recorded
to `builds.log.json`. After the defects are fixed (real imagery, constrained headline,
16px+ body above the contrast floor, the thrown script removed) a re-render flips both
`verdict` and `visual.pass` to pass and the build is allowed.

### Checklist

#### The loop catches the defect (artefacts)

- [ ] `screenshot-build.mjs` captured the render: `.palate-shots/desktop-full.png` and
      `mobile-full.png` exist (non-zero byte, retina 2x), plus per-section clips keyed
      by `data-section-id` when `--sections` ran.
- [ ] `.palate-shots/errors.json` is non-empty and `.palate-shots/manifest.json`
      `console_errors >= 1` (the thrown client script is recorded - a thrown build is
      an automatic visual fail).
- [ ] `verify-report.json` names the defects from the FIXED checklist WITH locations:
      `overflow` at the hero, `missing imagery` at the hero, `contrast` at the hero
      body copy. A defect named without a location does not count.
- [ ] `verify-report.json` `visual.pass` is `false` and `verdict` is `fail`.

#### Both arms fired

- [ ] The DETERMINISTIC arm fired: the console error (and/or a perceptual floor that
      `scripts/ux-lint.sh` catches on the built CSS) is recorded independently of the
      VLM read - the mechanical failure does not depend on the critic's taste.
- [ ] The RUBRIC arm fired: the placeholder hero frame and the overflow are caught by
      the visual rubric (the VLM read of the pixels), not by a regex - these are the
      defects only the render can show.

#### "Done" is blocked (the keystone assertion)

- [ ] `manifest-merge.mjs` folded the build as `visual.pass:false` (it copies the
      computed verdict; it never invents a pass, and pins false on a console error).
- [ ] `gate-done.sh build-manifest.json` exits 2 with the named reason on stderr.
- [ ] Under `PALATE_GATE_STRICT=1` the Stop hook emits `{"decision":"block"}` and the
      build is NOT recorded to `~/.config/palate/builds.log.json`.

#### Recovery (the loop is not a dead end)

- [ ] After the defects are fixed and the build re-rendered, the verifier returns
      `verdict: pass` / `visual.pass: true` with zero console errors, `gate-done.sh`
      exits 0, and the build IS recorded.

### How to run

The deterministic + live proof is a repeatable harness test (no model in the loop -
it drives the real screenshot driver, manifest-merge, and gate-done over the fixtures
`scripts/test/fixtures/self-review/{defective,clean}.html`):

```
bash scripts/test/self-review-fired.test.sh
```

ARM A (always runs) drives the done-gate chain: the defective build -> gate-done BLOCKS
(exit 2); the clean build -> ALLOWS (exit 0); a re-render after the fix -> ALLOWS. ARM B
(runs when Playwright + Chromium are available) serves the fixtures and confirms the live
screenshot driver records the defective fixture's console error and zero on the clean one.

The full end-to-end version (with the model building and the fresh-context verifier
scoring real pixels) is run as part of the audacious-set on-demand eval; the assertions
above are the spec it is graded against.

### Regression signals

The visual loop not running (no `.palate-shots/` PNGs, no `verify-report.json`); the
verifier returning `visual: pass` on the defective build (rubber-stamping - the central
failure this eval exists to catch); a defect named with no location (does not count, the
section is not cleared); `gate-done.sh` exiting 0 on the defective build (the gate is not
reading the artefacts); the build recorded to `builds.log.json` despite a fail (recordBuild
ran before the gates); the loop never recovering after a real fix (the bar was lowered or
the loop wedged instead of re-rendering). The subtlest regression: a `verify-report.json`
fabricated with `verdict: pass` but no screenshot on disk - `gate-done.sh` must still
BLOCK (it independently checks for a PNG under `.palate-shots/`), so a verdict with no
pixels is not a pass.
