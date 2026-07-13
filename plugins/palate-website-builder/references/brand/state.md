# Brand-as-code state and resume

`.palate-brand-state.json` lives in the brand repo working dir and makes runs resumable. Created by `state-init.sh`, mutated atomically by `state-update.sh`, queried by `state-resume.sh`.

## Steps tracked
repoCreated, assetsInventoried, assetsCopied, tokensGenerated, fontsCssWritten, componentsWritten, examplesWritten, docsWritten, metaFilesWritten, packagePublished, pushed, photographyPass.

## Resume logic
On re-invocation, `state-resume.sh` prints the first non-complete step. Resume from there. Each step is idempotent (Check-Before-Act): re-running a completed step is safe.

## Cross-skill resume (when composed)
When palate-website-builder invokes this skill in Phase 0 and the run is interrupted, the website-builder's own state records the brand repo path. On the website-builder's resume, it checks for `.palate-brand-state.json` in the brand repo and resumes this skill first before continuing to Phase A.

## Secrets
Never write tokens or secrets to the state file. The state file is committed to the brand repo, so it must contain only non-sensitive progress data. The content hash is a sha256 of the token/font/component files, not a secret.
