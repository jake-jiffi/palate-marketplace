# Phase 0: brand-as-code detection

The first real phase. Decides where the design system comes from.

## Detect
Run `scripts/detect-brand-repo.sh {slug}`. Three outcomes:

1. **EXISTS:{repo}:{version}**: the brand repo exists and is published. Run
   `scripts/verify-brand-exports.sh {slug} {version}`. It answers four ways:
   - `OK`: colours and type both published. Record packageName + exact version in
     state, set brand.mode="package", done.
   - `OK:PARTIAL:type-free`: the token core is there but there is no `fonts.css`,
     i.e. the client gave colours and no type. This is a REAL brand, not a broken
     one. Record it the same way, and write `"locked": { "colour": true, "type":
     false }` into the brand record so the build knows to lock the palette and
     choose the face to fit. (It used to be reported as MISSING_EXPORTS, which sent
     a perfectly good partial brand down the "regenerate or vendor" path.)
   - `MISSING_EXPORTS:{list}` (exit 1): a required export (`tokens.css`,
     `tailwind.preset`, `components/*`) is genuinely absent, i.e. an older format.
     Warn and offer: regenerate via the BUILD BRAND mode, or scaffold with
     `--vendor-brand`.
   - `CANNOT_VERIFY:{reason}` (exit 2): the registry could not be asked (auth or
     network). This is NOT a missing-exports result and must not be treated as one.
     Fix the auth, do not regenerate the brand.

   ALSO read `brand-record.json` from the brand repo (the approved motion-intensity
   band + voice + faces) so they are INHERITED, not re-derived each build; if the
   record is absent (an older package), derive those once and write the record (see
   "The per-client brand record" below).

2. **MISSING + raw assets available**: offer to run the BUILD BRAND mode now,
   in-process and composed (see the SKILL.md "Mode: Build a brand package"). On
   yes, run it, wait for it to publish, then record the package + version. On
   no, fall through to vendoring.

3. **MISSING + no assets, or --skip-brand-repo**: use the inline brand pipeline
   (basic tokens from any provided colours/fonts, vendored into the site). Set the
   marker, and set it for real:

   ```
   scripts/state-update.sh set '.brand.vendored' 'true'
   ```

   This is not bookkeeping. `verify-is-real-astro.sh` asserts the FIELD (it used to
   grep for the word "vendored" anywhere in the state file, which matched the
   `"vendored": false` that state-init.sh writes into every build, so the check
   passed on builds with no brand at all). Leave it false on a vendored build and
   the anti-freestyle gate will stop you, which is the point.

## The per-client brand record (retrieve, do not re-derive)

A returning client's brand should be inherited, not re-detected. The published
`{slug}-brand` package already carries the tokens, but the approved MOTION-INTENSITY
BAND and VOICE used to be re-derived every build, and the redesign/captured path
re-extracted from the live site every build. The record fixes both. It lives at
`brand-record.json` in the brand repo (per-client, per-tenant, never pooled; for a
`vendored` brand with no brand repo it lives alongside `.palate-skill-state.json` in the
project root):

```json
{
  "slug": "lighthouse-optometry", "version": 1,
  "tokens": { "package": "@palate-projects/lighthouse-optometry-brand", "version": "2.0.0" },
  "approvedType": { "display": "Simula", "body": "Satoshi" },
  "motionBand": "calm",
  "voice": { "summary": "warm, plain-spoken, reassuring", "say": ["book an eye test"], "doNotSay": ["leverage"] }
}
```

(For a vendored brand use `"tokens": { "vendored": true }`.) Validate a record with
`node scripts/verify-brand-record.mjs <record.json>` (exit 0 = a returning build can
inherit it). It prints `DIVERGE_FREE_AXES=<csv|none>`, which is the line that decides
which axes the mandatory DIVERGE step may vary. Write the record once the brand is
approved (BUILD BRAND, or the first captured-redesign build); read it at Phase 0 before
re-deriving anything. The `voice` block is the same one W7's commission voice spec
consumes (`references/build-commission.md`).

### Partial brands: colours locked, type free

Doctrine (SKILL.md Phase 0) says a partial brand counts as brand-provided: LOCK the
provided half, choose the missing half to fit. The record can now say which half, via an
optional `locked` block. Absent means both halves are locked, so every record written
before this field keeps its old meaning.

```json
{
  "slug": "acme",
  "tokens": { "package": "@palate-projects/acme-brand", "version": "1.0.0" },
  "locked": { "colour": true, "type": false },
  "motionBand": "calm",
  "voice": { "summary": "plain, direct" }
}
```

Rules the validator enforces, because a record that contradicts itself is worse than one
that is merely incomplete:
- `locked.type: false` REQUIRES `approvedType` to be absent. A record that says type is
  free and also names an approved face cannot be acted on. Before this existed, the only
  way to store a colours-only brand was to invent a face and write it down as "approved",
  which is a lie the next build inherits AND silently removes type from the axes DIVERGE
  may vary.
- `locked.type: true` still requires `approvedType`, unchanged.
- Locking nothing is rejected: that is brand-creation, not a brand record.
- An unknown axis name is rejected rather than ignored into "everything locked".

## Extracting the brand from an existing site (do this for the FIRST redesign only)

FIRST check for an existing `brand-record.json` for this slug: if present, READ it and
SKIP the extraction (the approved brand is already captured, the second build inherits
it). Only extract when there is no record yet. When the client already has a website -
a redesign, a Webflow/Wix migration - do NOT guess the colours and fonts. Extract the
real ones with the capture engine that powers the reference library:

```
scripts/reference-capture/setup.sh        # once
scripts/capture-reference-site.sh <slug> <current-url> /tmp/brand-extract "" desktop
```

The capture writes `/tmp/brand-extract/_capture/tokens.raw.json` (exact hex
colours by usage frequency, the type scale, radii, shadows) and
`typography.raw.json` (font families, weights, @font-face sources). Seed the
brand's colour palette and type from those real values, then modernise - the
client's actual brand, not an approximation. Same headless engine as
`references/reference-library`; no browser extension needed. Once extracted,
modernised and approved, WRITE `brand-record.json` (tokens + approvedType +
motionBand + voice) so the NEXT build for this client inherits it and never
re-extracts.

If the site is unreachable from the sandbox, capture it via the Claude-in-Chrome
browser tools instead, or read its CSS directly - but always work from the real
values, never a guess. (Real use failure mode: the skill could not reach a
client's Wix site and guessed the brand colour; the owner then asked for it to
be corrected. Extracting it up front avoids that entirely.)

## Version pinning
Always pin the EXACT version detected (e.g. "2.0.0"), never a range. Record it
in state.brand.packageVersion. The site's package.json gets this exact string.

## Cross-skill resume handshake
If the in-process BUILD BRAND step gets interrupted: its state lives in
`.palate-brand-state.json` in the brand repo. Record the brand repo path in this
skill's state. On resume, if phase brandAsCode is in_progress, cd to the brand
repo, run `brand-state-resume.sh`, finish the brand build, then return and
continue to Phase A.

## The --vendor-brand path
Copies the brand repo's tokens/, fonts/, components/, styles/ into the site
under src/brand/ and adds scripts/sync-brand.sh for manual re-pull. No npm
dependency. Use when the package path is troublesome or a client wants no
indirection.
