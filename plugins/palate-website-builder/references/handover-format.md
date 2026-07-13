# handover.md format

Generated at the end of every build. Plain, scannable, action-oriented.

```
# {Client} website: handover

## Live
- Site: https://{domain} (and https://{worker}.workers.dev)
- Studio (CMS): https://{domain}/studio  (embedded - same site)
- Repo: https://github.com/palate-projects/{slug}

## Brand
- Package: @palate-projects/{slug}-brand@{exact-version}
- To update: npm install @palate-projects/{slug}-brand@latest, review, deploy

## What's wired
- Sanity CMS (editors invited: {emails})
- Forms: email to hello@{domain} + saved in Studio under Form Submissions
- Analytics: Humblytics
- Search, sitemap, robots, llms.txt, OG images: all live

## Required actions
- {DNS records if external}
- {Set RESEND_API_KEY / TURNSTILE keys if not yet}
- {Confirm brand assumptions, if composed: list}

## CRO (if enabled)
Installed but dormant until ~{threshold} sessions (est. 2-3 weeks). Activates automatically.
```

Also write proposal-update.md: a short client-facing note that the site is live, what they can do now, and next steps. Friendly tone, less formal.

## Preview-stage hand-back (when stage=preview)

A preview does not deploy anything. The skill STARTS the server itself and hands over a working link, it does not ask the person to run commands. End with:

```
# {Client}: design preview

This is a real Astro project (the production codebase), not a mockup.

## See it now
  {the live URL from serve-preview.sh, e.g. http://localhost:4321}
It is already running. Just open the link.
(To stop it later: kill $(cat {project-dir}/.palate-devserver.pid). To restart: serve-preview.sh {project-dir}.)

## What's built
- {N} pages as real .astro components
- Brand system: {brand package or vendored}, applied via BaseLayout + Tailwind preset
- Design direction: {style} / {mode}, informed by {references}

## Not yet done (happens at production)
- CMS (Sanity), working forms, hosting (Cloudflare), repo + CI, domain

## To go live
Say "make it production-ready" and I'll promote this exact project: add the CMS,
wire the forms, deploy to Cloudflare, set up the repo and CI, attach the domain.
No rebuild, it continues from here.
```

The key message: it is the real codebase, and production is a continuation, not a restart.
