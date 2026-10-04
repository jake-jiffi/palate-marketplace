#!/usr/bin/env bash
# Add the Sanity CMS to a scaffolded Palate project. The default scaffold ships
# with NO CMS, so run this ONLY when the build genuinely needs one: the client
# will edit their own copy, or content is collection-shaped (blog, case studies,
# menu, listings). A brochure site that changes twice a year does not need it,
# and carrying it costs ~850 packages.
#
#   Usage:  scripts/add-sanity.sh <project-dir>
#
# Safe to run at ANY point after Phase A - during the build, at Phase B
# provisioning, or months later in continue-mode. It is ADDITIVE and idempotent:
#
#   * it never edits astro.config.mjs or BaseLayout.astro (both are customised
#     per build). They already delegate to astro.cms.mjs and CmsVisualEditing
#     .astro, and this script REPLACES those two files wholesale.
#   * output stays "server" and every page keeps calling loadPage(), so NO page
#     is touched and nothing is rebuilt.
#
# After this, provision the Sanity project itself with scripts/provision-sanity.sh.
# See references/cms-and-draft-preview.md.
set -euo pipefail
PROJ="${1:?project dir}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="${SKILL_DIR}/templates/cms-sanity"

[ -d "$OVERLAY" ] || { echo "add-sanity: overlay not found at $OVERLAY" >&2; exit 1; }
[ -d "$PROJ" ]    || { echo "add-sanity: project dir not found at $PROJ" >&2; exit 1; }
[ -f "$PROJ/package.json" ] || { echo "add-sanity: $PROJ is not a project (no package.json)" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "add-sanity: jq is required" >&2; exit 1; }

# The seam must exist, or this is not a Palate scaffold (or it predates the
# opt-in CMS split) and the wholesale file swaps below would silently do nothing.
grep -q "cmsIntegrations" "$PROJ/astro.config.mjs" 2>/dev/null || {
  echo "add-sanity: $PROJ/astro.config.mjs does not spread ...cmsIntegrations(env)." >&2
  echo "  This project predates the opt-in CMS seam. Add these two lines by hand first:" >&2
  echo "    import { cmsIntegrations } from \"./astro.cms.mjs\";" >&2
  echo "    integrations: [ ...cmsIntegrations(env), /* existing */ ]" >&2
  exit 1
}

echo "adding Sanity -> $PROJ"

# 1. The two seam files the base ships as no-ops, replaced wholesale.
cp "$OVERLAY/astro.cms.mjs"                        "$PROJ/astro.cms.mjs"
cp "$OVERLAY/src/components/CmsVisualEditing.astro" "$PROJ/src/components/CmsVisualEditing.astro"

# 2. The files that gain a Sanity-backed implementation. loadPage() keeps its
#    signature, so every caller is unaffected.
cp "$OVERLAY/src/lib/load.ts"         "$PROJ/src/lib/load.ts"
cp "$OVERLAY/src/env.d.ts"            "$PROJ/src/env.d.ts"
cp "$OVERLAY/src/pages/api/contact.ts" "$PROJ/src/pages/api/contact.ts"

# 3. The Sanity-only files: Studio config, schemas, image helper, seed scripts.
mkdir -p "$PROJ/src/sanity/schema" "$PROJ/src/lib" "$PROJ/scripts"
cp "$OVERLAY/sanity.config.ts"        "$PROJ/sanity.config.ts"
cp "$OVERLAY/src/lib/sanity.ts"       "$PROJ/src/lib/sanity.ts"
cp "$OVERLAY"/src/sanity/schema/*.ts  "$PROJ/src/sanity/schema/"
cp "$OVERLAY"/scripts/*.mjs           "$PROJ/scripts/"

# 4. Merge deps + scripts. The project's own values WIN on conflict, so a build
#    that pinned something deliberately is never silently downgraded.
jq -s '.[0] as $o | .[1]
       | .dependencies    = (($o.dependencies    // {}) + (.dependencies    // {}))
       | .devDependencies = (($o.devDependencies // {}) + (.devDependencies // {}))
       | .scripts         = (($o.scripts         // {}) + (.scripts         // {}))' \
   "$OVERLAY/deps.json" "$PROJ/package.json" > "$PROJ/package.json.tmp"
mv "$PROJ/package.json.tmp" "$PROJ/package.json"

# 5. THE CONTENT-SECURITY-POLICY. The base template's policy lists only what the base
#    template loads, and the Studio and the visual-editing overlay run in the BROWSER and
#    talk to Sanity, so without this a CMS build ships a Studio that cannot sign in.
#
#    MEASURED, not guessed: a real build of this overlay served under the base policy raised
#    connect-src violations for `https://<projectId>.api.sanity.io` (users/me, check/cors) and
#    font-src violations for the Studio's own webfont on design-system-static.sanity.io, a host
#    nobody would have listed from reading the code. The CDN host is the one the client builds
#    itself when `useCdn` is true, which src/lib/load.ts turns on for a production CMS build.
#
#    Patches whichever file this project carries: vercel.json on Vercel, public/_headers on
#    Cloudflare (switch-host-cloudflare.sh deletes vercel.json). Idempotent, and loud rather
#    than silent when there is no policy to extend.
CSP_CONNECT="https://*.api.sanity.io https://*.apicdn.sanity.io https://api.sanity.io https://cdn.sanity.io"
CSP_FONT="https://design-system-static.sanity.io"

CSP_PATCH="$(mktemp -t palate-csp-XXXXXX).mjs"
cat > "$CSP_PATCH" <<'CSPJS'
// Add hosts to named directives of a Content-Security-Policy, in place, once.
// argv: <file> <kind: vercel|headers> <"directive=host host"...>
import { readFileSync, writeFileSync } from "node:fs";
const [file, kind, ...pairs] = process.argv.slice(2);
const wanted = pairs.map((p) => {
  const i = p.indexOf("=");
  return { directive: p.slice(0, i), hosts: p.slice(i + 1).split(" ").filter(Boolean) };
});

/** Add the missing hosts to one directive. A directive that is absent is ADDED, because a
 *  missing font-src falls back to default-src 'self' and blocks the Studio's webfont. */
