#!/usr/bin/env node
/**
 * hooks/palate-manifest.mjs - the build-manifest keystone (PostToolUse).
 *
 * Registered at the USER level (~/.claude/settings.json) by scripts/install.sh,
 * matched on `mcp__palate__.*` and `Edit|Write|MultiEdit`. On every matched tool
 * call it appends real telemetry to `build-manifest.json` in the PROJECT directory,
 * so the depth gate reads what the build ACTUALLY did, not what the agent claims.
 * This is the source of truth every other gate hangs off.
 *
 * IT USED TO WRITE TO THE SESSION CWD, and that is a different directory from the one
 * gate-done.sh reads. gate-done derives the project from the manifest's own directory and
 * looks for dist/, verify-report.json and .palate-shots/ beside it, while SKILL.md builds
 * under WORK_ROOT/{slug}-site and nothing ever changes directory. When the two disagree the
 * done gate hits "no renderable preview" and skips, so the whole visual half of the suite
 * evaluates against nothing. The shared resolver in hooks/project-dir.mjs is now the single
 * answer to "which project is this", and the manifest is MOVED, once, when the project
 * directory first appears (a build diverges before it scaffolds, so early telemetry
 * legitimately lands in the cwd and must not be orphaned there).
 *
 * A MANIFEST BELONGS TO ONE BUILD. It records the project it is for, and refuses to keep
 * appending once that project changes: the live proof of the old behaviour was one manifest
 * in this repo's root holding 188 files_written across three unrelated repositories and /tmp.
 *
 * PostToolUse delivers the tool RESULT in the payload. The field is `tool_response`
 * in current Claude Code; we also read `tool_output`/`toolResponse` defensively so
 * a field-name change cannot silently empty the manifest.
 *
 * GROUNDING IS READ FROM THE RESULT, NOT THE REQUEST. A refused or empty refs_* call used to
 * be recorded exactly like a successful one, so "this build drew on the library" could be
 * true of a build that never received a single reference. A call now counts as grounding only
 * when its result actually carried content; refusals and empty results are recorded in
 * `mcp_failures` instead, which keeps them visible rather than erasing them.
 *
 * Never blocks (PostToolUse cannot, apart from the quota stop below). Exit 0 always;
 * failures are swallowed so the hook can never wedge a build.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveBuildContext } from "./project-dir.mjs";

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function blank() {
  return {
    schema: 3, // was 2
    created_at: new Date().toISOString(),
    // The project this manifest is FOR. Set on first write and checked on every write after,
    // so telemetry from an unrelated repo cannot keep accumulating into one file.
    project: null,
    project_resolved_by: null,
    business: null,
    signature_move: null,
    mcp_calls: [],
    // Palate calls that were REFUSED or came back empty. They are not grounding (the depth
    // gate counts mcp_calls, and a call that returned nothing taught the build nothing), but
    // deleting them would hide a broken connection behind a quiet manifest.
    mcp_failures: [],
    references_surveyed: [],
    inner_pages_viewed: [],
    layers_read: [], // R2: intent-named refs_get layers actually pulled (depth signal)
    files_written: [],
    // Writes that landed OUTSIDE the resolved project (a scratch file in /tmp, a note in
    // another repo). Recorded, never counted as part of the build. Only ever populated when
    // the project was actually DETECTED: with no detection there is no authority to filter,
    // and quietly dropping every write would turn the Stop gate off without saying so.
    files_written_outside: [],
    sections: [],
    // --- schema 3 evidence blocks (agent/verifier/script-set, NOT hook-set) ---
    // ANTI-REWARD-HACKING: the hook NEVER sets visual.pass, novelty.pass or
    // verifier.pass. Those pass/fail verdicts are computed by SCRIPTS from real
    // artefacts (PNGs, rendered HTML, gate exit codes) and folded in by
    // scripts/manifest-merge.mjs. The agent may set the DESCRIPTIVE fields it
    // genuinely knows (diverge.concepts, converge.scored, variants[].donor_slugs,
    // signature_move); every pass/fail is machine-checked, never self-claimed.
    // NOTE: diverge/converge are read by TWO gates, not one. The Stop-time novelty
    // gate (scripts/gate-novelty.mjs) reads them at done-time, and the PreToolUse
    // DIVERGE wall (hooks/palate-pretooluse.mjs) reads them at write-time to decide
    // whether a build site may write its first source file. Both judge validity
    // MODE-AWARE off the marker's brandMode, so the agent's diverge.mode / axes_varied /
    // locked / per-concept axis tags below are load-bearing. Do not drop these blocks.
    // diverge is MODE-AWARE (the brand mode comes from .palate-skill-state.json brandMode):
    //   mode: "brand-creation" | "brand-provided" (MUST equal the marker's brandMode)
    //   axes_varied: the axes this set diverged on. brand-creation REQUIRES colour + type
    //     (the full identity space); brand-provided MUST NOT list colour/type (they are locked).
    //   locked: { colour, type, palette_source?, faces? } - true/true in brand-provided.
    //   concepts: each carries conventionality + a creative axis tag, PLUS the per-concept
    //     axis fingerprints distinctness is judged on: brand-creation reads colourway + type
    //     (>= 3 distinct each); brand-provided reads layout/composition/section_logic/motion/
    //     density/art_direction (>= 6 distinct skins, colourway/type constant).
    diverge: null, // { ran, n, mode, axes_varied:[...], locked:{...}, concepts:[{id, mechanic, lens, analogical_seed, conventionality:0..1, colourway, type, layout, motion, density, art_direction}] }
    converge: null, // { ran, scored:[{id, originality:0..5, craft_feasibility:0..5, combined:0..5}], advanced:[id,...] }
    // COMMISSION (the build commission, A.3.5): the ambition bar + the chosen toolkit
    // made explicit after CONVERGE and before EXPLORE, then carried + checked by the
    // verifier. AGENT-set DESCRIPTIVE fields only; the bar's pass/fail stays computed
    // by the gates + the verifier, never self-claimed. Nullable: its absence never
    // blocks a build (fail-open, no hard trap).
    commission: null, // { bar, concept, vision, chosen_mechanisms:[{ name, recipe, precedent_slug, astro_recipe_pulled:bool, fit_reason }], proof:{ viewports:["1440","390"], read_pixels:bool, read_console:bool, mobile_friendly:bool, holds_60fps:bool, honours_reduced_motion:bool }, restraint_note }
    variants: [], // [{ id, route, name, concept_id, donor_slugs:[], html_path }]
    // EXPLORE labels (W1, gap6 item 3): every variant SHOWN in Explore (not just the
    // pick) + the accept/edit signal, with the surface context propensity correction
    // needs. Agent-set DESCRIPTIVE block (like variants[]); persisted to builds.log.json
    // by palate-stop.mjs. Nullable + additive: absence never blocks (calm/edit builds).
    explore: null, // { ran, shown:[{ id, name, donor_slug, hero_pattern, position }], picks:[{ surface, variant_id }], edits:[{ surface, variant_id, note }] }
    visual: null, // { ran, pass, iterations:[{i, shots:{desktop_full,mobile_full,sections:{}}, axes:{philosophy..variety}, defects:[{type,location}], score}], console_errors:int }
    novelty: null, // { ran, pass, closest_pair, struct, style, category_distance, recent_build_distance }
    verifier: null, // { ran, pass, verdict, report_path }
    buildability: null, // MOVE 4: { ran, mechanics:[{name, precedent_slug, astro_recipe_pulled:bool, feasible:bool, fallback}] }
    // ARCHITECT substage (W16, gap4 item 1): the page inventory + nav + journey derived from
    // the concept + business type BEFORE Diverge, grounded by page-type coverage. Agent-set
    // descriptive; the done-gate checks its presence for a multi-page build (fail-open).
    architecture: null, // { ran, pages:[{ route, pageType, purpose, donor_slug }], nav:[...], journey:"awareness->...->conversion", rationale }
    // GROUNDING (the third state): did this build actually draw on the Palate MCP at all?
    // SCRIPT-set, NEVER agent-set - hooks/palate-stop.mjs writes it from the exit code of
    // scripts/gate-mcp-depth.sh (0 or 2 = grounded, 3 = UNGROUNDED), so it cannot be
    // self-claimed. Null until the gate has run. UNGROUNDED is a LABEL, not a failure: the
    // build ran without the taste layer, which is allowed but must never be silent, and
    // recording it here is what lets the fact travel past this one session.
    grounding: null, // { state:"grounded"|"ungrounded", mcp_calls:int, checked_at, note }
  };
}

// Walk an arbitrary tool result and collect every `slug` string it contains.
function collectSlugs(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectSlugs(x, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "slug" && typeof v === "string") out.add(v);
    else collectSlugs(v, out);
  }
}

// MCP results often arrive as { content: [{ type:'text', text:'<json>' }] }; the
// slugs live inside that stringified JSON, so parse text blocks too.
function collectFromMcpResult(result, out) {
  collectSlugs(result, out);
  const blocks = result && Array.isArray(result.content) ? result.content : [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string") {
      try {
        collectSlugs(JSON.parse(b.text), out);
      } catch {
        /* not JSON; ignore */
      }
    }
  }
}

