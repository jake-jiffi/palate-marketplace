# Environments

This covers two different things that both get called "environment": the **runtime environment** the skill is invoked in (where it builds), and the **deploy environments** of a finished site (local/preview/production). Read the first part before any build.

## Runtime environment (where the skill builds): detect, never assume

The skill can be invoked several ways, and they have different filesystems:
- **Cowork as a task** (no folder context): often starts at `/`, with `/mnt/user-data/outputs` writable and `/mnt/user-data/uploads` read-only.
- **Cowork in a folder**: a writable project folder is the working context.
- **Claude Code pointed at a folder**: the current directory is the project, writable.
- **Bare sandbox**: only `/tmp` or `$HOME` may be writable.

Because these differ, the skill must NOT hardcode paths or assume writability. The first step of any build is:

```bash
eval "$(scripts/detect-environment.sh)"
# now WORK_ROOT, OUTPUTS_DIR, ENV_KIND, HAS_NODE, NODE_OK are set
```

`detect-environment.sh` proves writability (it actually writes a temp file) and picks WORK_ROOT by priority: an explicit `PALATE_WORK_DIR` override, then the current directory if it is writable and not inside a skill folder, then `/mnt/user-data/outputs`, then `$HOME/palate-builds`, then `/workspace`, then `/tmp/palate-builds`. It will never choose a directory inside the skill itself (no building where SKILL.md lives). If nothing is writable it errors clearly rather than failing deep in a phase.

Build under `WORK_ROOT/{slug}-site`. Put final deliverables (zips, exported screenshots) under `OUTPUTS_DIR` when it differs from WORK_ROOT.

### Filesystem rules that prevent the stumbles
- Template files may be read-only (e.g. under `/mnt/skills`). Copy them WITHOUT preserving permissions: `cp -r template/. dest/` then `chmod -R u+w dest` if needed, rather than `cp -p`.
- Some mounts allow create/overwrite but not delete (e.g. an outputs mount). Do not rely on deleting there; build in WORK_ROOT and only copy finished artefacts out.
- Never try to write into a protected skill directory (e.g. a project's `.claude/`) if it errors; note it in the handover instead of failing the build.

## Deploy environments (of a finished, production site)
- **Local dev**: `npm run dev`, reads .env (SANITY_PROJECT_ID, read token), brand package from ~/.npmrc.
- **Preview deploy**: a PR triggers preview.yml, deploys a Workers preview version (wrangler versions upload), comments the URL.
- **Production deploy**: push to main triggers deploy.yml, builds in CI, deploys dist/ to the production Worker.
- **Content rebuilds**: a Sanity webhook fires repository_dispatch (sanity-publish), triggering revalidate.yml.

Secrets per environment: local in .env (gitignored), CI/prod in GitHub Actions secrets and Cloudflare Worker secrets. The read token is in .env + Actions; the write token is ONLY a Worker secret.

(Note: a preview-STAGE build, see `build-stages.md`, does none of the deploy-environment steps. It is purely local. Deploy environments only exist once a site is promoted to production.)
