#!/usr/bin/env node
/**
 * hooks/palate-stop.mjs - make "done" machine-checkable from evidence (Stop hook).
 *
 * Registered at the user level. It only acts on a real build (a build-manifest.json that
 * recorded source writes); non-build sessions pass untouched. It finds that manifest through
 * hooks/project-dir.mjs, the same resolver the manifest hook writes through, because looking
 * in the session cwd while gate-done.sh reads the artefacts beside the manifest is how the
 * whole visual half of the suite ended up evaluating against nothing.
 * On a real build it runs, in order:
 *   1. the MCP-depth gate (gate-mcp-depth.sh)  - KEEP THE FLOOR, unchanged behaviour.
 *   2. the DONE gate (gate-done.sh)            - the VISUAL loop ran + passed
 *      (screenshots on disk, zero console errors, every rubric axis cleared the bar)
 *      AND the fresh-context palate-verifier ran + returned verdict:pass. It reads the
 *      real ARTEFACTS (verify-report.json, .palate-shots/*), never a manifest boolean
 *      an LLM could have set - anti-reward-hacking is the whole point.
 *   3. fold the computed verdicts into build-manifest.json (manifest-merge.mjs) so the
 *      manifest's visual/verifier blocks are a cache of computed evidence.
 *
 * Both gates FAIL OPEN: each skips (exit 0) when it cannot run - no jq, no manifest, no
 * readable manifest, and (gate-done only) no renderable preview (no dist/ and no
 * verify-report.json). So enforcement fires ONLY on a build that COULD have been
 * verified and was not - never on a public-plugin user whose token is not set or who is
 * editing an existing app.
 *
 * THE THIRD STATE. A build that recorded ZERO Palate MCP calls (MCP not connected, or
 * surveyed in a subagent) is UNGROUNDED: gate-mcp-depth.sh exits 3, this hook records
 * `grounding` in the manifest, lets the done gate and recordBuild run as normal, and
 * states the label ONCE on stderr with the reconnect command. It never blocks, not even
 * under PALATE_GATE_STRICT=1. Absence is now visible, which is what stops it having to
 * be fatal upstream.
 *
 * Enforcement split (the "enforce-when-possible" default): the GATES enforce when they
 * CAN (renderable + MCP connected); the HOOK stays nudge-by-default. On any gate
 * failure: by DEFAULT allow finishing with a loud non-blocking reminder; HARD-BLOCK
 * (decision:"block") only under PALATE_GATE_STRICT=1. recordBuild runs ONLY after ALL
 * gates pass, so a build that fails the loop is not written to cross-build memory.
 *
 * SHIP-READINESS BLOCKS, it does not nudge. Unresolved {{PLACEHOLDER}} tokens, rejected Explore
 * concepts still routed on the client's domain and photographs nobody measured are all
 * client-facing damage, and routing them through the nudge path meant they reached nobody on a
 * default install. They are now read as positive on-disk evidence, scoped to an active build
 * site so an ordinary Astro edit session is never trapped by an absence check.
 *
 * A BLOCK IS NOT CLEARED BY STOPPING AGAIN. `stop_hook_active` used to release the hook
 * unconditionally, so two stops shipped a build with the same failures still on disk. The
 * release now requires the evidence to have MOVED, bounded by a counter in the manifest
 * (PALATE_STOP_MAX_BLOCKS, PALATE_STOP_MAX_TOTAL) so it cannot loop, and a release past the
 * bound is printed on stderr with the outstanding failures rather than passing quietly.
 *
 * Escape hatch: PALATE_GATE_OFF=1. Hard enforcement: PALATE_GATE_STRICT=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildLogEntry } from "./build-log-entry.mjs";
import { resolveBuildContext } from "./project-dir.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "..", "scripts", "gate-mcp-depth.sh");
const DONE_GATE = path.join(HERE, "..", "scripts", "gate-done.sh");
const MERGE = path.join(HERE, "..", "scripts", "manifest-merge.mjs");
const PHANTOM = path.join(HERE, "..", "scripts", "phantom-utility-check.mjs");
const SOURCE = /\.(astro|svelte|vue|tsx?|jsx?|mjs|css|scss)$/i;
const OVERFLOW_PX = 16; // a layout break, not a scrollbar/sub-pixel (clean builds read ~0)

// Positive ON-DISK evidence of a REAL failure - the "enforce on evidence" layer. Unlike a
// gate exit code (which conflates a real fail with could-not-verify, e.g. a subagent survey
// the depth gate cannot see), every signal here fires ONLY when the evidence is PRESENT and
// BAD, so an absent artefact is never a false trap. These BLOCK by default; the softer gate
// failures keep nudging unless PALATE_GATE_STRICT=1. Console errors, phantom utilities and
// verdict:fail are unambiguous; overflow is conservative (>16px) so it never trips on a clean
// page. This is what closes the "verdict:pass shipped a broken site" gap without false-blocking.
function positiveFailures(proj, markerDirs = []) {
  const reasons = [];
  const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const rep = readJSON(path.join(proj, "verify-report.json"));
  const sm = readJSON(path.join(proj, ".palate-shots", "manifest.json"));

  // 1. Runtime console errors on the rendered page (the driver's own count).
  let consoleErrs = null;
  if (sm && Number.isFinite(sm.console_errors)) consoleErrs = sm.console_errors;
  else if (rep && rep.visual && Number.isFinite(rep.visual.console_errors)) consoleErrs = rep.visual.console_errors;
  if (consoleErrs > 0) reasons.push(`${consoleErrs} runtime console error(s) on the rendered page (.palate-shots/errors.json) - a thrown build cannot ship`);

  // 2. PAGE-LEVEL horizontal overflow only: the whole document wider than the viewport =
  //    horizontal scroll = a layout break. Page-level is the robust, low-FP signal (a real
  //    build reads ~0; a too-wide row spilling past the viewport reads hundreds of px).
  //    Per-section internal overflow (s.overflow in the manifest) is deliberately NOT a
  //    block: scrollWidth-clientWidth picks up shadows, decorative bleeds and sub-pixel, so
  //    a clean section can read ~20px - that is the verifier/persona's call, not a hard gate.
  if (sm) {
    const pageOv = Object.entries(sm.overflow || {}).filter(([, v]) => Number(v) > OVERFLOW_PX);
    if (pageOv.length) reasons.push(`the page scrolls horizontally (content wider than the viewport) at ${pageOv.map(([vp, v]) => `${vp} +${Math.round(v)}px`).join(", ")} - a layout break`);
  }

  // 3. Phantom/undefined utility classes (compile to nothing -> unstyled markup). Re-run the
  //    static check against the FRESH dist only (--require-fresh SKIPs a stale oracle, so a
  //    not-rebuilt tree never false-flags real utilities); exit 1 = real phantoms present.
  if (fs.existsSync(path.join(proj, "dist")) && fs.existsSync(PHANTOM)) {
    try {
      execFileSync("node", [PHANTOM, proj, "--no-build", "--require-fresh", "--ci"], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      if (e && e.status === 1) reasons.push("phantom/undefined Tailwind utility classes that compile to nothing (they ship as unstyled markup) - run scripts/phantom-utility-check.mjs to list them, fix the names, rebuild");
      /* status 2 = stale/internal = could-not-verify; never block on it */
    }
  }

  // 4. The fresh-context verifier itself returned verdict:fail (it ran and judged it a fail).
  if (rep && rep.verdict === "fail") reasons.push("the fresh-context verifier returned verdict:fail (see verify-report.json) - resolve the named findings");

  // 5. Rendered-page failures from verify-rendered.mjs: interaction state (it drives a real
  //    pointer / keyboard and asserts the state changed) and accessibility (an axe pass over
  //    the rules the GRADER scores, run at all three viewports because a pass only ever tests
  //    what is on screen when it runs). Only the OBJECTIVE, low-FP checks are written here (a
  //    dead hover, a deleted focus ring, a nav that never opens or traps Escape, an axe
  //    violation but never an axe `incomplete`); softer findings stay advisory. So a PRESENT,
  //    non-empty list is a real, blockable failure; an absent file = the pass did not run
  //    (never a false trap), consistent with every other signal above.
  const ix = readJSON(path.join(proj, ".palate-shots", "interaction.json"));
  if (ix && Array.isArray(ix.interaction_failures) && ix.interaction_failures.length) {
    const all = ix.interaction_failures;
    const n = all.length;
    // THE HYGIENE ENTRY IS HOISTED, not merely sampled. It carries the whole self-heal loop:
    // the build hygiene score against the floor, whether the last iteration improved or
    // regressed it, the ranked gaps with a fix each, and the exact command to re-run.
    // verify-rendered already unshifts it to the head of the list, but sampling the first three
    // entries is a silent dependency on that ordering, and behind five axe rows the one message
    // the agent needs to converge would never reach it. Pick it explicitly.
    const isHygiene = (f) => f && f.rule === "hygiene-below-floor";
    const grade = all.find(isHygiene);
    const rest = all.filter((f) => !isHygiene(f));
    const picked = [...(grade ? [grade] : []), ...rest.slice(0, grade ? 2 : 3)];
    const sample = picked.map((f) => (f && f.msg ? f.msg : String(f))).join("; ");
    // Accessibility only: the design and vitals entries also carry a `check`, and counting a
    // slow LCP or a Tailwind-default accent as "an accessibility violation you must not
    // suppress" sends the agent at the wrong file. The interaction entries (focus-visible,
    // nav-escape-dismiss) carry no `rule` and stay counted, as they always were.
    const NOT_A11Y = new Set(["framework-default-accent", "tap-target-under-24px", "mobile-body-under-16px"]);
    const a11y = rest.filter((f) => f && f.check && !NOT_A11Y.has(f.rule)
      && !String(f.rule ?? "").startsWith("vitals-")).length;
    // Contrast is the one worth naming a number against: the grader reads it as a binary,
    // so a single failing node anywhere costs 22 of the 100 accessibility points.
    const tail = a11y
      ? ` - ${a11y} of these are accessibility violations the grader scores; fix the markup or the token, do not suppress the rule`
      : " - drive the state, fix it, and re-verify";
    const heal = grade && grade.stalled
      ? " - the build hygiene score has STALLED: stop iterating and escalate the named gaps to the human"
      : grade
        ? " - fix the ranked gaps above, rebuild, and RE-RUN the command in that message so the next run reports whether it moved"
        : "";
    reasons.push(`${n} rendered-page failure(s) (.palate-shots/interaction.json): ${sample}${n > picked.length ? "; ..." : ""}${tail}${heal}`);
  }

  // 6. SHIP-READY: the seam between "built" and "deliverable". Unresolved {{PLACEHOLDER}}
  //    tokens in a third-party script tag, eight rejected concept homepages still routed and
  //    in the sitemap, photographs nobody ever measured. Every one of those is client-facing
  //    damage on a real domain, and every one shipped on a build that passed every other gate.
  //    IT BELONGS HERE, NOT IN THE NUDGE PATH. gate-done.sh already runs this gate, but a
  //    gate-done failure is downgraded to a stderr line unless PALATE_GATE_STRICT=1, so the
  //    findings reached nobody on a default install. Run it directly and treat it like every
  //    other positive signal here: exit 1 is PRESENT and BAD evidence, exit 2 is CANNOT CHECK
  //    (no src/pages) and never blocks. PALATE_GATE_OFF=1 still bypasses everything.
  //
  //    SCOPED TO AN ACTIVE BUILD SITE, same as the DIVERGE wall in gate-done.sh. One of its
  //    three findings is an ABSENCE ("src uses images but .palate/assets.json never existed"),
  //    and an absence check outside its own flow is exactly the shape that traps someone who
  //    was only editing their own Astro site with the plugin installed. The marker
  //    (.palate-skill-state.json) is written only by the BUILD SITE flow, so no marker means
  //    no handover seam to be unready for.
  const SHIPREADY = path.join(HERE, "..", "scripts", "gate-shipready.mjs");
  const isBuildSite = markerDirs.some((d) => {
    try { return fs.existsSync(path.join(d, ".palate-skill-state.json")); } catch { return false; }
  });
  if (isBuildSite && fs.existsSync(SHIPREADY) && fs.existsSync(path.join(proj, "src", "pages"))) {
    try {
      execFileSync("node", [SHIPREADY, proj], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      if (e && e.status === 1) {
        const detail = (e.stderr ? e.stderr.toString() : "").trim().replace(/\s*\n\s*/g, " ");
        reasons.push(`not ready to hand over: ${detail || "gate-shipready.mjs reported findings; run it for the list"}`);
      }
      /* status 2 = cannot check (not an Astro project shape); never block on it */
    }
  }

  return reasons;
}

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Pull the display FACE names a rendered variant actually used, so cross-build
// type-face recurrence (the smell gate-novelty.mjs catches) has data. The recurring
// FACE across unrelated builds is the tell, not the family - see references/type-
// selection.md. Normalise each declaration's first family + Google-Fonts link families
// to a bare lower-case token; drop the generic fallbacks.
function facesFromHtml(html) {
  const faces = new Set();
  const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset", ""]);
  // Capture the whole value up to ; or } (quotes included) so a quoted first family is read.
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const f = m[1].replace(/['"]/g, "").split(",")[0].trim().toLowerCase().replace(/\s+/g, " ");
    if (!GENERIC.has(f) && !f.startsWith("var(")) faces.add(f);
  }
  for (const m of html.matchAll(/family=([A-Za-z0-9+]+)/g)) {
    const f = m[1].replace(/\+/g, " ").trim().toLowerCase();
    if (!GENERIC.has(f)) faces.add(f);
  }
  return [...faces];
}

// Write the GROUNDING label into the manifest from the depth gate's exit code, so the
// fact that a build ran without the taste layer travels beyond this one stderr line.
// SCRIPT-computed from the gate's exit code AND the telemetry, never an LLM boolean.
// THREE states, because exit 0 has three meanings and only one of them is "passed": the
// gate can also skip when jq is missing or the manifest is unreadable. Deriving the label
// from "not exit 3" therefore stamps `grounded` on a build with zero MCP calls, which is
// the silent degradation this whole change exists to remove, written to disk as a fact.
//   ungrounded  the gate ran and found no Palate MCP calls
//   unknown     the gate could not run (no jq, unreadable manifest) and there is no
//               telemetry either, so grounding was never determined. Never claim otherwise.
//   grounded    the telemetry is there (whether or not the build was deep enough)
// Best-effort, like recordBuild: the label must never be the thing that traps a session.
function recordGrounding(manifest, depth) {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const calls = Array.isArray(m.mcp_calls) ? m.mcp_calls.length : 0;
    const state =
      depth.state === "ungrounded" ? "ungrounded" : calls === 0 ? "unknown" : "grounded";
    m.grounding = {
      state,
      mcp_calls: calls,
      checked_at: new Date().toISOString(),
      note:
        state === "ungrounded"
          ? depth.reason
          : state === "unknown"
            ? "depth gate could not run (no jq, or unreadable manifest); grounding not determined"
            : null,
    };
    fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
  } catch {
    /* the label is best-effort; never block finishing over it */
  }
}

