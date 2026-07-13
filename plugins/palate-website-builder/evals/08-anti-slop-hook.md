# Eval 08 - the project-level anti-slop hook fires on Edit

### Brief (verbatim)

> Scaffold a project from the astro-project template. Then, in a fresh
> Claude Code session inside that project, try to write a banned pattern
> to `src/lib/content.ts` and confirm the hook blocks it.

### Setup

A scaffolded project at, say, `~/work/scaffold-test-site/`, generated
by the standard Phase A.1 (template copy + `_claude/` -> `.claude/` merge).

### Expected behaviour

The project ships with `.claude/hooks/anti-slop-check.js` and
`.claude/settings.local.json` (merged from the template's `_claude/`).
PostToolUse on Edit / Write / MultiEdit invokes the hook. Critical-severity
violations exit 2 and surface a clear message Claude can act on.

### Checklist

- [ ] `~/work/scaffold-test-site/.claude/hooks/anti-slop-check.js` exists
      and is valid ESM (the host package.json has `"type": "module"`).
- [ ] `.claude/settings.local.json` registers the hook on
      `Edit|Write|MultiEdit`.
- [ ] Editing `src/lib/content.ts` to add `"leverages synergy"` triggers the
      hook with exit code 2; the message names both `ai-tell-leverage` and
      `ai-tell-synergy`, line numbers, and the Fix paragraphs.
- [ ] Adding `font-family: 'Inter', sans-serif;` to `src/styles/globals.css`
      triggers `banned-display-inter`.
- [ ] Adding a `—` (em dash) to any covered file type triggers `no-em-dash`.
- [ ] A `// ux-lint-disable ai-tell-leverage` comment on the offending line
      suppresses ONLY that finding; another Critical violation on a
      different line still blocks.
- [ ] A clean Edit (no banned patterns) exits 0; the hook does NOT block
      legitimate edits.
- [ ] The hook does NOT trigger on Edit / Write outside the project (e.g.
      against `~/Downloads/something.md`).

### Regression signals

Hook missing after scaffold (the `_claude/` merge did not happen); hook
present but not blocking on Critical (a regex broke); hook blocking on
clean files (regex too loose); hook firing on files in `node_modules/` or
`.git/` (the skip list is wrong).
