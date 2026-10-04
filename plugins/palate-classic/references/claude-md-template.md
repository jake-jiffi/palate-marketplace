# The site's CLAUDE.md

Every generated site gets a CLAUDE.md (from templates/astro-project/.claude/CLAUDE.md.tpl) so any future agent working in the repo knows the rules.

Non-negotiables at the top, always including:
- Build in CI, deploy artifact. Never build on Cloudflare (private brand package auth breaks there).
- Pin the brand package exactly. Updates are deliberate.
- Australian English, no em dashes.
- Brand tokens only for colour/type.

Then: reading order, deploy flow, how to update the brand. Written for an LLM, not a human.