/**
 * THE TASTE LINEAGE. Which library references this site's craft actually came from, written
 * into the site's own .palate/ so it SURVIVES THE BUILD.
 *
 * Without it, every later session starts blind: /post cannot pull the spine donor's copy_voice
 * because nothing remembers who the spine donor was, and the ongoing commands re-search the
 * library from scratch as if this were a stranger's site. The manifest already knows
 * (references_surveyed, explore.shown[].donor_slug); it just never left the build. Best-effort
 * like recordBuild: lineage must never be the thing that traps a session.
 */
function recordDonors(manifest, m) {
  try {
    const proj = path.dirname(manifest);
    const refs = Array.isArray(m.references_surveyed) ? m.references_surveyed.filter(Boolean) : [];
    if (!refs.length) return;
    const shown = m.explore && Array.isArray(m.explore.shown) ? m.explore.shown : [];
    const picks = m.explore && Array.isArray(m.explore.picks) ? m.explore.picks : [];
    const pickedIds = new Set(picks.map((p) => p && p.variant_id).filter(Boolean));
    // The spine is the donor of the variant that supplied the dominant tone (the hero pick),
    // falling back to the first surveyed reference, which the surveyor lists backbone-first.
    const heroPick = picks.find((p) => p && p.surface === "hero");
    const spineFromPick = heroPick
      ? (shown.find((s) => s && s.id === heroPick.variant_id) || {}).donor_slug
      : null;
    const out = {
      version: 1,
      spine: spineFromPick || refs[0],
      donors: refs,
      picked_variant_donors: shown
        .filter((s) => s && pickedIds.has(s.id) && s.donor_slug)
        .map((s) => ({ variant: s.id, donor: s.donor_slug })),
      writtenAt: new Date().toISOString(),
      note: "The library references this site's craft came from. RUN SITE commands re-ground on these rather than searching cold.",
    };
    const dir = path.join(proj, ".palate");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "donors.json"), JSON.stringify(out, null, 2) + "\n");
  } catch {
    /* never trap the session over lineage */
  }
}

