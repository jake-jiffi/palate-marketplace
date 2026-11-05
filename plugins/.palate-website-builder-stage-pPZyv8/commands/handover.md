---
description: Transfer the whole site to the customer's own accounts, write the ownership receipt, revoke our access, and leave it building.
argument-hint: "[--dry-run] [github-owner] [contact email]"
---

# /palate-website-builder:handover

Arguments: **$ARGUMENTS**

This is a sales feature. "Hosted, not rented" is a claim until someone can leave in an afternoon
and the site keeps building without us, so demonstrating this command is what makes the promise
credible. Run it cheerfully. Never delay it, never counter-offer, never ask why.

The finish line is not "access transferred". It is **a deploy that succeeds from their account,
with ours removed**. Until that has happened, nothing has been handed over.

## 0. Dry run

If `--dry-run` is anywhere in the arguments, do sections 1 and 2, print the plan, and **change
nothing**. No transfers, no revocations, no commits, no `HANDOVER.md`. Read-only commands only.
End with the line:

> Dry run. Nothing moved. Run `/palate-website-builder:handover <owner> <email>` to do it for real.

Default is the real thing, after the confirmation in section 3.

## 1. Inventory what actually exists

**Run the script. It does the inventory, the redaction and the receipt.**

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/palate-handover.sh" <dir> --dry-run
```

`--dry-run` is the default and changes nothing, so it is safe to run in front of
the customer. That demonstration is the point: showing the exit is what makes
"hosted, not rented" credible, and an exit nobody has seen is a promise.

Read its output rather than re-deriving it. It reports the repo and remote, the
hosting project, the domain, the CMS (only when one is actually wired, not merely
when a no-op config file exists), the environment variables **by name and never
by value**, and the `.palate/` state that travels with the site. It marks each
row as automatic or "needs a person", because cross-provider transfers usually
require the receiving party to accept and some need a human in a dashboard.

When the customer is ready, `--execute --to <github-owner>` performs what can be
performed and writes the receipt. Use `--receipt-only` to regenerate the document
without moving anything.

The hand probes below are for what the script does not cover. Do not repeat what
it already reported: two inventories drift, and the one in the customer's receipt
is the one that has to be right.

```
git remote -v
gh repo view --json nameWithOwner,visibility,isFork,defaultBranchRef 2>/dev/null
gh api "repos/{owner}/{repo}/collaborators" --jq '.[].login' 2>/dev/null
gh api "repos/{owner}/{repo}/teams" --jq '.[].slug' 2>/dev/null
gh secret list 2>/dev/null
vercel project ls 2>/dev/null
vercel domains ls 2>/dev/null
```

Then read `.env`, `.env.example` and `wrangler.toml` for what else is wired: `SANITY_PROJECT_ID`,
Cloudflare account and worker name, any storage token, any third-party keys.

Six things can move, and a given site has some subset:

| Thing | Where it usually is | How it moves |
|---|---|---|
| the repo | `palate-projects/<slug>` on GitHub | GitHub transfer API |
| the hosting project | Vercel, our team scope | dashboard transfer, or redeploy from their account |
| the CMS | a Sanity project | role change in manage.sanity.io |
| media | Sanity's asset CDN, inside the CMS project | moves with the CMS |
| the domain | the client's registrar already | usually nothing to do |
| the code | the git history itself | moves with the repo |

If the site has media somewhere other than the CMS, name that store explicitly and treat it as a
seventh row. **There is no separate media bucket in a standard Palate build**, so if you find one
it was added by hand and you must find out where before promising to move it.

## 2. Print the plan

One table. What moves, from where, to where, and by which mechanism. Mark each row **automatic**
or **needs a person**, and for the second kind say who and where.

```
repo        palate-projects/acme-plumbing  ->  acmeplumbing            automatic (gh)
hosting     vercel/jiffico/acme-plumbing   ->  their Vercel team       needs a person (dashboard)
CMS         sanity 7x2k9abc                ->  admin: ops@acme.com.au  needs a person (manage.sanity.io)
domain      acmeplumbing.com.au            ->  already theirs          nothing to do
our access  palate-engineering team, 2 collaborators, 3 repo secrets   automatic (gh)
```

Then say the total: how many automatic, how many need them, and roughly how long the manual ones
take. Do not soften a manual step into sounding automatic. They will be sitting at the dashboard.

## 3. Confirm once

Two facts you cannot derive, so ask for both in one message: the **GitHub account or organisation**
to receive the repo, and the **email address** to make CMS and hosting administrator. If they came
in as arguments, read them back and ask for a yes.

> Transferring `palate-projects/acme-plumbing` to `acmeplumbing`, and making
> `ops@acme.com.au` administrator of the CMS. Yes to go ahead?

One yes covers everything below. Do not confirm again per step.

## 4. Move the repo

GitHub's transfer keeps the history, the issues, the stars and the URL redirect. It does **not**
carry Actions secrets, which is the one thing that silently breaks CI on the far side.

Before transferring, list the secret names so they can be recreated. Names only, never values:

```
gh secret list --json name --jq '.[].name'
```

Transfer:

```
gh api -X POST "repos/palate-projects/<slug>/transfer" -f new_owner='<their-owner>'
```

The receiving account gets an invitation to accept if it is an organisation they do not own
outright. Say so, and wait for it rather than assuming it landed.

Then verify from the other side:

```
gh repo view <their-owner>/<slug> --json nameWithOwner,defaultBranchRef
```

Update the local remote so their clone and yours both point at the new home:

```
git remote set-url origin git@github.com:<their-owner>/<slug>.git
```

Recreate each secret in the new location. `gh secret set <NAME>` prompts for the value; the values
they need are their own, from their own accounts, so this is where they paste in their Vercel or
Cloudflare token rather than inheriting ours. **Never copy our credentials into their repo.** A
handover that leaves them running on our keys is not a handover, it is a longer leash.

## 5. Move the hosting

Vercel has no CLI project transfer. The dashboard does it: **Project Settings, Advanced, Transfer
Project**, choosing their team as the destination. Give them that path in one line and wait.

The alternative, and often the better one when they are on a personal Vercel account: they import
the transferred repo into their own Vercel from scratch. It takes about two minutes, it proves the
build works from their side without inheriting any of our configuration, and it is the cleaner
answer to "what happens if you disappear". Offer both, recommend the import, and let them pick.

Either way, the environment variables do not travel. List the names so nothing is missed:

```
vercel env ls
```

**`vercel env pull` returns the literal string `[SENSITIVE]`, not the value.** Secrets cannot be
copied across accounts by any tooling here, and that is correct behaviour, not an obstacle. Every
secret is re-minted by them, in their account. Name each one, say what it is for, and link where
they get it.

On Cloudflare, the worker lives in our account and workers do not transfer. They deploy it into
theirs: `npx wrangler login` in their terminal, then deploy from the repo they now own.

## 6. Move the CMS and its media

At manage.sanity.io, on that project: invite the contact email as **administrator**, then have
them accept. Once they are administrator, they can move the project to their own Sanity
organisation and remove us. Media lives in the project's asset CDN, so it travels with the
project. Nothing is re-uploaded and no URLs change.

If the CMS project sits inside our Sanity organisation, moving it out is theirs to trigger after
they hold administrator, not ours. Say that clearly, because it is the step most often left half
done: they get an admin seat, the project stays in our org, and nobody notices for a year.

## 7. The domain

On a normal build the domain was always theirs at the registrar and only the DNS records point at
our infrastructure. Confirm rather than assume:

```
dig +short <domain>
dig +short NS <domain>
```

If hosting moved in section 5, the records change. Give them the exact new values from the new
hosting project, tell them the propagation window, and say plainly that the site keeps serving
from the old place until the records update, so there is no outage.

If the domain is registered to us, transfer it out at the registrar. That has its own 60-day
ICANN lock after any recent registration or transfer, so say the date, not "soon".

## 8. Write the ownership receipt

`HANDOVER.md` in the repo root, committed. This is the document they keep, so it must make sense
to someone who was not in this conversation.

```markdown
# Ownership: <site name>

