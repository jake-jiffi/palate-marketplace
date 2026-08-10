/**
 * palate-mcp.mjs - a minimal Streamable-HTTP MCP client, for the local grade.
 *
 * The local self-check needs two free lookups from the Palate MCP (the judging pack and the
 * taste-head projection). The agent could make those calls itself, but the taste vector alone
 * is 768 floats and the pack carries three full do/don't rule sets, so routing them through
 * the model's context would cost thousands of tokens on every iteration of a self-heal loop.
 * A script call costs none.
 *
 * WHY THIS READS THE CLAUDE CONFIG. `claude mcp add` bakes the bearer into Claude Code's own
 * config rather than an environment variable (that was a deliberate onboarding fix: an env var
 * does not reach GUI and IDE clients). So the token this process needs is already on disk, in
 * the file the customer's own MCP connection uses. Nothing is minted, stored or transmitted
 * anywhere else, and the token is never logged.
 *
 * WHEN THERE IS NO STATIC TOKEN, IT SAYS SO AND STOPS. A customer who connected over OAuth has
 * no bearer on disk (it lives in the OS credential store, which this must not go rummaging in),
 * so the fetch cannot be made from a script. That is reported as a specific, actionable failure
 * with the fallback spelled out, and the caller drops the affected checks from the grade. It is
 * never scored around: a taste percentile that silently did not happen is the exact failure
 * mode that left the grader's design ladder dead through an entire calibration run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_URL = 'https://mcp.palatemcp.com/api/mcp';
const HOST_RE = /mcp\.palatemcp\.com/;

/** Thrown for every failure here, so a caller can tell "MCP unavailable" from a real bug. */
export class PalateMcpError extends Error {
  constructor(message, { remedy = null, cause = null } = {}) {
    super(message);
    this.name = 'PalateMcpError';
    this.remedy = remedy;
    if (cause) this.cause = cause;
  }
}

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Any `Authorization` header on a server entry pointing at our host. */
function bearerFromServers(servers) {
  for (const s of Object.values(servers ?? {})) {
    if (!s || typeof s !== 'object') continue;
    if (!HOST_RE.test(String(s.url ?? ''))) continue;
    const a = s.headers?.Authorization ?? s.headers?.authorization;
    if (typeof a === 'string' && a.trim()) return { auth: a.trim(), url: String(s.url) };
  }
  return null;
}

/**
 * Find a bearer. Explicit env first so a CI run or a test can override without touching config.
 * `projectDir` is searched for a project-scoped `.mcp.json` before falling back to user scope.
 */
export function resolveAuth(projectDir = process.cwd()) {
  const env = (process.env.PALATE_MCP_TOKEN ?? '').trim();
  if (env) return { auth: env.toLowerCase().startsWith('bearer ') ? env : `Bearer ${env}`, url: process.env.PALATE_MCP_URL || DEFAULT_URL, source: 'PALATE_MCP_TOKEN' };

  const project = readJson(join(projectDir, '.mcp.json'));
  const fromProject = project && bearerFromServers(project.mcpServers ?? project);
  if (fromProject) return { ...fromProject, source: '.mcp.json' };

  const user = readJson(join(homedir(), '.claude.json'));
  if (user) {
    const fromUser = bearerFromServers(user.mcpServers);
    if (fromUser) return { ...fromUser, source: '~/.claude.json' };
    // A project-scoped entry inside the user config, for the same project directory.
    const scoped = user.projects?.[projectDir]?.mcpServers;
    const fromScoped = scoped && bearerFromServers(scoped);
    if (fromScoped) return { ...fromScoped, source: `~/.claude.json (project ${projectDir})` };
  }
  return null;
}

const NO_TOKEN_REMEDY =
  'No static Palate bearer was found. Either:\n' +
  '  (a) set PALATE_MCP_TOKEN=plt_live_... for this run (get one at https://app.palatemcp.com/dashboard/tokens), or\n' +
  '  (b) if you connected over OAuth, call the MCP tools yourself and pass the results in:\n' +
  '        palate_grade_pack  -> --pack <file>\n' +
  '        palate_taste_score -> --taste <file>\n' +
  '      (an OAuth token lives in the OS credential store, which this script deliberately does not read).';

/**
 * One JSON-RPC round trip. `initialize` is required before `tools/call` on Streamable HTTP, so
 * a session is set up per client instance and reused across calls.
 */
export function createClient({ projectDir = process.cwd(), timeoutMs = 30_000 } = {}) {
  const found = resolveAuth(projectDir);
  if (!found) throw new PalateMcpError('no Palate MCP token available', { remedy: NO_TOKEN_REMEDY });
  const { auth, url, source } = found;

  let nextId = 0;
  let sessionId = null;
  let initialised = null;

  async function rpc(method, params) {
    const headers = {
      Authorization: auth,
      'content-type': 'application/json',
      // Streamable HTTP servers may answer as JSON or as an SSE stream; accept both.
      accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new PalateMcpError(`could not reach the Palate MCP at ${url}: ${e?.message ?? e}`, {
        remedy: 'Check network access. The local grade needs it for the judging pack and the taste head.',
        cause: e,
      });
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const text = await res.text();
    if (res.status === 401)
      throw new PalateMcpError('the Palate MCP rejected the bearer (401)', {
        remedy: `The token from ${source} is not valid. Mint a fresh one at https://app.palatemcp.com/dashboard/tokens.`,
      });
    if (!res.ok) throw new PalateMcpError(`the Palate MCP returned ${res.status}: ${text.slice(0, 200)}`);

    // SSE framing: the payload is on the last `data:` line.
    let payload = text;
    if (text.includes('data:')) {
      const lines = text.split('\n').filter((l) => l.startsWith('data:'));
      if (lines.length) payload = lines[lines.length - 1].slice(5).trim();
    }
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      throw new PalateMcpError(`the Palate MCP returned a body that is not JSON: ${payload.slice(0, 160)}`, { cause: e });
    }
    if (parsed.error) throw new PalateMcpError(`${method} failed: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
    return parsed.result;
  }

  async function init() {
    if (!initialised) {
      initialised = rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'palate-grade-local', version: '1' },
      });
    }
    return initialised;
  }

  /**
   * Call a tool and return its structured payload.
   *
   * An MCP tool error arrives as a NORMAL result carrying `isError`, not as a JSON-RPC error, so
   * a client that only checks the transport reports a failed tool call as a successful one. That
   * is checked here, not left to each caller.
   */
  async function callTool(name, args) {
    await init();
    const r = await rpc('tools/call', { name, arguments: args ?? {} });
    const text = (r?.content ?? []).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n').trim();
    if (r?.isError) throw new PalateMcpError(`${name} returned an error: ${text.slice(0, 400)}`);
    if (r?.structuredContent) return r.structuredContent;
    if (!text) throw new PalateMcpError(`${name} returned an empty result`);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new PalateMcpError(`${name} returned text that is not JSON: ${text.slice(0, 160)}`, { cause: e });
    }
  }

  return { callTool, source, url };
}

export { NO_TOKEN_REMEDY };
