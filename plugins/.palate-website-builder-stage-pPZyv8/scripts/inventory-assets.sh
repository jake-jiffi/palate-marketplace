#!/usr/bin/env bash
# Inventory and classify raw brand assets at a source path.
# Usage: inventory-assets.sh <source-path>
# Prints a JSON summary the skill reads to plan the build.
set -euo pipefail
SRC="${1:?source path required}"
[ -d "$SRC" ] || { echo "source path not found: $SRC" >&2; exit 1; }

count_ext() { find "$SRC" -type f -iname "*.$1" 2>/dev/null | wc -l | tr -d ' '; }

fonts=$(( $(count_ext woff2) + $(count_ext woff) + $(count_ext ttf) + $(count_ext otf) ))
logos_svg=$(count_ext svg)
logos_png=$(count_ext png)
photos=$(( $(count_ext jpg) + $(count_ext jpeg) + $(count_ext avif) ))
pdfs=$(count_ext pdf)
copy_md=$(( $(count_ext md) + $(count_ext txt) ))

# Detect an existing brand skill / voice doc
existing_skill="none"
if find "$SRC" -type f -iname "*.md" 2>/dev/null | xargs grep -ilE "voice|tone of voice|brand guidelines" 2>/dev/null | head -1 | grep -q .; then
  existing_skill=$(find "$SRC" -type f -iname "*.md" 2>/dev/null | xargs grep -ilE "voice|tone of voice|brand guidelines" 2>/dev/null | head -1)
fi

cat <<JSON
{
  "source": "${SRC}",
  "fonts": ${fonts},
  "logosSvg": ${logos_svg},
  "logosPng": ${logos_png},
  "photography": ${photos},
  "brandPdfs": ${pdfs},
  "copyDocs": ${copy_md},
  "existingBrandSkill": "${existing_skill}",
  "missing": []
}
JSON
