#!/usr/bin/env node
/**
 * taste-profile.mjs - W5 (gap6 item 2). Promote the build log from a negative-only
 * diversification list into a POSITIVE, confidence-weighted preference profile, injected
 * at Diverge/Explore to BIAS (not pin) variant selection, WITH a diversity guard.
 *
 * It reads ~/.config/palate/builds.log.json (the same machine-wide log the W1 explore
 * labels write to). Two signals:
 *   - shipped recurrence: the signature_move / donors / faces that recur across shipped
 *     builds are kept choices (confidence grows with the count).
 *   - explore pick-rate (propensity-aware, W1): of the variants SHOWN in Explore, which
 *     hero_pattern / donor were actually PICKED. picks/shown is the debiased preference
 *     (a thing shown often but rarely picked is NOT a preference).
 *
 * The output is advisory and biasing, never pinning: it carries an explicit EXPLORATION
 * BUDGET (a breadth floor of variants that must come from OUTSIDE the profile) so a
 * per-operator house style can never crowd out the diversity Palate sells. Pair it with
 * the UNCHANGED negative memory (gate-novelty.mjs) - that stays the hard diversity guard.
 *
 * Usage: node scripts/taste-profile.mjs [builds.log.json] [--variants N]
 * Prints the profile JSON. Exit 0 always (advisory; absence of a log = empty profile).
 * No deps. ES module.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// A preference is reported only once it has been seen at least this many times, so a
// single build never hardens into a "house style".
const MIN_SEEN = Number(process.env.PALATE_TASTE_MIN_SEEN ?? 3);
// The breadth floor: this fraction of the variant set must come from OUTSIDE the profile.
const EXPLORE_FRACTION = Number(process.env.PALATE_TASTE_EXPLORE_FRACTION ?? 0.3);

function loadLog(p) {
  const file = p || path.join(os.homedir(), ".config", "palate", "builds.log.json");
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** Tally a value into a {seen,kept} map. */
function bump(map, key, kept) {
  if (!key) return;
  const e = map.get(key) || { seen: 0, kept: 0 };
  e.seen += 1;
  if (kept) e.kept += 1;
  map.set(key, e);
}

export function buildTasteProfile(entries, variantCount = 8) {
  const dims = { signatureMove: new Map(), donor: new Map(), face: new Map(), heroPattern: new Map() };

  for (const b of entries) {
    // shipped recurrence: a shipped build's attributes are kept by construction.
    bump(dims.signatureMove, b.signature_move, true);
    for (const d of Array.isArray(b.donors) ? b.donors : []) bump(dims.donor, d, true);
    for (const f of Array.isArray(b.faces) ? b.faces : []) bump(dims.face, f, true);

    // explore pick-rate (W1 labels): hero_pattern + donor SHOWN vs PICKED.
    const ex = b.explore;
    if (ex && Array.isArray(ex.shown)) {
      const pickedIds = new Set((Array.isArray(ex.picks) ? ex.picks : []).map((p) => p.variant_id));
      for (const s of ex.shown) {
        const kept = pickedIds.has(s.id);
        bump(dims.heroPattern, s.hero_pattern, kept);
        // a donor shown-and-picked is a stronger signal than shipped recurrence alone
        if (s.donor_slug) bump(dims.donor, s.donor_slug, kept);
      }
    }
  }

  const toPrefs = (map) =>
    [...map.entries()]
      .filter(([, e]) => e.seen >= MIN_SEEN)
      .map(([value, e]) => ({ value, seen: e.seen, kept: e.kept, confidence: round2(e.kept / e.seen) }))
      .filter((p) => p.confidence >= 0.5) // only POSITIVE preferences (kept more than half the time)
      .sort((a, b) => b.confidence - a.confidence || b.seen - a.seen);

  const preferences = {
    signatureMove: toPrefs(dims.signatureMove),
    donor: toPrefs(dims.donor),
    face: toPrefs(dims.face),
    heroPattern: toPrefs(dims.heroPattern),
  };

  const top = (arr) => arr.slice(0, 2).map((p) => `${p.value} (${Math.round(p.confidence * 100)}%, n=${p.seen})`);
  const lines = [];
  if (preferences.signatureMove.length) lines.push(`leans to signature moves: ${top(preferences.signatureMove).join(", ")}`);
  if (preferences.heroPattern.length) lines.push(`leans to hero patterns: ${top(preferences.heroPattern).join(", ")}`);
  if (preferences.donor.length) lines.push(`returns to donors: ${top(preferences.donor).join(", ")}`);
  if (preferences.face.length) lines.push(`returns to faces: ${top(preferences.face).join(", ")}`);

  // The diversity guard: at least ceil(variantCount * EXPLORE_FRACTION) variants must be
  // chosen from OUTSIDE these preferences (a breadth floor), and the profile BIASES the
  // rest, never pins it. With too little data the whole thing is inert.
  const explorationBudget = Math.max(2, Math.ceil(variantCount * EXPLORE_FRACTION));
  const hasSignal = lines.length > 0;

  return {
    builds: entries.length,
    hasSignal,
    preferences,
    summary: hasSignal
      ? `The operator ${lines.join("; ")}. BIAS toward these, do not pin.`
      : `Not enough history for a taste profile (need >= ${MIN_SEEN} recurrences). Explore proceeds neutral.`,
    diversityGuard: {
      explorationBudget,
      rule: `of ${variantCount} variants, >= ${explorationBudget} MUST come from OUTSIDE the profile (the breadth floor); the negative memory (gate-novelty.mjs) is unchanged and still the hard guard.`,
    },
  };
}

function round2(x) { return Math.round(x * 100) / 100; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const vi = args.indexOf("--variants");
  const variantCount = vi >= 0 ? Number(args[vi + 1]) : 8;
  const logArg = args.find((a) => !a.startsWith("--") && a !== String(variantCount));
  const profile = buildTasteProfile(loadLog(logArg), variantCount);
  console.log(JSON.stringify(profile, null, 2));
  process.exit(0);
}