// A parsed JSON body that carried nothing to read. `{"results":[]}` and `{"ok":true}` are
// well-formed responses that surveyed no reference, and counting them as grounding is how a
// build with an empty library search can report that it drew on the library.
function jsonIsEmpty(j) {
  if (j == null) return true;
  if (Array.isArray(j)) return j.length === 0;
  if (typeof j === "string") return !j.trim();
  if (typeof j !== "object") return false;
  const keys = Object.keys(j);
  if (!keys.length) return true;
  return keys.every((k) => {
    const v = j[k];
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return !v.trim();
    // counts and flags describe a response; they are not content that was read
    return typeof v === "number" || typeof v === "boolean";
  });
}

// Did this call actually RETURN CONTENT? Three answers, and the third one matters:
//   "ok"       content came back; this is grounding
//   "empty"    the call was refused, errored, or returned nothing; this is NOT grounding
//   "unknown"  there is no result on the payload at all, so we cannot tell
// "unknown" deliberately still counts. If Claude Code renames the result field again, the
// honest failure is a manifest that over-counts grounding, not one that silently reports every
// build as ungrounded and turns the depth gate into noise on every machine at once.
function resultEvidence(result) {
  if (result === null || result === undefined) return "unknown";
  if (typeof result === "string") return result.trim() ? "ok" : "empty";
  if (typeof result !== "object") return "ok";
  if (result.isError === true || result.is_error === true) return "empty";

  const sc = result.structuredContent;
  if (sc && typeof sc === "object" && typeof sc.error === "string") return "empty";

  const blocks = Array.isArray(result.content) ? result.content : null;
  if (blocks) {
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text") {
        const t = typeof b.text === "string" ? b.text.trim() : "";
        if (!t) continue;
        let parsed;
        try {
          parsed = JSON.parse(t);
        } catch {
          return "ok"; // prose came back, so something was read
        }
        if (parsed && typeof parsed === "object" && (parsed.error || parsed.isError)) continue;
        if (jsonIsEmpty(parsed)) continue;
        return "ok";
      } else {
        return "ok"; // an image or an embedded resource is content
      }
    }
    return "empty";
  }

  if (sc && typeof sc === "object") return jsonIsEmpty(sc) ? "empty" : "ok";
  return jsonIsEmpty(result) ? "empty" : "ok";
}

