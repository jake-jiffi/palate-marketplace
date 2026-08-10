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
 *
 * Usage: node scripts/verify-brand-record.mjs <record.json>
 * Exit 0 = valid (the second build can inherit it), 2 = missing/invalid (re-derive once,
 * then write the record). No deps. ES module.
 */
import { readFileSync } from "node:fs";

const MOTION_BANDS = ["still", "calm", "confident", "bold", "spectacle"];

export function validateBrandRecord(rec) {
  const errors = [];
  if (!rec || typeof rec !== "object") return ["record is not an object"];
  if (typeof rec.slug !== "string" || !rec.slug) errors.push("missing slug");
  const t = rec.tokens;
  const tokensOk = t && typeof t === "object" &&
    ((typeof t.package === "string" && typeof t.version === "string") || t.vendored === true);
  if (!tokensOk) errors.push("missing tokens ({ package, version } or { vendored: true })");
  const at = rec.approvedType;
  if (!at || typeof at !== "object" || typeof at.display !== "string" || typeof at.body !== "string")
    errors.push("missing approvedType ({ display, body })");
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
  console.log(`brand record valid: ${rec.slug} (motionBand=${rec.motionBand}, type=${rec.approvedType.display}/${rec.approvedType.body}) - a returning build can inherit it without re-detection.`);
  process.exit(0);
}
