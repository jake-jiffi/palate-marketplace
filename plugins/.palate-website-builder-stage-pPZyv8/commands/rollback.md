---
description: Undo the last publish, or a named one, with the reason recorded and the right mechanism chosen.
argument-hint: "--reason \"why\" [--publish <commit sha>] [--to <deployment url>] [--dir <path>]"
---

# /palate-website-builder:rollback

Put the site back. There are two mechanisms and picking the wrong one is the entire cost of this
command, so pick deliberately and say which you used.

**Host rollback is instant.** `vercel rollback <url>` re-points production at a deployment that
already exists, so nothing builds. It does not touch the repo, which is the catch: the bad commit
is still on `main`, and the next push ships it straight back.

**Git revert is not instant.** It is a full build and deploy, minutes. It is the one that makes
the fix stick, and because baselines are committed it takes those back too, so the site and its
own record agree again.

The rule: if it is live and wrong, roll the host back FIRST to stop the bleeding, then revert to
make it stick. If nobody is looking, a low-traffic page, a draft, a change pushed two minutes
ago, just revert. A host rollback nobody follows up is a trap for whoever pushes next.

**Not `scripts/rollback.sh`.** That script is a project teardown: it deletes the Cloudflare
worker, the GitHub repo and the Sanity project for a slug. It is not an undo for a publish and
must never be run as one.

## 1. Require a reason

No `--reason`, no rollback. Ask for it in one question. It goes in the log and it is the only
part of tonight that is still useful in six months.

## 2. Identify the publish being undone

The last `publish` line in `<dir>/.palate/changelog.md`, or the one named by `--publish`. Print
its class, routes, verdict and message, and confirm that is the one. Rolling back the publish
before the bad one is a second outage.

## 3. Resolve the deployment to go back to

```
vercel ls --environment production        # run from <dir>
```

The newest READY deployment is what is live. The target is the one immediately before the publish
being undone; confirm by timestamp that it predates that publish. `--to` overrides the lookup.

Vercel is the source of truth for deployments. The changelog is the source of truth for what
changed and why. Cross-check them rather than trusting either alone.

## 4. Stop the bleeding

```
vercel rollback <target-url> --yes
vercel rollback status
```

Poll `status` until it settles, then fetch the live URL and confirm the reverted content is
actually gone. A rollback that reported success and did not change what is served is the failure
mode worth checking for, and it takes one request.

## 5. Make it stick

```
git -C <dir> revert --no-commit <sha>      # a merge commit needs -m 1
# append the changelog line from step 6 NOW, while the revert is still uncommitted
git -C <dir> commit -m "revert: <what and why>"
git -C <dir> push
```

`--no-commit`, not `--no-edit`, and the ordering is the point. Committing the revert first and
appending the changelog after leaves you needing `git commit --amend` to keep it to one commit,
and amending rewrites the sha that the log line names. One staged change, one commit, one push,
one deploy.

`<sha>` is the **publish commit**, the one carrying the source and the baselines. Do not revert
the `log:` commit that follows it. The changelog is a record of what happened, and what happened
includes the publish you are undoing.

Reverting the publish commit restores the source and the committed baselines together, so the
next contribution is measured against a version that exists.

Skipping this is allowed, when the real fix is minutes away. It is not allowed silently. Say the
state out loud: production is serving deployment N-1, `main` still carries the bad commit, and
the committed baselines describe a version nobody can see. Anyone who pushes before the fix lands
re-ships the thing you just rolled back.

## 6. Put the record straight

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>` to rebuild the index, and read
   `links.dead`: a revert can resurrect a link to a page that has since gone.
2. Append one line to `<dir>/.palate/changelog.md`, same shape as a publish line:
   ```
   2026-08-10T05:01:44Z  rollback  a1b2c3d  host+revert  routes=/blog,/blog/spring-hours  reason="wrong closing date"
   ```
   The third field is the publish being undone. The mechanism field is `host`, `revert`, or
   `host+revert`, and it is there so the next person can tell whether the repo and the live site
   agree.
3. Append this line while the revert from step 5 is still staged and uncommitted, so the two go
   in as one commit. Never `--amend` afterwards to achieve that: amending changes the sha this
   very line names.

## 7. Report

- What is live now, and how long the rollback took.
- Which mechanism ran, and whether the repo and production now agree.
- What is still broken: the revert re-opens whatever the change was trying to fix, and that is
  now the next piece of work, not a solved problem.
- If the host rollback ran alone, repeat the state warning here. Once at the end is where people
  read it.
