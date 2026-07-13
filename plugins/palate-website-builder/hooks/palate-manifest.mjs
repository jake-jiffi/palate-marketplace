#!/usr/bin/env node
/**
 * hooks/palate-manifest.mjs - the build-manifest keystone (PostToolUse).
 *
 * Registered at the USER level (~/.claude/settings.json) by scripts/install.sh,
 * matched on `mcp__palate__.*` and `Edit|Write|MultiEdit`. On every matched tool
 * call it appends real telemetry to `build-manifest.json` at the project root
 * (cwd), so the depth gate reads what the build ACTUALLY did, not what the agent
 * claims. This is the source of truth every other gate hangs off.
 *
 * PostToolUse delivers the tool RESULT in the payload. The field is `tool_response`
 * in current Claude Code; we also read `tool_output`/`toolResponse` defensively so
 * a field-name change cannot silently empty the manifest.
 *
 * Never blocks (PostToolUse cannot). Exit 0 always; failures are swallowed so the
 * hook can never wedge a build.
 */
import fs from "node:fs";
import path from "node:path";

const MANIFEST = path.join(process.cwd(), "build-manifest.json");

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

function blank() {
  return {
    schema: 3, // was 2
    created_at: new Date().toISOString(),
    business: null,
    signature_move: null,
    mcp_calls: [],
    references_surveyed: [],
    inner_pages_viewed: [],
    layers_read: [], // R2: intent-named refs_get layers actually pulled (depth signal)
    files_written: [],
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

function main() {
  const p = readStdin();
  if (!p) return;
  const tool = p.tool_name || "";
  const input = p.tool_input || {};
  const result = p.tool_response ?? p.tool_output ?? p.toolResponse ?? null;

  const m = load() ?? blank();
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

  if (tool.startsWith("mcp__palate__")) {
    const slugs = new Set();
    collectFromMcpResult(result, slugs);
    if (typeof input.slug === "string") slugs.add(input.slug);
    if (Array.isArray(input.slugs)) for (const s of input.slugs) if (typeof s === "string") slugs.add(s);
    const slugList = [...slugs];
    m.mcp_calls.push({ tool, args: input, slugs: slugList, ts: new Date().toISOString() });
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
    const fp = input.file_path || input.filePath || input.path;
    if (fp && !m.files_written.includes(fp)) m.files_written.push(fp);
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
