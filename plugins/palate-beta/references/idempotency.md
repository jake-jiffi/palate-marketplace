# Idempotency - every provisioning step must be safe to re-run

A build can fail or be interrupted mid-phase and then resume. The phase model
already skips a phase that is fully complete (see `pipeline.md` / `state.md`),
but a failure PART-WAY through a phase means the script runs again from the top.
So every step inside a provisioning script must be safe to run twice.

The failure to avoid: a resumed Phase B that creates a SECOND Sanity project,
or a resumed Phase D that pushes a duplicate repo. Re-running must converge on
the same single result, never multiply it.

## The three patterns

1. **Check-before-act.** Before creating a resource, query for one that already
   matches (by stable name / slug) and reuse it. Use this when the create call
   is not itself idempotent - e.g. `POST /projects`.
2. **Upsert.** Use an API that creates-or-replaces in one call, keyed by a
   stable identifier. Always idempotent by construction - prefer it when the
   provider offers it (e.g. `PUT .../datasets/{name}`).
3. **Tombstone.** Record "this step is done" in state (`.palate-skill-state.json`)
   the moment it succeeds, so a resume skips it. Use for steps with side effects
   that are awkward to detect after the fact (an email invite, a DNS write).

## Status of the shipped provisioning scripts

- **`provision-github.sh`** - idempotent. It checks `gh repo view` before
  `gh repo create`; `gh secret set` is an upsert; branch-protection and team
  grants are `PUT`s (idempotent); `git remote add ... || true`.
- **`provision-cloudflare.sh`** - idempotent. `wrangler secret put` upserts;
  `wrangler deploy` simply re-deploys.
- **`provision-sanity.sh`** - made idempotent via check-before-act: it looks for
  an existing project with the same `displayName` and reuses it rather than
  creating a duplicate. The dataset call is a `PUT` (upsert). Re-running may mint
  extra API tokens with the same label - that is untidy but harmless; revoke
  unused tokens in the Sanity dashboard if a build was retried several times.

## The rule for any new provisioning step

Before adding a `POST`/create call to a script, ask: "what happens if this runs
twice?" If the answer is "a duplicate", apply check-before-act, switch to an
upsert, or tombstone it in state. A provisioning script that is not re-run-safe
is a bug.
