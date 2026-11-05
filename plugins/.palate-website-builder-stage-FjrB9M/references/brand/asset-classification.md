# Asset classification

Run `inventory-assets.sh <source>` to get a JSON summary, then classify by hand where the script is ambiguous.

## Categories
- **fonts**: woff2, woff, ttf, otf. Group by family.
- **logos**: svg (preferred), png. Note colour variants (full-colour, mono, white, black).
- **characters**: brand mascots, if any. svg + png.
- **illustrations**: organise by usage mode (playful vs professional) if the brand has both.
- **photography**: jpg, jpeg, avif. Triage into team vs editorial (see photography-pipeline.md).
- **brand PDFs**: guideline docs. If scanned (image-only), OCR or vision-review.
- **copy**: md, txt, docx. Website copy, taglines, messaging.
- **existing brand skill / voice doc**: any md that already distils voice or visual rules. THIS IS SOURCE OF TRUTH; reuse verbatim.

## Missing-asset handling
If a key type is missing (no fonts, no logo, no voice), interactive mode asks before inventing. Composed mode uses a documented default and logs the assumption:
- No fonts: default to Inter (display + body), note it.
- No logo: generate a simple wordmark from the brand name in the display font + primary colour, note it.
- No voice doc: distil from available copy, flag as distilled.
- No colours: neutral palette with one accent derived from the logo if present.
