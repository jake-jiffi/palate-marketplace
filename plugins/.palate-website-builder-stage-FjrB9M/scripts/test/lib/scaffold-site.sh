#!/usr/bin/env bash
# scripts/test/lib/scaffold-site.sh - stand up a real, installed copy of the scaffold.
#
# Four suites in this epic need the same thing: the template with its placeholders resolved,
# a stub brand package standing in for the client's, and node_modules present so `astro build`
# runs. Each one doing its own npm install costs minutes it does not buy anything with, so the
# first caller pays for the install and every caller after copies the result.
#
# THE CACHE HOLDS node_modules ONLY, and the source is laid down fresh every time. Caching the
# whole site was tried first and it silently served yesterday's src/: a suite that had just
# added a page built a tree that never contained it, and reported the page missing. npm links
# the `file:` brand stub with a RELATIVE symlink (../../brand-stub), so a cached node_modules
# resolves correctly in any destination that also carries the stub, which this always writes.
#
# Usage:  source this file, then `scaffold_site <dest-dir> [slug]`.
# Exit:   the function returns non-zero and prints why when the install or the copy fails, so
#         a caller can report UNPROVEN rather than a pass.

# The cache is keyed on the template's dependency list: change a dependency and the next run
# installs again rather than reusing a tree that no longer matches.
scaffold_cache_dir() { # <template-dir> <slug>
  local tpl="$1" key
  local slug="${2:-boardtest}"
  key="$(node -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    const p = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
    // The slug is in the key because the brand stub is named after it, so a tree installed for
    // one slug cannot satisfy another.
    const material = JSON.stringify([p.dependencies, p.devDependencies, p.overrides, process.argv[2]]);
    process.stdout.write(crypto.createHash("sha256").update(material).digest("hex").slice(0, 12));
  ' "$tpl" "$slug" 2>/dev/null)"
  [ -n "$key" ] || key="nokey"
  echo "${PALATE_TEST_SITE_CACHE:-${TMPDIR:-/tmp}/palate-scaffold-cache}/$key"
}

scaffold_site() { # <dest-dir> [slug]
  local dest="$1" slug="${2:-boardtest}" tpl cache
  tpl="$SCAFFOLD_TEMPLATE"
  cache="$(scaffold_cache_dir "$tpl" "$slug")"

  mkdir -p "$dest"
  cp -R "$tpl/." "$dest/" || { echo "scaffold_site: could not copy the template." >&2; return 2; }
  rm -rf "$dest/node_modules" "$dest/dist" "$dest/.astro"

  # The same substitutions bootstrap.sh makes, so the fixture is the scaffold a client gets.
  find "$dest" -type f \( -name '*.astro' -o -name '*.ts' -o -name '*.mjs' -o -name '*.json' \
    -o -name '*.css' -o -name '*.md' -o -name '*.txt' -o -name '*.tpl' -o -name '*.toml' -o -name '*.yml' \) -print0 \
    | xargs -0 perl -pi -e "
        s/\\{\\{SLUG\\}\\}/$slug/g; s/\\{\\{DOMAIN\\}\\}/$slug.example.com/g;
        s/\\{\\{CLIENT_NAME\\}\\}/Board Fixture/g;
        s{\\{\\{BRAND_VERSION\\}\\}}{file:./brand-stub}g;
        s/\\{\\{SUB\\}\\}/A fixture built to prove the boards/g;
        s/\\{\\{ONE_LINE_DESCRIPTION\\}\\}/A fixture built to prove the boards./g;
        s/\\{\\{HUMBLYTICS_SITE_ID\\}\\}/hb-fixture-1234/g;
        s/\\{\\{HEADING\\}\\}/Built to prove the boards/g;
        s/\\{\\{DESIGN_MODE_DATA\\}\\}/brand-provided/g;
        s/\\{\\{CTA_LABEL\\}\\}/See the work/g; s{\\{\\{CTA_HREF\\}\\}}{/contact}g;"

  mkdir -p "$dest/brand-stub"
  cat > "$dest/brand-stub/package.json" <<JSON
{ "name": "@palate-projects/$slug-brand", "version": "1.0.0", "type": "module",
  "main": "tailwind.preset.js",
  "exports": { "./tailwind.preset": "./tailwind.preset.js", "./tokens.css": "./tokens.css", "./fonts.css": "./fonts.css" } }
JSON
  cat > "$dest/brand-stub/tailwind.preset.js" <<'JS'
export default {
  theme: {
    extend: {
      // `border` IS NOT OPTIONAL HERE. ContactForm.astro ships `border-brand-border` on three
      // inputs, so a stub without it built a fixture carrying three Critical phantom utilities
      // and the Stop hook blocked on every suite that uses this helper. A real brand package
      // defines it; the stub has to as well, or the fixture is dirty for a reason no client
      // build has.
      colors: { brand: { bg: "#f7f5ee", text: "#1c1b19", accent: "#2f5d50", muted: "#6d6b65", inverse: "#ffffff", border: "#d8d4c6" } },
      fontFamily: { display: ["Georgia", "serif"], body: ["Helvetica", "Arial", "sans-serif"] },
      borderRadius: { brand: "4px" },
    },
  },
};
JS
  cat > "$dest/brand-stub/tokens.css" <<'CSS'
:root {
  --brand-bg: #f7f5ee;
  --brand-text: #1c1b19;
  --brand-muted: #6d6b65;
  --brand-accent: #2f5d50;
  --brand-inverse: #ffffff;
  --brand-border: #d8d4c6;
  --brand-bg-inverse: #1c1b19;
  --brand-font-display: Georgia, "Times New Roman", serif;
  --brand-font-body: Helvetica, Arial, sans-serif;
  --brand-radius: 4px;
}
CSS
  printf '/* the stub ships no webfont; the system stack renders */\n' > "$dest/brand-stub/fonts.css"

  if [ -d "$cache/node_modules" ]; then
    cp -R "$cache/node_modules" "$dest/node_modules" || {
      echo "scaffold_site: could not copy the cached node_modules." >&2; return 2; }
    return 0
  fi

  ( cd "$dest" && npm install --no-audit --no-fund ) > "$dest/.install.log" 2>&1 || {
    echo "scaffold_site: npm install failed. Last lines:" >&2
    tail -8 "$dest/.install.log" >&2
    return 2
  }

  mkdir -p "$cache"
  cp -R "$dest/node_modules" "$cache/node_modules" 2>/dev/null || true
  return 0
}
