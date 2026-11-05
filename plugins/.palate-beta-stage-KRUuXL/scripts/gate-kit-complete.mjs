#!/usr/bin/env node
/**
 * gate-kit-complete.mjs - the manifest and the components cannot drift.
 *
 * The manifest (src/lib/kit.ts) is what Compose reads when choosing a section, so a variation
 * declared there with no component is a section Compose can pick and cannot render. A component
 * with no entry is invisible: it exists, nobody can find it, and it rots.
 *
 * It also enforces the parts of Jake's "finished" definition that are checkable statically:
 * every variation declares its states, documents when to use it and what content it needs, and
 * every piece that takes a list handles the empty case.
 *
 * Exit: 0 clean, 1 findings, 2 could not run (never a pass).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSurvey, sealOf } from "./kit-survey-snapshot.mjs";

const dir = process.argv[2] || ".";
const base = existsSync(join(dir, "templates/astro-project/src"))
  ? join(dir, "templates/astro-project/src")
  : join(dir, "src");
const manifestPath = join(base, "lib/kit.ts");
const kitRoot = join(base, "components/kit");

if (!existsSync(manifestPath)) {
  console.log(`gate-kit-complete: skipped (no ${relative(dir, manifestPath)}); this build ships no kit.`);
  process.exit(0);
}
if (!existsSync(kitRoot)) {
  console.error(`gate-kit-complete: could not run: the manifest exists but ${relative(dir, kitRoot)} does not.`);
  process.exit(2);
}

const src = readFileSync(manifestPath, "utf8");

/**
 * Parsed from the source rather than imported, because this gate must run against a plugin
 * checkout with no build step and no TypeScript loader. The shapes it reads are the ones the
 * manifest is required to have, so a manifest that stops matching them fails loudly here.
 */
function parsePieces(text) {
  const pieces = [];
  const pieceRe = /\{\s*\n?\s*id:\s*"([a-z]+)",\s*name:\s*"([^"]+)",([\s\S]*?)\n  \},\n/g;
  let m;
  while ((m = pieceRe.exec(text))) {
    const [, id, name, body] = m;
    if (!/variations:\s*\[/.test(body)) continue;
    const piece = { id, name, when: /when:\s*"([^"]*)"/.exec(body)?.[1] || "",
      where: /where:\s*"([^"]*)"/.exec(body)?.[1] || "", variations: [] };
    // The optional tail is what carries per-variation flags. Without it they sit outside the
    // match and read as absent, which is a check that quietly answers "no" to everything.
    // The tail also carries `evidence: [...]`, an array, so a flag value may be a bracketed list.
    const varRe = /\{\s*id:\s*"([A-Za-z]+)",\s*name:\s*"([^"]+)",\s*\n?\s*when:\s*"([^"]*)",\s*\n?\s*needs:\s*\[([^\]]*)\],\s*\n?\s*states:\s*\[([^\]]*)\]((?:\s*,\s*[A-Za-z]+:\s*(?:\[[^\]]*\]|[^,}]+))*)/g;
    let v;
    while ((v = varRe.exec(body))) {
      const tail = v[6] || "";
      piece.variations.push({
        id: v[1], name: v[2], when: v[3],
        needs: (v[4].match(/"[^"]+"/g) || []).length,
        states: (v[5].match(/"[^"]+"/g) || []).map((s) => s.replace(/"/g, "")),
        ownsPageHeading: /ownsPageHeading:\s*true/.test(tail),
        evidence: ((/evidence:\s*\[([^\]]*)\]/.exec(tail) || [])[1]?.match(/"[^"]+"/g) || []).map((s) => s.replace(/"/g, "")),
      });
    }
    piece.origin = /origin:\s*"library"/.test(body) ? "library" : "spec";
    pieces.push(piece);
  }
  return pieces;
}

const pieces = parsePieces(src);
if (!pieces.length) {
  console.error("gate-kit-complete: could not run: the manifest parsed to zero pieces, so nothing was checked. A gate never exits 0 having inspected nothing.");
  process.exit(2);
}

const findings = [];
let declared = 0;

