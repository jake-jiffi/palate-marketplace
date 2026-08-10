# fonts.css rules

## One family name per typeface
```css
/* CORRECT */
@font-face {
  font-family: "BrandSans";
  src: url("./brand-sans/regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "BrandSans";
  src: url("./brand-sans/bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```
Consumers then write `font-family: BrandSans; font-weight: 700`.

```css
/* WRONG: never do this */
@font-face { font-family: "BrandSans-Bold"; ... }
```
Per-weight family names leak implementation detail into every consumer and break the weight axis.

## Always
- `font-display: swap` on every face
- woff2 first, woff fallback, ttf only if a tool needs it
- self-host (place files under `fonts/{family}/`), do not hotlink
- document the licence in `fonts/{family}/LICENSE` and in the repo LICENSE

## Adobe Fonts exception
Adobe Fonts (Typekit) are non-redistributable. Do not vendor the files. Instead document the kit ID in LICENSE and in fonts.css add a comment pointing to the kit, with a `@import` of the Adobe kit URL as the loading mechanism. Note this clearly so consumers know they need the kit.
