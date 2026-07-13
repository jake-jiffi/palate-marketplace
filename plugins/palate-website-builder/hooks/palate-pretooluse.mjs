#!/usr/bin/env node
/**
 * hooks/palate-pretooluse.mjs - the build-site write gate (PreToolUse).
 *
 * Registered at the user level, matched on `Write|MultiEdit`. It does TWO things:
 *
 *  1. The DIVERGE WALL (default-ON, but scoped to an active build site). A Palate
 *     BUILD SITE must begin by diverging into 8-10 genuinely different directions
 *     BEFORE any site source is written. This hook ENFORCES that: when an active
 *     build-site marker (`.palate-skill-state.json`, written ONLY by the BUILD SITE
 *     flow's scripts/state-init.sh, before scaffold) is present and the build has not
 *     recorded a VALID diverge+converge in build-manifest.json, it BLOCKS the first
 *     NEW page/section source Write. No env var enables it; it is on whenever a build
 *     site is active. It NEVER traps a non-build: no marker => not a build => allow.
 *     The validity bar is MODE-AWARE: the marker's `brandMode` (brand-creation when no
 *     brand was provided, brand-provided when a brand package / real tokens / stated
 *     colours+fonts exist) sets WHICH axes the 8-10 must diverge on. brand-creation
 *     requires colour AND type to vary (the FULL identity space, since you are creating
 *     the brand); brand-provided LOCKS colour + type and judges distinctness on the
 *     within-brand axes (layout / composition / motion / density / art-direction).
 *
 *  2. The DEPTH NUDGE (unchanged, opt-in). When NO build-site marker is present the
 *     hook falls through to the original behaviour: NON-BLOCKING by default (the depth
 *     nudge is delivered by the skill and the Stop hook), HARD-BLOCK only under
 *     PALATE_GATE_STRICT=1, and even then fail-OPEN when the gate cannot be satisfied.
 *
 * Escape hatches (so it can never trap an ordinary edit or a non-build session):
 *   - PALATE_GATE_OFF=1 disables everything.
 *   - No `.palate-skill-state.json` marker => not a build site => allow (the primary
 *     scope wall: editing an existing app, a BUILD BRAND session, a small edit, or any
 *     non-Palate work never sees the wall).
 *   - Edit is never matched (only Write/MultiEdit), so editing an existing file is
 *     structurally exempt; a Write OVER an already-scaffolded NON page/section file
 *     (config, layout chrome, lib) is iteration and also allowed.
 *   - DIVERGE is a reasoning step, NOT an MCP call, so the wall does NOT depend on MCP
 *     liveness: the model writes manifest.diverge whether or not the MCP is connected.
 *     A tooling failure (fs throw) falls through to the depth path (allow under
 *     non-strict), so a failure can never wedge a write.
 *
 * DELIBERATELY DEPTH-ONLY for "done": this hook does NOT run the "done" gate
 * (gate-done.sh). The done gate judges a RENDER (screenshots + a built preview), and
 * at write-time nothing is rendered yet - so a done check here would trap every
 * mid-build source write. "Done" enforcement belongs at Stop (hooks/palate-stop.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "..", "scripts", "gate-mcp-depth.sh");
const SOURCE = /\.(astro|svelte|vue|tsx?|jsx?|mjs|css|scss)$/i;
const CONFIG = /(^|\/)(astro|tailwind|vite|postcss|package|tsconfig|eslint)\.[a-z.]+$/i;
// Page/section source: the files the model HAND-AUTHORS to compose the site. A NEW one
// (or overwriting one) is the act the DIVERGE wall guards; everything else (config,
// layout chrome, lib, the manifest/state files) is exempt so the scaffold is free.
const PAGE_OR_SECTION = /(^|\/)src\/(pages|components)\//i;

// Thresholds for the divergeValid predicate (env-tunable, documented; defaults echo
// references/story-engine.md's own numbers, N=6-8 sampled with >=2 concepts at
// conventionality <= 0.3, spanning >= 2 lenses). MIN_DIVERGE defaults to 8 to make
// SKILL.md's "8-10 directions" the hard floor, per Jake's directive that the 8-10
// divergent directions must ALWAYS be the first step. Set PALATE_MIN_DIVERGE=6 to
// relax to the sample floor.
const MIN_DIVERGE       = Number(process.env.PALATE_MIN_DIVERGE       ?? 8);   // >= 8 directions
const MIN_DISTINCT_SIGS = Number(process.env.PALATE_MIN_DISTINCT_SIGS ?? 6);   // distinct lens|seed fingerprints
const MIN_CONV_SPREAD   = Number(process.env.PALATE_MIN_CONV_SPREAD   ?? 0.4); // max-min conventionality
const LOW_TAIL_MAX      = Number(process.env.PALATE_LOW_TAIL_MAX      ?? 0.3); // a surprising-tail concept exists
// MODE-AWARE AXIS FLOOR (brand-creation only): the set must show at least this many
// DISTINCT colourways AND this many distinct type directions, so the single-default-style
// failure (one colourway + one type pairing across all 8) cannot be recorded as valid.
const MIN_AXIS_DISTINCT = Number(process.env.PALATE_MIN_AXIS_DISTINCT ?? 3);   // distinct colourways AND type dirs

// The deny message is MODE-AWARE: brand-creation diverges the FULL identity space
// (colour + type are required varied axes); brand-provided LOCKS colour + type and
// diverges only within the brand (layout / composition / motion / density / art-direction).
// Shared head + tail, a mode-specific axes block between. House rules: Australian English,
// no em dashes, no AI-tell vocabulary.
function DIVERGE_REQUIRED_MESSAGE(mode) {
  const head =
    "Palate BUILD SITE gate: DIVERGE has not run (validly). A Palate build MUST begin by\n" +
    "diverging into 8 to 10 genuinely different directions BEFORE any site source is written.\n" +
    "This is step one, not an option. It is what stops every build collapsing to one default\n" +
    "style.\n" +
    "\n" +
    `This build is in ${mode} mode. Diverge on the axes for this mode, then this write passes.\n`;

  const creation =
    "\n" +
    "NO brand was provided, so you are helping CREATE the brand. Diverge across the FULL\n" +
    "identity space:\n" +
    "  - colourway (vary it: at least 3 distinct colourways across the set),\n" +
    "  - type / faces (vary them: at least 3 distinct type directions; do not reach for one\n" +
    "    default pairing),\n" +
    "  - mood, layout, composition, motion, density.\n" +
    'Set diverge.mode = "brand-creation" and list these in diverge.axes_varied (colour and\n' +
    "type are REQUIRED varied axes). Each concept records its colourway and type plus its\n" +
    "layout and motion.\n";

  const provided =
    "\n" +
    "A brand WAS provided, so LOCK it. Do NOT vary colour or fonts away from the brand: set\n" +
    "diverge.locked = { colour: true, type: true } and record the palette source and faces.\n" +
    "Do NOT put colour or type in diverge.axes_varied. Diverge ONLY within the brand, on:\n" +
    "  - layout, composition, section logic,\n" +
    "  - motion, density, art direction.\n" +
    "At least 6 distinct layout/motion skins across the set, judged on those axes (not on\n" +
    "colour or face).\n";

  const tail =
    "\n" +
    "Steps:\n" +
    "  1. SAMPLE 8 to 10 candidate concepts in ONE pass with constraints removed (Verbalized\n" +
    "     Sampling). Self-tag each: conventionality 0..1 (carry a low-typicality tail, at least\n" +
    "     one concept <= 0.3), the lens it came from (2 to 3 varied lenses), and a forced\n" +
    "     cross-domain analogical_seed (print, signage, architecture, film).\n" +
    "  2. Write manifest.diverge = { ran:true, n, mode, axes_varied, locked, concepts:[...] }.\n" +
    "  3. CONVERGE: score originality (distance from the default) + craft-feasibility, advance\n" +
    "     the best 1 to 2, write manifest.converge = { ran:true, scored, advanced:[ids] }.\n" +
    "See references/story-engine.md (DIVERGE/CONVERGE) and references/build-commission.md.\n" +
    "(Not a build site? This only fires when .palate-skill-state.json exists. Escape:\n" +
    "PALATE_GATE_OFF=1.)";

  return head + (mode === "brand-provided" ? provided : creation) + tail;
}

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// divergeValid: the manifest records a GENUINELY divergent set that was scored and
// narrowed, on the axes appropriate to the build's BRAND MODE. It mirrors what
// scripts/gate-novelty.mjs's --require-diverge copy validates, so the write-time wall
// and the done-time novelty gate agree on what "valid" means; keep the two copies
// byte-identical in logic (they share the PALATE_MIN_* env thresholds).
//
// ANTI-GAMING: it is not enough to set ran:true. The set must have >= MIN_DIVERGE
// concepts, each carrying the divergence axes and a self-tagged conventionality, a
// spread of conventionality, a low-typicality tail, and a CONVERGE that advanced >= 1.
// (8 identical concepts, or 8 all clustered at the mode, both fail.) The DISTINCTNESS
// check is MODE-AWARE:
//   - brand-creation: the FULL identity space must vary. colour AND type must be in
//     axes_varied, and the concepts must actually show >= MIN_AXIS_DISTINCT distinct
//     colourways AND distinct type directions, plus the distinct lens|seed signatures.
//     So the single-default-style failure (one colourway + Bricolage/Hanken everywhere)
//     is structurally impossible to record as valid.
//   - brand-provided: colour AND type are LOCKED. They MUST NOT be in axes_varied and
//     MUST be ~constant across concepts; distinctness is judged on the allowed axes
//     (layout / composition / section_logic / motion / density / art_direction). So the
//     model is forced to diverge on the right axes and is blocked from drifting the brand.
// A manifest whose self-declared diverge.mode disagrees with the build's mode is invalid
// (anti-tamper: the agent cannot record one mode to dodge the other mode's bar).
//
// `mode` defaults to "brand-creation" (the stricter, safer default) when the marker
// carries no brandMode, for back-compat with older state files.
function divergeValid(m, mode = "brand-creation") {
  if (!m || typeof m !== "object") return false;
  const d = m.diverge, c = m.converge;
  if (!d || d.ran !== true || !Array.isArray(d.concepts)) return false;
  if (d.concepts.length < MIN_DIVERGE) return false; // >= 8 directions

  // Mode consistency: a manifest that claims a different mode than the build is invalid.
  // Only enforced when the manifest self-declares a mode (legacy manifests have none).
  if (d.mode && d.mode !== mode) return false;

  // Each concept must carry the divergence axes and a self-tagged conventionality.
  const ok = d.concepts.filter((x) =>
    x && typeof x === "object" &&
    typeof x.conventionality === "number" &&
    (x.mechanic || x.lens || x.analogical_seed),
  );
  if (ok.length < MIN_DIVERGE) return false;

  // Conventionality spread + low tail (both modes): not 8 shades of one, a tail exists.
  const convs = ok.map((x) => x.conventionality);
  const spread = Math.max(...convs) - Math.min(...convs);
  if (spread < MIN_CONV_SPREAD) return false;          // not all clustered at the mode
  if (!convs.some((v) => v <= LOW_TAIL_MAX)) return false; // >= 1 surprising-tail concept

  // axes_varied: the declared intent. Lower-cased set.
  const axes = new Set((Array.isArray(d.axes_varied) ? d.axes_varied : []).map((a) => String(a).toLowerCase().trim()));
  const hasColour = axes.has("colour") || axes.has("colourway") || axes.has("color");
  const hasType = axes.has("type") || axes.has("faces") || axes.has("typography");
  // distinct non-empty values of a concept axis, lower-cased.
  const distinctOf = (key) => new Set(
    ok.map((x) => String(x[key] || "").toLowerCase().trim()).filter((s) => s.length > 0),
  ).size;

  if (mode === "brand-provided") {
    // colour + type are LOCKED: NOT in axes_varied, locked flags set, ~constant per concept.
    if (hasColour || hasType) return false;
    if (!d.locked || d.locked.colour !== true || d.locked.type !== true) return false;
    if (distinctOf("colourway") > 1) return false;       // colourway must be constant (locked)
    if (distinctOf("type") > 1) return false;            // type must be constant (locked)
    // distinctness judged on the ALLOWED within-brand axes.
    const allowed = ["layout", "composition", "section_logic", "motion", "density", "art_direction"];
    const declaredAllowed = allowed.filter((a) => axes.has(a));
    if (declaredAllowed.length < 2) return false;        // >= 2 distinct allowed axes declared
    const skins = new Set(
      ok.map((x) => allowed.map((a) => String(x[a] || "").toLowerCase().trim()).join("|"))
        .filter((s) => s.replace(/\|/g, "").length > 0),
    );
    if (skins.size < MIN_DISTINCT_SIGS) return false;    // >= 6 distinct layout/motion skins
  } else {
    // brand-creation: the FULL identity space must vary. colour + type required + actually distinct.
    if (!hasColour) return false;
    if (!hasType) return false;
    if (distinctOf("colourway") < MIN_AXIS_DISTINCT) return false; // >= 3 distinct colourways
    if (distinctOf("type") < MIN_AXIS_DISTINCT) return false;      // >= 3 distinct type directions
    // plus the existing lens|seed signature spread (genuine concept variety).
    const sigs = new Set(
      ok.map((x) =>
        `${String(x.lens || "").toLowerCase().trim()}|${String(x.analogical_seed || "").toLowerCase().trim()}`,
      ),
    );
    if (sigs.size < MIN_DISTINCT_SIGS) return false;     // distinct fingerprints
  }

  // CONVERGE must have narrowed to a chosen 1-2 (both modes).
  if (!c || c.ran !== true || !Array.isArray(c.advanced) || c.advanced.length < 1) return false;
  return true;
}

const p = readStdin();
if (!p || process.env.PALATE_GATE_OFF === "1") allow();

const tool = p.tool_name || "";
if (tool !== "Write" && tool !== "MultiEdit") allow();

const input = p.tool_input || {};
const fp = input.file_path || input.filePath || input.path || "";
if (!SOURCE.test(fp)) allow(); // non-source: scaffolding, config, notes, the manifest
if (CONFIG.test(fp)) allow();

const cwd = p.cwd || process.cwd();

// BUILD-SITE SCOPE: the DIVERGE wall only applies inside an active build-site flow.
// state-init.sh writes .palate-skill-state.json before scaffold and before any source
// write, and ONLY the BUILD SITE mode writes it (BUILD BRAND writes
// .palate-brand-state.json; an ordinary edit writes neither). No marker => not a build
// => fall through to the unchanged depth nudge. This is the non-negotiable fail-open
// scope wall. Wrapped in try/catch so a marker-read throw cannot wedge a write.
try {
  const marker = path.join(cwd, ".palate-skill-state.json");
  if (fs.existsSync(marker)) {
    const isPageOrSection = PAGE_OR_SECTION.test(fp);

    // Write-over-existing NON page/section source (config, layout chrome, lib) is
    // iteration on the scaffold: allow. New page/section source, OR overwriting page/
    // section source, both wait for DIVERGE so the first authored hero/section cannot
    // sneak in by overwriting a template stub before the build has diverged.
    if (fs.existsSync(fp) && !isPageOrSection) allow();

    // Read the BRAND MODE from the MARKER (not the manifest, so it cannot be tampered
    // with by a manifest write). Default brand-creation (the stricter bar) when the
    // marker has no brandMode (an older state file).
    let mode = "brand-creation";
    try {
      const st = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (st.brandMode === "brand-provided" || st.brandMode === "brand-creation") mode = st.brandMode;
    } catch { /* default brand-creation */ }

    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(cwd, "build-manifest.json"), "utf8"));
    } catch {
      /* absent/unreadable => diverge not yet valid */
    }

    if (divergeValid(manifest, mode)) allow();

    // A build site is active, this is a NEW (or page/section) source write, and DIVERGE
    // has not validly run FOR THIS MODE. Block it and tell the model to diverge first.
    deny(DIVERGE_REQUIRED_MESSAGE(mode));
  }
} catch {
  // Any unexpected fs error: do NOT wedge a write. Fall through to the depth path,
  // which allows under non-strict.
}

// No build-site marker: not a build. Keep the EXISTING depth nudge, unchanged. NEVER
// block a write by default; the depth gate is a nudge, not a wall (hard-blocking a
// write would trap anyone whose Palate MCP is not connected, who is editing an existing
// app, or who surveyed in a subagent). Opt into hard enforcement with PALATE_GATE_STRICT=1.
if (process.env.PALATE_GATE_STRICT !== "1") allow();

try {
  execFileSync("bash", [GATE, path.join(cwd, "build-manifest.json")], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  allow();
} catch (e) {
  const reason =
    (e.stderr ? e.stderr.toString() : "").trim() ||
    'MCP-depth gate failed: survey the library first: refs_search with concrete lexical terms (a font, "GSAP", "preloader", the business category), then refs_get your donors with a layer (signature_moves / do_dont / component_prompts) or format:design before writing code.';
  deny(reason);
}