// sec-49r.20: detect the MCP's quota_exceeded refusal in a tool result. The free tier caps
// DEEP READS (enriched/screenshot); search stays free. Without this the build keeps fanning
// doomed deep-read calls. Returns the structured signal { resetAt, upgradeUrl, ... } or null.
function detectQuota(result) {
  if (!result || typeof result !== "object") return null;
  if (result.structuredContent && result.structuredContent.error === "quota_exceeded") return result.structuredContent;
  const blocks = Array.isArray(result.content) ? result.content : [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string") {
      try { const j = JSON.parse(b.text); if (j && j.error === "quota_exceeded") return j; } catch { /* not JSON */ }
    }
  }
  let found = null;
  (function walk(n) { if (found || !n || typeof n !== "object") return; if (n.error === "quota_exceeded") { found = n; return; } for (const v of Object.values(n)) walk(v); })(result);
  return found;
}

// The hard-stop directive (PostToolUse decision:"block" feeds `reason` to the model).
// Copy signed off (sec-49r.20). Data-driven from the MCP signal where present.
// Aligns with SKILL.md 6.1's verbatim stop. The hook is the DETERMINISTIC backstop to that
// prompt instruction: 6.1 tells the model what to say, this makes the model actually stop.
function quotaStopDirective(q) {
  const pricing = (q && q.upgradeUrl) || "https://palatemcp.com/pricing";
  return [
    "⛔ PALATE FREE-TIER LIMIT REACHED — STOP DEEP READS.",
    "",
    "This Palate call was refused: you have used the free tier's daily deep-read cap (25 deep reference reads). Search is still unlimited, but finishing a full build needs more deep reads. Further deep-read calls (refs_get, refs_get_tokens, refs_get_screenshot, refs_get_astro_recipe) will keep failing until the cap resets at midnight UTC.",
    "",
    "DO THIS NOW:",
    "1. Stop making Palate deep-read calls — do not retry them in a loop.",
    `2. Tell the user, plainly: they have reached Palate's free daily limit; to finish this build now, upgrade to Pro at https://app.palatemcp.com/dashboard/billing (pricing: ${pricing}), then re-run the build.`,
    "3. Search stays FREE and unlimited (refs_search, refs_for_business, refs_match_brief) — only deep reads are capped.",
    "4. Continue only with the references already gathered, or pause until the user upgrades or the cap resets.",
  ].join("\n");
}

