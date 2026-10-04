# Token generation: one source, four formats

## The source of truth: tokens.json (W3C DTCG)
Write tokens.json first, in W3C Design Tokens Community Group format. This is the single source. Everything else derives from it.

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "palette": {
    "blue": { "500": { "$type": "color", "$value": "#2563eb" } }
  },
  "brand": {
    "bg": { "default": { "$type": "color", "$value": "{palette.white.base}" } },
    "text": { "primary": { "$type": "color", "$value": "{palette.slate.900}" } }
  },
  "type": {
    "display": { "$type": "fontFamily", "$value": "BrandDisplay" },
    "scale": { "base": { "$type": "dimension", "$value": "1rem" } }
  },
  "space": { "4": { "$type": "dimension", "$value": "1rem" } },
  "radius": { "default": { "$type": "dimension", "$value": "0.5rem" } }
}
```

## Deriving the other three
- **tokens.css**: flatten to CSS custom properties. Primitives as `--palette-blue-500`, semantic aliases as `--brand-bg-default`. Wrap semantic aliases so a `[data-brand-mode="dark"]` block can override them.
- **tokens.ts**: typed exports. Export both the hash form (`#2563eb`) and a `noHash` variant (`2563eb`) for PptxGenJS, which wants colours without the hash.
- **tailwind.preset.ts**: a Tailwind v3 preset that maps the tokens into `theme.extend` (colors, spacing, fontFamily, borderRadius). Drop-in for any consuming Tailwind project.

## The rule
Never hand-edit tokens.css, tokens.ts, or the preset directly. Edit tokens.json and regenerate. A small generator script (or the skill doing it inline) reads tokens.json and writes the other three. This guarantees they cannot drift.
