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
      // Which references a Palate call read, and whether it answered. This is what lets the
      // runtime refuse a "ready" option whose reference decisions name nothing actually read.
      if (String(payload.tool_name || "").startsWith("mcp__palate__")) {
        const input = payload.tool_input || {};
        record.slugs = [...new Set([input.slug, ...(Array.isArray(input.slugs) ? input.slugs : [])].filter(s => typeof s === "string" && s))];
        const response = payload.tool_response ?? payload.tool_output ?? null;
        const text = typeof response === "string" ? response : JSON.stringify(response ?? "");
        record.ok = Boolean(response) && !/"isError"\s*:\s*true|quota_exceeded/.test(text);
      }
      fs.writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(record) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") process.stderr.write("[palate] Optional hook evidence could not be saved; project commands remain available.\n");
    }
  }
  return true;
}
