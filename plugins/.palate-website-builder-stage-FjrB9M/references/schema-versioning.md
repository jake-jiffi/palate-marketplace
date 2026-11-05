# Sanity schema versioning

## The challenge
The schema lives in the site repo (studio/schemas) and is deployed to Sanity. Schema changes need to deploy without breaking existing content.

## The approach
- Additive changes (new optional fields, new types) deploy safely anytime.
- Breaking changes (renaming/removing fields) need a migration: add the new field, migrate content, then remove the old field in a later deploy.
- The schema is versioned with the site repo, so every schema state is tied to a git commit.

## formSubmission is read-only
The formSubmission type is readOnly in Studio. It is written only by the form handler. This prevents editors accidentally creating or corrupting submission records.

## Deploying schema changes
`sanity deploy` (or the Studio deploy in Phase B) pushes the schema. The hosted Studio updates. Existing documents keep their data; new fields appear empty until populated.
