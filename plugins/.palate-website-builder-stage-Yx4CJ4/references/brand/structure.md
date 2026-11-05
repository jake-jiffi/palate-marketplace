# The canonical brand repo structure

Every brand-as-code repo has this exact shape. Scaffold it by copying `templates/repo-skeleton/` then substituting variables.

```
{slug}-brand/
├── README.md              Gateway for humans
├── CLAUDE.md              Agent reading order + non-negotiable rules
├── AGENTS.md              Shim pointing to CLAUDE.md
├── LICENSE                Per-asset licensing notes (especially fonts)
├── package.json           @palate-projects/{slug}-brand, exports tokens/css/tailwind/components
├── .npmrc                 Scope mapping to GitHub Packages (no token)
├── .gitignore
├── tokens/
│   ├── tokens.json        W3C DTCG (source of truth)
│   ├── tokens.css         CSS custom properties + semantic aliases
│   ├── tokens.ts          Typed exports, includes a noHash variant for PptxGenJS
│   └── tailwind.preset.ts Tailwind v3 preset, drop-in
├── fonts/
│   ├── {family}/          woff2/woff/ttf + licence file
│   └── fonts.css          Unified @font-face, one family name per typeface
├── logo/{svg,png}/        Kebab-cased filenames, all colour variants
├── characters/{svg,png}/  Brand mascots if they exist
├── illustrations/         Organised by usage mode (playful/professional)
├── imagery/               Photography library if present
│   ├── team/{headshots,group,at-work,candid,detail}/
│   └── editorial/{by-service/{service}/{header-desktop,header-mobile,cta},generic}/
├── components/            Reference React + Tailwind (Button, Card, Hero, CTASection, Nav, Footer, Logo, Character)
├── examples/              Full-page demos (landing.tsx, proposal-cover.html, title-slide.html, content-slide.html)
├── styles/globals.css
└── brand/                 All prose, in markdown
    ├── overview.md        Who they are in one read
    ├── voice.md           Tone, do's and don'ts, approved phrases
    ├── visual-system.md   Colour, typography, shape, logo rules, WCAG pairings
    ├── messaging.md       Headline formulas, CTAs, approved copy
    ├── photography.md     Team vs editorial universes, per-service metaphor index, pairing rules
    ├── services.md        Service/product lines with positioning
    └── team.md            Who's who
```

The package.json exports map is what palate-website-builder depends on. It MUST expose: `./tokens.css`, `./fonts.css`, `./tailwind.preset`, `./components/*`, `./tokens.json`, `./tokens` (the TS). See `templates/repo-skeleton/package.json.tpl`.
