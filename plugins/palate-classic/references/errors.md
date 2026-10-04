# Error taxonomy

Six classes. Each maps to an action.

1. **auth** (401/403): a token is missing or lacks scope. HALT, surface the exact token + scope needed. Never retry blindly.
2. **conflict** (409, name taken): a resource name collides. Append a discriminator consistently across all namespaces, re-check, continue.
3. **transient** (5xx, network): retry up to 3 times with backoff. If still failing, HALT and report.
4. **config** (bad input, missing env): a precondition is wrong. HALT, point at the fix.
5. **logic** (build error, type error): the generated code is wrong. HALT, do not deploy broken output.
6. **brand-mismatch** (pinned version != latest): EXPECTED and informational, not an error. The pin is deliberate. Surface on resume, continue.

The build never deploys on a logic-class error. Better to halt with a clear message than ship a broken site.

## The verify-fail self-healing loop

Every phase ends with one or more gates: the structural `verify-*.sh` scripts (e.g. `verify-is-real-astro.sh`), the aesthetic `scripts/ux-lint.sh`, and at Phase A.10 the interpretive reviewer pass against `references/audit-dimensions.md`. When ANY gate FAILS, do not stop at the first failure and do not push past it - run this loop:

1. **Read** the verify script's output. It names what is wrong.
2. **Diagnose** - map it to the taxonomy above. A `logic`-class failure (build / type error) is the generated code; a `config`-class failure is an input or env var.
3. **Fix the actual cause** - not the symptom, and never the verify script itself.
4. **Re-run the same verify.**
5. Repeat at most **3 times**. If it still fails, HALT: report the failure, the diagnosis, and the fixes already tried. Do not mark the phase complete, do not advance, do not deploy.

Never edit or weaken a verify script, a `ux-lint.sh` rule, or an audit dimension to make a check pass - the gates are the contract. Never skip a phase because its gate is inconvenient. Three honest attempts then an honest halt beats a green check on a broken build.
