#!/usr/bin/env node
/**
 * taste-profile.mjs - W5 (gap6 item 2). Promote the build log from a negative-only
 * diversification list into a POSITIVE preference profile, injected at Diverge/Explore to
 * BIAS (not pin) variant selection, WITH a diversity guard.
 *
 * It reads ~/.config/palate/builds.log.json (the same machine-wide log the W1 explore
 * labels write to).
 *
 * WHAT CHANGED AND WHY, because the first version reported a confident house style off
 * almost no data and pushed every build toward the same handful of donors. Measured on the
 * real log on 2026-08-13: 1,735 entries, of which 1,278 (73.7%) are attribute-less shells
 * (`{business:null, signature_move:null, donors:[], faces:[]}`), 35 carry a business, 37 a
 * signature move, 14 any explore block and 2 any faces. Three separate faults:
 *
 *   1. EVERY "confidence" WAS 1.0 BY CONSTRUCTION. Shipped recurrence called
 *      `bump(map, key, true)`, so kept always equalled seen and `kept/seen` could only ever
 *      be 1. It was a count wearing a rate's name, and it read as certainty.
 *   2. THE DONOR DIMENSION WAS NEVER A PREFERENCE. The writer stores
 *      `donors: m.references_surveyed`, which is the whole SURVEY list (median 25 slugs per
 *      build, max 103), not the donors the build chose. So "returns to donors: linear
 *      (100%, n=393)" only says linear is in 88% of surveys. Feeding that back as a taste
 *      preference is a loop that reinforces whatever the library returns first, and it is
 *      the mechanism behind the complaint that builds come out timid.
 *   3. IT NEVER ASKED HOW BIG THE SAMPLE WAS. A profile computed over 1,735 rows of which
 *      457 carry anything reported `builds: 1735` and a 100% confidence, which is the most
 *      misleading pair of numbers the file could have printed.
 *
 * So the profile now refuses rather than guesses. It counts USABLE entries (not rows),
 * declines to emit any preference below PALATE_TASTE_MIN_BUILDS usable builds and says so,
 * separates a real PICK-RATE (explore shown-vs-picked, the only debiased signal in the log)
 * from a bare PREVALENCE (a recurring shipped attribute, which carries no rejected
 * counterfactual), drops values that appear in nearly every build as uninformative, and
 * excludes the survey-list donors entirely with the reason attached. Anything it cannot
 * read - including the older `explore.shown: ["v1","v2"]` id-only shape that is in the real
 * log five times - is COUNTED and REPORTED, never silently matched against nothing.
 *
 * The output stays advisory and biasing, never pinning: it carries an explicit EXPLORATION
 * BUDGET (a breadth floor of variants that must come from OUTSIDE the profile) so a
 * per-operator house style can never crowd out the diversity Palate sells. Pair it with the
 * negative memory (gate-novelty.mjs) - that stays the hard diversity guard.
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
// The floor on the SAMPLE, not on the value. Below this many usable builds the profile
// refuses outright: three recurrences out of five usable builds is a coincidence, and a
// bias applied on that basis is noise dressed as taste.
const MIN_BUILDS = Number(process.env.PALATE_TASTE_MIN_BUILDS ?? 10);
// A value present in more than this share of usable builds is the CONSTANT, not the
// preference. Nothing that appears everywhere can discriminate between directions, so
// biasing toward it only removes variety.
const UNIVERSAL = Number(process.env.PALATE_TASTE_UNIVERSAL ?? 0.9);
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

/** Does this entry carry anything at all? Reported, but not the sample the floor uses. */
function isReadable(b) {
  if (!b || typeof b !== "object") return false;
  return Boolean(
    b.business ||
    b.signature_move ||
    (Array.isArray(b.donors) && b.donors.length) ||
    (Array.isArray(b.faces) && b.faces.length) ||
    (b.explore && typeof b.explore === "object"),
  );
}

/**
 * Does this entry carry a field the profile can actually turn into a preference?
 * The floor is measured on THIS, not on isReadable, because 446 of the log's 457 readable
 * rows carry only the surveyed-donor list, which is excluded (see excludedNote). Sizing the
 * sample on rows that cannot contribute is how the old version reported a confident profile
 * over "1,735 builds" while standing on 37 signature moves and 2 face records.
 */
function isProfileable(b) {
  if (!b || typeof b !== "object") return false;
  return Boolean(
    b.signature_move ||
    (Array.isArray(b.faces) && b.faces.length) ||
    (b.explore && typeof b.explore === "object" && Array.isArray(b.explore.shown) && b.explore.shown.length),
  );
}

/**
 * The unit of evidence is the BRIEF, not the log row. The real log contains the same
 * Gelato Messina build nine times (re-runs of one project, each appending an entry), and
 * counting rows turned that one client's signature move into a nine-build "preference" that
 * would then be nudged onto unrelated briefs. Nine re-runs of one brief are one
 * observation. Fall back to the timestamp when the entry records no business, so
 * unlabelled entries each count once rather than collapsing into a single group.
 *
 * The fallback is keyed on the entry's INDEX, never on a random value: the key is computed
 * for both the numerator and the denominator, so a nondeterministic fallback would count
 * one entry as two different briefs.
 */