// Move a manifest that was started before the project directory existed into the project.
// A build DIVERGES before it SCAFFOLDS, so the first half of a build legitimately writes its
// telemetry beside the session cwd; the moment package.json + src/pages appear, that file
// belongs with the artefacts the gates read. Copy first, remove second, and on any failure
// keep using the old location: losing a diverge block would hard-block the next source write.
function adoptStaleManifest(ctx) {
  if (!ctx.stale || ctx.stale === path.join(ctx.dir, "build-manifest.json")) return ctx.manifest;
  const target = path.join(ctx.dir, "build-manifest.json");
  try {
    const body = fs.readFileSync(ctx.stale, "utf8");
    fs.writeFileSync(target, body);
  } catch {
    return ctx.manifest; // could not copy: stay where the data is
  }
  try {
    fs.rmSync(ctx.stale);
  } catch {
    /* the copy landed; a leftover original is untidy, not wrong (it is gitignored) */
  }
  return target;
}

function main() {
  const p = readStdin();
  if (!p) return;
  const tool = p.tool_name || "";
  const input = p.tool_input || {};
  const result = p.tool_response ?? p.tool_output ?? p.toolResponse ?? null;
  const written = input.file_path || input.filePath || input.path;

  // ONE answer to "which project is this", shared with palate-stop.mjs and palate-pretooluse.mjs.
  // The file being written is the strongest hint available: a write into src/pages/index.astro
  // names its project even when the session cwd sits two levels above it.
  const ctx = resolveBuildContext(p.cwd || process.cwd(), { hint: written });
  const MANIFEST = adoptStaleManifest(ctx);
  const projectDir = ctx.dir;

  let m = load(MANIFEST) ?? blank();
  // A manifest belongs to ONE build. If the project underneath it has changed, start fresh
  // rather than keep appending: a merged manifest reports references and file writes from a
  // different site, and every gate downstream reads it as one build's evidence.
  if (typeof m.project === "string" && m.project !== projectDir) {
    process.stderr.write(
      `[palate] build-manifest.json at ${MANIFEST} was recorded for ${m.project}; the project is now ${projectDir}. Starting a fresh manifest rather than merging two builds.\n`,
    );
    m = blank();
  }
  m.project = projectDir;
  m.project_resolved_by = ctx.how;
  if (!Array.isArray(m.layers_read)) m.layers_read = []; // back-compat with schema 1 manifests
  // Upgrade a schema-1/2 manifest in place: add the schema-3 evidence blocks
  // without disturbing any existing field. Never invents a pass; the blocks
  // start null/[] and are filled by the agent/scripts later.
  if ((m.schema ?? 1) < 3) {
    m.diverge ??= null;
    m.converge ??= null;
    m.commission ??= null;
    if (!Array.isArray(m.variants)) m.variants = [];
    m.visual ??= null;
    m.novelty ??= null;
    m.verifier ??= null;
    m.buildability ??= null;
    m.schema = 3;
  }
  // commission is an additive schema-3 block; backfill it on an already-schema-3
  // manifest written before it existed, via the same null-default guard. This keeps
  // every older manifest readable without a schema bump or a hard trap.
  if (!("commission" in m)) m.commission = null;
  // explore is the additive W1 block; backfill it on an older schema-3 manifest the
  // same way, so a build that started before this field exists stays readable.
  if (!("explore" in m)) m.explore = null;
  if (!("architecture" in m)) m.architecture = null; // additive W16 block
  if (!("grounding" in m)) m.grounding = null; // additive third-state label (script-set)
  if (!Array.isArray(m.mcp_failures)) m.mcp_failures = []; // additive: refused/empty calls
  if (!Array.isArray(m.files_written_outside)) m.files_written_outside = [];

  if (tool.startsWith("mcp__palate__")) {
    const evidence = resultEvidence(result);
    if (evidence === "empty") {
      // Refused or empty. Record it so a broken connection is visible, and do NOT let it feed
      // references_surveyed, inner_pages_viewed or layers_read: the request named a slug, the
      // response never delivered it, and a gate that cannot tell those apart can be satisfied
      // by calls that returned nothing at all.
      m.mcp_failures.push({ tool, args: input, ts: new Date().toISOString() });
      if (m.mcp_failures.length === 1) {
        process.stderr.write(
          `[palate] a Palate call (${tool}) returned no content; recorded as a failure, not as grounding.\n`,
        );
      }
      try {
        fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
      } catch {
        /* never wedge a build over a manifest write */
      }
      const q = detectQuota(result);
      if (q) process.stdout.write(JSON.stringify({ decision: "block", reason: quotaStopDirective(q) }));
      return;
    }

    const slugs = new Set();
    collectFromMcpResult(result, slugs);
    if (typeof input.slug === "string") slugs.add(input.slug);
    if (Array.isArray(input.slugs)) for (const s of input.slugs) if (typeof s === "string") slugs.add(s);
    const slugList = [...slugs];
    m.mcp_calls.push({ tool, args: input, slugs: slugList, evidence, ts: new Date().toISOString() });
    for (const s of slugList) if (!m.references_surveyed.includes(s)) m.references_surveyed.push(s);
    // An inner-page view = looking at a specific inner page screenshot.
    if (tool === "mcp__palate__refs_get_screenshot" && input.page && input.slug) {
      const seen = m.inner_pages_viewed.some((v) => v.slug === input.slug && v.page === input.page);
      if (!seen) m.inner_pages_viewed.push({ slug: input.slug, page: input.page });
    }
    // R2 rich-layer depth signal: record which intent-named refs_get layers the
    // build actually pulled (format:"design" counts as the 'design' layer). And
    // layer:"pages" is the LLM-native inner-page read, so it counts as inner-page
    // coverage the same as viewing an inner-page screenshot.
    if (tool === "mcp__palate__refs_get") {
      const layers = Array.isArray(input.layer) ? input.layer.slice() : (typeof input.layer === "string" ? [input.layer] : []);
      if (input.format === "design") layers.push("design");
      for (const l of layers) if (!m.layers_read.includes(l)) m.layers_read.push(l);
      if (layers.includes("pages")) {
        for (const s of slugList) {
          if (!m.inner_pages_viewed.some((v) => v.slug === s && v.page === "pages")) m.inner_pages_viewed.push({ slug: s, page: "pages" });
        }
      }
    }
  } else if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    const fp = written;
    if (fp) {
      // Only file the write under this build when it landed INSIDE the project, and only when
      // the project was actually detected. `how === "fallback"` means nothing was detected, and
      // filtering on a guess would empty files_written, which is what the Stop hook uses to
      // decide a build happened at all: the gates would go quiet without saying why.
      const abs = path.isAbsolute(fp) ? fp : path.resolve(projectDir, fp);
      const inside =
        ctx.how === "fallback" ||
        abs === projectDir ||
        abs.startsWith(projectDir.endsWith(path.sep) ? projectDir : projectDir + path.sep);
      if (inside) {
        if (!m.files_written.includes(fp)) m.files_written.push(fp);
      } else if (!m.files_written_outside.includes(fp)) {
        m.files_written_outside.push(fp);
      }
    }
  } else {
    return; // not a tool we track
  }

  try {
    fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  } catch {
    /* never wedge a build over a manifest write */
  }

  // sec-49r.20 hard-stop: if THIS palate call was refused for quota, feed the model a
  // forceful STOP directive so it does not keep fanning doomed deep-read calls. Only fires
  // on a real quota_exceeded signal; every other call stays silent (exit 0).
  if (tool.startsWith("mcp__palate__")) {
    const q = detectQuota(result);
    if (q) process.stdout.write(JSON.stringify({ decision: "block", reason: quotaStopDirective(q) }));
  }
}

main();
process.exit(0);
