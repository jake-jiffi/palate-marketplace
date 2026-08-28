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

// ABSENT AND UNREADABLE ARE NOT THE SAME THING, and treating them alike is how a build's whole
// survey disappears without a word. Absent means a fresh start, which is correct. Unreadable
// means evidence EXISTS and we are about to write over it: archive it first and say so.
//
// The symlink rung is not hypothetical. On a real build an agent replaced the manifest with a
// symlink to a sibling path to "unify" two locations; the target had already been moved away, so
// every subsequent write went through a dangling link and silently created a fresh default
// manifest. Follow a live link (its target is the real file), and clear a dead one so the write
// lands on a real file rather than conjuring one at the far end of a broken pointer.
function load(manifestPath) {
  try {
    const st = fs.lstatSync(manifestPath);
    if (st.isSymbolicLink()) {
      let target = null;
      try {
        target = fs.realpathSync(manifestPath);
      } catch {
        /* dangling */
      }
      if (!target) {
        process.stderr.write(
          `[palate] ${manifestPath} is a DANGLING symlink; removing it so telemetry lands on a real file.\n`,
        );
        try {
          fs.unlinkSync(manifestPath);
        } catch {
          /* cannot remove: the write below will fail loudly enough */
        }
        return null;
      }
      process.stderr.write(
        `[palate] ${manifestPath} is a symlink to ${target}; following it. A manifest should be a real file: two paths for one build is how evidence gets lost.\n`,
      );
    }
  } catch {
    return null; // genuinely absent
  }

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt, but NOT empty. Keep it: it is the only copy of whatever it recorded.
    const bak = `${manifestPath}.corrupt-${Date.now()}.json`;
    try {
      fs.writeFileSync(bak, raw);
      process.stderr.write(
        `[palate] build-manifest.json did not parse. The unreadable copy is kept at ${bak} and a fresh manifest starts now. Any survey recorded in it is NOT counted.\n`,
      );
    } catch {
      process.stderr.write("[palate] build-manifest.json did not parse and could not be archived; a fresh manifest starts now.\n");
    }
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

/**
 * The facts, in the MCP's own words.
 *
 * The MCP knows the cap, the window and the reset date, and it deploys independently of this
 * plugin. Quoting it is what stops this directive going stale, which it comprehensively did:
 * it hardcoded "25 deep reference reads", called the cap DAILY and told the user it "resets
 * at midnight UTC", while the real allowance has been 20 A MONTH since pricing v3, resetting
 * on the 1st. A capped user was being told to wait a few hours when the true wait could be
 * thirty days, at the exact moment we most want them to upgrade.
 *
 * Takes the first paragraph only: the MCP's message states what happened, and the call to
 * action after it is composed below rather than quoted twice.
 */
function quotaFacts(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string" && !b.text.trimStart().startsWith("{")) {
      const first = b.text.split(/\n\s*\n/)[0].trim();
      if (first) return first;
    }
  }
  return null;
}

/** When the allowance comes back, and whether waiting is a realistic answer. */
function quotaResetLine(q) {
  const t = Date.parse(q?.resetAt ?? "");
  if (!Number.isFinite(t)) return null;
  const days = Math.round((t - Date.now()) / 86_400_000);
  const on = new Date(t).toISOString().slice(0, 10);
  return days >= 1
    ? `The allowance resets on ${on}, about ${days} day${days === 1 ? "" : "s"} away, so waiting is NOT a fix for this build.`
    : `The allowance resets on ${on}.`;
}

