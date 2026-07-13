# The build manifest (`build-manifest.json`)

The machine-readable record of what a build actually did, written to the project
root during a build by the PostToolUse hook (`hooks/palate-manifest.mjs`). It is
populated from real tool **telemetry**, not the agent's narration, so the gates
that read it cannot be talked around. Every enforcement gate hangs off this file.

## Schema

```jsonc
{
  "schema": 3,
  "created_at": "ISO-8601",
  "business": "free-text brief (optional; the agent may set it)",
  "signature_move": { "name": "...", "source_slug": "..." },  // optional, agent-set
  "mcp_calls": [
    { "tool": "mcp__palate__refs_search", "args": { ... }, "slugs": ["..."], "ts": "..." }
  ],
  "references_surveyed": ["slug", "..."],        // unique slugs seen across all calls
  "inner_pages_viewed": [{ "slug": "...", "page": "pricing" }],
  "layers_read": ["signature_moves", "do_dont", "..."], // R2: rich refs_get layers pulled
  "files_written": ["src/pages/index.astro", "..."],
  "sections": [],                                 // optional, agent-set: section -> donor provenance

  // --- schema 3 evidence blocks (the divergent spine + visual loop) ---
  // The agent may set the DESCRIPTIVE fields it genuinely knows; every pass/fail
  // verdict is computed by a script from a real artefact and folded in by
  // scripts/manifest-merge.mjs. The hook NEVER sets a pass/fail.
  "diverge": null,      // MODE-AWARE: { ran, n, mode, axes_varied:[...], locked:{...}, concepts:[{ id, mechanic, lens, analogical_seed, conventionality:0..1, colourway, type, layout, motion, density, art_direction }] }
  "converge": null,     // { ran, scored:[{ id, originality:0..5, craft_feasibility:0..5, combined:0..5 }], advanced:[id,...] }
  "commission": null,   // A.3.5: { bar, intensity:"high"|"calm", concept, vision, chosen_mechanisms:[{ name, recipe, precedent_slug, astro_recipe_pulled, fit_reason }], proof:{ viewports, read_pixels, read_console, mobile_friendly, holds_60fps, honours_reduced_motion }, restraint_note, explore_skip?:bool } - agent-set descriptive only; intensity arms the v1.5 bold bar in scripts/gate-done.sh (high -> pairwise + ambition + built-Explore enforced); explore_skip records a named-direction Explore exemption
  "variants": [],       // [{ id, route, name, concept_id, donor_slugs:[], html_path }]
  "explore": null,      // W1 labels: { ran, shown:[{ id, name, donor_slug, hero_pattern, position }], picks:[{ surface, variant_id }], edits:[{ surface, variant_id, note }] } - persisted to builds.log.json by palate-stop.mjs
  "architecture": null, // W16: { ran, pages:[{ route, pageType, purpose, donor_slug }], nav, journey, rationale } - the page inventory, read by the verifier's cross-page check (8.5)
  "visual": null,       // SCRIPT-set: { ran, pass, iterations:[{ i, shots:{...}, axes:{...}, defects:[{type,location}], score }], console_errors:int }
  "novelty": null,      // SCRIPT-set: { ran, pass, closest_pair, struct, style, category_distance, recent_build_distance }
  "verifier": null,     // SCRIPT-set: { ran, pass, verdict, report_path }
  "buildability": null  // { ran, mechanics:[{ name, precedent_slug, astro_recipe_pulled:bool, feasible:bool, fallback }] }
}
```

- **`mcp_calls`**, **`references_surveyed`**, **`inner_pages_viewed`**, **`layers_read`**,
  **`files_written`** are written automatically by the hook (telemetry). The hook reads
  the tool result (`tool_response`) and harvests every `slug` it returned, including
  slugs inside stringified-JSON MCP text blocks.
- **`business`**, **`signature_move`**, **`sections`** are optional and may be set by
  the agent/surveyor to record intent; the depth gate cross-checks them against the
  telemetry (e.g. a declared signature move's `source_slug` must appear in
  `references_surveyed`).
- **The schema-3 evidence blocks** record the divergent-then-convergent concept spine
  (`diverge`, `converge`), the **build commission** (`commission`, the ambition bar +
  the chosen toolkit made explicit at A.3.5 - `references/build-commission.md`), the
  Explore variants and their donors (`variants`), the buildability oracle
  (`buildability`), and the COMPUTED verdicts of the visual loop, the novelty check and
  the verifier (`visual`, `novelty`, `verifier`). The agent sets the descriptive parts
  (concepts, scores, donor slugs, the commission's bar / concept / vision / chosen
  mechanisms / proof requirements); the `pass`/`fail` inside `visual`/`novelty`/`verifier`
  is set ONLY by a script reading a real artefact (screenshots, rendered HTML, a gate's
  exit code), never by an LLM boolean. The commission's ambition bar is likewise judged
  by the verifier from the render, not self-claimed in the manifest. This is the
  anti-reward-hacking rule: "done" is machine-checkable, not self-claimed.
