# Phase 0: brand-as-code detection

The first real phase. Decides where the design system comes from.

## Detect
Run `scripts/detect-brand-repo.sh {slug}`. Three outcomes:

1. **EXISTS:{repo}:{version}**: the brand repo exists and is published. Run
   `scripts/verify-brand-exports.sh {slug} {version}`. If exports are complete,
   record packageName + exact version in state, set brand.mode="package", done.
   ALSO read `brand-record.json` from the brand repo (the approved motion-intensity
   band + voice + faces) so they are INHERITED, not re-derived each build; if the
   record is absent (an older package), derive those once and write the record (see
   "The per-client brand record" below).
   If exports are missing (older format), warn and offer: regenerate via the
   BUILD BRAND mode, or scaffold with --vendor-brand.

2. **MISSING + raw assets available**: offer to run the BUILD BRAND mode now,
   in-process and composed (see the SKILL.md "Mode: Build a brand package"). On
   yes, run it, wait for it to publish, then record the package + version. On
   no, fall through to vendoring.

3. **MISSING + no assets, or --skip-brand-repo**: use the inline brand pipeline
   (basic tokens from any provided colours/fonts, vendored into the site). Set
   brand.vendored=true.

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
inherit it). Write the record once the brand is approved (BUILD BRAND, or the first
captured-redesign build); read it at Phase 0 before re-deriving anything. The `voice`
block is the same one W7's commission voice spec consumes (`references/build-commission.md`).

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
