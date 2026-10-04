# Run Palate on any model

Palate is model-agnostic by construction. It is three layers and none is tied to the Claude
model or API:

- **Doctrine** is portable text (this skill's `SKILL.md` + the `references/` corpus).
- **Tools** are the Palate MCP over standard HTTP + a bearer header (`mcp__palate__*`), callable
  by any MCP-capable client.
- **Gates** are deterministic CLI scripts that score ARTEFACTS, not the model's self-report:
  `ux-lint.sh` (PCRE over the files), `gate-novelty.mjs` / `gate-uniqueness.mjs` (pure Node),
  `gate-mcp-depth.sh` (over real MCP telemetry), `gate-done.sh` / `verify-rendered.sh` (over
  screenshots + console). Because they read pixels, HTML and tool telemetry rather than a
  narration boolean, a differently-aligned model cannot talk its way past them.

The only Claude coupling is the HARNESS (the hook + subagent wiring), not the model.

## The lowest-risk way: keep Claude Code as the harness, swap the brain

Point Claude Code at another model and you keep every hook, subagent and gate verbatim:

```sh
export ANTHROPIC_BASE_URL="https://<provider-anthropic-compatible-endpoint>"
export ANTHROPIC_AUTH_TOKEN="<provider-key>"
# then run claude as usual; the Palate plugin + MCP + gates are unchanged
```

GLM (Z.ai ships a "GLM Coding Plan" explicitly for Claude Code), Qwen and Kimi all expose
Anthropic-compatible endpoints for exactly this. This is the recommended path: the model changes,
the enforcement does not.

## The one switch you MUST flip for a non-Claude brain: strict mode

The depth and done gates **fail open by default** (a loud nudge, not a hard block; hard-block is
opt-in). They were tuned on Claude. For a less-adherent model, turn the backstops on:

```sh
export PALATE_GATE_STRICT=1   # the gates now hard-block instead of nudging
```

Without this, a model that ignores a step still ships, and the failure is invisible.

## What the gates can and cannot do

They catch the MECHANICAL failures: banned faces, the gradient/glassmorphism/glow surface,
AI-tell copy, MCP-grounding depth, near-duplication, novelty distance from the category default,
and rendered errors. They CANNOT manufacture taste or narrative coherence. So the model still
sets the ceiling.

The dominant risk is not raw design skill, it is **instruction-following + multi-tool agentic
discipline**: winning a single-round HTML generation is not the same competency as honouring the
~15-step MCP-grounded loop (liveness probe, Story Engine, surveyor, layer-specific deep reads,
DIVERGE/CONVERGE, Explore, Compose, verifier, done-gate). Validate a new brain on the golden +
audacious briefs with `PALATE_GATE_STRICT=1` before trusting it.

Also: the verifier is itself an LLM judge. If one weak model both builds AND verifies, the
independent check is only as good as that model. Prefer **cross-model verification**: a strong
model verifies a cheaper model's build.

## Which models are good enough at design

On Design Arena's website board (mid-2026) **GLM-5.2 leads** (ahead of Claude Fable 5 and Opus),
and it auto-avoids Palate's banned tells (no purple gradients, Tailwind by default), so the
"GLM is great at design" read holds. **Gemini 3.x Pro** is the other strong design brain
(multimodal, near-tops WebDev Arena). **GPT-5.x / Codex** are agentically strong but flatter on
pure visual taste, so not first choice solo for the design surface. **Claude** (Opus / Fable 5)
remains the safest single choice and the only one where the harness is native, but it is no
longer the only good one.

## Other tools (not the Claude Code harness)

Any MCP-capable tool (Cursor, Codex, Windsurf, Cline, Zed, Copilot, Gemini CLI) can connect the
Palate MCP directly with a bearer header (see the dashboard token page or `palatemcp.com/docs`).
They get the MCP taste layer (the references, tokens, do/don't rules), but NOT the hook-enforced
gates, which are Claude Code only, so output quality regresses versus the gated experience. The
gate scripts are standalone CLIs, so a determined integrator can wire them into a tool's own hook
system (Cursor, Codex and Gemini CLI now all have PreToolUse/PostToolUse/Stop hooks); without
that, treat a non-Claude run as honour-system, not gated.
