#!/usr/bin/env node
import { refuseLegacy } from "./lib/workflow-route.mjs";
/**
 * kit-survey-snapshot.mjs - freeze the library survey the kit's contract is grounded in.
 *
 * The kit was first written without the Palate MCP connected, and nothing noticed: the plugin's
 * recorder only counts calls on a BUILD site, so a change to the template itself had no gate that
 * could see zero calls. Every `when`, every rule of rhythm, came out of one head. That is the
 * generic output the product exists to prevent, shipped inside the product.
 *
 * This script is the fix's foundation. It reads the recorder's own output (build-manifest.json,
 * written by the PostToolUse hook, never by hand) and writes the set of references that were
 * actually READ, with the layers they were read through, into src/lib/kit-survey.json. The
 * grounding record may then cite ONLY those slugs, and gate-kit-complete enforces it, so a slug
 * that was never opened cannot appear as evidence for anything.
 *
 * Usage: node scripts/kit-survey-snapshot.mjs <path/to/build-manifest.json> [--out <file>]
 * Exit: 0 written, 2 could not run (never a pass).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { invokedDirectly } from "./lib/invoked-directly.mjs";

/**
 * A reference counts as READ only when a deep-read tool returned it. Search results are
 * candidates, not evidence: a slug that only ever appeared in a list was never opened, and its
 * notes were never seen, so nothing about it can be cited.
 */
const DEEP = new Set(["mcp__palate__refs_get", "mcp__palate__refs_get_tokens", "mcp__palate__refs_get_screenshot", "mcp__palate__refs_get_astro_recipe"]);

/**
 * Derive the survey from a manifest. Exported so gate-kit-complete can re-derive it from the
 * manifest the snapshot names and refuse a snapshot that no longer matches: a survey nobody can
 * regenerate is a survey somebody could have typed.
 */
/**
 * `excluded` is a list of declared windows `{ from, to, reason }`: the recorder writes down every
 * session's reads in this workspace, including a critic's verification reads, and a survey that
 * absorbed those would grow every time it was audited. The windows are recorded in the snapshot
 * itself so the exclusion is visible and the gate re-derives with the same windows; calls newer
 * than the snapshot are counted in `unabsorbed` rather than absorbed.
 */
/**
 * WHICH LAYERS CARRIED NOTES. The recorder keeps, per reference and section, the substantive
 * length of what the library answered with (headings and comments stripped), because a record
 * can answer on a layer with an untouched template and three of the kit's cited references did.
 * A layer counts as carrying notes when any of its sections clears the floor; a reference read
 * only by a recorder that kept no content has no `notes` field at all, which the gate treats as
 * "re-read it", never as "fine".
 */
const LAYER_SECTIONS = {
  concept: ["overview", "voice"],
  pages: ["structure"],
  tokens: ["tokens", "typography", "layout"],
  signature_moves: ["visualSystem", "motion"],
  do_dont: ["doDont", "surfaces", "imageryPhilosophy", "motionPhilosophy"],
  component_prompts: ["componentPrompts", "components"],
  astro_recipe: ["astroRebuild"],
  copy_voice: ["copyVoice", "voice"],
};
export const NOTE_FLOOR = 40;