function recordBuild(manifest) {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    recordDonors(manifest, m);
    const dir = path.join(os.homedir(), ".config", "palate");
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, "builds.log.json");
    let entries = [];
    try {
      entries = JSON.parse(fs.readFileSync(log, "utf8"));
    } catch {
      // Back-compat: migrate the v1 jiffi-namespaced log on first write.
      try {
        entries = JSON.parse(
          fs.readFileSync(path.join(os.homedir(), ".config", "jiffi", "builds.log.json"), "utf8"),
        );
      } catch {
        entries = [];
      }
    }
    // Record the display faces used, read from the rendered variant HTML the manifest
    // points at, so type-face recurrence is computable across builds. Best-effort: a
    // missing/unreadable variant file just contributes no faces.
    const faces = new Set();
    const mdir = path.dirname(manifest);
    for (const v of Array.isArray(m.variants) ? m.variants : []) {
      const hp = v && v.html_path;
      if (typeof hp !== "string") continue;
      const abs = path.isAbsolute(hp) ? hp : path.join(mdir, hp);
      try {
        for (const f of facesFromHtml(fs.readFileSync(abs, "utf8"))) faces.add(f);
      } catch {
        /* variant file gone; skip */
      }
    }
    // Entry shape (incl. the W1 Explore labels) lives in build-log-entry.mjs so it is
    // unit-testable without faking a whole passing build.
    entries.push(buildLogEntry(m, [...faces]));
    fs.writeFileSync(log, JSON.stringify(entries, null, 2) + "\n");
  } catch {
    /* memory is best-effort; never block finishing over it */
  }
}

