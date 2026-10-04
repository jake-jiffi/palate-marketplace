# templates/cms-sanity - the opt-in CMS overlay

Applied by `scripts/add-sanity.sh <project-dir>`. Nothing here ships in the
default scaffold: `templates/astro-project/` is deliberately CMS-free, because
this tree costs about **850 packages** (a scaffold goes 436 -> 1,291) and most
sites never need it.

**Add a CMS only when** the client will edit their own copy, content is
collection-shaped and growing (blog, case studies, menu, listings), or someone
needs draft preview before publishing. See `references/cms-and-draft-preview.md`.

## How it applies without touching the build

`astro.config.mjs` and `BaseLayout.astro` are customised per build, so the
script never patches them. It replaces whole files instead, and the base ships
no-op versions of the two that matter:

| File | Base (no CMS) | Here |
|------|---------------|------|
| `astro.cms.mjs` | `cmsIntegrations()` returns `[]` | returns the `sanity()` integration |
| `src/components/CmsVisualEditing.astro` | renders nothing | renders `<VisualEditing>` |
| `src/lib/load.ts` | returns the `fallback` | queries Sanity, falls back |
| `src/env.d.ts` | no CMS types | `@sanity/astro/module` + `SANITY_*` |
| `src/pages/api/contact.ts` | Resend only | Resend + `formSubmission` write |

Everything else is new: `sanity.config.ts`, `src/sanity/schema/`,
`src/lib/sanity.ts` (image URL helper) and the seed scripts. `deps.json` is
merged into the project's `package.json`, with the project's own pins winning
on conflict.

Because `output: "server"` and `loadPage()` are already in place from the first
file, **no page changes and nothing is rebuilt.**

## Notes

- React (`react`, `react-dom`, `react-is`, `styled-components`, `@astrojs/react`)
  is already in the base scaffold and is a peer of `@sanity/astro`, so it is not
  repeated in `deps.json`.
- On `--host cloudflare`, apply the host overlay FIRST. It overwrites
  `package.json`, so the reverse order would strip the CMS back out;
  `switch-host-cloudflare.sh` hard-blocks it rather than doing that silently.
- Provisioning the Sanity project itself is separate:
  `scripts/provision-sanity.sh <slug> <display-name> <site-domain>`.
- **Sanity 6 line**, verified against Astro 7: `sanity` + `@sanity/vision` ^6.9
  (they move in lockstep, vision peers `sanity ^6`), `@sanity/client` ^7.26,
  `@sanity/image-url` ^2.1. Studio v6 drops Node 20, removes the deprecated
  `auth.mode` and `enableLegacySearch` options (neither is used here), enables
  React strict mode, and moves to **Vite 8** - which is why it pairs with Astro 7
  rather than fighting it. Our `defineConfig` / `defineField` / `defineType` /
  `sanity/structure` / `sanity/presentation` imports are unchanged; a typecheck
  A/B against the v5 tree gave identical results.
- `@sanity/image-url` v2 **deprecated its default export**. `src/lib/sanity.ts`
  uses the named `createImageUrlBuilder`; the default still works but warns.
- Sanity 6 peers `react`/`react-dom` **^19.2.2** and `styled-components`
  **^6.1.19**. Those live in the BASE scaffold, and `deps.json` cannot raise a
  base pin (the merge lets the project win), so the base floors were bumped to
  match and must move with any future Sanity major.
