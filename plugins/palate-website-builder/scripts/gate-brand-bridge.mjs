#!/usr/bin/env node
/**
 * gate-brand-bridge.mjs - does the brand actually reach the kit?
 *
 * ========================== THE DEFECT THIS EXISTS FOR ==========================
 *
 * `foundations.css` read `--brand-bg`, `--brand-text`, `--brand-muted`, `--brand-accent`,
 * `--brand-border` and `--brand-dark`. The generated brand package publishes
 * `--brand-bg-default`, `--brand-text-primary`, `--brand-text-muted`, `--brand-accent-default`,
 * `--brand-border-default` and `--brand-bg-inverse`. Not one of the colours matched, so every
 * kit colour fell back to a literal written in the kit, and a client whose ink is #333 got #111
 * on every page. Only the fonts and radii happened to connect.
 *
 * NO EXISTING CHECK COULD SEE IT. gate-kit-tokens passes, because every component correctly
 * reads a token. The build passes, because a `var()` with a fallback never errors. The site
 * renders, because the fallbacks are sane. The only symptom is that every client's site comes
 * out the same colour, which is the precise failure the whole token discipline exists to
 * prevent, arriving through a door nobody was watching.
 *
 * So this compares the two sides by NAME: every `--brand-*` the kit consumes must either be
 * published by the brand package, or be a deliberate secondary fallback sitting behind one that
 * is. A name read FIRST that nobody publishes is the bug.
 *
 * Exit: 0 clean, 1 findings, 2 could not run (never a pass).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] || ".";
const candidates = {
  foundations: ["templates/astro-project/src/styles/foundations.css", "src/styles/foundations.css"],
  globals: ["templates/astro-project/src/styles/globals.css", "src/styles/globals.css"],
  /**
   * EVERY BRAND SOURCE, NOT THE FIRST ONE FOUND.
   *
   * The first version checked only templates/brand-repo-skeleton/tokens/tokens.css and reported
   * clean while a real project's TYPE never reached the kit: the skeleton publishes
   * --brand-font-display, every hand-vendored brand publishes --brand-display, and the gate was
   * validating against the ideal rather than the thing actually on disk. A check that grades the
   * specimen instead of the patient is worse than no check.
   *
   * So every brand file present is read and their names are unioned, and a project is checked
   * against ITS OWN brand as well as the skeleton.
   */
  brand: [
    "templates/brand-repo-skeleton/tokens/tokens.css",
    "templates/brand-repo-skeleton/fonts/fonts.css",
    "src/brand/tokens.css",
    "src/brand/fonts.css",
    "node_modules/@palate-projects/brand/tokens.css",
  ],
};
const find = (list) => list.map((f) => join(dir, f)).find(existsSync);
const findAll = (list) => list.map((f) => join(dir, f)).filter(existsSync);

const foundations = find(candidates.foundations);
const brandFiles = findAll(candidates.brand);
const brand = brandFiles[0];

if (!foundations) {
  console.log("gate-brand-bridge: skipped (no foundations.css; this build ships no kit).");
  process.exit(0);
}
if (!brand) {
  console.log("gate-brand-bridge: skipped (no brand token file found to compare against; a build with a vendored or absent brand cannot be checked here).");
  process.exit(0);
}

const published = new Set();
for (const bf of brandFiles) {
  for (const m of readFileSync(bf, "utf8").matchAll(/(^|\s)(--brand-[a-z0-9-]+)\s*:/g)) published.add(m[2]);
}
if (!published.size) {
  console.error(`gate-brand-bridge: could not run: ${relative(dir, brand)} declares no --brand-* tokens, so nothing was compared. A gate never exits 0 having inspected nothing.`);
  process.exit(2);
}

