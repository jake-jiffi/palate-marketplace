import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hookWorkflow, reportRoute } from "../scripts/lib/workflow-route.mjs";

/** Return true when the legacy hook must stop. No design gate runs on the live path. */
export function handleLiveWorkflow(payload, event, additional = []) {
  const result = hookWorkflow(payload, additional);
  if (result.kind === "legacy") return false;
  if (result.kind === "unsupported") {
    reportRoute(result, event);
    if (event === "PreToolUse") process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse", permissionDecision: "deny",
        permissionDecisionReason: result.error,
      },
    }) + "\n");
    return true;
  }
  if (event === "SessionStart") {
    process.stdout.write(`[palate] Live design project, ${result.state.stage}; run node scripts/palate.mjs status to resume.\n`);
  }
  if (event === "PostToolUse" && payload.tool_use_id) {
    try {
      const folder = path.join(result.root, ".palate", "events");
      // Events are optional evidence, never a second semantic record. Refuse redirected output.
      for (const dir of [path.join(result.root, ".palate"), folder]) {
        if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) return true;
      }
      fs.mkdirSync(folder, { recursive: true });
      const id = createHash("sha256").update(`${event}:${payload.tool_use_id}`).digest("hex");
      const record = {
        schema: 1, event, tool: payload.tool_name, toolUseId: payload.tool_use_id,
        recordedAt: new Date().toISOString(),
        paths: result.files.map(file => path.relative(result.root, file)),
      };
      fs.writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(record) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") process.stderr.write("[palate] Optional hook evidence could not be saved; project commands remain available.\n");
    }
  }
  return true;
}
