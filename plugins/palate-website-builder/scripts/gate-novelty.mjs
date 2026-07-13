#!/usr/bin/env node
/**
 * scripts/gate-novelty.mjs - the deterministic NOVELTY gate (Move 1).
 *
 * Sibling of gate-uniqueness.mjs. Where uniqueness asks "are the variants in THIS
 * build distinct from each OTHER", novelty asks the cross-build question: "is the
 * ADVANCED concept too close to the category default, or to what the last N builds
 * already did?" It computes everything from ARTEFACTS (the manifest's diverge/converge
 * blocks the agent set, the rendered variant HTML, and the recordBuild history
 * palate-stop.mjs writes) - never from an LLM pass/fail boolean. That is the
 * anti-reward-hacking contract every Palate gate shares.
 *
 * Two roles, both fail-OPEN (exit 0 = pass OR not-applicable; exit 2 = a real failure):
 *
 *   CONCEPT pre-check (--manifest <f>): read manifest.diverge/converge. Fail if the
 *     CONVERGE step advanced only safe concepts - i.e. the advanced set's mean
 *     `conventionality` is above PALATE_MAX_CONVENTIONALITY (default 0.6). Skip when
 *     diverge/converge is absent (the spine did not run, e.g. MCP not connected).
 *
 *   BUILD-level (--variants a.html b.html ... , or the manifest.variants block): compare
 *     this build to the last N logged builds (~/.config/palate/builds.log.json). Fail if
 *     this build is a near-repeat of a recent one on BOTH the structural/style skin AND
 *     the carried donors. Also flag TYPE-FACE RECURRENCE: a display FACE that recurs
 *     build-to-build across unrelated briefs is the smell, not the family. Skip with <2
 *     variants or no build history (nothing to compare).
 *
 * Exit 0 = pass/skip, 2 = block (with the reason on stderr). Like the other gates this
 * script only DECIDES; the caller (gate-done.sh / the Stop hook / eval-runner) chooses
 * whether to enforce. Mirrors gate-uniqueness.mjs's exit codes; the <2 / no-history
 * cases SKIP (exit 0) rather than the uniqueness gate's exit-2, because a missing
 * comparison is not a failure - it is the public-plugin fail-open invariant.
 *
 * Thresholds via env (documented, never magic numbers buried in code):
 *   PALATE_MAX_CONVENTIONALITY  default 0.6   - converge advanced too-safe a set above this
 *   PALATE_RECENT_N             default 5     - how many recent builds to compare against
 *   PALATE_NOVELTY_STRUCT       default 0.82  - struct skin too close to a recent build
 *   PALATE_NOVELTY_STYLE        default 0.72  - style skin too close to a recent build
 *   PALATE_NOVELTY_DONOR        default 0.6   - donor overlap too high vs a recent build
 *   PALATE_FACE_RECUR_N         default 3     - a display face in this many recent builds is a tell
 *
 * Pure Node, no deps. Reuses gate-uniqueness.mjs's signatures by copy (kept standalone
 * and dependency-free like every other gate).
 */
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_CONV = Number(process.env.PALATE_MAX_CONVENTIONALITY ?? 0.6);
const RECENT_N = Number(process.env.PALATE_RECENT_N ?? 5);
const STRUCT_MAX = Number(process.env.PALATE_NOVELTY_STRUCT ?? 0.82);
const STYLE_MAX = Number(process.env.PALATE_NOVELTY_STYLE ?? 0.72);
const DONOR_MAX = Number(process.env.PALATE_NOVELTY_DONOR ?? 0.6);
const FACE_RECUR_N = Number(process.env.PALATE_FACE_RECUR_N ?? 3);

// Thresholds for the --require-diverge mode (the done-time mirror of the PreToolUse
// DIVERGE wall). Same env names + defaults as hooks/palate-pretooluse.mjs so write-time
// and done-time agree on what a "valid diverge" is.
const MIN_DIVERGE = Number(process.env.PALATE_MIN_DIVERGE ?? 8);
const MIN_DISTINCT_SIGS = Number(process.env.PALATE_MIN_DISTINCT_SIGS ?? 6);
const MIN_CONV_SPREAD = Number(process.env.PALATE_MIN_CONV_SPREAD ?? 0.4);
const LOW_TAIL_MAX = Number(process.env.PALATE_LOW_TAIL_MAX ?? 0.3);
const MIN_AXIS_DISTINCT = Number(process.env.PALATE_MIN_AXIS_DISTINCT ?? 3);

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes(k);
const list = (k) => {
  const i = args.indexOf(k);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]);
  return out;
};