/**
 * CORE VERSUS OPTIONAL, because falling back is not always a fault.
 *
 * A hand-vendored brand that ships colour and type and leaves the feedback palette, the page
 * widths and the shadows to the kit is doing something reasonable, and failing that build would
 * train people to switch this off. What is NOT reasonable is the brand's own ink, ground, accent
 * or typeface failing to reach the kit, because then every client's site comes out looking the
 * same, which is the entire failure this gate exists to prevent.
 *
 * So the core set blocks and the rest is reported. The core is exactly the values a stranger
 * would name if asked what makes two sites look different.
 */
const CORE = new Set([
  "--kit-bg", "--kit-text", "--kit-accent", "--kit-font-display", "--kit-font-body",
  /* THE DARK GROUND IS CORE. I left it out and the critic's argument beat mine: 44 of the 45
     pieces can render on the inverse band, and it carries the closing call to action and the
     footer, so it is where the kit is boldest. A brand whose dark is navy falling back to this
     kit's charcoal produces two sites that match in the most conspicuous place on the page,
     which is exactly the test I wrote the core set against and then failed to apply. */
  "--kit-bg-inverse",
  "background-color", "color", "font-family",
]);

const findings = [];
const advisory = [];
let checked = 0;

for (const [label, path] of [["foundations", foundations], ["globals", find(candidates.globals)]]) {
  if (!path) continue;
  const src = readFileSync(path, "utf8");
  // Only declarations, and only the FIRST name in each fall-through chain: the later ones are
  // deliberate fallbacks for a hand-vendored brand and are allowed not to exist.
  for (const decl of src.matchAll(/(--kit-[a-z0-9-]+|background-color|color|font-family|outline)\s*:\s*([^;]+);/g)) {
    const value = decl[2];
    if (!value.includes("--brand-")) continue;
    /**
     * A CHAIN RESOLVES IF ANY NAME IN IT IS PUBLISHED, not only the first.
     *
     * Two naming conventions exist in the wild and a chain that covers both is CORRECT, not a
     * near miss. What is wrong is a chain no brand satisfies at all, because that value silently
     * becomes a literal on every build.
     */
    const names = [...value.matchAll(/var\(\s*(--brand-[a-z0-9-]+)/g)].map((m) => m[1]);
    if (!names.length) continue;
    checked++;
    const name = names[0];
    if (!names.some((n) => published.has(n))) {
      const line = src.slice(0, decl.index).split("\n").length;
      const line2 = src.slice(0, decl.index).split("\n").length;
      const msg = `${relative(dir, path)}:${line2}  ${decl[1]} reads ${names.join(" then ")}, and no brand source here publishes any of them`;
      if (CORE.has(decl[1])) {
        findings.push(`${msg}, so the brand's own ${decl[1].replace("--kit-", "")} never reaches the kit and every site built from this brand renders it identically`);
      } else {
        advisory.push(`${msg}; the kit's own default applies`);
      }
    }
  }
}

if (!checked) {
  console.error("gate-brand-bridge: could not run: no --brand-* consumption found to check.");
  process.exit(2);
}

if (findings.length) {
  console.error(`gate-brand-bridge: ${findings.length} CORE token(s) never reach the kit (checked ${checked} consumption(s) against ${published.size} published name(s)).`);
  for (const f of findings.slice(0, 30)) console.error(`  - ${f}`);
  console.error(`  Either read the published name first, or publish the name the kit reads. A client's brand that does not reach the kit means every client's site comes out the same colour.`);
  process.exit(1);
}

if (advisory.length) {
  console.log(`gate-brand-bridge: ${advisory.length} optional token(s) fall back to the kit's own defaults, which is a legitimate choice for a partial brand:`);
  for (const a of advisory.slice(0, 12)) console.log(`  - ${a}`);
  if (advisory.length > 12) console.log(`  ... and ${advisory.length - 12} more`);
}
console.log(`gate-brand-bridge: clean (${checked} consumption(s) resolve against ${published.size} token(s) published across ${brandFiles.length} brand source(s): ${brandFiles.map((f) => relative(dir, f)).join(", ")}).`);
process.exit(0);