// --- THE RELEASE LATCH -------------------------------------------------------------------
// A blocked build used to proceed on the very next stop. `stop_hook_active` is true whenever
// this hook is what caused the model to keep going, and the hook exited 0 on it, so the whole
// gate could be cleared by stopping twice: the second stop released a build with exactly the
// same failures on disk. The evidence has to MOVE before the gate does.
//
// It is still bounded, because an unconditional re-block is the infinite loop `stop_hook_active`
// exists to prevent. Two counters, both persisted in the manifest (already gitignored, already
// this build's file, so no new artefact and nothing to clean up):
//   unchanged  consecutive blocks on the SAME evidence. Changed evidence resets it to 1, so
//              real progress is never punished.
//   total      blocks in this build, so evidence that churns without improving still ends.
// Past either ceiling it RELEASES, and says so on stderr with the outstanding failures listed.
// A release that reads like a pass is the failure mode this whole file exists to prevent.
const MAX_UNCHANGED_BLOCKS = intEnv(process.env.PALATE_STOP_MAX_BLOCKS, 3);
const MAX_TOTAL_BLOCKS = intEnv(process.env.PALATE_STOP_MAX_TOTAL, 6);

function intEnv(raw, dflt) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}

function evidenceFingerprint(reasons) {
  return createHash("sha1").update(reasons.join("\n")).digest("hex").slice(0, 12);
}

