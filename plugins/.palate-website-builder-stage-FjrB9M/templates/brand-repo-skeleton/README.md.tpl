# {{CLIENT_NAME}} Brand

Brand-as-code for {{CLIENT_NAME}}: design tokens, fonts, logos, reference components,
and brand documentation, published as `@palate-projects/{{SLUG}}-brand`.

## For humans
Start with `brand/overview.md`, then `brand/visual-system.md`. The `examples/` folder
shows the system assembled into full pages.

## For AI design tools
This repo is built to feed Claude Design, v0, Cursor, and Figma Make. Link the repo,
use `tokens/`, `fonts/`, and `components/`. Agent rules are in `CLAUDE.md`.

## For developers
```
npm install @palate-projects/{{SLUG}}-brand
```
```css
@import "@palate-projects/{{SLUG}}-brand/tokens.css";
@import "@palate-projects/{{SLUG}}-brand/fonts.css";
```
Pin an exact version. Brand updates are deliberate: bump the version, review, deploy.

## Built with Palate
Generated with the Palate website builder.