// The hard-stop directive (PostToolUse decision:"block" feeds `reason` to the model).
// Aligns with SKILL.md 6.1's verbatim stop. The hook is the DETERMINISTIC backstop to that
// prompt instruction: 6.1 tells the model what to say, this makes the model actually stop.
// Every number in it is now read from the MCP signal; nothing about the plan is hardcoded.
function quotaStopDirective(q, result) {
  const facts = quotaFacts(result) || "A Palate deep read was refused: this plan's allowance is spent.";
  const url = (q && q.upgradeUrl) || "https://palatemcp.com/pricing";
  // upgradeUrlIsPersonalised means the MCP minted a signed one-click checkout link for THIS
  // customer. Leading with the dashboard billing page instead (as this did) buries a
  // no-sign-in path under one that needs a login and a six-digit code from an email client.
  const oneClick = Boolean(q && q.upgradeUrlIsPersonalised);
  const searchFree = !q || q.searchStillAvailable !== false;
  const resets = quotaResetLine(q);

  const lines = ["⛔ PALATE ALLOWANCE SPENT — STOP DEEP READS.", "", facts];
  if (resets) lines.push("", resets);
  lines.push(
    "",
    "DO THIS NOW:",
    "1. Stop calling Palate deep reads (refs_get, refs_get_tokens, refs_get_screenshot, refs_get_astro_recipe). They will keep failing. Do not retry them in a loop.",
    oneClick
      ? `2. Tell the user plainly that the build has reached Palate's allowance, and give them this link, which opens checkout directly with no sign-in: ${url}`
      : `2. Tell the user plainly that the build has reached Palate's allowance, and point them at ${url}`,
  );
  if (searchFree) {
    lines.push("3. Search stays FREE and unlimited (refs_search, refs_for_business, refs_match_brief). Only deep reads are capped, so keep searching if it helps.");
  }
  lines.push(
    `${searchFree ? "4" : "3"}. Then either continue with the references already gathered, or pause until they upgrade. Do NOT claim the survey was deeper than it was.`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------
// EVIDENCE SURVIVAL. Everything below exists because a survey is expensive, irreplaceable and,
// until now, deletable by half a dozen ordinary accidents.
// ---------------------------------------------------------------------------------------

/**
 * Is the move from `was` to `now` the same build descending into its scaffold (or climbing back
 * out), rather than a different build entirely? Containment either way, because a manifest can
 * legitimately travel in both directions: down when the scaffold appears, up if a tool call is
 * resolved from the workspace root before the project is detected again.
 */
function isSameBuildMove(was, now) {
  try {
    const a = path.resolve(was);
    const b = path.resolve(now);
    if (a === b) return true;
    const under = (parent, child) => child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
    return under(a, b) || under(b, a);
  } catch {
    return false;
  }
}

/** Keep a copy before anything is thrown away. Returns the archive path, or null if it failed. */
function archiveManifest(manifestPath, m) {
  const calls = Array.isArray(m?.mcp_calls) ? m.mcp_calls.length : 0;
  const files = Array.isArray(m?.files_written) ? m.files_written.length : 0;
  if (calls === 0 && files === 0) return null; // nothing worth keeping
  const bak = `${manifestPath}.previous-${Date.now()}.json`;
  try {
    fs.writeFileSync(bak, JSON.stringify(m, null, 2) + "\n");
    return bak;
  } catch {
    return null;
  }
}

const JOURNAL_REL = path.join(".palate", "mcp-journal.jsonl");

function journalPath(manifestPath) {
  return path.join(path.dirname(manifestPath), JOURNAL_REL);
}

/**
 * Append one Palate call to the journal, which is the record of last resort.
 *
 * The manifest is a document: it gets rewritten whole on every tool call, moved when the
 * scaffold appears, and is a single file that any number of accidents can empty. The journal is
 * a LOG: one line per call, only ever appended, never rewritten. A survey recorded here survives
 * a manifest that is deleted, blanked, symlinked away or corrupted, which between them account
 * for every way we have actually lost one.
 */
function appendJournal(manifestPath, entry) {
  const jp = journalPath(manifestPath);
  try {
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    fs.appendFileSync(jp, JSON.stringify(entry) + "\n");
  } catch {
    /* the journal is a safety net, never a reason to wedge a build */
  }
}

/** Read the journal back. Tolerates a torn final line, which append-only files can have. */
function readJournal(manifestPath) {
  try {
    return fs
      .readFileSync(journalPath(manifestPath), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Put back any Palate call the journal has and the manifest does not.
 *
 * Deliberately additive and idempotent: entries are matched on tool + timestamp, so a manifest
 * that lost nothing is left byte-identical and a manifest that lost everything is rebuilt. It
 * restores only what the journal actually witnessed, never a count.
 */
function rehydrateFromJournal(m, manifestPath) {
  const journal = readJournal(manifestPath);
  if (!journal.length) return;
  if (!Array.isArray(m.mcp_calls)) m.mcp_calls = [];
  const seen = new Set(m.mcp_calls.map((c) => `${c.tool}|${c.ts}`));
  const missing = journal.filter((e) => !seen.has(`${e.tool}|${e.ts}`));
  if (!missing.length) return;

  for (const e of missing) m.mcp_calls.push(e);
  m.mcp_calls.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  if (!Array.isArray(m.references_surveyed)) m.references_surveyed = [];
  if (!Array.isArray(m.inner_pages_viewed)) m.inner_pages_viewed = [];
  if (!Array.isArray(m.layers_read)) m.layers_read = [];
  for (const e of missing) {
    for (const s of e.slugs || []) if (!m.references_surveyed.includes(s)) m.references_surveyed.push(s);
    const a = e.args || {};
    if (e.tool === "mcp__palate__refs_get_screenshot" && a.page && a.slug) {
      if (!m.inner_pages_viewed.some((v) => v.slug === a.slug && v.page === a.page)) {
        m.inner_pages_viewed.push({ slug: a.slug, page: a.page });
      }
    }
    if (e.tool === "mcp__palate__refs_get") {
      const layers = Array.isArray(a.layer) ? a.layer.slice() : typeof a.layer === "string" ? [a.layer] : [];
      if (a.format === "design") layers.push("design");
      for (const l of layers) if (!m.layers_read.includes(l)) m.layers_read.push(l);
      if (layers.includes("pages")) {
        for (const s of e.slugs || []) {
          if (!m.inner_pages_viewed.some((v) => v.slug === s && v.page === "pages")) {
            m.inner_pages_viewed.push({ slug: s, page: "pages" });
          }
        }
      }
    }
  }
  process.stderr.write(
    `[palate] restored ${missing.length} Palate call(s) from ${JOURNAL_REL}; the manifest had lost them.\n`,
  );
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
  // The journal moves WITH the manifest, or the survey recorded before the scaffold would be
  // stranded in the workspace root while the manifest that needs it lives in the project.
  try {
    const from = journalPath(ctx.stale);
    const to = journalPath(target);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      try {
        fs.rmSync(from);
      } catch {
        /* a leftover journal is untidy, not wrong */
      }
    }
  } catch {
    /* never wedge a build over the safety net */
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
  // A manifest belongs to ONE build, so telemetry from an unrelated repo must not keep
  // accumulating into one file. But the first version of this check compared the two paths for
  // EQUALITY, and that destroyed the survey of very nearly every build.
  //
  // THE BUILD ORDER IS THE BUG. A Palate build surveys and diverges BEFORE it scaffolds, so for
  // the first hour the only honest project is the session cwd and the manifest records it.
  // The moment `package.json` + `src/pages` appear, the resolver correctly starts answering
  // WORK_ROOT/{slug}-site, the recorded project no longer equals it, and this branch wiped
  // mcp_calls, references_surveyed, inner_pages_viewed and layers_read: the entire survey, on
  // the normal path, silently. Every gate downstream then read the build as ungrounded, which is
  // exactly what happened on a real client build that had called the library and lost the record.
  //
  // A SCAFFOLD IS A DESCENT, A DIFFERENT BUILD IS NOT. So the rule is containment, not equality:
  // if the recorded project contains the new one (or vice versa) this is the same build moving
  // into its scaffold, and the evidence is carried over. Only a genuinely unrelated directory
  // starts fresh, and even then the old file is ARCHIVED first: no path through this hook may
  // destroy the only record of a survey.
  if (typeof m.project === "string" && m.project !== projectDir) {
    if (isSameBuildMove(m.project, projectDir)) {
      process.stderr.write(
        `[palate] the project moved from ${m.project} to ${projectDir} (the scaffold appeared). Carrying the survey across: ${(m.mcp_calls || []).length} Palate call(s), ${(m.references_surveyed || []).length} reference(s).\n`,
      );
    } else {
      const archived = archiveManifest(MANIFEST, m);
      process.stderr.write(
        `[palate] build-manifest.json at ${MANIFEST} was recorded for ${m.project}; the project is now ${projectDir}. Starting a fresh manifest rather than merging two builds.` +
          (archived ? ` The previous one is kept at ${archived}.` : "") +
          "\n",
      );
      m = blank();
    }
  }
  // Belt and braces for every OTHER way a manifest can lose its history (deleted by hand,
  // replaced by a symlink to a file that was then moved, clobbered by a second writer): the
  // journal is append-only and is the record of last resort.
  //
  // NOT ON EVERY CALL. A Write is the hottest path through this hook and re-parsing the whole
  // log there would cost the build nothing but time. An empty mcp_calls is the catastrophic
  // case and is a free check; a Palate call is the only moment a partial loss actually matters,
  // since depth is measured from these numbers. Between them they cover every case a gate reads.
  const couldHaveLostCalls =
    !Array.isArray(m.mcp_calls) || m.mcp_calls.length === 0 || tool.startsWith("mcp__palate__");
  if (couldHaveLostCalls) rehydrateFromJournal(m, MANIFEST);
  // Record the project, but NEVER demote it to an ancestor. A tool call resolved from the
  // workspace root (a scratch write, a fallback) legitimately answers the parent directory, and
  // rewriting the anchor to it would leave the manifest pointing at the workspace rather than
  // the site, which is what makes a SECOND build in the same workspace look like a continuation
  // of the first. Descending is a real move and is recorded; climbing out is a resolution
  // artefact and is not.
  const climbingOut =
    typeof m.project === "string" && m.project !== projectDir && isSameBuildMove(m.project, projectDir) &&
    m.project.startsWith(projectDir.endsWith(path.sep) ? projectDir : projectDir + path.sep);
  if (!climbingOut) {
    m.project = projectDir;
    m.project_resolved_by = ctx.how;
  }
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
      if (q) process.stdout.write(JSON.stringify({ decision: "block", reason: quotaStopDirective(q, result) }));
      return;
    }

    const slugs = new Set();
    collectFromMcpResult(result, slugs);
    if (typeof input.slug === "string") slugs.add(input.slug);
    if (Array.isArray(input.slugs)) for (const s of input.slugs) if (typeof s === "string") slugs.add(s);
    const slugList = [...slugs];
    const entry = { tool, args: input, slugs: slugList, evidence, ts: new Date().toISOString() };
    m.mcp_calls.push(entry);
    // The journal is written FIRST-class, beside the manifest, on the same call. If the manifest
    // write below fails, or the file is later blanked, moved or symlinked away, this line is
    // what proves the survey happened.
    appendJournal(MANIFEST, entry);
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
    if (q) process.stdout.write(JSON.stringify({ decision: "block", reason: quotaStopDirective(q, result) }));
  }
}

main();
process.exit(0);