function readStopGate(manifestPath) {
  try {
    const g = JSON.parse(fs.readFileSync(manifestPath, "utf8")).stop_gate;
    return g && typeof g === "object" ? g : null;
  } catch {
    return null;
  }
}

// Returns false when the latch could not be persisted. That matters: with no memory of the
// previous stop every stop looks like the first, which would block forever, so the caller
// falls back to the platform's own loop guard instead.
function writeStopGate(manifestPath, gate) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (gate === null) delete m.stop_gate;
    else m.stop_gate = gate;
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

const p = readStdin() || {};
if (process.env.PALATE_GATE_OFF === "1") process.exit(0);

// ONE answer to "which project is this", shared with palate-manifest.mjs. The manifest used to
// be looked for in the session cwd while gate-done.sh reads the artefacts beside the manifest,
// and on a build under WORK_ROOT/{slug}-site those are different directories.
const ctx = resolveBuildContext(p.cwd || process.cwd());
const manifest = ctx.manifest;
if (!fs.existsSync(manifest)) process.exit(0); // not a build session
// The artefact root is the manifest's own directory, deliberately: that is exactly how
// gate-done.sh derives it, and the two agreeing is the whole point of the change.
const cwd = path.dirname(manifest);

// Only gate a real build (one that wrote source files).
try {
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const wroteSource = (m.files_written ?? []).some((f) => SOURCE.test(f));
  if (!wroteSource) process.exit(0);
} catch {
  process.exit(0);
}

