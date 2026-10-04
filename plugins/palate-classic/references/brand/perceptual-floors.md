# Perceptual floors - cited defaults the brand cannot violate silently

A set of perceptual minimums every Palate brand package must meet. These are
not opinions; they are research-grounded defaults sourced from WCAG, Material
3, NNGroup, APCA, and the Apple HIG. The brand package can adjust them
deliberately, but it cannot fall below them silently. `scripts/ux-lint.sh`
checks the emitted CSS / Tailwind preset against these floors.

The pattern is borrowed from the pencilplaybook skill's Perceptual Design
Defaults tables, in our own voice and tuned for marketing sites.

## Body text on dark surfaces

| Property | Floor | Rationale |
|----------|-------|-----------|
| Body text colour on dark | `#E2E8F0` or lighter, NEVER pure `#FFFFFF` | WCAG SC 1.4.8 visual presentation; pure white on dark causes halation and reduces readability for low-vision users. |
| Body text contrast (light bg) | >= 4.5:1 | WCAG 2.2 SC 1.4.3 (AA). |
| Body text contrast (dark bg) | >= 4.5:1 | Same. APCA Lc 60 is a stronger modern alternative if the brand uses an APCA-aware system. |
| Large text contrast | >= 3:1 | WCAG 2.2 SC 1.4.3 (large = 18pt+ regular, 14pt+ bold). |

## Interactive states

| Property | Floor | Rationale |
|----------|-------|-----------|
| Disabled-state opacity | 40% (not 50%) | APCA contrast research; Material 3 disabled state token. Pure 50% reads as "active but dim" and breaks affordance. |
| Hover delta (lightness) | >= 8% perceived shift | NNGroup hover discoverability research. Smaller deltas read as no change. |
| Pressed (`:active`) state | A visible change on press: Material 3 pressed state-layer (~12%), or a transform / colour shift | Material 3 state layers. Without a pressed state a tap feels dead, especially on touch where there is no hover. |
| Focus ring | Min 2px, contrast >= 3:1 against both backgrounds | WCAG 2.4.7 visible focus + 1.4.11 non-text contrast. |
| Tap-target size | Min 44 x 44 px | Apple HIG; WCAG 2.5.5 (AAA, but the floor for marketing sites that hand over to clients). |

## Type

| Property | Floor | Rationale |
|----------|-------|-----------|
| Body font size (mobile) | >= 16px | iOS / Android zoom-prevent; WCAG SC 1.4.4 text resize. |
| Body line-height | 1.5 to 1.7 | WCAG SC 1.4.12 text spacing. |
| Letter spacing (body) | 0 to 0.01em | WCAG SC 1.4.12. |
| Display letter spacing | -0.03em is the floor before letters touch on heavy weights | Apple HIG large titles. |
| Max body line-length | 50 to 80 characters | Bringhurst; Robert Bringhurst _The Elements of Typographic Style_. |

## Motion

| Property | Floor | Rationale |
|----------|-------|-----------|
| Animations on body text | None unless triggered by user input | WCAG SC 2.2.2 + 2.3.3. |
| `prefers-reduced-motion` | All non-essential motion respects it; the brand package must ship a documented reduced-motion strategy | WCAG SC 2.3.3. |
| Page transition duration | 150 to 300ms | NNG: under 100ms is missed; over 400ms feels sluggish. |

## Spacing and density

| Property | Floor | Rationale |
|----------|-------|-----------|
| Minimum gap between adjacent interactive controls | 8px | Fitts's Law derivative; Material 3 component spacing token. |
| Section vertical padding rhythm | A documented scale (e.g. 16 / 24 / 32 / 48 / 80) | Internal consistency; reviewer pass dimension 2. |

## How this interacts with the brand package

`references/brand/opinionated-choices.md` declares this file as a hard floor:
the brand package can pick stronger values (e.g. body text at 18px, hover
delta at 12%) but cannot fall below any number above. When generating a brand
package from raw client assets (BUILD BRAND), `references/brand/normalisation-rules.md`
applies these floors as upgrades.

`scripts/ux-lint.sh` enforces a subset of these mechanically:

- body text colour `#FFFFFF` on a class whose tokens declare a dark background -> Critical;
- a `:disabled` state with `opacity: 0.5` -> High;
- body font-size below 16px on a mobile breakpoint -> High;
- `transition-duration` outside the 150-300ms band for page-level motion -> Medium.

(Specific lint rules live in `references/anti-patterns.md`; add them as the
brand package output stabilises.)

## Adding a floor

Cite a source. A perceptual floor without a citation is an opinion and
belongs in `references/brand/opinionated-choices.md`, not here. The
authority of this file is precisely that every row points to a piece of
research.
