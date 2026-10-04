# Canvas-first Explore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explore draws one `.dc.html` artboard per rung, publishes the canvas at once, and builds Astro only for the picked direction; every downstream gate keeps working on the same artefact paths.

**Architecture:** The agent hand-authors `.palate/explore/seed/B{n}.dc.html` against the Claude Design contract. `scripts/boards-render.mjs` stops building Astro and becomes a validator + measurer that writes the artefacts the gates already read (`shots/<id>/rendered.html`, `shots/<id>/hero.png`, `public/_explore/<id>.png`, `canvas.json`, `manifest.explore`). The write wall treats artboards as design source. The board routes, `BoardFrame`, `BoardNotes`, `SectionMark` and `ExploreSwitcher` leave the template; `/explore` shows stills. `palate-pick.mjs` records the question round; `gate-done` requires it.

**Tech Stack:** Node ESM scripts (no deps beyond the vendored Playwright + sharp under `scripts/reference-capture/`), bash test suites under `scripts/test/`, Astro 5 template.

**Spec:** `docs/superpowers/specs/2026-09-11-explore-canvas-first.md`

## Global Constraints

- Branch `beta` of `/Users/jakeshelley/dev/palate/skill`. Never `main`.
- Australian English, no em dashes, no AI-tell copy, in every doc and message string.
- Every new gate assertion is watched failing with its fix reverted (mutation-checked) before the task is done; say so in the report.
- Artefact paths are contracts: `.palate/explore/seed/B{ambition}.dc.html`, `.palate/explore/seed/Ref{position}.dc.html`, `.palate/explore/seed/canvas.json`, `.palate/explore/shots/<id>/rendered.html`, `.palate/explore/shots/<id>/hero.png`, `public/_explore/<id>.png`, `public/_explore/ref{N}.jpg`, `manifest.explore = { ran, shown_at, boards:[{id,rung,donor}] }`. Do not rename any of them.
- `boards-render.mjs` keeps exporting `PROPERTY_LIST`, `parseRegistry`, `toArtboard`, `writeCanvasJson`, `decodeDataUri`, `rewriteUrls`, `selfContained` (palate-pick and the tests import them). Deleting an export is a break.
- Exit codes: 0 ok, 2 refusal, first stderr line `<tool>: skipped (<reason>)` for a skip. Never `process.exit()` inside a Playwright run; set `process.exitCode`.
- Fast suite must stay green: `bash scripts/test/run.sh --fast` from the skill root. Run it at the end of every task that touches a script or the template.
- Design-skill authoring contract (verbatim rules the validator enforces): skeleton `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>…</style></helmet>…</x-dc></body></html>`; `x-dc` 1440px wide; images are bare basenames beside the artboard, each ≤ 70 KB, extensions png/jpg/jpeg/gif/webp/avif/bmp/svg, `src` double-quoted; no remote URLs except `fonts.googleapis.com` / `fonts.gstatic.com`; no `<script>` other than `./support.js`.
- Do not touch `hooks/palate-stop.mjs`, `scripts/gate-uniqueness.mjs` discovery, or `gate-done.sh`'s bold-bar block: they already read the preserved artefacts.

---

### Task 1: The write wall reaches the artboards

