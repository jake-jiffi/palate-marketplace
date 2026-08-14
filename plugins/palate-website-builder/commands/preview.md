---
description: Serve the working tree locally and show before and after stills of what changed at 390 and 1440.
argument-hint: "[path to the site] [--routes /,/blog] [--full]"
---

# /palate-website-builder:preview

See the change before anyone else does. The local dev server IS the preview: no build queue, no
deploy, no per-account build ceiling, no waiting on a host. It runs as often as you like.

This command never gates. It builds, serves, shoots and shows. `/palate-website-builder:publish` is what refuses.

## 1. Orient

1. Resolve the project dir: `$ARGUMENTS` if it holds a `package.json`, else the cwd. Confirm
   `src/pages` exists. If it does not, say it is not an Astro site and stop.
2. Work out what changed:
   ```
   git -C <dir> diff --name-only HEAD
   git -C <dir> ls-files --others --exclude-standard
   ```
   Together those are the changed set. If it is empty, say so and carry on: previewing an
   unchanged tree is a legitimate thing to want.

   Not a git repo, or no commit yet, and both of those fail. Treat every source file as changed,
   say that is what you did, and expect a wide blast radius.
3. Work out which routes that reaches:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir> --blast <changed files...>
   ```
   It prints `{changed, routes, count}`. `--routes` on the command line overrides it. The blast
   radius fails WIDE on purpose: an unrecognised file returns every route. If `count` is over 10
   say the change is wide and shoot the first six routes unless `--full` was passed.

## 2. Serve

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
```

It backgrounds the server, polls until it answers, and prints `SERVE_URL=`, `SERVE_PID=` and
`SERVE_HTTP=`. Read those three, do not guess a port.

**This does not build.** The default mode is `npm run dev`, so there is no `dist/` and a build
error will not surface here: it surfaces at `/palate-website-builder:publish`, which does build.
Say so when you hand over the link. Telling someone the tree was built when it was only served
means they read a clean preview as proof the build is fine, and it is not evidence of that.

- `SERVE_FAIL` about an existing Astro dev server holding the lock: run
  `(cd <dir> && lsof -ti tcp:4321 | xargs kill)` and re-run once. Never hand over the URL from that notice.
  It belongs to somebody else's build.
- `SERVE_FAIL` with the server exiting: the script already retried with the built worker. Print
  the last log lines from `<dir>/.palate-devserver.log` and stop. A build error is the finding.
- `SERVE_HTTP` other than 200: say so and give it a few seconds before shooting.

## 3. Shoot the after

For each affected route:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/screenshot-build.sh" \
  --url <SERVE_URL><route> --out .palate-shots/after/<route-slug> --label after --sections
```

It always shoots both viewports, mobile 390x844 and desktop 1440x900, retina, full page, plus a
per-section clip for every `data-section-id`. It exits 0 even when a capture fails, so read
`<out>/manifest.json` rather than the exit code: `status`, `shots`, `sections[]`, `overflow`,
`console_errors`, `notes`.

## 4. Shoot the before

The before is what visitors are being served right now, not what is in git. Find it in this order
and say which one you used:

1. the newest READY production deployment, `vercel ls --environment production` run from `<dir>`;
2. the site URL in `src/lib/business.ts`.

Shoot it the same way into `.palate-shots/before/<route-slug>`. `screenshot-build.mjs` does not
carry the capture engine's SSRF guard, so a public URL is fine here.

If the site has never been deployed, there is no before. Say that once and show the after alone.
Do not fabricate a comparison out of the last commit.

## 5. Crop to what changed

Read both `manifest.json` files. Pair the section clips by `sid` across before and after, then
show ONLY the sections the diff touches:

- a changed component or section file maps to the `data-section-id` it renders;
- a changed content entry maps to the sections of its own route plus the listing that carries it;
- where nothing maps, fall back to the full-page pair for that route.

`--full` shows every section. Default is cropped, because a wall of identical stills is how a
real regression goes unnoticed.

Read the PNGs and present them one route at a time: mobile before, mobile after, desktop before,
desktop after. Name what moved in one line per pair. If nothing visibly moved, say that too, it is
the answer for most content edits.

## 6. Report

- The URL, live and responding, and the routes shot.
- Console errors from `manifest.console_errors` and `<out>/errors.json`, quoted, not counted.
- `overflow` above 0 at either viewport: horizontal scroll is a real defect, name the viewport.
- Anything in `notes` (a failed clip, a WebGL relaunch, a nav warning).
- How to stop it: `(cd <dir> && kill -- -$(cat .palate-devserver.pid) 2>/dev/null; lsof -ti tcp:4321 | xargs kill)`.
- The next step: `/palate-website-builder:publish` when it looks right.

Leave the server running. Somebody is about to look at it.
