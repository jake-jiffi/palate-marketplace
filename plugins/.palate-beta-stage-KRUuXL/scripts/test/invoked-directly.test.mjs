/**
 * invoked-directly.test.mjs - every CLI in the plugin runs when it is run.
 *
 * ========================= THE FAULT THIS PINS =========================
 *
 * Fifteen scripts hand-rolled the "am I the entry point" test, and every one of them was wrong
 * through a symlinked path. `main()` never ran: no stdout, no stderr, exit 0. An operator reads
 * that as a tool that ran and found nothing to say, which is the worst reporting a defect can
 * have, and it is the exists-but-never-fires class this repo already hunts.
 *
 * It was found in `boards-render.mjs` by a real seed run out of `/tmp`, which on macOS is a
 * symlink to `/private/tmp`, so every `mktemp -d` reproduces it. So does a symlinked home, a
 * symlinked dev directory, and any plugin root recorded through one: the scaffold's own
 * resolver hands `installPath` from `installed_plugins.json` straight to `spawnSync` without
 * resolving it, so `node scripts/palate.mjs grade` in a client project is a live route here.
 *
 * ======================== WHAT COUNTS AS RUNNING =======================
 *
 * Output, not an exit code. Every script here is invoked with no arguments, which for all of
 * them reaches their own usage or their own refusal, and a refusal is a script that ran. Exit 0
 * with nothing on either stream is the signature of the defect, so that is what fails.
 *
 * The real path is measured too, on the same command, so a script that is broken for some other
 * reason cannot be mistaken for the guard being wrong: the assertion is that the two agree.
 *
 * No browser and no network. Run: node --test scripts/test/invoked-directly.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = realpathSync(join(HERE, "..", ".."));
const run = promisify(execFile);

/**
 * Every module in the plugin that decides for itself whether it is the entry point.
 *
 * DERIVED FROM THE SOURCE BELOW AS WELL AS LISTED HERE, so a new script that hand-rolls the
 * test is caught by the completeness case rather than quietly joining the fifteen.
 */
const CLIS = [
  "scripts/install-shopify-overlay.mjs",
  "scripts/lib/workflow-route.mjs",
  "scripts/boards-render.mjs",
  "scripts/palate-traffic.mjs",
  "scripts/palate-route-review.mjs",
  "scripts/palate-baseline.mjs",
  "scripts/palate-index.mjs",
  "scripts/palate-contract.mjs",
  "scripts/palate-crawl.mjs",
  "scripts/palate-shopify.mjs",
  "scripts/palate-assets.mjs",
  "scripts/taste-profile.mjs",
  "scripts/gate-brand-token-usage.mjs",
  "scripts/verify-brand-record.mjs",
  "scripts/reference-capture/measure-composition.mjs",
  "scripts/reference-capture/measure-drift.mjs",
  "scripts/reference-capture/grade-local.mjs",
];

let TMP = null;
let LINK = null;
let CWD = null;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), "palate-guards-"));
  LINK = join(TMP, "plugin-link");
  symlinkSync(ROOT, LINK);
  // A scratch working directory: several of these write into the cwd when they find nothing to
  // refuse (palate-assets writes .palate/assets.json), and a test must not litter the repo.
  CWD = mkdtempSync(join(tmpdir(), "palate-guards-cwd-"));
});

after(() => {
  try { if (LINK) unlinkSync(LINK); } catch { /* already gone */ }
  if (TMP) rmSync(TMP, { recursive: true, force: true });
  if (CWD) rmSync(CWD, { recursive: true, force: true });
});

const invoke = async (path) => {
  try {
    const { stdout, stderr } = await run(process.execPath, [path], {
      cwd: CWD, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, out: `${stdout}${stderr}` };
  } catch (e) {
    return { status: e.code ?? e.signal ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

test("the symlink is a different string, or this suite measures nothing", () => {
  assert.notEqual(LINK, ROOT);
  assert.equal(realpathSync(LINK), ROOT, "the link does not point at the plugin root");
});

for (const rel of CLIS) {
  test(`${rel} runs through a symlinked path`, async () => {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} is listed here and not in the tree`);
    const real = await invoke(join(ROOT, rel));
    const linked = await invoke(join(LINK, rel));

    // A script that says nothing at all has not run. Every one of these reaches its own usage
    // or its own refusal with no arguments, so silence is the defect and nothing else.
    assert.ok(real.out.trim().length > 0,
      `${rel} says nothing even through its real path, so this case cannot tell a guard from a bug`);
    assert.ok(linked.out.trim().length > 0,
      `${rel} exited ${linked.status} with NOTHING on either stream through a symlinked path: main() never ran`);

    // And it did the same thing both ways. A path in the message legitimately differs, so the
    // exit code and the first line's shape are what have to agree.
    assert.equal(linked.status, real.status, `${rel} exits ${linked.status} through a symlink and ${real.status} directly`);
    const head = (s) => s.trim().split("\n")[0].replace(ROOT, "").replace(LINK, "").slice(0, 60);
    assert.equal(head(linked.out), head(real.out), `${rel} says something different through a symlink`);
  });
}

test("no CLI in the plugin hand-rolls the entry-point test any more", async () => {
  // COMPLETENESS, so the next script written does not quietly rejoin the fifteen. Three shapes
  // were in the tree and all three were wrong through a symlink; the helper is the only one
  // that is right, so any other comparison against process.argv[1] is a finding.
  const { stdout } = await run("git", ["grep", "-n", "process.argv\\[1\\]", "--", "scripts", "hooks"], {
    cwd: ROOT, encoding: "utf8",
  }).catch((e) => ({ stdout: e.stdout ?? "" }));
  const offenders = stdout.split("\n")
    .filter((l) => l && !l.startsWith("scripts/test/") && !l.startsWith("scripts/lib/invoked-directly.mjs"))
    .filter((l) => /import\.meta\.url|pathToFileURL|fileURLToPath/.test(l));
  assert.deepEqual(offenders, [],
    `these compare process.argv[1] against their own module URL by hand:\n${offenders.join("\n")}`);
});