function briefKey(b, i) {
  const v = b && b.business;
  if (typeof v === "string" && v.trim()) return "b:" + v.trim().toLowerCase();
  if (v && typeof v === "object" && typeof v.name === "string" && v.name.trim()) return "b:" + v.name.trim().toLowerCase();
  if (b && b.ts) return "t:" + String(b.ts);
  return "i:" + i;
}

/** Record that `key` occurred under this brief. */
function bumpSeen(map, key, brief) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return;
  const e = map.get(k) || { briefs: new Set(), shown: 0, picked: 0 };
  e.briefs.add(brief);
  map.set(k, e);
}

/** Record that `key` was SHOWN under this brief, and whether it was PICKED. */
function bumpShown(map, key, picked, brief) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return;
  const e = map.get(k) || { briefs: new Set(), shown: 0, picked: 0 };
  e.briefs.add(brief);
  e.shown += 1;
  if (picked) e.picked += 1;
  map.set(k, e);
}

export function buildTasteProfile(entries, variantCount = 8) {
  const all = Array.isArray(entries) ? entries : [];
  const readableRows = all.filter(isReadable).length;
  // Key each entry ONCE and carry the key, so the denominator below and the per-value
  // counts inside the loop are computed from the identical grouping.
  const usable = all.map((b, i) => ({ b, brief: briefKey(b, i) })).filter((x) => isProfileable(x.b));
  const usableRows = usable.length;
  const usableBuilds = new Set(usable.map((x) => x.brief)).size;

  // Two evidence kinds, deliberately never merged into one number.
  //   recurrence: an attribute of a SHIPPED build. There is no rejected counterfactual, so
  //     the only honest statistic is prevalence (how many builds out of the usable sample).
  //   pickRate:   an Explore variant SHOWN and then PICKED. This one has a denominator, so
  //     it is the only place a real preference rate exists.
  const recurrence = { signatureMove: new Map(), face: new Map() };
  const pickRate = { heroPattern: new Map(), donor: new Map() };

  // Everything the reader could not interpret, reported rather than dropped.
  const unreadable = { exploreIdOnlyShown: 0, exploreShownUnlabelled: 0, exploreWithNoPicks: 0 };
  let exploreBuilds = 0;

  for (const { b, brief } of usable) {
    bumpSeen(recurrence.signatureMove, b.signature_move, brief);
    for (const f of Array.isArray(b.faces) ? b.faces : []) bumpSeen(recurrence.face, f, brief);

    const ex = b.explore;
    if (!ex || !Array.isArray(ex.shown) || ex.shown.length === 0) continue;
    exploreBuilds += 1;
    const picks = Array.isArray(ex.picks) ? ex.picks : [];
    if (picks.length === 0) unreadable.exploreWithNoPicks += 1;
    const pickedIds = new Set(picks.map((p) => (p && p.variant_id != null ? String(p.variant_id) : null)));
    for (const s of ex.shown) {
      // The real log carries BOTH shapes: five entries record `shown: ["v1","v2","v3"]`
      // (ids only) and nine record the labelled object. The id-only shape has no
      // hero_pattern or donor to attribute, so it cannot feed a dimension - but it must be
      // counted, because reading `s.hero_pattern` off a string yields undefined and the
      // old loop matched nothing without ever saying so.
      if (typeof s === "string") { unreadable.exploreIdOnlyShown += 1; continue; }
      if (!s || typeof s !== "object") { unreadable.exploreShownUnlabelled += 1; continue; }
      const picked = pickedIds.has(String(s.id));
      if (!s.hero_pattern && !s.donor_slug) unreadable.exploreShownUnlabelled += 1;
      bumpShown(pickRate.heroPattern, s.hero_pattern, picked, brief);
      bumpShown(pickRate.donor, s.donor_slug, picked, brief);
    }
  }

  // A recurring shipped attribute: prevalence over the usable sample, capped by UNIVERSAL.
  const toPrevalence = (map) =>
    [...map.entries()]
      .filter(([, e]) => e.briefs.size >= MIN_SEEN)
      .map(([value, e]) => ({
        value,
        evidence: "recurrence",
        briefs: e.briefs.size,
        of: usableBuilds,
        prevalence: round2(e.briefs.size / usableBuilds),
      }))
      .filter((p) => p.prevalence <= UNIVERSAL)
      .sort((a, b) => b.briefs - a.briefs || a.value.localeCompare(b.value));

  // A shown-and-picked choice: a real rate with a denominator. It must ALSO have been shown
  // across >= MIN_SEEN distinct briefs, or one project's Explore run supplies the whole rate.
  const toPickRate = (map) =>
    [...map.entries()]
      .filter(([, e]) => e.briefs.size >= MIN_SEEN)
      .map(([value, e]) => ({
        value,
        evidence: "pick-rate",
        briefs: e.briefs.size,
        shown: e.shown,
        picked: e.picked,
        pickRate: round2(e.picked / e.shown),
      }))
      .filter((p) => p.pickRate >= 0.5)
      .sort((a, b) => b.pickRate - a.pickRate || b.shown - a.shown);

  // The sample floor. Refuse before computing a single preference, and say what is missing.
  if (usableBuilds < MIN_BUILDS) {
    return {
      builds: all.length,
      readableRows,
      usableRows,
      usableBuilds,
      hasSignal: false,
      refused: true,
      refusedReason:
        `Refusing to bias: only ${usableBuilds} distinct briefs (${usableRows} rows) carry a signature move, a face ` +
        `record or an Explore choice set, out of ${readableRows} readable and ${all.length} logged entries; a profile ` +
        `needs >= ${MIN_BUILDS} briefs. A preference inferred from this many is noise, and biasing Explore on noise ` +
        `costs variety for nothing. The gap is a WRITER problem, not a reader one: see \`unreadable\` and \`excluded\`.`,
      preferences: { signatureMove: [], donor: [], face: [], heroPattern: [] },
      excluded: excludedNote(),
      unreadable,
      summary:
        `NO TASTE PROFILE. ${usableBuilds} distinct briefs carry anything a preference can be computed from ` +
        `(${usableRows} rows; ${readableRows} readable; ${all.length} logged; need >= ${MIN_BUILDS} briefs). ` +
        `Explore proceeds NEUTRAL - do not invent a house style from this log.`,
      diversityGuard: guard(variantCount),
    };
  }

  const preferences = {
    signatureMove: toPrevalence(recurrence.signatureMove),
    // The log's `donors` field is the SURVEY list, not the chosen donors, so it is excluded
    // from the profile entirely (see `excluded` below). A donor only earns a place here by
    // being SHOWN in Explore and PICKED, which is a real choice with a denominator.
    donor: toPickRate(pickRate.donor),
    face: toPrevalence(recurrence.face),
    heroPattern: toPickRate(pickRate.heroPattern),
  };

  const lines = [];
  const topPrev = (arr) => arr.slice(0, 2).map((p) => `${clip(p.value)} (${p.briefs} of ${p.of} briefs)`);
  const topRate = (arr) => arr.slice(0, 2).map((p) => `${clip(p.value)} (picked ${p.picked}/${p.shown} over ${p.briefs} briefs)`);
  if (preferences.signatureMove.length) lines.push(`recurring signature moves: ${topPrev(preferences.signatureMove).join(", ")}`);
  if (preferences.heroPattern.length) lines.push(`picks hero patterns: ${topRate(preferences.heroPattern).join(", ")}`);
  if (preferences.donor.length) lines.push(`picks donors: ${topRate(preferences.donor).join(", ")}`);
  if (preferences.face.length) lines.push(`recurring faces: ${topPrev(preferences.face).join(", ")}`);

  const hasSignal = lines.length > 0;
  const caveat = exploreBuilds === 0
    ? " No Explore choice sets in the sample, so every line below is bare recurrence with no rejected alternative behind it: weak evidence, treat as a nudge."
    : "";

  return {
    builds: all.length,
    readableRows,
    usableRows,
    usableBuilds,
    exploreBuilds,
    hasSignal,
    refused: false,
    preferences,
    excluded: excludedNote(),
    unreadable,
    summary: hasSignal
      ? `Over ${usableBuilds} distinct briefs (${usableRows} readable rows of ${all.length} logged) the operator ${lines.join("; ")}. ` +
        `BIAS toward these, do not pin.${caveat}`
      : `No preference clears the bar over ${usableBuilds} distinct briefs (need a value in >= ${MIN_SEEN} briefs, ` +
        `present in <= ${Math.round(UNIVERSAL * 100)}% of them, and picked over half the times it was shown). ` +
        `Explore proceeds neutral.`,
    diversityGuard: guard(variantCount),
  };
}

// The diversity guard: at least ceil(variantCount * EXPLORE_FRACTION) variants must be
// chosen from OUTSIDE the preferences (a breadth floor), and the profile BIASES the rest,
// never pins it.
function guard(variantCount) {
  const explorationBudget = Math.max(2, Math.ceil(variantCount * EXPLORE_FRACTION));
  return {
    explorationBudget,
    rule:
      `of ${variantCount} variants, >= ${explorationBudget} MUST come from OUTSIDE the profile (the breadth floor); ` +
      `the negative memory (gate-novelty.mjs) is unchanged and still the hard guard.`,
  };
}

function excludedNote() {
  return {
    surveyedDonors:
      "the log's `donors` field is `manifest.references_surveyed`, the whole survey list " +
      "(median 25 slugs per build, max 103), not the donors the build chose. Recurrence in it " +
      "measures what the library returns, not what the operator likes, so it is excluded from " +
      "the profile. A donor appears above only when Explore SHOWED it and the operator PICKED it. " +
      "Fix at the writer: record the chosen donor slugs separately from the surveyed ones.",
  };
}

function clip(s) { const t = String(s); return t.length > 70 ? t.slice(0, 67) + "..." : t; }
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
