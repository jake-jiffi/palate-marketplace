---
description: Hold a post for a named instant, then publish it when that instant arrives.
argument-hint: "<post slug> <when, with an offset: 2026-09-01T09:00+10:00> | --due"
---

# /palate-website-builder:schedule

Scheduling here is `draft: true` plus a merge when it is due. That is the whole mechanism, and it
is deliberate.

**This command will not set up a cron, and will not propose GitHub Actions for it.** GitHub's own
documentation warns that scheduled workflows can be delayed during periods of high load, and that
when load is high enough, queued jobs may be dropped entirely. The delay is worst at the start of
every hour, which is exactly when a 9am embargo fires. A publish that silently does not happen is
worse than one nobody automated, because nobody finds out until the client asks where it is.

Two modes: set one, or run the ones that are due.

---

## Mode A: set a schedule

`$ARGUMENTS` is a post slug and an instant.

### 1. Get a real instant

An instant needs an offset. "9am" is not an instant, it is a wish about somebody's timezone.
Require `2026-09-01T09:00+10:00` or equivalent, and if you were given a bare time, ask once which
timezone, and record what they said.

### 2. Hold the post

Set `draft: true` in the frontmatter. That filters it from every listing and 404s it in
production, while it stays readable in local preview and in the diff.

### 3. Do NOT put the future date in `publishedAt`

This is the trap, and it fails the build rather than failing quietly.

`src/content.config.ts` refuses a `publishedAt` more than two days ahead. The refine runs on
every entry in the collection, drafts included, so a post dated next month does not sit
harmlessly in the repo: it fails `npm run build` and takes the whole site's next deploy with it.
The two days of slack exist for clock and timezone skew, not for scheduling.

So `publishedAt` stays at today's date until the post actually goes live. The due instant lives in
the register instead.

### 4. Record it in the register

Append to `<dir>/.palate/schedule.md`, one line per held post:

```
2026-09-01T09:00+10:00  posts/spring-hours  asked-by=Jake  "spring trading hours, embargoed until the sign goes up"
```

The reason matters as much as the time. In three weeks nobody remembers why a post is being held,
and a held post with no reason gets published early by someone being helpful.

### 5. Ship the draft

Hand to `/palate-website-builder:publish`. A draft is invisible in production, so shipping it now is safe and it
means the post is already through the gates. When it goes live it does so on a single frontmatter
flip that has nothing left to fail.

If you were told to hold it out of the repo entirely, say which you did.

### 6. Tell them who runs it

Say the instant back in their own words, and say plainly that a person or their machine's own
scheduler has to run `/palate-website-builder:schedule --due` at that time. Offer the two real options, a
calendar reminder or a scheduler on the machine that runs this session, and stop. Do not promise
a mechanism this command does not own.

---

## Mode B: `--due` (or no arguments)

### 1. Read the register

Read `<dir>/.palate/schedule.md`. List what is due now and what is upcoming, with instants. If
nothing is due, print the next one and its instant, and stop. Do not publish early: a post that
goes out late is fixable, a post that goes out early is not.

### 2. Release each due post

- `draft: true` becomes `draft: false`.
- `publishedAt` becomes today's date in the site's timezone. This is the moment it is allowed to
  carry a real date, and it is now inside the schema's window.
- Move the register line to a done line carrying the instant it was due and the instant it
  actually went out. The register then also records the lag, which is the only way anyone finds
  out that "9am" has been meaning 11am.

### 3. Ship

Hand to `/palate-website-builder:publish`, once, for all the posts released in this run. One deploy, not one per
post.

### 4. Report

What went live, at which URL, how late against the instant that was asked for, and what is still
held with its next instant.
