#!/usr/bin/env bash
# Convert AVIF photography to JPG previews (for vision review and fallback),
# and kebab-case rename image files. Uses sips (macOS) or imagemagick.
# Usage: process-images.sh <dir>
set -euo pipefail
DIR="${1:?dir required}"

convert_avif() {
  local src="$1" out="${1%.*}.jpg"
  if command -v sips >/dev/null 2>&1; then
    sips -s format jpeg -Z 1200 "$src" --out "$out" >/dev/null 2>&1 || true
  elif command -v convert >/dev/null 2>&1; then
    convert "$src" -resize 1200x1200\> "$out" 2>/dev/null || true
  else
    echo "  warn: no converter for $src" >&2
  fi
}

kebab() {
  local f="$1" dir base ext newbase
  dir=$(dirname "$f"); base=$(basename "$f")
  ext="${base##*.}"; newbase="${base%.*}"
  newbase=$(printf '%s' "$newbase" | tr '[:upper:]' '[:lower:]' | tr -s ' _' '--' | sed -E 's/[^a-z0-9-]+//g; s/-+/-/g; s/^-+//; s/-+$//')
  local target="$dir/$newbase.$ext"
  [ "$f" != "$target" ] && mv "$f" "$target" 2>/dev/null || true
}

find "$DIR" -type f -iname "*.avif" 2>/dev/null | while read -r f; do convert_avif "$f"; done
find "$DIR" -type f \( -iname "*.svg" -o -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.avif" \) 2>/dev/null | while read -r f; do kebab "$f"; done
echo "image processing done for $DIR"
