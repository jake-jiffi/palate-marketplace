#!/usr/bin/env node
/**
 * hooks/palate-media-guard.mjs - keeps Higgsfield spend inside the budget a person agreed for
 * a live-design site (PreToolUse on Bash and Higgsfield MCP tools).
 *
 * Outside a live-design project it does nothing, so a person's own Higgsfield work elsewhere is
 * untouched. Inside one, a direct `higgsfield generate create` is refused in favour of
 * `palate.mjs media generate`, which prices the job and records it; a spending MCP tool is
 * refused until consent exists and while budget remains. A shell script that calls the CLI is
 * not visible here, which is why the doctrine routes every generation through the wrapper.
 */
import fs from "node:fs";
import { inspectWorkflow } from "../scripts/lib/workflow-route.mjs";
import { readBudget, summary } from "../scripts/live/media.mjs";

const SPEND_COMMAND = /(?:^|[\s;&|(`'"])(?:\S*\/)?(?:higgsfield|higgs)\s+(?:generate\s+(?:create|workflow)|soul-id\s+create|marketing-studio|product-photoshoot)\b/;
const SPEND_TOOL = /generate|create|train|edit|upscale|animate|render|submit|remix|make|produce|photoshoot/i;
const READ_TOOL = /(?:^|_)(?:get|list|status|balance|account|credits?|cost|price|pricing|wait|poll|search|models?|voices?|presets?|history|jobs?|help|schema)s?$/i;

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n");
  process.exit(0);
}

let payload;
try { payload = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }
const tool = String(payload.tool_name || "");
const isBash = tool === "Bash";
if (isBash && !SPEND_COMMAND.test(String(payload.tool_input?.command || ""))) process.exit(0);
if (!isBash && !/^mcp__.*higgsfield/i.test(tool)) process.exit(0);
const action = tool.split("__").pop();
if (!isBash && !SPEND_TOOL.test(action) && READ_TOOL.test(action)) process.exit(0);

const route = inspectWorkflow([payload.cwd || process.cwd()]);
if (route.kind !== "live") process.exit(0);

if (isBash) deny("In this Palate site, generate media with `node scripts/palate.mjs media generate --input <file> --op <id>` so the job is priced and counted against the budget the person agreed (see references/generated-media.md). If the person wants this outside the site's budget, they can run it themselves with `! higgsfield ...`.");

let state;
try { state = summary(readBudget(route.root)); } catch (error) { deny(`The site's media budget cannot be read (${error.message}). No Higgsfield spend until it is repaired.`); }
if (!state.consent) deny("Nobody has agreed to Higgsfield spend on this site yet. Ask once with AskUserQuestion (see references/generated-media.md) and record the answer with `node scripts/palate.mjs media consent` first.");
if (state.consent.decision === "declined") deny("The person declined generated media for this site. Build without it.");
if (state.remaining <= 0) deny(`The agreed ${state.cap}-credit budget for this site is spent. Continue without generated media, or ask whether to raise the cap.`);
process.exit(0);
