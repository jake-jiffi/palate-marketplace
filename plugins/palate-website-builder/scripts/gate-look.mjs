#!/usr/bin/env node
import { routeOrExit } from "./lib/workflow-route.mjs";
/**
 * scripts/gate-look.mjs - did anybody OPEN the pages this build shipped?
 *
 * ========================== THE FAULT THIS CLOSES ==========================
 *
 * A real client build took 101 screenshots and finished with no record that a single one of
 * them had been held against the board it was composed from. Every mechanical gate passed:
 * the pages rendered, the console was clean, the routes were in the sitemap. None of those
 * asks the only question Compose is about, which is whether the built page still carries the
 * direction the client chose, and nothing in the build could answer it because nothing had
 * been written down.
 *
 * Screenshots are not a look. A screenshot proves a page RENDERED. A look is a person (or the
 * agent, honestly) opening the shot beside the board and saying what they see, and the only
 * durable form of that is a sentence recorded against the route it is about.
 *
 * ============================== WHAT IT ASKS ===============================
 *
 * One look per PAGE TYPE, not per page. A site with nine services does not need nine looks:
 * the ninth service page teaches nothing the first did not, and asking for it would turn this
 * into a tax. It needs one look at a service page, one at the home page, one at contact, and
 * so on for every KIND of page it actually built, discovered from `dist/client/**\/index.html`
 * through the same classifier `palate-pick.mjs` records a look with
 * (`scripts/lib/route-kind.mjs`), so the two cannot disagree about what `/client-reviews` is.
 *
 * ============================== FAIL-OPEN ==================================
 *
 * A look is only owed once a DIRECTION EXISTS. Before the pick there is no board to hold a
 * page against, so a build with no `explore.picks` skips, as do a build with no manifest and
 * one that has not been built yet. `PALATE_GATE_LOOK=0` releases it with a named skip. The
 * gate never deletes anything and never writes to the manifest: `palate-pick.mjs --looked` is
 * the only writer, which is what keeps the record a report rather than a self-certification.
 *
 * Usage: node scripts/gate-look.mjs <projectDir>
 * Exit: 0 every page type was looked at, 1 findings, 2 cannot check (first stderr line
 *       `gate-look: skipped (<reason>)`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { pageTypeOf, normaliseRoute } from "./lib/route-kind.mjs";

const dir = resolve(process.argv[2] || ".");
routeOrExit("reader", "gate-look", [dir]);

const skip = (reason) => {
  process.stderr.write(`gate-look: skipped (${reason})\n`);
  process.exitCode = 2;
};

/**
 * Routes that are not the site. `/explore` is the board set, `/kit` and `/kit-frame` are the
 * plugin's own component browser, and `/404` and `/thank-you` are answers rather than pages a
 * client is shown a direction on. Asking for a look at any of them would mean asking for a
 * reading of something Compose never composed.
 */
const NOT_THE_SITE = ["/kit", "/kit-frame", "/explore", "/404", "/thank-you"];
const excluded = (route) => NOT_THE_SITE.some((p) => route === p || route.startsWith(`${p}/`));

function builtRoutes(root) {
  const out = [];
  const walk = (abs) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(abs, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== "index.html") continue;
      const rel = relative(root, p).split(sep).slice(0, -1).join("/");
      out.push(rel ? `/${rel}` : "/");
    }
  };
  walk(root);
  return out;
}

function main() {
  if (process.env.PALATE_GATE_LOOK === "0") return skip("PALATE_GATE_LOOK=0");

  const manifestPath = join(dir, "build-manifest.json");
  if (!existsSync(manifestPath)) return skip(`no build-manifest.json under ${dir}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { return skip("build-manifest.json is not readable JSON"); }

  const picks = Array.isArray(manifest?.explore?.picks) ? manifest.explore.picks : [];
  if (!picks.length) return skip("no pick recorded");

  // The build output, `dist/client` first, in the order the adapters produce it (the Vercel
  // adapter leaves a bare `dist/` behind on some versions and walking that one first would
  // read server bundles).
  const root = ["dist/client", "dist"].map((d) => join(dir, d)).find((d) => existsSync(join(d, "index.html")));
  if (!root) return skip(`no built pages under ${join(dir, "dist")}, so there is nothing to have looked at`);

  const routes = builtRoutes(root).map(normaliseRoute).filter((r) => !excluded(r));
  if (!routes.length) return skip("the build output holds no pages of the site itself");

  // Page type -> the routes that carry it, so a finding can name one.
  const byType = new Map();
  for (const r of routes.sort()) {
    const t = pageTypeOf(r);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }

  const pages = Array.isArray(manifest?.compose?.pages) ? manifest.compose.pages : [];
  const record = "  Record one with: node scripts/palate-pick.mjs <project-dir> --looked <route> --shot .palate-shots/<file>.png --verdict \"<what you can see>\"";

  if (!pages.length) {
    process.stderr.write(
      `gate-look: no page has a recorded look. ${routes.length} page(s) were built across ` +
      `${byType.size} page type(s) (${[...byType.keys()].sort().join(", ")}) and nothing says anybody ` +
      "opened one of them beside the board it was composed from.\n" + record + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const lookedTypes = new Set(
    pages
      .filter((p) => p && typeof p.verdict === "string" && p.verdict.trim())
      // The recorded page_type is what palate-pick wrote, and the route is the fallback for a
      // record written before the field existed. Both go through the one classifier.
      .map((p) => (typeof p.page_type === "string" && p.page_type ? p.page_type : pageTypeOf(p.route))),
  );

  const missing = [...byType.entries()].filter(([t]) => !lookedTypes.has(t));
  if (missing.length) {
    process.stderr.write(
      `gate-look: ${missing.length} page type${missing.length === 1 ? "" : "s"} never looked at: ` +
      missing.map(([t, rs]) => `${t} (${rs[0]})`).join(", ") +
      ". A page type nobody opened is a page type nobody compared with the direction the client picked.\n" +
      record + "\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `gate-look: ${byType.size} page type(s) looked at (${[...byType.keys()].sort().join(", ")}), ` +
    `${pages.length} recorded look(s) over ${routes.length} built page(s).`,
  );
}

main();