**Files:**
- Modify: `hooks/palate-pretooluse.mjs:78-83`
- Test: `scripts/test/pretooluse-diverge.test.sh` (append after line 403's block)

**Interfaces:**
- Produces: `SOURCE` and `PAGE_OR_SECTION` also match `.palate/explore/seed/<Name>.dc.html`. Nothing else changes; the DIVERGE, checkpoint and survey walls apply unchanged.

- [ ] **Step 1: Write the failing tests** (append before `echo "passed=$pass failed=$fail"`)

```bash
# === ARTBOARDS ARE DESIGN SOURCE ===========================================================
# Canvas-first Explore writes .palate/explore/seed/B1.dc.html as the FIRST design artefact of a
# build. If that path fell outside the wall, five boards could be drawn having diverged nothing,
# asked nothing and surveyed nothing: the exact failure every wall exists to stop.
AB="$TMP/art-nodiverge"; mkdir -p "$AB"; echo "$MARKER" > "$AB/.palate-skill-state.json"
want "artboard before DIVERGE -> deny" DENY "$(run "$AB" Write "$AB/.palate/explore/seed/B1.dc.html")"
AB2="$TMP/art-diverged"; mkdir -p "$AB2"; echo "$MARKER" > "$AB2/.palate-skill-state.json"; write_valid_manifest "$AB2"
want "artboard after DIVERGE + checkpoint -> allow" ALLOW "$(run "$AB2" Write "$AB2/.palate/explore/seed/B1.dc.html")"
AB3="$TMP/art-survey"; mkdir -p "$AB3"; echo "$MARKER" > "$AB3/.palate-skill-state.json"; write_valid_manifest "$AB3"; add_calls "$AB3" "$SHALLOW"
want "artboard with a thin survey -> deny (drawn FROM the library)" DENY "$(run "$AB3" Write "$AB3/.palate/explore/seed/B1.dc.html")"
AB4="$TMP/art-notes"; mkdir -p "$AB4"; echo "$MARKER" > "$AB4/.palate-skill-state.json"
want "the seed README is not design source -> allow" ALLOW "$(run "$AB4" Write "$AB4/.palate/explore/seed/README.md")"
want "canvas.json is not design source -> allow" ALLOW "$(run "$AB4" Write "$AB4/.palate/explore/seed/canvas.json")"
```

- [ ] **Step 2: Run, expect the first and third to FAIL** (`got ALLOW, want DENY`): `bash scripts/test/pretooluse-diverge.test.sh | grep -E "FAIL|passed="`

- [ ] **Step 3: Implement**

```js
const SOURCE = /\.(astro|svelte|vue|tsx?|jsx?|mjs|css|scss)$|\.dc\.html$/i;
// ...
// Canvas-first Explore: an artboard under .palate/explore/seed/ IS the first design write of a
// build (a drawn hero and section), so it is page-and-section source for every wall.
const PAGE_OR_SECTION = /(^|\/)src\/(pages|components)\/|(^|\/)\.palate\/explore\/seed\/[^/]+\.dc\.html$/i;
```

- [ ] **Step 4: Run, expect all green**; then mutation: revert `PAGE_OR_SECTION` only and confirm the thin-survey case fails; restore.
- [ ] **Step 5: Commit** `git add hooks/palate-pretooluse.mjs scripts/test/pretooluse-diverge.test.sh && git commit -m "wall: artboards under .palate/explore/seed are design source"`

---

### Task 2: The registry names an artboard, and gate-explore checks the artboard and the canvas record

**Files:**
- Modify: `templates/astro-project/src/lib/variants.ts:38-75`
- Modify: `scripts/gate-explore.mjs:207-212` (check 1 stays), `:256-270` (check 4)
- Test: `scripts/test/gate-explore.test.sh` (helpers at 39-41, cases 4 and 11, plus new cases)

**Interfaces:**
- Produces: `Variant.artboard: string` REQUIRED (`"B{ambition}.dc.html"`); `Variant.href?: string` optional and unused. `parseRegistry` (Task 3) returns `artboard` on each entry.
- Produces: gate-explore blocks when `manifest.explore.shown_at` exists and neither `explore.canvas.url` nor `explore.canvas.skipped` is recorded.

- [ ] **Step 1: Edit the type** (replace the `href` doc + field, add `artboard`)

```ts
  /**
   * The artboard file under .palate/explore/seed/, e.g. "B1.dc.html". REQUIRED: the board IS
   * this file. There is no route; Astro is built once, for the picked direction, at Compose.
   */
  artboard: string;
  /** Deprecated. Boards have no route since canvas-first Explore; kept optional for old registries. */
  href?: string;
```
Also update the file's header comment: `/explore` shows stills of the artboards; nothing under `/boards/` exists.

- [ ] **Step 2: Rewrite the test helpers and cases**

```bash
mk() { mkdir -p "$1/src/lib" "$1/src/pages" "$1/.palate/explore/seed"; }
page() { : > "$1/src/pages/explore.astro"; }
boards() { for id in "${@:2}"; do n="${id#b}"; printf '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style></style></helmet><section class="hero" data-section-id="%s-hero"></section></x-dc></body></html>' "$id" > "$1/.palate/explore/seed/B$n.dc.html"; done; }
```
Every registry fixture in the file gains `artboard: "B<n>.dc.html",` beside `id` and drops `href`. Case 11 becomes:
```bash
# === 11. A REGISTERED BOARD WITH NO ARTBOARD. The canvas shows a hole where the rung should be.
K="$TMP/k11"; mk "$K"; page "$K"; boards "$K" b1 b2 b3; write_valid "$K"
rm -f "$K/.palate/explore/seed/B2.dc.html"
want "a registered board with no artboard -> block" BLOCK "$(run "$K")"
has "and it names the file it needs" "$K" ".palate/explore/seed/B2.dc.html"
```
New cases 16 and 17:
```bash
# === 16. SHOWN BUT THE CANVAS WAS NEITHER PUBLISHED NOR DECLINED. Silence is the failure.
Q="$TMP/k16"; mk "$Q"; page "$Q"; boards "$Q" b1 b2 b3; write_valid "$Q"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","boards":[]}}' > "$Q/build-manifest.json"
want "shown, no canvas record -> block" BLOCK "$(run "$Q")"
has "and it says what to record" "$Q" "explore.canvas"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"}}}' > "$Q/build-manifest.json"
want "shown, canvas url recorded -> pass" PASS "$(run "$Q")"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true,"reason":"no design skill in this session"}}}' > "$Q/build-manifest.json"
want "shown, canvas skip recorded with a reason -> pass" PASS "$(run "$Q")"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true}}}' > "$Q/build-manifest.json"
want "shown, canvas skipped with NO reason -> block" BLOCK "$(run "$Q")"
# === 17. NOT YET SHOWN: the canvas cannot be owed before the boards exist.
R="$TMP/k17"; mk "$R"; page "$R"; boards "$R" b1 b2 b3; write_valid "$R"
echo '{"schema":3}' > "$R/build-manifest.json"
want "not shown yet, no canvas record -> pass" PASS "$(run "$R")"
```

- [ ] **Step 3: Run, expect 11, 16 to FAIL**: `bash scripts/test/gate-explore.test.sh | grep -E "FAIL|passed="`

- [ ] **Step 4: Implement check 4 and the canvas check** in `gate-explore.mjs` (replace the `if (href) {...} else {...}` block):

```js
  // ------------------------------------------- 4. the artboard exists (the board IS the file)
  const artboard = typeof v.artboard === "string" ? v.artboard.trim() : "";
  if (!artboard) {
    add(`${id} has no artboard`, `every board names its file, e.g. artboard: "B${v.ambition ?? 1}.dc.html". Without it nothing can be drawn on the canvas or shown on /explore.`);
  } else if (!/^B\d+\.dc\.html$/.test(artboard)) {
    add(`${id} names an artboard outside the convention`, `artboard must be B<rung>.dc.html (got ${artboard}); the canvas read-back (/pick --canvas) aligns on that name.`);
  } else if (!existsSync(join(dir, ".palate/explore/seed", artboard))) {
    add(`${id} registers a board that was never drawn`, `artboard ${artboard} needs .palate/explore/seed/${artboard} and there is no such file. The canvas shows a hole where rung ${v.ambition} should be.`);
  }
```
and, after the per-entry loop, before findings are reported:
```js
// ------------------------------------------------ 5. shown boards were put somewhere
// The canvas is where the person iterates. Publishing it is not optional when the design skill
// is present, and when it is absent that is RECORDED with a reason, never left silent.
try {
  const m = JSON.parse(readFileSync(join(dir, "build-manifest.json"), "utf8"));
  const ex = m.explore || {};
  if (ex.shown_at) {
    const c = ex.canvas || {};
    const ok = (typeof c.url === "string" && c.url.trim()) || (c.skipped === true && typeof c.reason === "string" && c.reason.trim());
    if (!ok) {
      add("The boards were shown but the canvas was neither published nor declined",
        `explore.shown_at is ${ex.shown_at} and manifest.explore.canvas records nothing. Publish the canvas with the design skill and record explore.canvas = { url }, or record explore.canvas = { skipped: true, reason } when no design skill can run in this session.`);
    }
  }
} catch { /* no manifest: nothing shown yet */ }
```
Confirm `readFileSync` is imported. Keep check 1 (explore.astro) as is.

- [ ] **Step 5: Run green; mutation: remove check 5, confirm case 16's first assertion fails; restore.**
- [ ] **Step 6: Commit** `git commit -am "gate-explore: a board is its artboard; the canvas is published or declined, never silent"`

---

### Task 3: boards-render becomes the artboard validator and measurer

**Files:**
- Modify: `scripts/boards-render.mjs` (rewrite `main()`; delete the harvest pipeline; keep exports)
- Test: `scripts/test/boards-render.test.mjs` (keep the unit tests for `toArtboard`, `writeCanvasJson`, `parseRegistry`; replace the integration section)

**Interfaces:**
- Consumes: `Variant.artboard` (Task 2).
- Produces: CLI `node scripts/boards-render.mjs <projectDir> [--out .palate/explore] [--refs <path>]` (no `--no-build`, no `--port`; `--no-build` is accepted and ignored with a stderr note so old docs do not break). Exports unchanged plus new `export function validateArtboard(html, { id, section, dir })` returning `{ ok, problems: string[] }` and `export function stampKeys(html)` returning html with `data-palate-k` on every element that lacks one.
- Writes exactly the artefacts in Global Constraints. `rendered.html` is the artboard after `stampKeys`, byte-identical to the seed file (the seed file is rewritten in place with the keys, so the published canvas and the archive align).

- [ ] **Step 1: Write the failing unit tests** (add to `boards-render.test.mjs`, node:test style like the existing ones)

```js
import { validateArtboard, stampKeys } from "../boards-render.mjs";
const GOOD = `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>a{color:#000}a:hover{color:#333}</style></helmet><header class="nav" data-section-id="b1-navigation"><a class="nav-logo" href="#">Eastcoast</a><a class="nav-cta" href="#">Ring</a></header><section class="hero" data-section-id="b1-hero"><h1 class="hero-title">Hogan Street</h1><img src="b1-img1.jpg" alt=""></section><section class="services" data-section-id="b1-services"><ul class="list"><li class="row">Doors</li></ul></section><aside class="motion-note" data-palate-motion="">On load the column rules draw down over 800ms on one curve, then hold; nothing loops.</aside><section class="cta" data-section-id="b1-cta"><a class="cta-btn" href="#">Book</a></section><footer class="footer" data-section-id="b1-footer"><p class="footer-line">Ballina</p></footer></x-dc></body></html>`;
test("a conforming artboard validates", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});
test("a missing hero mark is named", () => {
  const r = validateArtboard(GOOD.replace(' data-section-id="b1-hero"', ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /b1-hero/);
});
test("a whole page is required: nav, cta and footer marks are each named when missing", () => {
  for (const piece of ["navigation", "cta", "footer"]) {
    const r = validateArtboard(GOOD.replace(` data-section-id="b1-${piece}"`, ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
    assert.equal(r.ok, false, piece); assert.match(r.problems.join("\n"), new RegExp(`b1-${piece}`));
  }
});
test("the planned motion must be written on the board as text", () => {
  const r = validateArtboard(GOOD.replace(/<aside class="motion-note"[^>]*>[^<]*<\/aside>/, ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /motion/);
  const short = validateArtboard(GOOD.replace(/(<aside class="motion-note"[^>]*>)[^<]*/, "$1fades in"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(short.ok, false); assert.match(short.problems.join("\n"), /motion/);
});
test("the hero is found by name, not by position (nav first is fine)", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});
test("a remote image is refused", () => {
  const r = validateArtboard(GOOD.replace("b1-img1.jpg", "https://example.com/x.jpg"), { id: "b1", section: "services", dir: fixtureDirWith({}) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /remote|bare filename/i);
});
test("an oversized image is refused at 70 KB", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 71 * 1024 }) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /70 KB/);
});
test("a second script tag is refused", () => {
  const r = validateArtboard(GOOD.replace("</x-dc>", "<script>alert(1)</script></x-dc>"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /script/);
});
test("blind structure is refused: fewer than 60% of block elements carry a class", () => {
  const blind = GOOD.replace(/ class="[^"]*"/g, "");
  const r = validateArtboard(blind, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false); assert.match(r.problems.join("\n"), /class/);
});
test("stampKeys gives every element a stable data-palate-k and is idempotent", () => {
  const once = stampKeys(GOOD); const twice = stampKeys(once);
  assert.equal(once, twice);
  assert.ok((once.match(/data-palate-k="/g) || []).length >= 7);
});
```
`fixtureDirWith(sizes)` creates a temp dir with files of the given byte sizes (helper in the test file).

- [ ] **Step 2: Run, expect import failure**: `node --test scripts/test/boards-render.test.mjs`

- [ ] **Step 3: Implement** `validateArtboard` and `stampKeys` (pure string functions using the same regex style the file already uses; no DOM):

```js
const IMG_OK = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const BLOCK_TAGS = /^(section|div|header|footer|main|nav|article|aside|ul|ol|li|figure|h[1-6]|p|table|form)$/i;
export function validateArtboard(html, { id, section, dir }) {
  const problems = [];
  if (!/^<!doctype html><html><head><meta charset="utf-8"><script src="\.\/support\.js"><\/script><\/head><body><x-dc><helmet><style>/i.test(html.replace(/\s+/g, " ").replace(/> </g, "><").trim().replace(/^\s+/, ""))) {
    problems.push("the skeleton must be exactly <!doctype html><html><head><meta charset=\"utf-8\"><script src=\"./support.js\"></script></head><body><x-dc><helmet><style>…; the editor replaces support.js at render time and a different spelling silently breaks editing");
  }
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  if (scripts.length !== 1 || !/src="\.\/support\.js"/.test(scripts[0])) problems.push(`exactly one <script> is allowed, ./support.js; found ${scripts.length}`);
  const ids = [...html.matchAll(/data-section-id="([^"]+)"/g)].map((m) => m[1]);
  // A board is the WHOLE page in that direction, nav to footer, composed from the kit's pieces.
  for (const piece of ["navigation", "hero", "cta", "footer"]) {
    if (!ids.includes(`${id}-${piece}`)) problems.push(`no element carries data-section-id="${id}-${piece}"; an artboard is the whole page (navigation, hero, the inner sections, cta, footer), composed from the kit, never a hero plus one section`);
  }
  if (!ids.includes(`${id}-${section}`)) problems.push(`no element carries data-section-id="${id}-${section}"; the registry says this board shows "${section}"`);
  // The motion is written ON the board: a still cannot show it, and a side panel is not where it is judged.
  const motion = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bdata-palate-motion\b[^>]*>([\s\S]*?)<\/\1>/i);
  const motionText = motion ? motion[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  if (motionText.length < 40) problems.push(`the planned motion must be written on the board as text: one block with class="motion-note" data-palate-motion carrying what moves, when and how it feels (found ${motionText ? JSON.stringify(motionText) : "none"})`);
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
    const raw = m[1];
    if (!raw.startsWith('"')) { problems.push(`img src ${raw} must be double-quoted`); continue; }
    const src = raw.slice(1, -1);
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) { problems.push(`img src ${src} is remote or inline; images are bare filenames beside the artboard`); continue; }
    if (src.includes("/")) { problems.push(`img src ${src} must be a bare filename beside the artboard`); continue; }
    if (!IMG_OK.test(src)) { problems.push(`img src ${src} is not an image type the canvas resolves`); continue; }
    const p = join(dir, src);
    if (!existsSync(p)) problems.push(`img src ${src} is not beside the artboard`);
    else if (statSync(p).size > 70 * 1024) problems.push(`${src} is ${Math.round(statSync(p).size / 1024)} KB; the canvas needs every image under 70 KB`);
  }
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const u = m[2];
    if (/^(https?:)?\/\//i.test(u) && !/fonts\.gstatic\.com|fonts\.googleapis\.com/.test(u)) problems.push(`css url(${u}) is remote; only Google Fonts may be fetched`);
  }
  for (const m of html.matchAll(/<(link|@import)\b[^>]*href=("[^"]*")/gi)) {
    if (!/fonts\.googleapis\.com/.test(m[2])) problems.push(`link ${m[2]} is not Google Fonts; nothing else may be fetched`);
  }
  const blocks = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].filter((m) => BLOCK_TAGS.test(m[1]));
  const withClass = blocks.filter((m) => /\bclass="[^"]*[a-z]/i.test(m[2]));
  if (blocks.length && withClass.length / blocks.length < 0.6) problems.push(`only ${withClass.length} of ${blocks.length} block elements carry a class; name every block's role (hero, hero-title, list, row) or the uniqueness gate signs the structure blind`);
  if (!/a\s*:\s*hover/.test(html)) problems.push("define a and a:hover in <helmet><style>");
  return { ok: problems.length === 0, problems };
}
export function stampKeys(html) {
  let i = 0;
  return html.replace(/<([a-z][a-z0-9-]*)\b([^>]*?)(\/?)>/gi, (whole, tag, attrs, slash) => {
    if (/^(html|head|meta|script|style|helmet|x-dc|body|link|title|br)$/i.test(tag)) return whole;
    if (/\bdata-palate-k=/.test(attrs)) return whole;
    return `<${tag}${attrs} data-palate-k="k${i++}"${slash}>`;
  });
}
```
`stampKeys` is idempotent because it skips elements that already carry a key.

- [ ] **Step 4: Rewrite `main()`** (delete the astro build, the server, `settle`, `harvest`, `inlineComputedStyles`, `inlineFonts`, the image ladder walk over harvested images, and the `public/_explore` copy of a LIVE screenshot; keep everything exported):

```js
async function main() {
  const projectDir = resolve(positional[0] || ".");
  const outDir = resolve(projectDir, opt("--out", ".palate/explore"));
  const seedDir = join(outDir, "seed");
  const shotsDir = join(outDir, "shots");
  const refsPath = opt("--refs", null);
  if (flag("--no-build")) process.stderr.write("boards-render: --no-build is obsolete; boards are artboards and nothing is built here.\n");

  const reg = join(projectDir, "src", "lib", "variants.ts");
  if (!existsSync(reg)) die(`no ${join("src", "lib", "variants.ts")} under ${projectDir}. Not an Explore build; nothing measured. NOT a pass.`);
  const boards = parseRegistry(readFileSync(reg, "utf8")).sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
  if (!boards.length) die("no boards registered in src/lib/variants.ts. Register them first; nothing was measured.");
  if (!existsSync(seedDir)) die(`no ${seedDir}. Draw the artboards first: one .palate/explore/seed/B<rung>.dc.html per registered board.`);

  // 1. every registered board has a conforming artboard; refuse the set on the first bad one
  for (const b of boards) {
    const file = b.artboard || `B${b.ambition}.dc.html`;
    const p = join(seedDir, file);
    if (!existsSync(p)) die(`board ${b.id} registers ${file} and ${p} does not exist. Nothing measured.`);
    const v = validateArtboard(readFileSync(p, "utf8"), { id: b.id, section: b.section, dir: seedDir });
    if (!v.ok) die(`artboard ${file} (${b.id}) does not meet the canvas contract:\n  - ${v.problems.join("\n  - ")}`);
  }
  const refs = refsPath ? loadRefs(refsPath) : [];   // keep the existing --refs validation (slug,name,position,why,screenshot)

  const { chromium } = await import(join(HERE, "reference-capture", "node_modules", "playwright", "index.mjs")).catch(() => ({}));
  if (!chromium) die("playwright is not installed under scripts/reference-capture; run scripts/reference-capture/setup.sh");
  const browser = await chromium.launch();
  const measured = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    for (const b of boards) {
      const file = b.artboard || `B${b.ambition}.dc.html`;
      const p = join(seedDir, file);
      // 2. stamp keys IN PLACE so the published canvas and the archive align on data-palate-k
      const stamped = stampKeys(readFileSync(p, "utf8"));
      writeFileSync(p, stamped);
      // 3. archive the artboard itself as the render the gates read
      const boardShots = join(shotsDir, b.id); mkdirSync(boardShots, { recursive: true });
      writeFileSync(join(boardShots, "rendered.html"), stamped);
      for (const img of [...stamped.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1])) {
        try { copyFileSync(join(seedDir, img), join(boardShots, img)); } catch { /* validated above */ }
      }
      // 4. measure and shoot over file://, the same layout the canvas draws
      await page.goto(`file://${p}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(150);
      const h = await page.evaluate(() => Math.ceil(document.querySelector("x-dc")?.getBoundingClientRect().height || document.documentElement.scrollHeight));
      await page.screenshot({ path: join(boardShots, "hero.png"), fullPage: false });
      const pub = join(projectDir, "public", "_explore"); mkdirSync(pub, { recursive: true });
      copyFileSync(join(boardShots, "hero.png"), join(pub, `${b.id}.png`));
      measured.push({ ...b, file, h });
    }
    for (const r of refs) await refArtboard(page, r, seedDir, projectDir);   // unchanged behaviour
  } finally { await browser.close(); }

  writeCanvasJson({ boards: measured, refs, out: join(seedDir, "canvas.json") });
  writeFileSync(join(seedDir, "README.md"), seedReadme(measured, refs));
  recordShown(projectDir, boards);
  process.stdout.write(`boards-render: ${measured.length} artboard(s) validated, keyed, measured and archived under ${outDir}\n`);
}
```
Keep `writeCanvasJson`'s existing signature (`boards` entries need `id`, `ambition`, `name`, `h`; if it read `file` from `B${b.ambition}.dc.html` before, it still can). Keep `refArtboard`, `seedReadme` (update its text: the artboard IS the source of truth now; `/pick --canvas` reads edits back; no line about Astro being the source), `recordShown` unchanged. Delete `die`'s seed wipe: the seed is now the operator's own work and must never be deleted by a refusal.

- [ ] **Step 5: Rewrite the integration test**: scaffold a temp project with `src/lib/variants.ts` registering b1 and b2 (`artboard` set, no `href`), write two conforming artboards with one small JPEG each (reuse the test's existing PNG/JPEG fixture bytes), run the CLI, assert: exit 0; `.palate/explore/shots/b1/rendered.html` exists and contains `data-palate-k=` and `data-section-id="b1-hero"`; `shots/b1/hero.png` and `public/_explore/b1.png` exist and are > 1 KB; `seed/B1.dc.html` now carries `data-palate-k`; `canvas.json` lists `B1.dc.html` and `B2.dc.html` with `h` ≥ 200 and the row/gap geometry the old tests asserted; running the CLI twice leaves `seed/B1.dc.html` byte-identical (idempotent); a registry naming `B3.dc.html` with no file exits 2 naming the path and does NOT delete `seed/B1.dc.html`; an artboard with a 71 KB image exits 2 naming "70 KB". Delete the old assertions about `<script>` counts, flattened `font-size: 27px`, `srcset`, Google Fonts survival and the Astro build.

- [ ] **Step 6: Run** `node --test scripts/test/boards-render.test.mjs` green; run `bash scripts/test/run.sh --fast`.
- [ ] **Step 7: Commit** `git commit -am "boards-render: validate, key, measure and archive hand-drawn artboards; no Astro build in Explore"`

---

### Task 4: gate-fidelity reads the artboard without a dist

**Files:**
- Modify: `scripts/gate-fidelity.mjs:118-131` (dist requirement), `:370-376` (board serving), `:503` (hero.png source, unchanged path)
- Test: `scripts/test/gate-fidelity.test.mjs` (fixtures)

**Interfaces:**
- Consumes: `shots/<id>/rendered.html` is now a self-contained artboard with bare-filename images beside it (Task 3).
- Produces: the board is served from `.palate/explore/shots/<id>/` on the free port (so `b1-img1.jpg` resolves); `dist` is required ONLY when `--serve` is absent (the built home has to come from somewhere). Skip reason text updated.

- [ ] **Step 1: Change the fixtures** so every case writes `shots/b1/rendered.html` as a conforming artboard (copy the `GOOD` string from Task 3's test, with `data-section-id="b1-hero"` and `b1-services`) plus a 1 KB `b1-img1.jpg` beside it, and a `hero.png`. Keep the built-home fixtures (`dist/index.html` with `data-palate-section` marks) exactly as they are. Add one case: `--serve <url>` with NO `dist/` directory must NOT skip with "a build is required"; it must reach the comparison (assert the stderr does not match `/build is required/`).
- [ ] **Step 2: Run, expect the new case to fail** with the old skip text.
- [ ] **Step 3: Implement**

```js
const distRoot = ["dist/client", "dist"].map((d) => join(dir, d)).find((d) => existsSync(join(d, "index.html")));
if (!distRoot && !serveUrl) {
  cannotCheck(`no built site under ${join(dir, "dist")} and no --serve URL. The composed home has to be built (or served) before it can be compared with the picked board.`);
}
// ...
// The board is an artboard: self-contained CSS, bare-filename images beside it. Serve its own
// directory, not the build's, so `b1-img1.jpg` resolves and no dist is needed for the board.
const boardServed = await serveOnFreePort(join(shotsRoot, heroPick.variant_id), Number(opt("--port", "8791")), readFileSync(heroRenderPath, "utf8"));
```
and the home URL: `const homeUrl = serveUrl || (distRoot ? await serveDist(distRoot) : null)` where `serveDist` reuses `serveOnFreePort` on `distRoot` (a second server, closed in `finally`). Update the `data-section-id` skip text to say "mark the hero root data-section-id=\"<id>-hero\" in the artboard and re-run boards-render" instead of naming `SectionMark`. **The hero is found by NAME**: replace `const heroSectionId = heroIds[0];` with `const heroSectionId = heroIds.includes(`${heroPick.variant_id}-hero`) ? `${heroPick.variant_id}-hero` : heroIds[0];` because an artboard opens with its navigation, so the first mark is `<id>-navigation`, not the hero. Add a fixture case where the artboard's first `data-section-id` is `b1-navigation` and assert the gate still names `b1-hero` as the hero.
- [ ] **Step 4: Run green; mutation: put the unconditional dist check back and watch the new case fail; restore.**
- [ ] **Step 5: Commit** `git commit -am "gate-fidelity: the picked board is an artboard served from its own directory; dist only for the home"`

---

### Task 5: The template loses the board routes and `/explore` shows stills

**Files:**
- Delete: `templates/astro-project/src/layouts/BoardFrame.astro`, `src/components/BoardNotes.astro`, `src/components/SectionMark.astro`, `src/components/ExploreSwitcher.astro`, `src/components/sections/` (if it only holds the board example), `src/pages/boards/` (if present)
- Modify: `templates/astro-project/src/layouts/BaseLayout.astro:13,102` (remove the import and the mount), `templates/astro-project/src/pages/explore.astro:153,179,183,196,211,218`
- Delete: `scripts/test/board-components.test.sh`
- Modify: `scripts/test/explore-page-boards.test.sh`

**Interfaces:**
- Produces: on `/explore`, each board card shows `/_explore/<id>.png` and every former `href={v.href}` becomes `href={`/_explore/${v.id}.png`}` with the link text "Open the still at full size"; the canvas link (line 111-119) is unchanged and stays first. No route under `/boards/`.

- [ ] **Step 1: Rewrite `explore-page-boards.test.sh`**: instead of registering Astro boards and building them, write `public/_explore/b1.png`, `public/_explore/b2.png` from the test's PNG fixture and register two variants with `artboard`. Keep every assertion about the calibration row, the ladder ordering, `data-asked-rung`, the canvas link preceding `more restrained`, `noindex`, and the motion sentence. Replace `href="/boards/b1"` with `href="/_explore/b1.png"`; delete the ExploreSwitcher pill assertion and the `/boards/b2/` page load; keep the final `verify-rendered.sh` run on `/explore` only.
- [ ] **Step 2: Run, expect the href assertions to fail.**
- [ ] **Step 3: Edit `explore.astro`** (six `href={v.href}` sites) and `BaseLayout.astro`; delete the five files and the old test. Grep the template for `SectionMark|BoardFrame|BoardNotes|ExploreSwitcher|/boards/` and remove every remaining reference (including `templates/astro-project/_claude/` mirrors and `astro.config.mjs` route lists if any).
- [ ] **Step 4: Run** the test green, then `bash scripts/test/run.sh --fast` (expect `docs-truth` and `gate-shipready` cases to flag stale doc references; fix the docs they name in Task 7 if they are doctrine, or now if they are template comments).
- [ ] **Step 5: Commit** `git commit -am "template: boards are artboards; /explore shows stills; board routes and their components removed"`

---

### Task 6: The pick records the question round, and done refuses without it

**Files:**
- Modify: `scripts/palate-pick.mjs:30-31` (usage), `:43` (VALUE_FLAGS), after line 217 (new block), `:234` (the nothing-to-record list)
- Modify: `scripts/gate-done.sh:618-630` (fidelity skip chain)
- Test: `scripts/test/palate-pick.test.mjs`, `scripts/test/gate-done.test.sh`

**Interfaces:**
- Produces: `--answer <key>=<text>` repeatable; keys are exactly `motion`, `mix`, `cms`; written to `manifest.explore.question_round = { motion, mix, cms, answered_at }` (merge, so keys can arrive over several calls). gate-done: when picks exist and `question_round` lacks any of the three keys, `fail "The direction was picked but the question round was not recorded..."` before the proof check.

- [ ] **Step 1: Write the failing tests**

```js
test("--answer records the question round, key by key, and refuses an unknown key", () => {
  run(["--answer", "motion=the column rules draw down over 800ms, nothing loops"]);
  run(["--answer", "mix=b2 services list under the b3 hero"]);
  run(["--answer", "cms=false, the office edits nothing"]);
  const m = manifest();
  assert.equal(m.explore.question_round.motion.startsWith("the column rules"), true);
  assert.equal(m.explore.question_round.mix.startsWith("b2 services"), true);
  assert.equal(m.explore.question_round.cms, "false, the office edits nothing");
  assert.ok(m.explore.question_round.answered_at);
  const r = runRaw(["--answer", "colour=red"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /motion, mix, cms/);
});
```
and in `gate-done.test.sh`: a build with `explore.picks` non-empty, `explore.proof` set, a built home, and NO `question_round` → the done gate FAILS naming "question round"; the same with all three keys → passes that check (reaches fidelity).
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement** in palate-pick (`VALUE_FLAGS` gains `"--answer"`; collect ALL `--answer` occurrences, not just the last):

```js
const ANSWER_KEYS = ["motion", "mix", "cms"];
const answers = {};
for (let i = 0; i < argv.length; i++) if (argv[i] === "--answer") {
  const kv = String(argv[i + 1] || ""); const eq = kv.indexOf("=");
  const k = eq > 0 ? kv.slice(0, eq).trim() : ""; const v = eq > 0 ? kv.slice(eq + 1).trim() : "";
  if (!ANSWER_KEYS.includes(k) || !v) refuse(`--answer takes motion=..., mix=... or cms=... (got ${JSON.stringify(kv)}). These are the three things Compose needs from the person: how the picked rung should move, what to mix in from other boards, and who edits the copy.`);
  answers[k] = v;
}
if (Object.keys(answers).length) patch.explore = { ...(patch.explore || {}), question_round: { ...answers, answered_at: new Date().toISOString() } };
```
(merge-by-field through `manifest-merge.mjs` so earlier keys survive). Add `--answer` to the "nothing to record" list and the usage comment. In gate-done, before `elif [ -z "$proof" ]`:
```bash
  elif [ "$(jq -r '[.explore.question_round.motion, .explore.question_round.mix, .explore.question_round.cms] | map(select(type=="string" and length>0)) | length' "$MANIFEST" 2>/dev/null || echo 0)" -lt 3 ]; then
    fail "The direction was picked but the question round was not recorded. Before Compose, ask the person how the picked rung should move, what to mix in from the other boards, and who edits the copy, then record it: scripts/palate-pick.mjs --answer motion=... --answer mix=... --answer cms=..."
```
- [ ] **Step 4: Run green; mutation: remove the gate-done branch, watch its test fail; restore.**
- [ ] **Step 5: Commit** `git commit -am "pick: --answer records the question round; done refuses a pick without it"`

---

### Task 7: Doctrine follows the code

**Files:**
- Modify: `references/explore-stage.md` (steps 2, 2b, 3, 4; "Board scope" 230-244; "Section identifiers" 390-402; "Compose" 499-544; "Where this lives" 557-564)
- Modify: `SKILL.md:151, 184, 186-188, 227, 348`
- Modify: `agents/palate-surveyor.md:82,109,131`, `commands/pick.md`, `references/build-manifest.md:46`, `references/cache-invalidation.md`
- Test: `scripts/test/docs-truth.test.sh` (update the assertions that quote the old A.4 wording; add one that SKILL.md A.4 contains "artboard" and does not contain "src/pages/boards")

**Interfaces:**
- Consumes: everything above. The doctrine must name exactly: `.palate/explore/seed/B<rung>.dc.html`, `node scripts/boards-render.mjs <project-dir> [--refs …]`, `explore.canvas = { url } | { skipped, reason }`, `palate-pick.mjs --answer motion=… --answer mix=… --answer cms=…`, `Variant.artboard`.

- [ ] **Step 1: Write the docs-truth assertions first** (they fail on the current text).
- [ ] **Step 2: Rewrite `explore-stage.md` step 2** as "Draw the boards": one artboard per rung, **each the WHOLE home page in that direction, navigation to footer, composed from the website kit's pieces (`src/lib/kit.ts`, the rhythms in `src/lib/kit-grounding.ts`), declaring its rhythm the way the kit pages do, every rendered kit section a root marked `data-section-id="<id>-<piece>"`** (required at minimum navigation, hero, cta, footer and the registry's `section`), **with the planned motion written on the board as text in a `motion-note` block carrying `data-palate-motion`**, authored by hand against the contract (copy the "Artboard contract" section of the spec into the doc verbatim as a checklist), grounded in the survey (name the donor, its section notes, the locked tokens), each carrying `data-section-id="<id>-hero"` first and `"<id>-<section>"`, one class per block, images ≤ 70 KB beside the file, the motion written in `Variant.motion` because the artboard is still. Registration in `src/lib/variants.ts` with `artboard`. Then **2b "Validate, measure, publish"**: `boards-render.mjs` (what it refuses, what it writes), then `/design` seeding from `.palate/explore/seed/` and `manifest.explore.canvas = { url }`, or `{ skipped: true, reason }` when no design skill; then `deploy-preview.sh --explore` for the stills page. State plainly: no Astro is written for a board; the first Astro of the build is the picked hero at Compose. **Step 3 "Pause, pick, ask"**: the pick on the canvas or from `/explore`, `/pick`, then the question round (three questions, one pass, `--answer`), then `--canvas <extract-dir>` read-back. **Step 4 Compose**: proof of motion first (the picked hero alone, `--proof`), then honour `question_round.mix` and `feedback.json`, keep `data-palate-section` identities matching the artboard's `data-section-id`s. Delete the "Compose lifts component FILES" mechanics and "Section identifiers via SectionMark". Rewrite "Where this lives" to "the artboards are the direction; the project acquires its first page at Compose".
- [ ] **Step 3: Rewrite SKILL.md A.4** to the same sequence in the same compressed register (one paragraph), A.5 to include the question round, A.6 to drop the archive-boards step and keep "delete `public/_explore/`, clear `src/lib/variants.ts`, delete `explore.astro`". Fix lines 151, 184, 227, 348 to stop claiming boards are Astro routes.
- [ ] **Step 4: Update** `agents/palate-surveyor.md` (the `--refs` invocation is unchanged; remove any `--no-build`), `commands/pick.md` (`--answer`), `references/build-manifest.md` (`explore.canvas`, `explore.question_round`, `Variant.artboard`), `references/cache-invalidation.md` (artefact list).
- [ ] **Step 5: Run** `bash scripts/test/docs-truth.test.sh` and the full fast suite green.
- [ ] **Step 6: Commit** `git commit -am "doctrine: canvas-first Explore, the question round, the canvas recorded or declined"`

---

### Task 8: Release to beta

**Files:**
- Modify: none in the skill; marketplace `~/dev/palate-marketplace` via its scripts.

- [ ] **Step 1:** `bash scripts/test/run.sh --fast` green from the skill root; `git push origin beta`.
- [ ] **Step 2:** In `~/dev/palate-marketplace`: `./scripts/sync-beta.sh ~/dev/palate/skill 1.17.0-beta.17`, bump `plugins[palate-beta].version` in `.claude-plugin/marketplace.json` to `1.17.0-beta.17`, `./scripts/check-tracks.sh` must print `passed=15 failed=0`, commit, push.
- [ ] **Step 3:** Report: the commit SHAs, the test counts per suite touched, and the sentence "the next real build is the acceptance test".