// Fold the COMPUTED verdicts from the artefacts into the manifest before gating, so
// the visual/verifier cache blocks are fresh. Best-effort and never fatal: the gates
// read the artefacts directly as the source of truth, so a merge miss cannot weaken
// or strengthen the verdict.
try {
  execFileSync("node", [MERGE, "--manifest", manifest], { cwd, stdio: ["ignore", "ignore", "ignore"] });
} catch {
  /* merge is a cache convenience; never block finishing over it */
}

// ENFORCE-ON-EVIDENCE (the fix for "verdict:pass shipped a broken site"): block by DEFAULT
// when there is positive on-disk evidence of a real failure, independent of the gate exit
// codes (which conflate a real fail with could-not-verify). This fires even if the verifier
// set visual.pass:true on a hero-biased read, so a broken section/route cannot ship silently.
// It only blocks on PRESENT+BAD evidence, so an unverifiable session is never false-trapped.
/**
 * Block, unless the same evidence has already been refused too many times.
 * Returns true when it BLOCKED (the caller must exit), false when it RELEASED (loudly).
 */
function latchedBlock(reasons, reasonText) {
  const fingerprint = evidenceFingerprint(reasons);
  const prev = readStopGate(manifest);
  const same = Boolean(prev && prev.fingerprint === fingerprint);
  const unchanged = same ? (Number(prev.unchanged) || 0) + 1 : 1;
  const total = ((prev && Number(prev.total)) || 0) + 1;
  const persisted = writeStopGate(manifest, {
    fingerprint,
    unchanged,
    total,
    reasons,
    at: new Date().toISOString(),
  });

  // No memory of the last stop means every stop looks like the first, so the latch would never
  // release. Hand back to the platform's own loop guard rather than wedge the session.
  const untrackable = !persisted && p.stop_hook_active === true;
  if (unchanged > MAX_UNCHANGED_BLOCKS || total > MAX_TOTAL_BLOCKS || untrackable) {
    process.stderr.write(
      `[palate] RELEASING a build that still has ${reasons.length} unresolved gate failure(s) after ${unchanged} attempt(s) on the same evidence:\n` +
        reasons.map((r) => `  - ${r}\n`).join("") +
        "This is NOT a pass. The failures above are still on disk.\n",
    );
    return false;
  }

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        `${reasonText} Stopping again will NOT clear this: the gate re-reads the artefacts every time and ` +
        `only releases once they change (attempt ${unchanged} of ${MAX_UNCHANGED_BLOCKS}). ` +
        "(PALATE_GATE_OFF=1 bypasses, for a deliberate exception only.)",
    }),
  );
  return true;
}