for (const p of pieces) {
  if (!p.when) findings.push(`piece "${p.id}" does not say WHEN to use it`);
  if (!p.where) findings.push(`piece "${p.id}" does not say WHERE it belongs on a page`);
  if (!p.variations.length) findings.push(`piece "${p.id}" declares no variations`);
  for (const v of p.variations) {
    declared++;
    const file = join(kitRoot, p.id, `${v.id}.astro`);
    if (!existsSync(file)) {
      findings.push(`"${p.name} / ${v.name}" is declared but ${relative(dir, file)} does not exist, so Compose can pick a section that cannot render`);
      continue;
    }
    /**
     * A STATE MAY BE DELEGATED, and refusing to follow that would force duplication.
     *
     * NavSimple genuinely has an open state: it renders NavMobileSheet, which owns the
     * aria-expanded, the Escape handling and the focus return. Demanding NavSimple carry its own
     * copy would mean two implementations of one behaviour, which is how they drift. So the
     * check reads the component PLUS any kit component it imports, one level deep, which is as
     * far as composition goes in this kit.
     */
    let body = readFileSync(file, "utf8");
    for (const imp of body.matchAll(/from\s+"\.{1,2}\/([A-Za-z/]+)\.astro"/g)) {
      const rel = imp[1];
      const candidates = [
        join(kitRoot, p.id, `${rel}.astro`),
        join(kitRoot, `${rel}.astro`),
      ];
      for (const c of candidates) if (existsSync(c)) body += "\n" + readFileSync(c, "utf8");
    }
    if (!v.when) findings.push(`${v.id} does not say when to reach for it rather than its siblings`);
    if (!v.needs) findings.push(`${v.id} does not state the content it needs`);
    if (!/interface\s+Props/.test(body)) findings.push(`${v.id} has no Props interface, so its content contract is unstated`);
    if (v.states.includes("empty") && !/kit-empty/.test(body)) {
      findings.push(`${v.id} declares an empty state and never renders .kit-empty, so an empty list breaks the layout`);
    }
    if (v.states.includes("loading") && !/data-loading|kit-spinner|aria-busy/.test(body)) {
      findings.push(`${v.id} declares a loading state and shows no loading affordance`);
    }
    if ((v.states.includes("success") || v.states.includes("error")) && !/aria-live/.test(body)) {
      findings.push(`${v.id} declares success or error and has no aria-live region, so the outcome is silent to a screen reader`);
    }
    if (v.states.includes("open") && !/aria-expanded|<details|<dialog/.test(body)) {
      findings.push(`${v.id} declares an open state with no aria-expanded, <details> or <dialog>`);
    }
    /**
     * NO COMPONENT MAY DEFAULT AN IDENTITY FIELD.
     *
     * A piece that defaults `company`, `role`, `customer` or `name` turns an omission into a
     * fabrication: a build passing a real quote, a real name and a real location, and simply
     * not passing `company`, silently attributes those words to a firm nobody named. Three
     * components shipped exactly that, one of them directly contradicting its own header
     * comment, which said a company is never added to a quote that did not come with one.
     *
     * Sample COPY is fine. A quote with nothing attached attributes nothing to anybody. It is
     * the ATTRIBUTION that must never be invented, and an omitted prop must stay omitted.
     */
    const destructure = /const\s*\{([\s\S]*?)\}\s*=\s*Astro\.props/.exec(body);
    if (destructure) {
      /**
       * IDENTITY IS ANY PROP THAT NAMES SOMEBODY, not a list of five words I thought of.
       *
       * The first version matched `name` exactly and therefore missed `siteName` and
       * `businessName`, which are the two that actually ship: forget the site name and a real
       * client's header and footer carry an invented joinery firm on every page. So the rule is
       * shape-based (anything ending in Name, plus the identity nouns) and the exceptions are
       * named rather than the matches.
       */
      const IDENTITY = /(^|\n)\s*([A-Za-z]*(?:[Nn]ame|company|Company|customer|Customer|author|Author|attribution|Attribution|brand|Brand))\s*=\s*["'`][^"'`]+["'`]/g;
      /** Generic placeholders that name nobody are fine: "Us" is not a person or a firm. */
      const GENERIC = /^(us|you|them|your (?:solution|approach|team)|current|alternative|option [ab])$/i;
      /**
       * `accessibleName` and its siblings name the SECTION for a screen reader, not a person or
       * a firm. Defaulting "What our customers say" is correct and desirable: a section with no
       * accessible name is an accessibility defect, so the fallback must exist.
       */
      const NOT_IDENTITY = /^(accessible|aria|sr|screenReader|label|heading|field|input|button|class|tag|file|event|domain|host)/;
      for (const d of destructure[1].matchAll(IDENTITY)) {
        const value = /=\s*["'`]([^"'`]+)["'`]/.exec(d[0])?.[1] || "";
        if (NOT_IDENTITY.test(d[2])) continue;
        if (GENERIC.test(value.trim())) continue;
        findings.push(`${v.id} defaults the identity field "${d[2]}" to "${value}", so a build that omits it puts an invented person or firm on a real client's site`);
      }

      /**
       * AN ASSET PATH THAT DEFAULTS IS A 404 ON EVERY SITE BUT THIS ONE.
       *
       * A component defaulting `src`, `poster` or `image` to a path renders a broken-image
       * marker on any project that does not happen to carry that exact file, which is all of
       * them. The unset state belongs to the component: fall back to the .kit-media ratio box.
       */
      const ASSET = /(^|\n)\s*([A-Za-z]*(?:src|Src|poster|Poster|image|Image|logo|Logo|avatar|Avatar))\s*=\s*["'`](\/[^"'`]+|https?:[^"'`]+)["'`]/g;
      for (const a of destructure[1].matchAll(ASSET)) {
        const value = /=\s*["'`]([^"'`]+)["'`]/.exec(a[0])?.[1] || "";
        findings.push(`${v.id} defaults the asset "${a[2]}" to ${value}, which 404s on every site that does not carry that exact file`);
      }
    }

    /**
     * AN EMPTY MESSAGE IS COPY A VISITOR READS, NOT A NOTE TO WHOEVER IS BUILDING THE PAGE.
     *
     * Five components defaulted to a builder's instruction ("Add three to eight benefits, each
     * with a title and a sentence or two"). Those are component DEFAULTS, so they ship, and this
     * project has already had to fix the same class once: a blog index that served "Add a markdown
     * file to src/content/posts/" as public copy on a reachable page.
     */
    /**
     * A PIECE THAT RENDERS THE PAGE'S h1 HAS TO SAY SO, because the demo frame supplies a hidden
     * one for every piece that does not. Get it wrong in one direction and a hero demo ships two
     * h1s; get it wrong in the other and 166 single-section documents ship none. The signal is the
     * component's own heading level rather than where the file happens to live.
     */
    const ownsByDefault = /\blevel\s*=\s*1\b/.test(body);
    if (ownsByDefault && !v.ownsPageHeading) {
      findings.push(`${v.id} renders a level-1 heading by default and does not declare ownsPageHeading, so the demo frame adds a second h1 to the same document`);
    }
    if (!ownsByDefault && v.ownsPageHeading) {
      findings.push(`${v.id} declares ownsPageHeading and renders no level-1 heading by default, so its demo document has no h1 at all`);
    }

    const emptyDefault = /emptyMessage\s*=\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (emptyDefault && /^(Add|Set|Pass|Provide|Supply|Configure|Populate|Fill|Use)\s/.test(emptyDefault[1])) {
      findings.push(`${v.id} defaults its empty message to "${emptyDefault[1].slice(0, 60)}", which instructs whoever is building the page rather than telling a visitor what is going on. It ships, so a visitor reads it.`);
    }
    /**
     * AND A PIECE THAT RENDERS AN EMPTY MESSAGE HAS AN EMPTY STATE. Nine did not declare one, so
     * the state browser could never show the message and nobody reviewing the kit could see it.
     */
    if (emptyDefault && !v.states.includes("empty")) {
      findings.push(`${v.id} renders an empty message and does not declare the empty state, so nothing can show it and no reviewer can see what a visitor would read`);
    }

    if (!/^\s*\/\*[\s\S]{60,}?\*\//m.test(body) && !/^---[\s\S]{0,400}?\/\*\*/m.test(body)) {
      findings.push(`${v.id} has no header comment explaining what it is and when to use it`);
    }
  }
}

/**
 * EVERY DECLARED STATE HAS TO BE REACHABLE WITHOUT EDITING CODE.
 *
 * The manifest has always listed the states a piece must handle, and for a while that list was
 * the only evidence any of them worked: a reviewer could read "handles empty, long, open" and
 * had no way to see one. Spec section 7 names a browsable state per variation in acceptance, so
 * the routes and the fixtures are checked here rather than trusted.
 *
 * Content states need a FIXTURE, because a page cannot invent two hundred words of realistic
 * prose at render time. Runtime states need no fixture: they are driven through the piece's own
 * control by the demo, so a missing one shows up as a driver that reports it could not reach the
 * state rather than as a page that quietly renders the resting view.
 */
const CONTENT_STATES = { empty: "EMPTY_PROPS", long: "LONG_PROPS" };
const statesPath = join(base, "lib/kit-states.ts");
const viewerRoute = join(base, "pages/kit/[piece]/[variation]/[state].astro");
const frameRoute = join(base, "pages/kit-frame/[piece]/[variation]/[state].astro");

if (!existsSync(statesPath)) {
  findings.push(`${relative(dir, statesPath)} does not exist, so no declared state can be browsed and the manifest's state lists are unevidenced`);
} else {
  const statesSrc = readFileSync(statesPath, "utf8");
  const fixtures = {};
  for (const [state, name] of Object.entries(CONTENT_STATES)) {
    const block = new RegExp(`export const ${name}[^{]*\\{([\\s\\S]*?)\\n\\};`).exec(statesSrc);
    if (!block) {
      console.error(`gate-kit-complete: could not run: ${relative(dir, statesPath)} has no parsable ${name}, so the ${state} fixtures were not checked. A gate never exits 0 having inspected nothing.`);
      process.exit(2);
    }
    fixtures[state] = new Set((block[1].match(/^  ([A-Za-z]+):/gm) || []).map((m) => m.trim().replace(":", "")));
  }

  const declaredBy = { empty: new Set(), long: new Set() };
  for (const p of pieces) {
    for (const v of p.variations) {
      for (const state of Object.keys(CONTENT_STATES)) {
        if (!v.states.includes(state)) continue;
        declaredBy[state].add(v.id);
        if (!fixtures[state].has(v.id)) {
          findings.push(`${v.id} declares the ${state} state and ${CONTENT_STATES[state]} has no fixture for it, so /kit/${p.id}/${v.id}/${state} would render the resting content and call it ${state}`);
        }
      }
    }
  }
  // A fixture nobody can reach is dead weight that reads as coverage.
  for (const state of Object.keys(CONTENT_STATES)) {
    for (const id of fixtures[state]) {
      if (!declaredBy[state].has(id)) {
        findings.push(`${CONTENT_STATES[state]} carries a fixture for ${id}, which does not declare the ${state} state, so nothing can ever render it`);
      }
    }
  }

  if (!existsSync(viewerRoute)) findings.push(`${relative(dir, viewerRoute)} does not exist, so no state has a page`);
  if (!existsSync(frameRoute)) findings.push(`${relative(dir, frameRoute)} does not exist, so no state has a render to put in one`);
  else {
    /**
     * RENDERED, NOT MENTIONED. The first version of this check grepped for the driver's NAME and
     * passed a file where the import had been renamed and nothing was rendered, because the name
     * still appeared in the import PATH. Same class as a docs guard satisfied by a comment: match
     * the tag being rendered, which is the thing that has to be true.
     */
    const frameSrc = readFileSync(frameRoute, "utf8");
    if (!/<StateDriver[\s/>]/.test(frameSrc)) {
      findings.push(`${relative(dir, frameRoute)} never renders <StateDriver />, so every runtime state would silently show the resting view`);
    }
  }
}

/**
 * EVERY CLAIM ABOUT WHEN A PIECE WORKS HAS TO NAME A REFERENCE THAT WAS ACTUALLY READ.
 *
 * The kit was first written with the MCP configured and not connected, and every `when` came out
 * of one head. Nothing caught it because nothing asked where a rule came from. Now the manifest
 * carries `evidence` per variation, kit-grounding.ts carries donors, rules and anti-patterns per
 * piece, and kit-survey.json is the recorder's own list of what was deep-read. This block holds
 * the three to each other:
 *
 *   - every slug cited anywhere is in the survey, so a reference seen only in a search result,
 *     or never seen at all, cannot stand as evidence;
 *   - every piece has a grounding entry with at least three donors, and a rule with no citation
 *     is taste and is refused;
 *   - a variation's evidence is drawn from the references recorded FOR ITS PIECE, so a slug
 *     cannot be borrowed from another piece's notes to make a claim about this one;
 *   - a piece the library added (`origin: "library"`) cites at least three distinct references
 *     across its variations, because a piece that exists only because the library showed it
 *     needs the library to show it more than once.
 *
 * The survey file is generated, never hand-written: kit-survey-snapshot.mjs reads the build
 * manifest the PostToolUse hook wrote and keeps only deep-read calls. A missing or empty survey is
 * a run that cannot be trusted, and the gate says so rather than passing over nothing.
 */
const groundingPath = join(base, "lib/kit-grounding.ts");
const surveyPath = join(base, "lib/kit-survey.json");
if (!existsSync(groundingPath)) {
  findings.push(`${relative(dir, groundingPath)} does not exist, so no piece's contract has a recorded source`);
} else if (!existsSync(surveyPath)) {
  console.error(`gate-kit-complete: could not run: ${relative(dir, surveyPath)} does not exist, so no citation can be checked. Generate it: node scripts/kit-survey-snapshot.mjs <build-manifest.json>.`);
  process.exit(2);
} else {
  let survey;
  try {
    survey = JSON.parse(readFileSync(surveyPath, "utf8"));
  } catch {
    survey = null;
  }
  const read = new Set(((survey && survey.references) || []).map((r) => r && r.slug).filter(Boolean));
  /**
   * READ MEANS NOTES CAME BACK. Membership in the survey said the library answered for a slug; it
   * did not say the answer held anything, and three cited references (caliber, myodetox, dishoom)
   * answered every layer with an untouched template while donor notes attributed to them were
   * transcribed from the one-line blurb every record carries. The snapshot now records which
   * layers carried notes; a citation to a slug with none is a citation to nothing, and a slug read
   * only by a recorder that kept no content is unknown and has to be re-read, never assumed.
   */
  const notesOf = new Map(((survey && survey.references) || []).map((r) => [r && r.slug, Array.isArray(r && r.notes) ? r.notes : null]));
  /**
   * NULL notes means the survey was taken by a recorder that kept no per-section content (every
   * reference read before the content-capture recorder shipped). That is UNKNOWN, not empty: the
   * gate falls back to membership and lists the unknowns once, so the survey still validates while
   * the class is caught the next time a content-carrying survey is taken. An EMPTY notes array is
   * a recorded fact that the read came back a template, and that is refused by name.
   */
  const unknownCited = new Set();
  const citeFault = (slug, what) => {
    if (!read.has(slug)) return `${what} "${slug}", which the survey never read`;
    const notes = notesOf.get(slug);
    if (notes === null) { unknownCited.add(slug); return ""; }
    if (!notes.length) return `${what} "${slug}", which answered every recorded read with an empty template, so nothing in it can be cited`;
    return "";
  };
  if (!read.size) {
    console.error(`gate-kit-complete: could not run: ${relative(dir, surveyPath)} records zero deep reads, so every citation would fail and nothing would be learned. Re-run the survey and the snapshot.`);
    process.exit(2);
  }

  const gsrc = readFileSync(groundingPath, "utf8");
  const grounding = {};
  const gBlockRe = /\n  ([a-z]+): \{\n([\s\S]*?)\n  \},/g;
  let g;
  while ((g = gBlockRe.exec(gsrc))) {
    const [, id, body] = g;
    const list = (name) => {
      const m = new RegExp(`${name}:\\s*\\[([\\s\\S]*?)\\n    \\]`).exec(body);
      return m ? m[1] : "";
    };
    const slugsIn = (text) => (text.match(/"[a-z0-9-]+"/g) || []).map((x) => x.replace(/"/g, ""));
    const donors = (list("donors").match(/slug:\s*"([a-z0-9-]+)"/g) || []).map((x) => x.replace(/slug:\s*"|"/g, ""));
    const entries = (text) => Array.from(text.matchAll(/\{\s*text:\s*"([^"]+)",\s*slugs:\s*\[([^\]]*)\]/g)).map((m) => ({ text: m[1], slugs: slugsIn(m[2]) }));
    grounding[id] = { donors, rules: entries(list("rules")), avoid: entries(list("avoid")) };
  }
  const rhythms = Array.from(gsrc.matchAll(/id:\s*"([a-z-]+)",\s*\n\s*name:[\s\S]*?steps:\s*\[([\s\S]*?)\],\s*\n\s*slugs:\s*\[([^\]]*)\]/g)).map((m) => ({
    id: m[1],
    steps: (m[2].match(/"(?:[^"\\]|\\.)*"/g) || []).map((x) => x.slice(1, -1)),
    slugs: (m[3].match(/"[a-z0-9-]+"/g) || []).map((x) => x.replace(/"/g, "")),
  }));

/**
 * A COMPOSED PAGE DECLARES ITS RHYTHM AND EVERY SECTION IT RENDERS. The index says each example
 * page follows one rhythm "step for step", and one of the three renumbered its rhythm, invented a
 * step and left a rendered section off its own list; another left a rendered testimonial off. A
 * declaration nothing parses is prose. The leading comment of each page under pages/kit/*.astro
 * is read here: RHYTHM: `id`, then lines of the form
 *   `N. what the step is ... Component, Component`   (a step of the rhythm, in its own numbering)
 *   `+ why this addition, and which reference ... Component`   (a declared addition)
 *   `~ the page's chrome ... Component`
 * Every kit component the page renders has to be on one of those lines, every declared component
 * has to render, the numbered steps have to be exactly the rhythm's 1..k each once, and the
 * rendered order of step components has to be non-decreasing.
 */
const pagesDir = join(base, "pages/kit");
const rhythmIds = new Set(rhythms.map((r) => r.id));
const rhythmSteps = new Map(rhythms.map((r) => [r.id, r.steps.length]));
for (const file of existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => /^[a-z]+\.astro$/.test(f) && f !== "index.astro") : []) {
  const pagePath = join(pagesDir, file);
  const page = readFileSync(pagePath, "utf8");
  const rel = relative(dir, pagePath);
  const head = /^---\s*\n\/\*\*([\s\S]*?)\*\//.exec(page);
  if (!head) { findings.push(`${rel} does not open with a declaring comment, so its rhythm and its sections are undeclared`); continue; }
  const rhythmId = /RHYTHM:\s*`([a-z-]+)`/.exec(head[1])?.[1] || "";
  if (!rhythmIds.has(rhythmId)) { findings.push(`${rel} declares rhythm "${rhythmId || "(none)"}", which kit-grounding.ts does not define`); continue; }
  const lineRe = /^\s*\*\s+(\d+\.|\+|~)\s+(.*?)\s+\.*\s*([A-Z][A-Za-z]+(?:,\s*[A-Z][A-Za-z]+)*)\s*$/gm;
  const declared = new Map();
  const stepNumbers = [];
  let line;
  while ((line = lineRe.exec(head[1]))) {
    const [, mark, why, comps] = line;
    if (mark !== "~" && why.trim().length < 12) findings.push(`${rel} declares "${comps}" with no reason worth the name`);
    const step = mark.endsWith(".") ? Number(mark.slice(0, -1)) : mark === "+" ? "addition" : "chrome";
    if (typeof step === "number") stepNumbers.push(step);
    for (const c of comps.split(",").map((x) => x.trim())) {
      if (declared.has(c)) findings.push(`${rel} declares ${c} twice`);
      declared.set(c, step);
    }
  }
  const k = rhythmSteps.get(rhythmId);
  const expected = Array.from({ length: k }, (_, i) => i + 1);
  if (stepNumbers.join(",") !== expected.join(",")) findings.push(`${rel} declares steps ${stepNumbers.join(", ") || "(none)"} for "${rhythmId}", whose own numbering is 1 to ${k}, each once and in order`);
  const imported = new Set(Array.from(page.matchAll(/^import\s+([A-Z][A-Za-z]+)\s+from\s+"[^"]*components\/kit\/[^"]+"/gm)).map((m) => m[1]));
  const body = page.slice(page.indexOf("\n---", 4) + 4);
  const rendered = Array.from(body.matchAll(/<([A-Z][A-Za-z]+)\b/g)).map((m) => m[1]).filter((c) => imported.has(c));
  for (const c of new Set(rendered)) if (!declared.has(c)) findings.push(`${rel} renders ${c} and does not declare it as a step, an addition or chrome`);
  for (const c of declared.keys()) if (!rendered.includes(c)) findings.push(`${rel} declares ${c} and never renders it`);
  let last = 0;
  for (const c of rendered) {
    const step = declared.get(c);
    if (typeof step !== "number") continue;
    if (step < last) findings.push(`${rel} renders ${c} (step ${step}) after step ${last}, against the rhythm's order`);
    last = Math.max(last, step);
  }
}


  if (!Object.keys(grounding).length) {
    console.error(`gate-kit-complete: could not run: ${relative(dir, groundingPath)} parsed to zero pieces, so no citation was checked.`);
    process.exit(2);
  }

  for (const p of pieces) {
    const gp = grounding[p.id];
    if (!gp) {
      findings.push(`piece "${p.id}" has no entry in kit-grounding.ts, so its contract has no recorded source`);
      continue;
    }
    if (gp.donors.length < 3) {
      findings.push(`piece "${p.id}" cites ${gp.donors.length} donor(s) and needs at least three, or its contract rests on one reading`);
    }
    for (const slug of gp.donors) {
      const fault = citeFault(slug, `piece "${p.id}" names as a donor`);
      if (fault) findings.push(fault);
    }
    for (const kind of ["rules", "avoid"]) {
      for (const r of gp[kind]) {
        if (!r.slugs.length) findings.push(`piece "${p.id}" ${kind === "rules" ? "rule" : "anti-pattern"} "${r.text.slice(0, 50)}" cites nothing, which makes it taste rather than evidence`);
        for (const slug of r.slugs) {
          const fault = citeFault(slug, `piece "${p.id}" ${kind === "rules" ? "rule" : "anti-pattern"} "${r.text.slice(0, 50)}" cites`);
          if (fault) findings.push(fault);
        }
      }
    }
    /**
     * DONORS AND RULES, NEVER `avoid`. The first version unioned the anti-patterns in as well, so a
     * slug whose only note for a piece said "do not do this" stood as evidence for a variation's
     * `when`, and one variation relied on it (a pricing table citing the reference whose pricing
     * note is a warning against comparison tables). An anti-pattern citation is the opposite of
     * showing the piece in use.
     */
    const recordedForPiece = new Set([...gp.donors, ...gp.rules.flatMap((r) => r.slugs)]);
    const cited = new Set();
    for (const v of p.variations) {
      if (!v.evidence.length) {
        findings.push(`${v.id} declares no evidence, so its "when" is a claim with no reference behind it`);
        continue;
      }
      for (const slug of v.evidence) {
        cited.add(slug);
        const fault = citeFault(slug, `${v.id} cites as evidence`);
        if (fault) findings.push(fault);
        else if (!recordedForPiece.has(slug)) findings.push(`${v.id} cites "${slug}", which has no recorded note for the "${p.id}" piece in kit-grounding.ts; a slug cannot stand as evidence for a piece its notes were never recorded against`);
      }
    }
    if (p.origin === "library" && cited.size < 3) {
      findings.push(`piece "${p.id}" was added because the library showed it and cites ${cited.size} distinct reference(s) across its variations; a library piece needs at least three`);
    }
  }
  for (const id of Object.keys(grounding)) {
    if (!pieces.some((p) => p.id === id)) findings.push(`kit-grounding.ts carries an entry for "${id}", which no manifest piece declares, so it grounds nothing`);
  }
  if (!rhythms.length) findings.push(`kit-grounding.ts declares no rhythms, so no page order has a recorded source`);
  /**
   * A rhythm is read from a reference's own "rhythm to borrow" note, so one reference that states
   * it is enough (anthropic's five acts are anthropic's), and every reference it names has to be a
   * DONOR somewhere: a slug that appears only in a rhythm has no recorded note anywhere for the
   * gate to hold it to, which is how two rhythms became syntheses attributed to references whose
   * notes describe a different order.
   */
  const donorAnywhere = new Set(Object.values(grounding).flatMap((g) => g.donors));
  for (const r of rhythms) {
    if (r.slugs.length < 1) findings.push(`rhythm "${r.id}" cites no reference, so its order is invented`);
    /**
     * A COMPOSITE RHYTHM CITES EVERY STEP. When a rhythm names several references, each step has
     * to name, in parentheses, which of them states it, and only from that list: two rhythms were
     * syntheses attributed to references whose notes describe a different order, and the gate
     * could not see it because it checked membership, never meaning.
     */
    if (r.slugs.length > 1) {
      for (const step of r.steps) {
        const cites = Array.from(step.matchAll(/\(([a-z0-9-]+(?:,\s*[a-z0-9-]+)*)\)/g)).flatMap((m) => m[1].split(/,\s*/));
        if (!cites.length) findings.push(`rhythm "${r.id}" step "${step.slice(0, 50)}" names no reference that states it`);
        for (const c of cites) if (!r.slugs.includes(c)) findings.push(`rhythm "${r.id}" step "${step.slice(0, 50)}" cites "${c}", which is not in the rhythm's own list`);
      }
    }
    for (const slug of r.slugs) {
      const fault = citeFault(slug, `rhythm "${r.id}" cites`);
      if (fault) findings.push(fault);
      else if (!donorAnywhere.has(slug)) findings.push(`rhythm "${r.id}" cites "${slug}", which is no piece's donor, so no recorded note stands behind the order it is cited for`);
    }
  }

  /**
   * THE SURVEY MUST BE THE RECORDER'S, NOT A HAND'S. Adding a slug to the snapshot and a note to the
   * grounding used to pass, which made the whole chain only as honest as whoever last edited the
   * JSON. Two checks: the seal over the reference list has to match (an edit that forgets to
   * re-seal is caught), and wherever the manifest the snapshot names is present the survey is
   * re-derived from it and has to match slug for slug and layer for layer, which cannot be forged
   * without forging the recorder's own output. Where the manifest is absent (another machine) the
   * gate says so rather than counting it as verified.
   */
  if (unknownCited.size) {
    console.log(`gate-kit-complete: ${unknownCited.size} cited reference(s) were surveyed before per-section content was recorded, so the survey cannot yet prove their notes are not empty; a fresh survey will. Re-read: ${[...unknownCited].sort().join(", ")}`);
  }
  if (typeof survey.seal !== "string" || survey.seal !== sealOf(survey.references)) {
    findings.push(`${relative(dir, surveyPath)} does not carry a seal matching its reference list; regenerate it with kit-survey-snapshot.mjs rather than editing it`);
  }
  const manifestPath = survey.source && typeof survey.source.manifest === "string" ? survey.source.manifest : "";
  if (manifestPath && existsSync(manifestPath)) {
    try {
      // Same windows, same cut-off: reads made after the snapshot are reported, never absorbed.
      const derived = deriveSurvey(JSON.parse(readFileSync(manifestPath, "utf8")), Array.isArray(survey.excluded) ? survey.excluded : [], typeof survey.until === "string" ? survey.until : "");
      const key = (refs) => refs.map((r) => `${r.slug}:${[...r.layers].sort().join("+")}`).sort().join("|");
      if (key(derived.references) !== key(survey.references)) {
        findings.push(`${relative(dir, surveyPath)} no longer matches the survey derived from ${manifestPath} within its own windows; re-run kit-survey-snapshot.mjs (a hand-edited list)`);
      }
      if (derived.unabsorbed_calls) {
        console.log(`gate-kit-complete: survey provenance: ${derived.unabsorbed_calls} call(s) recorded after the snapshot's cut-off are not part of the survey; re-run the snapshot to absorb them deliberately.`);
      }
    } catch (error) {
      findings.push(`${relative(dir, surveyPath)} names a manifest that could not be re-derived: ${error && error.message}`);
    }
  } else {
    console.log(`gate-kit-complete: survey provenance: manifest not present on this machine, so only the seal was checked (${survey.references.length} references).`);
  }
}


/**
 * A PAGE'S OWN HEADER AND FOOTER ARE NOT CHROME, AND THE LAYOUT MUST NOT DROP THEM.
 *
 * BaseLayout's `chrome` flag exists so a frame can show a piece with no site header around it.
 * The first version gated the `header` and `footer` SLOTS on the same flag, so the three composed
 * example pages, which pass their own navigation and footer through those slots and ask for the
 * host chrome to go away, shipped with neither. Every kit gate passed; a screenshot found it. The
 * layout has to render a supplied slot unconditionally, and this is checked as source because it
 * is a one-line regression that nothing else in the build would notice.
 */
const layoutPath = join(base, "layouts/BaseLayout.astro");
if (existsSync(layoutPath)) {
  const layout = readFileSync(layoutPath, "utf8");
  for (const name of ["header", "footer"]) {
    const gated = new RegExp(`\\{\\s*chrome\\s*&&\\s*<slot\\s+name="${name}"`).test(layout);
    const supplied = new RegExp(`Astro\\.slots\\.has\\("${name}"\\)\\s*&&\\s*<slot\\s+name="${name}"`).test(layout);
    if (gated || !supplied) {
      findings.push(`${relative(dir, layoutPath)} does not render a supplied "${name}" slot unconditionally, so a composed page that passes its own ${name} and chrome={false} ships without one`);
    }
  }
}

// The reverse direction: a component nobody declared.
for (const pieceDir of readdirSync(kitRoot)) {
  const pd = join(kitRoot, pieceDir);
  if (!statSync(pd).isDirectory()) continue;
  const piece = pieces.find((p) => p.id === pieceDir);
  for (const f of readdirSync(pd)) {
    if (!f.endsWith(".astro")) continue;
    const id = f.replace(/\.astro$/, "");
    if (!piece || !piece.variations.some((v) => v.id === id)) {
      findings.push(`${relative(dir, join(pd, f))} exists but no manifest entry declares it, so Compose can never choose it`);
    }
  }
}

if (findings.length) {
  console.error(`gate-kit-complete: ${findings.length} finding(s) over ${pieces.length} piece(s) and ${declared} declared variation(s).`);
  for (const f of findings.slice(0, 40)) console.error(`  - ${f}`);
  if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
  process.exit(1);
}

const browsable = pieces.reduce((n, p) => n + p.variations.reduce((m, v) => m + v.states.length, 0), 0);
const cited = new Set(pieces.flatMap((p) => p.variations.flatMap((v) => v.evidence)));
console.log(`gate-kit-complete: clean (${pieces.length} pieces, ${declared} variations, ${browsable} declared states, every one declared, built, documented, browsable and grounded in ${cited.size} deep-read references).`);
process.exit(0);