Handed over <date> to <owner>.

## What they now own
| Thing | Where | Account |
|---|---|---|
| Repo | github.com/<owner>/<slug> | <owner> |
| Hosting | Vercel project <name> | <their team> |
| CMS | Sanity <projectId> | <their org> |
| Domain | <domain> | <registrar>, always theirs |

## What was removed
- palate-engineering team access, removed <date>
- <collaborators>, removed <date>
- Repo secrets holding our credentials, deleted <date>

## Running it
- Local: `npm install`, then `npm run dev`
- Deploy: push to `main`, CI builds and deploys
- Checks before publishing, in Claude Code: `/palate-website-builder:check`
- Checks before publishing, on any other tool, no install:
  `curl -fsSL https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/main/scripts/palate-verify.sh | bash -s -- ./`

## What still needs Palate
Nothing. The taste library (`mcp__palate__refs_*`) makes new pages better and is a paid
subscription, but the site builds, deploys and is maintainable without it.
```

That last section is the point of the document. If anything genuinely does still need us, name it
there in plain words rather than leaving them to discover it.

## 9. Revoke our access

Only after section 4 has verified and the receipt is committed. Revoking first can lock you out
of a transfer that has not completed.

```
gh api -X DELETE "orgs/palate-projects/teams/palate-engineering/repos/<owner>/<slug>" 2>/dev/null
gh api -X DELETE "repos/<owner>/<slug>/collaborators/<each-of-ours>"
gh secret delete <NAME>            # for each secret holding one of our credentials
```

Then remove our Vercel and Sanity memberships on their side once they are administrator, and
delete any of our API tokens that were minted for this project only.

Leave their access alone. The goal is that ours is gone, not that theirs is minimal.

## 10. Prove it still builds

The handover is not finished until a build succeeds with us removed.

Trigger a deploy from the new owner's setup, watch it, and read the result:

```
gh run list --repo <owner>/<slug> --limit 1
gh run watch --repo <owner>/<slug>
```

Then load the live site and confirm it serves. If the build fails, fix it. A failed first build on
their side is our problem for as long as it takes, regardless of who owns the repo now.

## 11. Close

Six lines, no farewell paragraph.

```
Repo        github.com/acmeplumbing/acme-plumbing        transferred, verified
Hosting     their Vercel team                            transferred, deploy green
CMS         Sanity 7x2k9abc, ops@acme.com.au admin       transferred
Domain      acmeplumbing.com.au                          unchanged, always theirs
Our access  removed: 1 team, 2 collaborators, 3 secrets
Receipt     HANDOVER.md, committed a1b2c3d
```

Then one line and stop:

> It is yours, and it is building. `/palate-website-builder:check` still works with no account.
