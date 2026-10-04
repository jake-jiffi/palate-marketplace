#!/usr/bin/env node
/**
 * verify-brand-record.mjs - W4 (gap6 item 1). Validate a per-client brand RECORD so a
 * returning client's build inherits the approved brand instead of re-detecting or
 * re-extracting it. The record is the artefact that closes the re-detection gap: the
 * published {slug}-brand package is already reused, but motion-intensity band and voice
 * were re-derived every build, and the redesign/captured path re-extracted from the live
 * site every build. The record persists all four, retrieved at Phase 0.
 *
 * A valid record carries:
 *   - slug            the client slug
 *   - tokens          { package, version } (the published brand pkg) OR { vendored: true }
 *   - approvedType    { display, body } (the approved faces, so type is not re-chosen)
 *   - motionBand      the approved motion-intensity band (calm|confident|bold|...)
 *   - voice           { summary, ... } the approved voice (W7 deepens this)
 *   - locked          OPTIONAL { colour, type } - which halves of the brand the CLIENT
 *                     provided. Defaults to both true, so every record written before
 *                     this field existed keeps its old meaning.
 *
 * PARTIAL BRANDS. Doctrine says a client who hands over colours but no fonts counts as
 * brand-provided: lock the given half, choose the missing half to fit. The record could
 * not say that. `approvedType` was unconditionally required, so the only way to store a
 * colours-only brand was to invent a typeface and write it down as "approved" - which is
 * a lie the next build inherits, and worse, it silently removes type from the axes
 * DIVERGE is allowed to vary. That is not a cosmetic gap: it is the difference between
 * the second build being allowed to re-choose the face and being told the client picked
 * it. So `locked.type: false` is now expressible, and it REQUIRES approvedType to be
 * absent, because a record that both says "type is free" and names an approved face
 * cannot be acted on.
 *
 * Usage: node scripts/verify-brand-record.mjs <record.json>
 * Exit 0 = valid (the second build can inherit it), 2 = missing/invalid (re-derive once,
 * then write the record). Prints DIVERGE_FREE_AXES=<csv|none> on success. No deps.
 */
import { readFileSync } from "node:fs";

const MOTION_BANDS = ["still", "calm", "confident", "bold", "spectacle"];
const LOCKABLE_AXES = ["colour", "type"];

/** Which halves the client provided. Absent = both, the pre-partial-brand meaning. */
export function lockedAxes(rec) {
  const l = rec && rec.locked;
  if (!l || typeof l !== "object") return { colour: true, type: true };
  return {
    colour: l.colour === undefined ? true : l.colour === true,
    type: l.type === undefined ? true : l.type === true,
  };
}

/** The axes DIVERGE may vary, given what the client locked. */
export function divergeFreeAxes(rec) {
  const locked = lockedAxes(rec);
  return LOCKABLE_AXES.filter((a) => !locked[a]);
}

export function validateBrandRecord(rec) {
  const errors = [];
  if (!rec || typeof rec !== "object") return ["record is not an object"];
  if (typeof rec.slug !== "string" || !rec.slug) errors.push("missing slug");
  const t = rec.tokens;
  const tokensOk = t && typeof t === "object" &&
    ((typeof t.package === "string" && typeof t.version === "string") || t.vendored === true);
  if (!tokensOk) errors.push("missing tokens ({ package, version } or { vendored: true })");

  if (rec.locked !== undefined) {
    if (!rec.locked || typeof rec.locked !== "object" || Array.isArray(rec.locked)) {
      errors.push("locked must be an object ({ colour: bool, type: bool })");
    } else {
      for (const [k, v] of Object.entries(rec.locked)) {
        if (!LOCKABLE_AXES.includes(k)) errors.push(`locked has unknown axis "${k}" (allowed: ${LOCKABLE_AXES.join(", ")})`);
        else if (typeof v !== "boolean") errors.push(`locked.${k} must be a boolean`);
      }
    }
  }
  const locked = lockedAxes(rec);
  if (!locked.colour && !locked.type) {
    // Nothing locked is not a partial brand, it is brand-creation, and a record asserting
    // an inherited brand while locking none of it would let the next build inherit nothing.
    errors.push("locked has no axis set to true; a record with nothing locked is brand-creation, not a brand record");
  }

  const at = rec.approvedType;
  if (locked.type) {
    if (!at || typeof at !== "object" || typeof at.display !== "string" || typeof at.body !== "string")
      errors.push("missing approvedType ({ display, body }) while locked.type is true");
  } else if (at !== undefined && at !== null) {
    errors.push("locked.type is false (the client gave no type) but approvedType is set; drop approvedType so the build knows type is free to vary");
  }

  if (typeof rec.motionBand !== "string" || !MOTION_BANDS.includes(rec.motionBand))
    errors.push(`missing/invalid motionBand (one of ${MOTION_BANDS.join("|")})`);
  const v = rec.voice;
  if (!v || typeof v !== "object" || typeof v.summary !== "string" || !v.summary)
    errors.push("missing voice ({ summary, ... })");
  return errors;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/verify-brand-record.mjs <record.json>");
    process.exit(2);
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`cannot read/parse ${path}: ${e.message}`);
    process.exit(2);
  }
  const errors = validateBrandRecord(rec);
  if (errors.length) {
    console.error(`brand record INVALID (${path}):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`Re-derive the missing pieces once, then write them into the record so the next build inherits them.`);
    process.exit(2);
  }
  const free = divergeFreeAxes(rec);
  const typeDesc = rec.approvedType
    ? `${rec.approvedType.display}/${rec.approvedType.body}`
    : "free (client gave no type)";
  console.log(`brand record valid: ${rec.slug} (motionBand=${rec.motionBand}, type=${typeDesc}) - a returning build can inherit it without re-detection.`);
  // Machine-readable, because this is the line that decides which axes the mandatory
  // DIVERGE step may vary. A partial brand that reads as fully locked silently narrows
  // the creative space; one that reads as fully free re-picks a colour the client owns.
  console.log(`DIVERGE_FREE_AXES=${free.length ? free.join(",") : "none"}`);
  process.exit(0);
}