export function deriveSurvey(manifest, excluded = [], until = "") {
  const all = Array.isArray(manifest.mcp_calls) ? manifest.mcp_calls : [];
  const inWindow = (ts) => excluded.some((w) => w.from <= ts && ts <= w.to);
  const calls = all.filter((c) => !(c.ts && inWindow(c.ts)) && !(until && c.ts && c.ts > until));
  const unabsorbed = until ? all.filter((c) => c.ts && c.ts > until).length : 0;
  const excludedCount = all.filter((c) => c.ts && inWindow(c.ts)).length;
  const read = new Map();
  let searches = 0;
  let withoutContent = 0;
  for (const c of calls) {
    if (c.evidence !== "ok") continue;
    if (!DEEP.has(c.tool)) { searches += 1; continue; }
    const layers = Array.isArray(c.args?.layer) ? c.args.layer : Array.isArray(c.args?.sections) ? c.args.sections : ["concept", "astro_recipe"];
    // A slug counts as read only when the library answered with it; older entries carry no
    // `returned` and fall back to what was requested.
    const got = Array.isArray(c.returned) ? c.returned : c.slugs || [];
    const content = c.content && typeof c.content === "object" ? c.content : null;
    if (!content) withoutContent += 1;
    for (const slug of got) {
      const entry = read.get(slug) || { slug, layers: new Set(), reads: 0, notes: new Set(), known: false };
      layers.forEach((l) => entry.layers.add(l));
      entry.reads += 1;
      if (content) {
        entry.known = true;
        const per = content[slug] && typeof content[slug] === "object" ? content[slug] : {};
        for (const l of layers) {
          const sections = LAYER_SECTIONS[l] || [l];
          if (sections.some((sec) => Number(per[sec] || 0) >= NOTE_FLOOR)) entry.notes.add(l);
        }
      }
      read.set(slug, entry);
    }
  }
  const references = [...read.values()]
    .map((e) => ({ slug: e.slug, layers: [...e.layers].sort(), reads: e.reads, ...(e.known ? { notes: [...e.notes].sort() } : {}) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    calls: calls.length,
    excluded_calls: excludedCount,
    unabsorbed_calls: unabsorbed,
    calls_without_content: withoutContent,
    searches,
    layers_read: [...new Set(references.flatMap((e) => e.layers))].sort(),
    references,
  };
}

/**
 * A seal over the reference list. It is not a secret and cannot stop a determined hand, but an
 * edit to the list that forgets to re-seal is caught, and the gate re-derives from the manifest
 * wherever the manifest is present, which is the check that cannot be forged.
 */
export function sealOf(references) {
  return createHash("sha256").update(JSON.stringify(references)).digest("hex");
}

if (invokedDirectly(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const manifestPath = args.find((a) => !a.startsWith("--"));
  const outAt = args.indexOf("--out");
  const outPath = outAt !== -1 ? resolve(args[outAt + 1]) : join(here, "..", "templates/astro-project/src/lib/kit-survey.json");
refuseLegacy([process.cwd(), manifestPath, outPath], "kit-survey-snapshot");

  if (!manifestPath || !existsSync(manifestPath)) {
    console.error("kit-survey-snapshot: could not run: pass the path to a build-manifest.json written by the Palate recorder.");
    process.exit(2);
  }
  // --exclude <from>/<to>/<reason>, repeatable. ISO timestamps; the reason is recorded verbatim.
  const excluded = args.flatMap((a, i) => (a === "--exclude" && args[i + 1] ? [args[i + 1]] : [])).map((spec) => {
    const [from, to, ...rest] = spec.split("/");
    return { from, to, reason: rest.join("/") || "declared exclusion" };
  });
  const until = new Date().toISOString();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const derived = deriveSurvey(manifest, excluded, until);
  if (!derived.calls) {
    console.error("kit-survey-snapshot: could not run: the manifest records zero MCP calls, so there is no survey to freeze.");
    process.exit(2);
  }
  if (!derived.references.length) {
    console.error("kit-survey-snapshot: could not run: the manifest records searches but no deep reads, so nothing was actually read.");
    process.exit(2);
  }
  const snapshot = {
    generated_at: new Date().toISOString(),
    until,
    excluded,
    source: {
      manifest: resolve(manifestPath),
      plugin_version: manifest.plugin_version ?? null,
      mcp_version: manifest.mcp_version ?? null,
      library: manifest.library ?? null,
    },
    ...derived,
    seal: sealOf(derived.references),
  };
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  const stubs = snapshot.references.filter((r) => Array.isArray(r.notes) && !r.notes.length).map((r) => r.slug);
  const unknown = snapshot.references.filter((r) => !Array.isArray(r.notes)).map((r) => r.slug);
  console.log(`kit-survey-snapshot: ${snapshot.references.length} reference(s) read through ${snapshot.layers_read.join(", ")} across ${snapshot.calls} recorded call(s), ${snapshot.excluded_calls} excluded by declared window(s); written to ${outPath}`);
  if (stubs.length) console.log(`kit-survey-snapshot: ${stubs.length} reference(s) answered with an empty template on every layer read and cannot be cited: ${stubs.join(", ")}`);
  if (unknown.length) console.log(`kit-survey-snapshot: ${unknown.length} reference(s) were read only by a recorder that kept no content, so the survey cannot say whether notes came back; re-read them: ${unknown.join(", ")}`);
}
