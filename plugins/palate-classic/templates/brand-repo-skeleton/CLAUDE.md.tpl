# {{CLIENT_NAME}} brand-as-code

This repo is the canonical design system for {{CLIENT_NAME}}. Any agent building
for this brand reads this file first.

## NON-NEGOTIABLE RULES (never break these)

{{NON_NEGOTIABLES}}
<!-- e.g.
- Australian English everywhere
- No em dashes; use commas, periods, or parentheses
- Only the approved palette in tokens/. Never invent colours.
- {{CHARACTER}} only appears in {{approved contexts}}, never {{forbidden contexts}}
- Never mix design modes within a single page
-->

## Reading order

1. brand/overview.md — who they are
2. brand/voice.md — how they sound
3. brand/visual-system.md — colour, type, shape, logo rules
4. tokens/tokens.css — the actual design tokens
5. components/ — reference implementations to compose from

## Decision tree

- Need a colour? -> tokens/tokens.css semantic aliases (--brand-*), never raw hex
- Need type? -> fonts/fonts.css families, tokens for sizes
- Building UI? -> compose from components/ before writing new
- Writing copy? -> brand/voice.md and brand/messaging.md
- Choosing imagery? -> brand/photography.md pairing rules
- Switching light/dark or playful/professional? -> [data-brand-mode] swap, see tokens.css

## What this package exports

tokens.css, fonts.css, tailwind.preset, tokens.json, tokens (ts), components/*.
Consumers (like a palate-website-builder site) import these and pin an exact version.

## Calibration examples

Good: a CTA using --brand-accent and BrandSans 600, composed from components/Button.
Bad: a CTA with a hand-picked hex and a font-family of "BrandSans-Bold".