let positive = [];
// The build-site marker is written by scripts/state-init.sh into whatever directory the flow
// was standing in, which is not always the project, so both are offered.
try { positive = positiveFailures(cwd, [cwd, p.cwd || process.cwd()]); } catch { positive = []; } // a detector bug must never trap the user
let releasedWithFailures = false;
if (positive.length) {
  const blocked = latchedBlock(
    positive,
    "Palate gate: this build has on-disk evidence of a real failure - " + positive.join("; ") +
      ". Fix the named issue, re-render, and re-verify before finishing.",
  );
  if (blocked) process.exit(0);
  // Released past the bound, so the session is not wedged, but the failures are real and this
  // build must NOT reach cross-build memory: recordBuild feeds the novelty gate, and a build
  // recorded here would go on to certify future builds as different from a broken one.
  releasedWithFailures = true;
} else if (readStopGate(manifest)) {
  // The evidence cleared. Drop the latch so the next block starts from zero rather than
  // inheriting a spent counter.
  writeStopGate(manifest, null);
}

// Hard enforcement is opt-in. By DEFAULT never block finishing — blocking traps a
// session that cannot satisfy the gate (surveyed in a subagent, artefacts unrenderable).
// Surface a non-blocking reminder instead so the build is still nudged toward depth.
function gateFailure(reason) {
  if (process.env.PALATE_GATE_STRICT === "1") {
    // Through the SAME latch as the evidence path. Without it, removing the blanket
    // stop_hook_active release would turn strict mode into an unbounded block loop.
    latchedBlock([reason], reason);
    process.exit(0);
  }
  process.stderr.write(`[palate] ${reason}\n(Set PALATE_GATE_STRICT=1 to enforce this as a hard gate.)\n`);
  process.exit(0);
}

const GATE_FALLBACK =
  "Palate gate: this build is not done - it did not draw on the library deeply enough, or the visual loop / verifier has not passed.";
const UNGROUNDED_FALLBACK =
  "MCP-depth gate UNGROUNDED: no Palate MCP calls were recorded, so this build carries no Palate taste layer. Connect it with: claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp";

// THE DEPTH GATE, run on its own so its THIRD STATE cannot swallow anything after it.
// Exit 3 = UNGROUNDED: it ran and the build recorded zero Palate MCP calls. That is a
// LABEL, not a failure - it does not block, the done gate still runs, and the build is
// still written to cross-build memory (a hole in that memory would quietly weaken the
// novelty gate). It was previously sharing one try block with the done gate, where any
// non-zero exit skipped both gate-done.sh and recordBuild().
let depth = { state: "grounded", reason: "" };
try {
  execFileSync("bash", [GATE, manifest], { stdio: ["ignore", "ignore", "pipe"] }); // KEEP THE FLOOR
} catch (e) {
  const msg = (e && e.stderr ? e.stderr.toString() : "").trim();
  depth =
    e && e.status === 3
      ? { state: "ungrounded", reason: msg || UNGROUNDED_FALLBACK }
      : { state: "blocked", reason: msg || GATE_FALLBACK };
}

// Record the grounding fact in the manifest BEFORE acting on it, so it travels to the
// check report and the local grade even on a build that then fails a later gate.
recordGrounding(manifest, depth);

if (depth.state === "blocked") gateFailure(depth.reason);

try {
  execFileSync("bash", [DONE_GATE, manifest], { stdio: ["ignore", "ignore", "pipe"] }); // visual loop + verifier (reads artefacts, fails open)
} catch (e) {
  gateFailure((e && e.stderr ? e.stderr.toString() : "").trim() || GATE_FALLBACK);
}

// Only record the build to cross-build memory after ALL gates pass, and never when the latch
// released one that still had failures on disk.
if (!releasedWithFailures) recordBuild(manifest);

// Degrade LOUDLY, ONCE. Stated here and nowhere else in the build (the write gate stays
// silent on purpose), factually, with the one command that fixes it. Never a block.
if (depth.state === "ungrounded") process.stderr.write(`[palate] ${depth.reason}\n`);
process.exit(0);
