---
description: Get this machine ready. Check what is there, install what needs no password, and hand back one exact line for anything else.
argument-hint: "[--with-taste to pre-download the 356MB appearance model]"
---

# /palate-website-builder:setup

Arguments: **$ARGUMENTS**

Assume the person running this does not write code and has never opened a terminal by choice.
They are here because they want to change their own website. Everything below is in service of
one sentence you will say at the end: **you are ready**, or **you are ready except for one thing,
and here is the line to fix it**.

## The two rules for everything you print

**Never print a stack trace.** Capture the noisy output to a log file and mention the path only
if they ask. A failure is one sentence about what is not working, and one action.

**Never say "dependency", "package", "binary", "runtime", "toolchain" or "install script".** Name
the thing by what it does. The translations are in section 6. A person who does not recognise a
word cannot act on the sentence containing it.

## 1. Find a place to work

```
eval "$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/detect-environment.sh")"
```

It prints `ENV_KIND`, `WORK_ROOT`, `OUTPUTS_DIR`, `HAS_NODE`, `NODE_OK`. It proves the folder is
writable rather than assuming it, and it refuses to work inside the plugin's own folder.

If it prints `PALATE_ENV_ERROR=no-writable-dir`, stop with:

> I could not find a folder on this machine I am allowed to write to. Tell me where your website
> folder is and I will use that.

Do not attempt a workaround. Every later step writes files, so there is nothing to salvage.

## 2. Check what is already here

Run these and record yes or no for each. Do not install anything yet.

```
node --version
git --version
jq --version
npm --version
```

Then the browser Palate uses to look at your pages, and the reading tools that come with it:

```
ls "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/node_modules/playwright" >/dev/null 2>&1 && echo browser-tools-present || echo browser-tools-absent
ls "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/node_modules/axe-core" >/dev/null 2>&1 && echo access-checker-present || echo access-checker-absent
```

Then the library connection. Call `mcp__palate__refs_list_verticals` once. It either answers, or
it does not exist as a tool, or it errors.

Two optional ones, needed only to put a site live, never to work on it:

```
gh --version
vercel --version
```

## 3. Install what needs no password

Exactly one thing installs itself, and it is the browser and its reading tools:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/setup.sh"
```

It is safe to re-run, it resumes if interrupted, and it writes only inside the plugin's own
folder. First run fetches a headless browser, which takes a few minutes on a slow connection.
Say that before you start it, not after.

With `--with-taste` in the arguments, run it as:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/reference-capture/setup.sh" --with-taste
```

That adds a one-time **356MB** download of the model that judges how a page looks. Never start
that without saying the size first. Without it, everything works except the appearance
comparison, which refuses cleanly rather than guessing.

If `jq` is missing **and** `brew --version` answers, install it, because Homebrew on this machine
does not ask for a password:

```
brew install jq
```

If `brew` is not there, do not install Homebrew. It asks for the person's password and it changes
the machine well beyond Palate. Hand back the line in section 5 instead.

**Install nothing else.** Not Node, not git, not the two optional publishing tools. Each one asks
for a password, changes the machine outside this project, or both. Handing back one line is the
correct outcome, not a failure to be worked around.

## 4. Decide what is ready

Three tiers. Say which tier they are in, in these words.

**Ready to work on your site** needs Node 22 or newer (`NODE_OK=yes`), git, and the browser tools
from section 3. This is the tier that matters. Everything in the daily loop, including checking
your own pages and seeing what changed, works here with no account and no library connection.

**Ready to check depth** additionally needs `jq`. Without it the depth gate does not run at all,
which is a silent pass, not a block. Worth fixing, not worth stopping for.

**Ready to publish** additionally needs `gh` and `vercel`, and both signed in. Only needed the
first time a site goes live.

The library connection sits across all three and is not required by any of them. If
`refs_list_verticals` did not answer, say this once and then move on:

> The Palate library is not connected, so I cannot compare your pages against real sites.
> Everything else works. Connect it any time with:
> `claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp`

Once. Not again at the end, and not as a warning.

## 5. Hand back the lines

For anything you did not install, give one line, complete, copyable, nothing to fill in. Say what
it is for in plain words first.

- **Node is missing or older than 22.** The program that runs Palate's tools.
  `brew install node` (or download the installer at https://nodejs.org and pick the LTS version)
- **git is missing.** Keeps every version of your site so nothing is ever lost.
  `xcode-select --install` on a Mac, which is a click-through, no password.
- **jq is missing and Homebrew is not installed.** A small tool the depth check reads results with.
  Install Homebrew from https://brew.sh, then `brew install jq`
- **Publishing tools missing.** Only needed to put the site on the internet.
  `brew install gh` then `gh auth login`, and `npm i -g vercel` then `vercel login`
- **A signed-in account is needed.** `gh auth login` and `vercel login` each open a browser for
  them to approve. Run the command yourself, then wait. Do not ask them to type anything into a
  terminal.

If `npm i -g vercel` fails on permissions, do not retry it with `sudo` and do not suggest they do.
Say the machine will not let anything install there, and hand back
`npm i -g vercel --prefix ~/.npm-global`.

## 6. Word substitutions

Use the right-hand column out loud, always.

| Do not say | Say |
|---|---|
| dependency, package, module | the tool that does *X*, named |
| Node, runtime | Node, the program that runs Palate's tools |
| Playwright, Chromium, headless browser | the browser Palate uses to look at your pages |
| axe-core | the accessibility checker |
| the SigLIP model, the vision tower | the model that judges how a page looks |
| jq | a small tool the depth check reads results with |
| install script, bootstrap | setup |
| the build failed, non-zero exit | it did not finish, and here is why in one line |
| stack trace, stderr | (never mention it, log it and move on) |

## 7. Say the principle, once, at the end

They are about to start changing a live website from a machine that might break. Tell them why
that is safe, in these words or close to them:

> Your machine can break. Your live site cannot. Nothing reaches the internet until it has passed
> the checks, so what is published is always the last version that passed. If something here stops
> working, the site stays exactly as it is until it is fixed.

That is the entire reason this command is worth running before anything else, and it is the answer
to the question they have not asked yet.

## 8. The report

Six lines, no more. No table unless something is missing.

```
Ready to work on your site   yes
Ready to check depth         yes
Ready to publish             no  (needs: gh, vercel)
Palate library               connected
Working folder               /Users/…/sites
Installed just now           the browser and its reading tools
```

Then, if anything is missing, the lines from section 5 and nothing else. Do not restate what
worked. Do not offer next steps they did not ask for. If everything is ready, say so in one
sentence and stop.
