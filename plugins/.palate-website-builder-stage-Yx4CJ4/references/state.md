# State and resume

`.palate-skill-state.json` makes the build resumable and idempotent. Created by `state-init.sh`, mutated by `state-update.sh`, queried by `state-resume.sh`.

## Shape
Top-level: skill, client, brand, design, phases, cro. Each phase has a status (pending/in_progress/complete/manual_pending/failed) and a resources object (the non-secret IDs and URLs it created).

## Resume logic
On invocation, if a state file exists, `state-resume.sh` prints the first non-complete phase. Resume there. Every phase is Check-Before-Act idempotent: re-running a complete phase is a no-op, re-running an interrupted one continues safely.

## Cross-skill resume (Phase 0)
If phase brandAsCode is in_progress and the brand repo path is recorded, check for `.palate-brand-state.json` in that repo and resume palate-brand-as-code FIRST, then continue to scaffold. See phase-0-brand-detection.md.

## Secrets rule
Never write tokens, API keys, or secrets to the state file. State holds only progress and non-sensitive resource identifiers (project ids, URLs, labels). Tokens go to .env (read token), Cloudflare Worker secrets (write token, API keys), and GitHub Actions secrets.

## Resource tagging
Every created resource carries `palate:project-slug={slug}` (Cloudflare via metadata, GitHub via topic, Sanity via a settings field) so a future run or rollback can find them.

## State is created early (not after scaffold)
state-init.sh runs right after preflight and BEFORE Phase A scaffold, so a partial or interrupted scaffold always leaves a resumable state file behind. Never defer state creation to the end of a build; that was a failure mode where a scaffold error left no state to resume from.
