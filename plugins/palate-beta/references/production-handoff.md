# Production handoff - running provisioning hands-off

Phases B-F provision real infrastructure (Sanity, Cloudflare, GitHub, the
domain). This doc is how they run. The short version: **in Cowork, Claude runs
them on the user's machine, hands-off. The user only does what genuinely needs a
human.**

## What changed, and why

Earlier guidance told the user production "can't run from a chat" and needed a
separate, dedicated build environment. Both were wrong and both cost trust. There is no
such environment - the user's own Mac, with its installed CLIs, is it. And in
Cowork, Claude can drive that Mac's Terminal directly. Delete that framing
wherever it appears; use this instead.

## Who does what

**Claude does, hands-off** (via the user's Terminal in Cowork - computer-use /
Terminal control): every `npm`, `git`, `gh`, `wrangler`, `npx sanity` and
`npx wrangler` command. Writing config and `.env` files. Building. Deploying.
Committing and pushing. Reading command output and handling errors. Claude
writes a deploy script into the project and runs it, rather than dictating
commands for the user to paste.

**The user does** only the three things that genuinely require a human:
1. **Create accounts** - Sanity, Cloudflare, GitHub. Claude cannot create
   accounts. One-time.
2. **Approve credential / OAuth prompts** - `wrangler login`, `gh auth login`,
   `npx sanity login` each open a browser for the user to approve. Claude runs
   the command; the user clicks approve.
3. **Create API tokens in a dashboard** when a CLI cannot mint them - e.g. a
   Sanity API token, a Cloudflare API token. Claude tells the user exactly which
   token, with which scope, and where; the user pastes it back once and Claude
   wires it into `.env` and the repo/worker secrets.

Claude must NOT type the user's passwords, and must not create accounts. Beyond
that, it runs the show.

## The hands-off pattern, per command

For each provisioning step: Claude writes the command(s) into a small script in
the project, runs it in the user's Terminal, and watches the output. On a
credential prompt, Claude pauses and asks the user to approve the browser
window, then continues. On an error, Claude reads it, fixes it, re-runs - it
does not hand a failing command back to the user.

## Credentials and where they live

- **`.env`** at the project root (git-ignored): `SANITY_PROJECT_ID`,
  `SANITY_DATASET`, `SANITY_API_READ_TOKEN`, `SANITY_API_WRITE_TOKEN`,
  `PUBLIC_SANITY_VISUAL_EDITING_ENABLED`. Used for local dev and the
  seed/publish scripts. (There is no preview secret - visual editing is gated
  by the `PUBLIC_SANITY_VISUAL_EDITING_ENABLED` build var; see
  `references/cms-and-draft-preview.md`.)
- **Build-time vars (CI build environment)**: `SANITY_PROJECT_ID`,
  `SANITY_DATASET`, `SANITY_API_READ_TOKEN`, `PUBLIC_SANITY_VISUAL_EDITING_ENABLED`.
  `@sanity/astro` bakes these in at build, so CI must set them before
  `astro build` runs. The preview deployment sets the flag to `true`.
- **Cloudflare Worker secrets** (`wrangler secret put`): the Sanity write token
  (the `/api/contact` handler), and the forms keys (`RESEND_API_KEY`,
  `TURNSTILE_SECRET`) - read at runtime via `locals.runtime.env`.
- **GitHub repo secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  plus the build-time vars above - so CI can build and deploy.
- A token is never written into the skill, the template, or a committed file.
  `.env` is git-ignored; verify `.gitignore` covers it before the first commit.

## Phase order, hands-off

- **B Sanity**: user creates the Sanity account + project (and pastes the
  project ID + an API token). Claude wires it into `.env` / CI vars and seeds
  the dataset from `content.ts`. The Studio is embedded at `/studio` and ships
  with the site - it deploys in Phase C, no separate Studio deploy.
- **C Hosting**: Vercel (default) - `vercel login` (user approves), then
  `scripts/provision-vercel.sh <slug>` links the project, pushes env vars
  scoped per environment, and triggers the first production deploy, returning
  the live `*.vercel.app` URL. Preview deployments come with Vercel Toolbar
  Comments automatically. Cloudflare (backup, `--host cloudflare`) -
  `npx wrangler login` (user approves the browser), then Claude builds and
  `wrangler deploy`s the SSR worker, returning the live `workers.dev` URL. See
  `references/hosting-vercel.md`.
- **D GitHub**: `gh auth login` (user approves), then Claude creates the repo,
  sets the secrets, pushes; CI takes over deploys from there.
- **E Domain**: the careful one - it moves DNS off the client's current site.
  Hold the cutover until the client has signed off. Walk it step by step.
- **F Optional**: analytics etc. - the user creates the analytics account,
  Claude wires the snippet.

## If not in Cowork

If the skill runs somewhere without Terminal control (plain Claude Code is
itself a terminal, so it is fine; a restricted remote session is not), fall
back to giving the user exact, copy-paste-ready commands - one block, tailored
to their paths and org. But in Cowork, the default is hands-off.
