# Asset handling in the site

- **Brand assets** come from the brand package (logos, fonts, tokens). Imported, never duplicated, unless --vendor-brand.
- **Content imagery** lives in Sanity, served via the Sanity image CDN with urlFor() (responsive, format-negotiated).
- **OG images** generated per page at build (src/pages/og/) for social sharing.
- **Favicons** generated from the brand logo at scaffold.
- **Static assets** (the IndexNow key, any downloads) live in public/.

The rule: brand assets from the package, content assets from Sanity, generated assets at build. Nothing hand-copied that could go stale.