- A schema-1/2 manifest is upgraded in place on the next hook write: the new blocks
  (including `commission`) are added (null / empty) without touching any existing field,
  and `schema` becomes 3. `commission` is additive within schema 3: a schema-3 manifest
  written before it existed gets `commission: null` backfilled on the next hook write,
  no schema bump.
- Note: the manifest `sections` field is the section -> donor provenance map (which
  donor each section came from). It is UNRELATED to the `refs_get` `layer` arg, which
  is the renamed retrieval selector (concept / pages / tokens / signature_moves / ...).

## The `diverge` block is mode-aware

The build's BRAND MODE is set at state-init (`.palate-skill-state.json` `brandMode`) from
the Phase 0 outcome: **brand-creation** when no brand was provided (no package, no real
tokens / assets, no stated colours+fonts, so the skill is inventing the identity), or
**brand-provided** when a brand package resolved, real tokens / assets were extracted, or
the brief stated colours+fonts. A partial brand (colour only, or a logo only) is
brand-provided: the provided half is LOCKED and the missing half is chosen to fit it.

The agent sets these DESCRIPTIVE fields on `diverge` (the hook never does); the two gates
read `brandMode` from the marker and judge validity accordingly:

```jsonc
"diverge": {
  "ran": true,
  "n": 8,
  "mode": "brand-creation" | "brand-provided",   // MUST equal the marker's brandMode
  "axes_varied": ["colourway","type","mood","layout","motion"], // the axes this set varied
  "locked": { "colour": false, "type": false }
          // brand-provided: { "colour": true, "type": true, "palette_source": "@palate/brand@2.1.0", "faces": ["soehne","tiempos"] }
  "concepts": [
    { "id":"c1", "mechanic":"...", "lens":"...", "analogical_seed":"...", "conventionality":0.1,
      "layout":"split-canvas, left rail", "motion":"scroll-rise tide", "density":"airy", "art_direction":"documentary photo",
      "colourway":"ink + bone + signal-red",  // brand-creation only; CONSTANT (locked) in brand-provided
      "type":"grotesk display + serif body" } // brand-creation only; CONSTANT (locked) in brand-provided
  ]
}
```

The mode-aware validity rule (enforced byte-identically by `hooks/palate-pretooluse.mjs`
at write-time and `scripts/gate-novelty.mjs --require-diverge` at done-time):

- **Both modes**: `>= 8` concepts, each with a `conventionality` self-tag and a creative
  axis tag; a conventionality spread (`max - min >= 0.4`); a low-typicality tail
  (`>= 1` concept at `<= 0.3`); and `converge.advanced >= 1`. `diverge.mode` must equal
  the marker's `brandMode` (anti-tamper: you cannot record one mode to dodge the other's
  bar).
- **brand-creation**: the FULL identity space must vary. `colour` AND `type` must be in
  `axes_varied`, and the concepts must show `>= 3` distinct `colourway` values AND `>= 3`
  distinct `type` directions, plus distinct `lens|analogical_seed` signatures (`>= 6`). So
  the single-default-style failure (one colourway + one type pairing across all 8) cannot
  be recorded as valid.
- **brand-provided**: `colour` + `type` are LOCKED. They MUST NOT appear in `axes_varied`;
  `locked.colour` and `locked.type` must be `true`; and `colourway` / `type` must be
  constant across concepts (`<= 1` distinct each). Distinctness is judged on the allowed
  within-brand axes (`layout`, `composition`, `section_logic`, `motion`, `density`,
  `art_direction`): `>= 2` of them declared in `axes_varied` and `>= 6` distinct skins.
  The brand colour and fonts are never varied away from the brand.

Thresholds are env-tunable (`PALATE_MIN_DIVERGE`, `PALATE_MIN_DISTINCT_SIGS`,
`PALATE_MIN_CONV_SPREAD`, `PALATE_LOW_TAIL_MAX`, `PALATE_MIN_AXIS_DISTINCT`). The escape
hatch for a non-standard need is `PALATE_GATE_OFF=1`; the wall only fires inside an active
build site (a `.palate-skill-state.json` marker), so non-build sessions are never trapped.

## What reads it

`scripts/gate-mcp-depth.sh` (the portable gate) asserts the build surveyed enough
references, read some deeply (`refs_get`), viewed enough inner pages, and used a
spread of tools. The Pre/Stop hooks call that gate. Thresholds are overridable via
`PALATE_MIN_REFS` / `PALATE_MIN_INNER` / `PALATE_MIN_TOOLS`.
