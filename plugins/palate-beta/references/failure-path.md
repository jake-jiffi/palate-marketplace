# The failure path

Everything on this page happens on someone else's machine, usually to someone who did not
choose to become a developer. The moment a build breaks is the moment they decide whether this
tool is theirs or not, and nobody in this market has bothered to write a good answer for it. So
the failure path is the product. Treat it as a designed surface, not as an exception branch.

## The principle: local can break, the live site cannot

What is published is always the last state that passed. A publish only happens after the
contract returns merge (`commands/publish.md`), the baselines ship in the same commit as the
change they describe, and the deploy is not called done until the host reports READY. Nothing
that failed a check has ever been served.

So a broken working copy is a workspace problem, not an outage. That single fact changes the
register of everything you say. There is no emergency, the site is up, and the person has as
long as they need. **Say it first, in the same breath as the problem.** Someone who thinks their
website is down reads the next sentence in a panic and does not take it in.

The one thing this principle demands in return: never publish around a check that could not run.
A gate that was blocked is not a gate that passed (`verify-rendered.sh` exit 3, and see below).
The moment we ship on an unverified check, "what is live has passed" stops being true, and it is
the load-bearing sentence.

## What the person sees

**One sentence, then one action.** That is the whole format.

The sentence says what cannot happen right now, in their vocabulary. The action is either a
single command they can paste, or a yes/no question with a default. Never both, never three
options, never a numbered list of things to try.

Banned from anything they read:

- a stack trace, an exit code, a file path inside `node_modules`, an npm error block
- the word **dependency**. Also *module*, *runtime*, *toolchain*, *transpile*, *lockfile*.
- "unfortunately", "it seems", "something went wrong". Say what specifically did not happen.
- an apology longer than the fact
- a guess dressed as a diagnosis. If you do not know why, say the fact you do know.

The detail is not deleted, it is relocated. It goes to you, in the transcript, and into the files
that already hold it: `.palate-devserver.log`, `.palate-shots/errors.json`, `verify-report.json`.
Do not invent a new failure log; the record already exists and a second one drifts from the
first. Give the person the filename only if they ask for it.

Worked examples. The left column is the whole of what they read.

| They see | Then |
| --- | --- |
| "Your site is still live and unchanged. This machine can't run the preview yet, because Node isn't installed. Install it with: `brew install node`" | Stop. This one is theirs. |
| "Setting up the site didn't finish. Trying once more from clean." | Retry once, silently. Report only if the second attempt fails. |
| "Something else was already using the preview address, so I moved the preview. It's at http://localhost:4322" | Nothing. This is a fact, not a question. |
| "This post can't go up yet: the title is 78 characters and the limit is 70. Want me to shorten it?" | Wait for the answer. It is their writing. |
| "I can't see the page yet, so I can't tell you it's fine. Nothing has been published. To let me look: `bash scripts/reference-capture/setup.sh`" | Stop. Do not publish. |
| "Working without the reference library this session, so this change carries no taste layer." | Carry on. Say it once. |

Note what the last two have in common with nothing else on the list: they are the only ones that
change what happens next. Everything above them is weather.

## Transient or real

Get this wrong in the optimistic direction and the agent spins in a retry loop while the person
watches a spinner. Get it wrong in the pessimistic direction and it escalates a hiccup to a human
who has to go and look something up.

**Transient** means: the same input, unchanged, would succeed on the next attempt. It is a
network drop, a 5xx, a rate limit carrying a reset time, a port still in `TIME_WAIT`, a lock held
by a process that is on its way out, a cold model cache.

**Real** means any one of these, and any one is enough:

- it names a file, a line, a field or a rule. Diagnostics are not weather.
- it exits with a code the script defines as a state: `gate-mcp-depth.sh` 2 or 3,
  `verify-rendered.sh` 2 or 3, `palate-contract.mjs` 4, `ux-lint.sh` 1.
- it failed identically twice with nothing changed in between.
- it is `config` or `logic` class in `references/errors.md`. Those never retry, by definition:
  a precondition is wrong, and running it again does not make it right.

**The bound is one retry.** `references/errors.md` allows three attempts with backoff for a
network-class failure, and that still holds for anything crossing the network. Everything on this
page is local, where the second attempt is paid for in the person's wall-clock and the answer is
almost never different. Retry once, then classify and speak.

A second identical failure is a real one. Never let attempt three exist.

## Recovering from the last good commit

The last good commit is the last **publish** commit: the last line in `.palate/changelog.md`
carrying `verdict=merge`, which names its sha. That state has been served to the public, which is
the strongest evidence available that it works.

Recover the machinery, never the writing:

```bash
git -C <dir> checkout <sha> -- astro.config.mjs package.json src/content.config.ts
```

Name the files. One at a time, or a short explicit list, always the file whose breakage you have
actually diagnosed.

**Never `git checkout .`, `git restore`, `git reset --hard`, `git stash`, or `git clean`.** Every
one of them can take away words somebody wrote, and there is no fault on this page worth that
trade. If a broad restore genuinely looks like the answer, that is the escalation, not the fix.

Derived state has no such protection and needs none, because it is rebuilt rather than restored:

```bash
rm -rf <dir>/.palate/index.json <dir>/dist <dir>/.astro
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>
```

