# Build memory - cross-build diversification

A single per-Palate log of every build, so the Explore stage actively
diversifies the variant set away from what was shipped recently. Stops the
slow drift toward a "Palate house structure" that would emerge if every
project's variants were generated from the same blank slate.

## Where the log lives

Outside the skill, at:

```
~/.config/palate/builds.log.json
```

Same convention the skill already uses for the GitHub token (the directory is
gitignored by being outside the repo entirely). The skill does not ship this
file - it is created on the first build that runs on a machine.

## What gets logged

One entry per build, appended automatically by the Stop hook
(`hooks/palate-stop.mjs`) once the build passes its gates, not by the agent. The
entry shape is defined in `hooks/build-log-entry.mjs`:

```json
{
  "ts": "2026-06-27T10:00:00.000Z",
  "business": "lighthouse-optometry",
  "signature_move": "carried-timeline",
  "donors": ["aesop", "leoleo"],
  "faces": ["fraunces", "satoshi"],
  "explore": {
    "ran": true,
    "shown": [
      { "id": "v1", "name": "Deep Trawl", "donor_slug": "aesop", "hero_pattern": "centred-display", "position": 1 },
      { "id": "v3", "name": "Low Tide", "donor_slug": "the-modern-house", "hero_pattern": "full-bleed", "position": 3 }
    ],
    "picks": [{ "surface": "hero", "variant_id": "v3" }, { "surface": "cta", "variant_id": "v1" }],
    "edits": [{ "surface": "hero", "variant_id": "v3", "note": "shortened headline" }]
  }
}
```

`donors` and `faces` are the cross-build DIVERSIFICATION signals
`scripts/gate-novelty.mjs` reads (donor overlap; the type-face recurrence
smell). `explore` is the W1 taste-flywheel capture: every variant SHOWN in
Explore (not just the pick), the accept (`picks`) and edit signal, and the
surface context (`position`) that propensity correction needs, because the
surfaced set is biased by what was shown. The per-surface REJECT is the
`shown`-minus-`picks` complement, derived when the labels are read, not stored.
`explore` is omitted on a calm / edit build that did not run Explore. These
labels are the proprietary signal that later feeds the calibrated taste judge;
no model is trained here yet.

(Earlier drafts of this doc described per-entry `macrostructure` / `hero_pattern`
/ `explore_picks` top-level fields. Those were never written by the hook. The
hero-pattern signal now lives inside `explore.shown[].hero_pattern`, the shipped
hero is the picked variant's, and the deterministic cross-build skin check is
`gate-novelty.mjs`.)

## How the Explore stage uses the log

At Phase A.4 (Explore) plan checkpoint, read the last 5 entries. Apply two
hard rules when generating the variant set:

1. **No hero pattern repeated from the last 3 builds.** If the most recent
   three Palate builds all used a "centred display + image-right" hero, the
   variant set for this build cannot include another centred display + image
   right hero. Pick from the long tail. (Read each recent build's shipped hero
   from `explore.picks` and the matching `explore.shown[].hero_pattern`.)
2. **No identical macrostructure from any of the last 5 builds.** The
   full section sequence cannot repeat verbatim.

Soft signal: if the dominant token treatment (scale + density + accent
posture) matches a recent build's fingerprint, flag it in the variant
write-up so the picker is aware.

If the log file does not exist (first build on a machine) or has fewer than
three entries, the rules are inert and Explore proceeds normally.

## The positive taste profile (bias, not pin)

The rules above are NEGATIVE (avoid the last few). The log ALSO carries a POSITIVE
signal: which donors, signature moves, faces and hero patterns the operator has
kept, from the shipped builds and the `explore` pick-rate (picks vs shown, the
debiased preference, W1). Compute it with `node scripts/taste-profile.mjs --variants N`;
inject the `summary` at A.2 DIVERGE and A.4 EXPLORE to **BIAS the variant set toward
the kept choices, never to PIN it**.

Three guardrails make this a bias and not a filter bubble (the differentiator Palate
sells dies if personalization collapses to a per-operator house style):

1. **Exploration budget / breadth floor.** `taste-profile.mjs` returns
   `diversityGuard.explorationBudget`: of N variants, at least that many MUST come from
   OUTSIDE the profile. Spend it deliberately on directions the operator has NOT kept.
2. **The negative memory is unchanged.** `gate-novelty.mjs` still hard-fails a build that
   repeats a recent skin or a recurring face. The positive profile only BIASES selection;
   it cannot override the diversity gate.
3. **A preference needs recurrence.** Only a choice kept across `>= 3` builds (and picked
   more than half the times it was shown) becomes a preference, so a single build never
   hardens into a house style.

Per-operator (the machine-wide log is one operator's history); per-tenant and never
pooled. The done-gate: a returning operator's builds trend to their kept choices AND the
cross-build diversity guardrail does NOT fall.

## Why it lives outside the skill

The diversification signal is Palate-wide, not per-project. A log inside any
single project would only track that project's own variants. The shared file
in `~/.config/palate/` is read and written by every build on the machine, so a
team running multiple builds in a week diversifies across all of them.

## Manual override

A brief that says "build it like {recent client}" deliberately overrides this
- the operator is asking for the same pattern, knowingly. Skip the memory
check when the brief names an explicit direction.

## Schema versioning

The first field is implicitly `"version": "1"`; bump the schema by adding a
`version` field at the top of new entries and updating this doc. The skill
should be backwards-compatible to v1 entries.
