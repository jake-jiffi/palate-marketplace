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

## WHAT THE LOG ACTUALLY CONTAINS (measured 2026-08-13)

The block above is the shape the writer CAN produce. It is not the shape a real
machine holds, and the difference is the whole reason the memory did nothing for
months. On the reference machine: **1,735 entries, of which 1,278 (73.7%) are
`{business:null, signature_move:null, donors:[], faces:[]}` shells.** Across all
of them, 35 carry a business, 37 a signature move, 14 an `explore` block, **2 any
`faces`**, and **zero any `struct` or `style`**. Of the 446 entries carrying
`donors`, the median list is 25 slugs and the longest is 103.

Four consequences, all of them silent until someone measured:

- **`donors` is not a taste signal.** The writer sets
  `donors: manifest.references_surveyed`, i.e. the whole survey, not the donors
  the build chose. Counting recurrence in it measures what the library returns
  first. `linear` appears in 88% of surveys and `gsap` in 87%, which is how the
  positive profile came to report both at "100% confidence" and push every build
  toward the same two.
- **The skin repeat check has never run.** It compares `struct`/`style`, which
  nothing writes.
- **The face tell is nearly unreachable**: it needs a face in three recent
  builds, and two entries in the whole log record a face at all.
- **A window of "the last 5 entries" lands in the empty tail**, so every
  comparison matched nothing and the gate still printed "clean".

The readers have been changed to survive this rather than to pretend: the
recency window is now the last N entries that CARRY the evidence a given
sub-check reads, and a sub-check with nothing to compare prints
`novelty gate COULD NOT CHECK: ... PASS BY ABSENCE OF DATA` on stderr instead of
reading as a pass. That is a workaround. **The real fix is at the writer**
(`hooks/build-log-entry.mjs` + `recordBuild` in `hooks/palate-stop.mjs`), which
should record, per entry: the `struct` and `style` signatures of the rendered
variants (`gate-novelty.mjs` already computes both, so the sub-check turns on the
day they appear); the CHOSEN donor slugs separately from `references_surveyed`;
and `faces` for every build rather than the two that have one. Until then a
build that repeats last week's skin ships unchallenged.

## How the Explore stage uses the log

At Phase A.4 (Explore) plan checkpoint, read the last 5 entries **that carry the
field each rule reads** (not the last 5 rows, see above). Apply two hard rules
when generating the variant set:

1. **No hero pattern repeated from the last 3 builds** that recorded one. If the
   most recent three logged Palate builds all used a "centred display +
   image-right" hero, the variant set for this build cannot include another
   centred display + image-right hero. Pick from the long tail. (Read each recent
   build's shipped hero from `explore.picks` and the matching
   `explore.shown[].hero_pattern`.) Note the older `explore.shown: ["v1","v2"]`
   id-only shape carries no hero pattern; those entries cannot answer this rule.
2. **No identical macrostructure from any of the last 5 builds.** The full
   section sequence cannot repeat verbatim. **This rule is currently INERT and
   you should not report it as satisfied**: nothing writes a macrostructure to
   the log, and no reader can reconstruct one from what is there. It becomes live
   when the writer records the section sequence (or the `struct` signature, which
   is a usable proxy `gate-novelty.mjs` already computes).

Soft signal: if the dominant token treatment (scale + density + accent
posture) matches a recent build's fingerprint, flag it in the variant
write-up so the picker is aware.

If the log file does not exist (first build on a machine), or fewer than three
entries carry the field a rule needs, that rule is inert and Explore proceeds
normally. Say which rules were inert; do not report an unreachable check as
passed.

## The positive taste profile (bias, not pin)

The rules above are NEGATIVE (avoid the last few). The log ALSO carries a POSITIVE
signal: which signature moves, faces and hero patterns the operator has kept, from
the shipped builds and the `explore` pick-rate (picks vs shown, the debiased
preference, W1). Compute it with `node scripts/taste-profile.mjs --variants N`;
inject the `summary` at A.2 DIVERGE and A.4 EXPLORE to **BIAS the variant set toward
the kept choices, never to PIN it**.

**Read `refused` before you read anything else.** The profile now declines rather
than guesses, because the first version returned a confident house style built on
almost nothing. When `refused` is true, `preferences` is empty by construction and
Explore proceeds NEUTRAL: do not synthesise a lean from the numbers in the report.

Five guardrails make this a bias and not a filter bubble (the differentiator Palate
sells dies if personalization collapses to a per-operator house style):

1. **Exploration budget / breadth floor.** `taste-profile.mjs` returns
   `diversityGuard.explorationBudget`: of N variants, at least that many MUST come from
   OUTSIDE the profile. Spend it deliberately on directions the operator has NOT kept.
2. **The negative memory is unchanged.** `gate-novelty.mjs` still hard-fails a build that
   repeats a recent skin or a recurring face. The positive profile only BIASES selection;
   it cannot override the diversity gate.
3. **A preference needs recurrence across DISTINCT BRIEFS.** Only a choice seen in
   `>= 3` different briefs (`PALATE_TASTE_MIN_SEEN`) becomes a preference. Rows are
   not briefs: the reference log holds the same Gelato Messina build nine times, and
   counting rows turned one client's signature move into a nine-build house style.
4. **The sample has a floor.** Below `PALATE_TASTE_MIN_BUILDS` (default 10) distinct
   briefs carrying a signature move, a face or an Explore choice set, the profile
   refuses outright and says how far short it is. Note the floor is measured on
   briefs that can contribute AFTER exclusions, not on log rows: 457 rows of the
   reference log are readable and only 37 of them can feed a preference.
5. **A value in nearly every build is dropped as uninformative.** Anything above
   `PALATE_TASTE_UNIVERSAL` (default 0.9 of briefs) is the constant, not the
   preference; biasing toward it can only remove variety.

**Surveyed donors are excluded from the profile entirely.** They are the survey,
not a choice (see the measurement section above), so a donor only appears when
Explore SHOWED it and the operator PICKED it. The report carries the reason in
`excluded.surveyedDonors` so nobody re-adds them.

**What could not be read is counted, not dropped.** `unreadable` reports the
id-only `explore.shown` entries, the shown variants with no hero pattern or donor
label, and the Explore runs with no picks recorded. A zero there means the reader
understood everything; a large number means the profile is thin because the WRITER
is thin, which is a different problem from the operator having no taste.

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
