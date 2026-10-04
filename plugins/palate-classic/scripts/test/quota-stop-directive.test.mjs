/**
 * The wall directive: what the model is told when Palate refuses a deep read for quota.
 *
 * This hook is the deterministic half of the stop. SKILL.md 6.1 tells the model what to say;
 * this makes it actually stop, by returning decision:"block" with a reason the model must act
 * on. So the reason's accuracy is not cosmetic: it is the last thing a capped customer hears.
 *
 * It had gone comprehensively stale. It hardcoded "25 deep reference reads", called the cap
 * DAILY, and told the user it "resets at midnight UTC", while the real allowance has been 20
 * A MONTH since pricing v3 and resets on the 1st. So a capped user was told to wait a few
 * hours when the true wait could be thirty days, at the exact moment we most want an upgrade.
 * It also led with the dashboard billing page and relegated the MCP's own upgradeUrl to a
 * parenthetical labelled "pricing" — and that URL is now a signed one-click checkout link
 * needing no sign-in at all.
 *
 * Every assertion below exists to keep one of those from coming back. The rule the fix rests
 * on: the MCP owns the facts (it knows the cap, the window and the reset date and deploys
 * independently), this hook owns the instruction.
 *
 *   node --test scripts/test/quota-stop-directive.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "..", "..", "hooks", "palate-manifest.mjs");

function tmp() {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "palate-quota-"));
  fs.mkdirSync(path.join(d, "src", "pages"), { recursive: true });
  fs.writeFileSync(path.join(d, "package.json"), '{"name":"site"}\n');
  return d;
}

/** The real shape of a refused deep read, as the deployed MCP returns it. */
function denial({ personalised = true, resetAt = null, searchStillAvailable = true } = {}) {
  const reset = resetAt ?? new Date(Date.now() + 4 * 86_400_000).toISOString();
  const url = personalised
    ? "https://app.palatemcp.com/u/1.11111111-2222-3333-4444-555555555555.1799999999.sig"
    : "https://palatemcp.com/pricing";
  return {
    content: [
      {
        type: "text",
        text:
          "You've used all 20 deep reads in your free monthly allowance. Search is still unlimited, and the allowance resets on the 1st (UTC).\n\n" +
          `Pro is US$9 a month for unlimited deep reads and cancels in one click. This opens checkout with no sign-in, and the link is valid for 7 days:\n${url}`,
      },
    ],
    structuredContent: {
      error: "quota_exceeded",
      plan: "free",
      resetAt: reset,
      searchStillAvailable,
      upgradeUrl: url,
      upgradeUrlIsPersonalised: personalised,
    },
  };
}

function reasonFor(result) {
  const cwd = tmp();
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({
      cwd,
      tool_name: "mcp__palate__refs_get",
      tool_input: { slug: "aesop" },
      tool_response: result,
    }),
    encoding: "utf8",
    env: { ...process.env, PALATE_PROJECT_DIR: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!out.trim()) return null;
  return JSON.parse(out);
}

test("a refused deep read blocks the build", () => {
  const d = reasonFor(denial());
  assert.equal(d?.decision, "block", "a quota refusal must hard-stop, not merely warn");
  assert.match(d.reason, /STOP DEEP READS/);
});

test("it states the cap in the MCP's OWN words, never its own hardcoded numbers", () => {
  // The staleness fix. The hook must not carry a cap figure of its own, because the plan
  // changes (50/month, then 20/month) and this file does not get redeployed with it.
  const d = reasonFor(denial());
  assert.match(d.reason, /all 20 deep reads in your free monthly allowance/);
});

test("NONE of the three stale claims can come back", () => {
  const d = reasonFor(denial());
  assert.doesNotMatch(d.reason, /25 deep/i, "the cap is not 25");
  assert.doesNotMatch(d.reason, /\bdaily\b/i, "the free cap is monthly, not daily");
  assert.doesNotMatch(d.reason, /midnight UTC/i, "monthly allowances do not reset at midnight");
});

test("it gives the real reset date, and says plainly that waiting will not rescue this build", () => {
  // The damaging half of the old copy: "wait until midnight" sent a capped customer away to
  // wait out a window that was up to thirty days wide.
  const resetAt = new Date(Date.now() + 4 * 86_400_000).toISOString();
  const d = reasonFor(denial({ resetAt }));
  assert.match(d.reason, new RegExp(resetAt.slice(0, 10)), "must name the actual reset date");
  assert.match(d.reason, /waiting is NOT a fix/i);
});

test("the one-click link leads, and is described as needing no sign-in", () => {
  const d = reasonFor(denial({ personalised: true }));
  const url = "https://app.palatemcp.com/u/1.11111111-2222-3333-4444-555555555555.1799999999.sig";
  assert.match(d.reason, /no sign-in/i);
  assert.ok(d.reason.includes(url), "the personalised checkout link must be handed to the user");
  // And the slow path must not be presented as the headline action.
  assert.doesNotMatch(d.reason, /upgrade to Pro at https:\/\/app\.palatemcp\.com\/dashboard\/billing/i);
});

test("without a personalised link it does not promise a no-sign-in checkout", () => {
  // Claiming "no sign-in needed" about the pricing page would be a straightforward lie.
  const d = reasonFor(denial({ personalised: false }));
  assert.doesNotMatch(d.reason, /no sign-in/i);
  assert.match(d.reason, /palatemcp\.com\/pricing/);
});

test("it keeps telling the model that search is still free", () => {
  const d = reasonFor(denial());
  assert.match(d.reason, /Search stays FREE/i);
  assert.match(d.reason, /refs_search/);
});

test("an ordinary successful call is not blocked", () => {
  const ok = { content: [{ type: "text", text: JSON.stringify({ slug: "aesop", essence: "x" }) }] };
  const d = reasonFor(ok);
  assert.ok(d === null || d.decision !== "block", "a good call must never be walled");
});