const manifestPath = arg("--manifest");
const variantFiles = list("--variants");
const requireDiverge = has("--require-diverge");

function fail(msg) { console.error(`novelty gate FAILED: ${msg}`); process.exit(2); }
function skip(msg) { console.log(`novelty gate skipped: ${msg}`); process.exit(0); }
function pass(msg) { console.log(`novelty gate passed: ${msg}`); process.exit(0); }

// --- signatures (copied from gate-uniqueness.mjs, kept standalone) ----------
function structSig(html) {
  const sig = [];
  const re = /<(section|header|main|footer|article|aside|nav|div|h1|h2|h3|ul|ol|figure)\b[^>]*?(?:class="([^"]*)")?[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = (m[2] || "").trim().split(/\s+/)[0] || "";
    sig.push(`${m[1].toLowerCase()}.${cls.toLowerCase()}`);
  }
  return new Set(sig);
}
function styleSig(html) {
  const s = new Set();
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) s.add(m[0].toLowerCase());
  for (const m of html.matchAll(/font-family:\s*([^;"}]+)/gi)) s.add("ff:" + m[1].toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40));
  for (const m of html.matchAll(/family=([A-Za-z0-9+]+)/g)) s.add("gf:" + m[1].toLowerCase());
  for (const m of html.matchAll(/cubic-bezier\([^)]+\)/gi)) s.add(m[0].toLowerCase().replace(/\s/g, ""));
  for (const m of html.matchAll(/border-radius:\s*([^;"}]+)/gi)) s.add("br:" + m[1].trim());
  return s;
}
function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 0; // no shared evidence != identical, for novelty
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Extract the display FACE names actually used by a rendered variant - the smell the
// type doctrine names: a face recurring build-to-build is the tell, not the family.
// Normalise to a bare lower-case family token (the first family in each declaration,
// plus Google-Fonts link families), so "Fraunces, serif" and 'family=Fraunces' both
// collapse to `fraunces`.
function facesFromHtml(html) {
  const faces = new Set();
  const norm = (s) => s
    .replace(/['"]/g, "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset", "var", ""]);
  // Capture the whole value up to ; or } (quotes included) so a quoted first family
  // like font-family:"Space Grotesk",... is read - norm() strips the quotes after.
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const f = norm(m[1]);
    if (!GENERIC.has(f) && !f.startsWith("var(")) faces.add(f);
  }
  for (const m of html.matchAll(/family=([A-Za-z0-9+]+)/g)) {
    const f = m[1].replace(/\+/g, " ").trim().toLowerCase();
    if (!GENERIC.has(f)) faces.add(f);
  }
  return faces;
}

// --- the recordBuild history (what palate-stop.mjs writes) ------------------
function loadHistory() {
  const log = path.join(os.homedir(), ".config", "palate", "builds.log.json");
  try {
    const entries = JSON.parse(readFileSync(log, "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch {
    // Back-compat: the v1 jiffi-namespaced log.
    try {
      const entries = JSON.parse(readFileSync(path.join(os.homedir(), ".config", "jiffi", "builds.log.json"), "utf8"));
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  }
}

// ============================================================================
// CONCEPT pre-check: did CONVERGE advance only safe concepts?
// ============================================================================
// divergeValid: the same MODE-AWARE predicate as the PreToolUse DIVERGE wall
// (hooks/palate-pretooluse.mjs). Used by the --require-diverge mode so the done-gate
// can catch a BUILD SITE that skipped DIVERGE (gate-done.sh invokes it ONLY when the
// build-site marker is present, so non-build sessions stay fail-open). Kept BYTE-IDENTICAL
// in logic with the hook's copy by sharing the PALATE_MIN_* env thresholds above; the
// `mode` arg is read from the marker beside the manifest (default brand-creation, the
// stricter bar, for back-compat). See the hook for the full doctrine on the two modes.
function divergeValid(m, mode = "brand-creation") {
  if (!m || typeof m !== "object") return false;
  const d = m.diverge, c = m.converge;
  if (!d || d.ran !== true || !Array.isArray(d.concepts)) return false;
  if (d.concepts.length < MIN_DIVERGE) return false;
  if (d.mode && d.mode !== mode) return false;
  const ok = d.concepts.filter((x) =>
    x && typeof x === "object" &&
    typeof x.conventionality === "number" &&
    (x.mechanic || x.lens || x.analogical_seed),
  );
  if (ok.length < MIN_DIVERGE) return false;
  const convs = ok.map((x) => x.conventionality);
  const spread = Math.max(...convs) - Math.min(...convs);
  if (spread < MIN_CONV_SPREAD) return false;
  if (!convs.some((v) => v <= LOW_TAIL_MAX)) return false;
  const axes = new Set((Array.isArray(d.axes_varied) ? d.axes_varied : []).map((a) => String(a).toLowerCase().trim()));
  const hasColour = axes.has("colour") || axes.has("colourway") || axes.has("color");
  const hasType = axes.has("type") || axes.has("faces") || axes.has("typography");
  const distinctOf = (key) => new Set(
    ok.map((x) => String(x[key] || "").toLowerCase().trim()).filter((s) => s.length > 0),
  ).size;
  if (mode === "brand-provided") {
    if (hasColour || hasType) return false;
    if (!d.locked || d.locked.colour !== true || d.locked.type !== true) return false;
    if (distinctOf("colourway") > 1) return false;
    if (distinctOf("type") > 1) return false;
    const allowed = ["layout", "composition", "section_logic", "motion", "density", "art_direction"];
    const declaredAllowed = allowed.filter((a) => axes.has(a));
    if (declaredAllowed.length < 2) return false;
    const skins = new Set(
      ok.map((x) => allowed.map((a) => String(x[a] || "").toLowerCase().trim()).join("|"))
        .filter((s) => s.replace(/\|/g, "").length > 0),
    );
    if (skins.size < MIN_DISTINCT_SIGS) return false;
  } else {
    if (!hasColour) return false;
    if (!hasType) return false;
    if (distinctOf("colourway") < MIN_AXIS_DISTINCT) return false;
    if (distinctOf("type") < MIN_AXIS_DISTINCT) return false;
    const sigs = new Set(
      ok.map((x) =>
        `${String(x.lens || "").toLowerCase().trim()}|${String(x.analogical_seed || "").toLowerCase().trim()}`,
      ),
    );
    if (sigs.size < MIN_DISTINCT_SIGS) return false;
  }
  if (!c || c.ran !== true || !Array.isArray(c.advanced) || c.advanced.length < 1) return false;
  return true;
}

// Read the build's brand mode from the marker beside the manifest (so it cannot be
// tampered with by a manifest write). Default brand-creation when absent/unreadable.
function modeFromMarker(manifestPath) {
  try {
    const st = JSON.parse(readFileSync(path.join(path.dirname(manifestPath), ".palate-skill-state.json"), "utf8"));
    if (st.brandMode === "brand-provided" || st.brandMode === "brand-creation") return st.brandMode;
  } catch { /* default */ }
  return "brand-creation";
}

// NOTE on the division of labour with the PreToolUse DIVERGE wall: the front gate
// (hooks/palate-pretooluse.mjs divergeValid) is the STRICTER one - it enforces the
// concept COUNT (>= 8), the conventionality SPREAD, the low-typicality tail and the
// MODE-AWARE distinctness (brand-creation: >= 3 distinct colourways + type directions;
// brand-provided: locked colour/type + >= 6 within-brand layout/motion skins) before the
// first source write of a build site. The --require-diverge mode above is the done-time
// mirror of exactly that predicate (same modeFromMarker read), run by gate-done.sh ONLY
// for an active build site. conceptPreCheck below stays the fail-open backstop that keeps
// the conventionality-MEAN check (did CONVERGE advance only safe concepts) without
// re-enforcing count/spread/distinctness.
function conceptPreCheck(m) {
  const diverge = m.diverge;
  const converge = m.converge;
  // Fail-open: the spine did not run (MCP not connected, or DIVERGE/CONVERGE skipped).
  if (!diverge || !diverge.ran || !Array.isArray(diverge.concepts) || diverge.concepts.length === 0) {
    skip("no diverge block (the concept spine did not run; nothing to score for conventionality).");
  }
  if (!converge || !converge.ran || !Array.isArray(converge.advanced) || converge.advanced.length === 0) {
    skip("no converge.advanced (CONVERGE did not record which concepts it advanced).");
  }
  const byId = new Map(diverge.concepts.map((c) => [String(c.id), c]));
  const convs = [];
  for (const id of converge.advanced) {
    const c = byId.get(String(id));
    if (c && typeof c.conventionality === "number") convs.push(c.conventionality);
  }
  if (convs.length === 0) {
    skip("advanced concepts carry no conventionality self-tags; cannot score (fail-open).");
  }
  const mean = convs.reduce((a, b) => a + b, 0) / convs.length;
  if (mean > MAX_CONV) {
    fail(
      `CONVERGE advanced only safe concepts: the advanced set's mean conventionality is ${mean.toFixed(2)} > ${MAX_CONV}. ` +
      `That means the build narrowed to the category default and threw away the low-typicality tail DIVERGE produced. ` +
      `Re-run CONVERGE and advance at least one concept from the surprising tail (conventionality below the set median); ` +
      `originality comes from the concept layer, not from the donor.`,
    );
  }
  return { ran: true, mean_conventionality: Number(mean.toFixed(3)), advanced: converge.advanced.length };
}

// ============================================================================
// BUILD-level: is this build a near-repeat of a recent build, or does a display
// face recur across builds?
// ============================================================================
function buildLevelCheck(variants) {
  // Need >=2 rendered variants to characterise THIS build's skin. (A single page
  // cannot be checked - this is the place gate-uniqueness.mjs's exit-2-on-<2 is
  // deliberately WRAPPED into a fail-open skip.)
  if (variants.length < 2) {
    skip(`only ${variants.length} variant(s); a build's skin cannot be characterised from fewer than 2 (fail-open).`);
  }
  const html = variants.map((f) => readFileSync(f, "utf8"));
  // This build's combined skin + faces (union across its own variants).
  const struct = new Set();
  const style = new Set();
  const faces = new Set();
  for (const h of html) {
    for (const x of structSig(h)) struct.add(x);
    for (const x of styleSig(h)) style.add(x);
    for (const x of facesFromHtml(h)) faces.add(x);
  }

  const history = loadHistory();
  const recent = history.slice(-RECENT_N);

  // --- TYPE-FACE RECURRENCE: a display face used here that ALSO appears in
  // FACE_RECUR_N of the recent builds is the tell. The face recurring
  // build-to-build is the smell, not the family. Counts the recent builds whose
  // recorded `faces` include each of this build's faces.
  const faceTell = [];
  for (const face of faces) {
    let count = 0;
    for (const b of recent) {
      const bf = Array.isArray(b.faces) ? b.faces.map((x) => String(x).toLowerCase()) : [];
      if (bf.includes(face)) count++;
    }
    if (count >= FACE_RECUR_N) faceTell.push({ face, count });
  }
  if (faceTell.length) {
    const names = faceTell.map((t) => `"${t.face}" (in ${t.count} recent builds)`).join(", ");
    fail(
      `type-face recurrence: ${names} keeps recurring build-to-build across unrelated briefs. ` +
      `A face reached for out of habit is the AI/no-opinion default tell - the recurring FACE is the smell, not the family. ` +
      `Choose the face fresh for THIS brand's voice and the website vision (see references/type-selection.md); ` +
      `treat type exactly as colour - reproduce the donor's type SYSTEM, decide the FACE per brief.`,
    );
  }

  // --- BUILD REPEAT: this build's skin AND its donors too close to a recent build.
  // Needs the recent builds to have recorded a skin (struct/style) to compare; the
  // current log records donors but not skin yet, so this sub-check only fires when a
  // logged build carries skin signatures (forward-compatible). Donor overlap alone is
  // not a block (re-using a great donor is fine); it is a block only WITH skin overlap.
  if (recent.length === 0) {
    return { face_recurrence: false, build_repeat: false, note: "no build history; repeat check skipped" };
  }
  const thisDonors = new Set(_manifestVariantDonors ?? []);
  let worst = null;
  for (const b of recent) {
    const bStruct = Array.isArray(b.struct) ? new Set(b.struct) : null;
    const bStyle = Array.isArray(b.style) ? new Set(b.style) : null;
    const bDonors = Array.isArray(b.donors) ? new Set(b.donors) : new Set();
    if (!bStruct || !bStyle) continue; // legacy entry without a skin; cannot compare skin
    const st = jaccard(struct, bStruct);
    const sy = jaccard(style, bStyle);
    const dn = jaccard(thisDonors, bDonors);
    if (st > STRUCT_MAX && sy > STYLE_MAX && dn > DONOR_MAX) {
      if (!worst || st + sy + dn > worst.st + worst.sy + worst.dn) worst = { b, st, sy, dn };
    }
  }
  if (worst) {
    fail(
      `this build is a near-repeat of a recent build (${worst.b.business ?? worst.b.ts ?? "unnamed"}): ` +
      `structure ${worst.st.toFixed(2)} > ${STRUCT_MAX}, style ${worst.sy.toFixed(2)} > ${STYLE_MAX}, donors ${worst.dn.toFixed(2)} > ${DONOR_MAX}. ` +
      `Lead this build from DIFFERENT references and a genuinely different advanced concept (vary the backbone, the signature move and the skin).`,
    );
  }
  return { face_recurrence: false, build_repeat: false };
}

// Donor slugs for THIS build are not in the variant HTML; the caller sets this from a
// manifest whose variants[] carry donor_slugs. When only HTML files are passed it stays
// empty, so the donor sub-check cannot trip (within-build skin variety is governed by
// gate-uniqueness; the cross-build repeat check needs donors to fire).
let _manifestVariantDonors = null;

// ============================================================================
function main() {
  // Mode R: --require-diverge --manifest <f> is the done-time mirror of the PreToolUse
  // DIVERGE wall, invoked by gate-done.sh ONLY when an active build-site marker exists.
  // Unlike the fail-open concept pre-check, this mode is HARD: an active build site that
  // skipped (or only thinly faked) DIVERGE is caught here, not silently passed. The
  // caller's marker guard keeps non-build sessions fail-open.
  if (requireDiverge) {
    if (!manifestPath) fail("--require-diverge needs --manifest <f>.");
    if (!existsSync(manifestPath)) {
      fail(
        `--require-diverge: no manifest at ${manifestPath}, so DIVERGE cannot have run. ` +
        `A Palate BUILD SITE must diverge into 8-10 directions and record manifest.diverge/converge before it is done.`,
      );
    }
    let m;
    try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch { fail("--require-diverge: manifest is not valid JSON; DIVERGE evidence cannot be read."); }
    const mode = modeFromMarker(manifestPath);
    if (!divergeValid(m, mode)) {
      const axesLine = mode === "brand-provided"
        ? "colour + type LOCKED (locked.colour/type = true, NOT in axes_varied) and >= " + MIN_DISTINCT_SIGS + " distinct layout/motion skins within the brand"
        : ">= " + MIN_AXIS_DISTINCT + " distinct colourways AND >= " + MIN_AXIS_DISTINCT + " distinct type directions (colour + type in axes_varied), with distinct lens|seed signatures";
      fail(
        `this ${mode} build site skipped DIVERGE (or recorded a thin / clustered / wrong-mode set). ` +
        `manifest.diverge must record >= ${MIN_DIVERGE} genuinely different concepts (a conventionality spread, ` +
        `a low-typicality tail at <= ${LOW_TAIL_MAX}, ${axesLine}) and manifest.converge must advance >= 1. ` +
        "DIVERGE is step one of a build, not optional polish: sample 8-10 directions wide on the axes for this brand mode, then converge to the best 1-2. " +
        "See references/story-engine.md.",
      );
    }
    pass(`DIVERGE valid (${mode}): >= ${MIN_DIVERGE} distinct concepts + a converged advance recorded.`);
  }

  // Mode A: --manifest drives the concept pre-check, and (if it has a variants[]
  // block with html_path + donor_slugs) the build-level check too.
  if (manifestPath) {
    if (!existsSync(manifestPath)) skip(`no manifest at ${manifestPath} (fail-open).`);
    let m;
    try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch { skip("manifest is not valid JSON (fail-open)."); }

    const concept = conceptPreCheck(m);

    // If the manifest records rendered variants on disk, also run the build-level
    // check over them (donors come from the manifest, skin/faces from the HTML).
    const mv = Array.isArray(m.variants) ? m.variants : [];
    const htmlPaths = mv.map((v) => v && v.html_path).filter((p) => typeof p === "string");
    const resolved = htmlPaths
      .map((p) => (path.isAbsolute(p) ? p : path.join(path.dirname(manifestPath), p)))
      .filter((p) => existsSync(p));
    if (resolved.length >= 2) {
      _manifestVariantDonors = [...new Set(mv.flatMap((v) => (Array.isArray(v.donor_slugs) ? v.donor_slugs : [])))];
      const build = buildLevelCheck(resolved);
      pass(`concept conventionality ${concept.mean_conventionality} <= ${MAX_CONV}; build-level clean (${resolved.length} variants).` + (build.note ? ` (${build.note})` : ""));
    }
    pass(`concept conventionality ${concept.mean_conventionality} <= ${MAX_CONV} (advanced ${concept.advanced}); build-level not applicable (no rendered variants in manifest).`);
  }

  // Mode B: --variants drives the build-level check directly over rendered HTML.
  if (variantFiles.length) {
    const existing = variantFiles.filter((f) => existsSync(f));
    const build = buildLevelCheck(existing);
    pass(`build-level clean over ${existing.length} variant(s).` + (build.note ? ` (${build.note})` : ""));
  }

  skip("nothing to check (pass --manifest <f> or --variants a.html b.html ...).");
}

main();