`.gitignore` already draws this line: derived state is ignored, measured state is committed.
Anything ignored may be deleted without asking. Anything committed may not.

After any recovery, re-run the lane that failed and say plainly what state the site is in now,
including the parts that are still broken. A recovery that silently reopens the problem the
change was fixing is a second failure wearing the first one's clothes.

## When to escalate to a human

Escalate immediately, without trying anything first, when:

- it needs a password, `sudo`, a credential, or a paid account
- it needs a decision about their content: which of two versions is right, whether a heading may
  be cut, whether a page may go
- it touches money, a domain, or DNS
- clearing it would delete or overwrite something they wrote
- the same failure has now survived a genuine fix

And escalate on the honest one: **you do not know why.** Say that, name what you did, name what
you observed, and stop. A confident wrong diagnosis costs more than an admitted unknown, because
they act on it.

What escalation looks like: the one sentence, the one action, and the state of the site. Never a
transcript dump, never "let me know if you'd like me to investigate further".

## The specific cases

**Node or npm missing.** Nothing local runs, including the checks that would tell you anything.
This is the one case that is genuinely theirs: installing a runtime needs their machine's
permission. One sentence, one install command for their platform, stop. Do not try `curl | sh`,
do not try to install into their home directory to route around a prompt.

**`npm install` fails.** Retry once after removing `node_modules` and `package-lock.json` from
the project only. If the second attempt fails, read the reason before speaking: a 4xx or a
resolution conflict is real (report it, name the package), a timeout or a 5xx is the network
(say the network, offer to try again later). Never edit `package.json` versions to make an
install succeed. That trades a stopped build for a site that behaves differently from the one
that was checked.

**A port is already held.** `serve-preview.sh` prints `SERVE_FAIL:` on stderr and exits 1. Read
which one it is, they are not the same failure:

- `SERVE_FAIL: an existing Astro dev server holds the lock; <url> is NOT this build.` This is the
  dangerous one, and the script catches it because the URL on offer serves somebody else's site.
  Never hand that URL to a person or to a check. Clear it with `lsof -ti tcp:4321 | xargs kill` in the
  project, then start again.
- `SERVE_FAIL: server exited.` The server died on boot. The last lines of `.palate-devserver.log`
  are already on stderr and they usually carry a real diagnostic, most often the content-schema
  failure below.
- `SERVE_FAIL: no URL appeared in log within timeout.` Slow machine or a wedged process. One
  retry, then real.

A port collision that the script resolved by itself is not an event. State the address it landed
on and move on.

**A content entry fails its schema.** The commonest failure on this page by a distance, and the
best one, because the message names the field. `astro sync` or the build fails, nothing renders,
and nothing publishes: the contract treats it as a `cap` (`commands/check.md`), which outranks
everything, so there is no path where a bad entry ships.

Read the field name out of the error and translate it into their sentence. The schema in
`src/content.config.ts` is written so this is possible: `title` over 70 characters, `description`
over 160 (an SEO bound, not taste), `imageAlt is required whenever image is set`, and the
publish-date refine that exists because YAML rolls `2026-13-01` over into 2027 without ever
erroring, so a one-key typo produces a post dated next year, sorted to the top of every listing.

Offer the fix, do not perform it. A title is their writing and 70 characters is our rule, not a
law of nature. The exceptions are the ones with a single correct answer: a missing `imageAlt`
that you can write truthfully from the image, and a date typo where the intended date is
unambiguous.

Never widen the schema to admit a failing entry. The schema is the reason a non-developer can be
trusted with content at all.

**Playwright is not installed.** `verify-rendered.sh` exits **3**, and 3 is BLOCKED. It is not a
pass, it is not a warning, and any wrapper that reads non-zero as "failed" or zero-ish as "fine"
has inverted the one code that matters. Nothing publishes on a 3. The site is still live and
still fine, and the honest sentence is that you cannot see the page, so you cannot say it is
right.

The script installs the runtime itself on first use (`reference-capture/setup.sh`) and only exits
3 when that install failed, so this is a real failure, not a first-run cost. Report it as one.

**The Palate MCP is unreachable.** Not a failure. The content runtime is free and works with no
MCP at all: it degrades, it does not die. `gate-mcp-depth.sh` exits **3**, which is the
UNGROUNDED label, and a label never blocks. Anything treating non-zero as a stop inverts it.

Say it exactly once, with the recovery line, and then never mention it again in the session:

> The Palate MCP was not used for this change, so it carries no taste layer.
> `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`

Once, because a correct message repeated is indistinguishable from nagging, and nagging is how a
free tier teaches people to stop reading. Grounding is orthogonal to the verdict: an ungrounded
merge is a real, allowed state, and recording it is what stops it having to be fatal.

## What never happens

- Publishing on a check that could not run.
- A third attempt at the same thing.
- Weakening a check, a lint rule, a schema or a threshold to clear a failure. The gates are the
  contract (`references/errors.md`).
- Deleting or overwriting something the person wrote in order to unstick a build.
- "It should work now." Either it was re-run and passed, and you say the number, or it was not,
  and you say that instead.
- Silence. A failure that is handled invisibly and correctly still gets its one sentence, because
  the alternative is a person watching nothing happen.
