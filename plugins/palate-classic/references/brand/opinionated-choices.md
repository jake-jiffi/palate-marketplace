# Opinionated choices (apply all of these)

These are the decisions that make a brand repo good rather than just present. Apply them on every build.

**Perceptual floor (hard rule, not opinion).** Every brand package must meet the cited perceptual minimums in `references/brand/perceptual-floors.md` - body text colour on dark surfaces, disabled-state opacity, hover delta, body font-size and line-height, focus ring visibility, tap-target size. The package can choose stronger values; it cannot fall below silently. When generating a brand from raw client assets, `references/brand/normalisation-rules.md` applies the floors as automatic upgrades. `scripts/ux-lint.sh` enforces a subset of these mechanically.

## Tokens in four formats, one logical source
Generate tokens.json (W3C DTCG, the source of truth), then derive tokens.css, tokens.ts, and tailwind.preset.ts from it. Never hand-write the four separately; they will drift. The tokens.ts includes a `noHash` variant (colours without the leading #) because PptxGenJS needs that format.

## Semantic aliases over raw primitives
Layer semantic tokens (`--brand-bg-default`, `--brand-text-inverse-muted`) over raw palette primitives (`--palette-blue-500`). Mode-switching becomes a one-line swap via `[data-brand-mode="..."]`. Namespace primitives and aliases differently so they never collide.

## Unified fonts.css, one family name per typeface
One `font-family` name per typeface, with weights expressed via `font-weight` in the @font-face blocks. Never `BrandName-Regular` as a family name; that leaks implementation detail into consumer code. Consumers write `font-family: BrandSans; font-weight: 700`, not `font-family: BrandSans-Bold`.

## AVIF + JPG pair for every photograph
AVIF master for modern use, JPG fallback for tools that cannot render AVIF (including some vision tools). When categorising AVIF-only photography, convert to JPG previews first (`sips -s format jpeg -Z 1200`) and review those.

## Photography in two universes (if the brand has a narrative arc)
Team (real humans, proof-of-work) and editorial (surreal or lifestyle stock, metaphor for the problem). If per-service solution imagery exists, organise by service and document the metaphor each image carries.

## Pairing rhythm in photography.md
Chaos/metaphor first, humans halfway down, metaphor CTA to close. Never open a page with a team photo.

## CLAUDE.md as the agent welcome mat
Explicit reading order, a decision tree ("if you need X, go to Y"), non-negotiable rules at the very top (hard never/always constraints unique to this brand), and calibration examples. Write it like docs for an LLM, not for a human.

## Non-negotiable rules at the top of CLAUDE.md
Whatever is unique to this brand: colour restrictions, language rules (e.g. Australian English), typographic constraints (e.g. no em dashes), mode-mixing rules, character usage rules. These go first because they are the things an agent must never get wrong.