function extend(csp) {
  const parts = csp.split(";").map((d) => d.trim()).filter(Boolean);
  let changed = false;
  for (const { directive, hosts } of wanted) {
    const at = parts.findIndex((d) => d.split(/\s+/)[0] === directive);
    if (at === -1) {
      parts.push([directive, "'self'", ...hosts].join(" "));
      changed = true;
      continue;
    }
    const missing = hosts.filter((h) => !parts[at].split(/\s+/).includes(h));
    if (!missing.length) continue;
    parts[at] = parts[at] + " " + missing.join(" ");
    changed = true;
  }
  return { csp: parts.join("; "), changed };
}

const src = readFileSync(file, "utf8");
if (kind === "vercel") {
  const json = JSON.parse(src);
  const rule = (json.headers || []).find((h) => h.source === "/(.*)");
  const header = rule && (rule.headers || []).find((h) => h.key === "Content-Security-Policy");
  if (!header) { console.error("NO_CSP"); process.exit(3); }
  const out = extend(header.value);
  if (!out.changed) { console.error("ALREADY"); process.exit(0); }
  header.value = out.csp;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
} else {
  const line = src.split("\n").find((l) => /^\s*Content-Security-Policy:/.test(l));
  if (!line) { console.error("NO_CSP"); process.exit(3); }
  const value = line.replace(/^\s*Content-Security-Policy:\s*/, "");
  const out = extend(value);
  if (!out.changed) { console.error("ALREADY"); process.exit(0); }
  writeFileSync(file, src.replace(line, line.slice(0, line.indexOf("Content-Security-Policy:")) + "Content-Security-Policy: " + out.csp));
}
console.error("PATCHED");
CSPJS

csp_target=""; csp_kind=""
if   [ -f "$PROJ/vercel.json" ];      then csp_target="$PROJ/vercel.json";      csp_kind="vercel"
elif [ -f "$PROJ/public/_headers" ];  then csp_target="$PROJ/public/_headers";  csp_kind="headers"
fi

if [ -z "$csp_target" ]; then
  echo "add-sanity: no vercel.json and no public/_headers in $PROJ, so the CSP was NOT extended." >&2
  echo "  The Studio at /studio will not be able to reach Sanity if a policy is served another way." >&2
  echo "  Add to connect-src: $CSP_CONNECT" >&2
  echo "  Add to font-src:    $CSP_FONT" >&2
else
  # The patcher's verdict comes back on stderr, so nothing is written into the client's repo
  # to find out what happened.
  set +e
  csp_said="$(node "$CSP_PATCH" "$csp_target" "$csp_kind" "connect-src=$CSP_CONNECT" "font-src=$CSP_FONT" 2>&1 >/dev/null)"
  csp_rc=$?
  set -e
  case "$csp_rc" in
    0) case "$csp_said" in
         *PATCHED*) echo "  CSP extended in $(basename "$csp_target") for the Studio and the visual-editing overlay" ;;
         *)         echo "  CSP already carries the Sanity hosts" ;;
       esac ;;
    3) echo "add-sanity: $csp_target carries NO Content-Security-Policy, so nothing was extended." >&2
       echo "  If a policy is served another way, add to connect-src: $CSP_CONNECT" >&2
       echo "  and to font-src: $CSP_FONT" >&2 ;;
    *) echo "add-sanity: could not patch the CSP in $csp_target (exit $csp_rc): $csp_said" >&2
       echo "  The Studio at /studio may be blocked from reaching Sanity." >&2 ;;
  esac
fi
rm -f "$CSP_PATCH"

# 6. Document the env vars (idempotent - only if not already there).
if [ -f "$PROJ/.env.example" ] && ! grep -q "SANITY_PROJECT_ID" "$PROJ/.env.example"; then
  cat >> "$PROJ/.env.example" <<'ENVVARS'

# --- Sanity (added by scripts/add-sanity.sh) ---
# Build-time vars - @sanity/astro reads these at `astro build`, so CI must pass
# them to the build step (the scaffold's ci.yml already does).
SANITY_PROJECT_ID=
SANITY_DATASET=production
SANITY_API_READ_TOKEN=

# "true" on the PREVIEW environment only - turns on click-to-edit overlays.
PUBLIC_SANITY_VISUAL_EDITING_ENABLED=false

# Runtime - the EDITOR token, used by /api/contact and the seed scripts.
SANITY_API_WRITE_TOKEN=
ENVVARS
fi

echo "SANITY_ADDED: $PROJ"
echo "Next:"
echo "  cd $PROJ && npm install     # pulls the Sanity tree (~850 packages)"
echo "  npm run build               # confirm it still compiles"
echo "  scripts/provision-sanity.sh <slug> <display-name> <site-domain>   # Phase B"
echo "  the Studio is embedded at /studio - there is no separate Studio to deploy"
