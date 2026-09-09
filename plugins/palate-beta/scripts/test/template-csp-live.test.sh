#!/usr/bin/env bash
# Proves the template's Content-Security-Policy against a REAL build in a REAL browser.
#
# template-headers.test.sh reads the policy. This one enforces it: the scaffold is built with
# a stub brand package, served with the headers vercel.json actually carries, and every route
# is opened in Chromium while `securitypolicyviolation` is recorded.
#
# WHY THE VIOLATION LISTENER AND NOT JUST THE CONSOLE. verify-rendered IGNORES console errors
# mentioning the analytics and Turnstile hosts, as third-party noise. Those are precisely the
# two hosts a CSP breaks, so a clean console alone would prove nothing about them.
#
# WHAT THIS CAUGHT WHEN IT WAS WRITTEN, and neither was visible in the source: the Vercel
# adapter injects an inline analytics bootstrap, and Astro inlined ContactForm's validation
# script into the page. A strict script-src blocked both, which would have shipped a template
# whose contact form silently stops validating. It also blocked the verifier's own axe
# injection, so accessibility went UNMEASURED on every route.
#
# Slow by construction (an npm install, a build, three browser passes), so scripts/test/run.sh
# skips it under --fast. Exit 2 with a reason wherever it cannot measure.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
TPL="$ROOT/templates/astro-project"
PORT="${TEMPLATE_CSP_PORT:-8931}"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

command -v node >/dev/null 2>&1 || { echo "template-csp-live: node is required. NOT a pass." >&2; exit 2; }
command -v npm  >/dev/null 2>&1 || { echo "template-csp-live: npm is required to build the template. NOT a pass." >&2; exit 2; }
[ -d "$ROOT/scripts/reference-capture/node_modules/playwright" ] || {
  echo "template-csp-live: playwright is not installed (scripts/reference-capture/setup.sh). The policy is UNPROVEN, not clean." >&2; exit 2; }

TMP="$(mktemp -d)"
SITE="$TMP/site"
cleanup() {
  if [ -n "${SRV_PID:-}" ]; then kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# ---- 1. A REAL BUILD, with a stub brand package standing in for the client's ------------
cp -R "$TPL/." "$SITE/"
rm -rf "$SITE/node_modules" "$SITE/dist" "$SITE/.astro"
find "$SITE" -type f \( -name '*.astro' -o -name '*.ts' -o -name '*.mjs' -o -name '*.json' \
  -o -name '*.css' -o -name '*.md' -o -name '*.txt' -o -name '*.tpl' -o -name '*.toml' -o -name '*.yml' \) -print0 \
  | xargs -0 perl -pi -e '
      s/\{\{SLUG\}\}/csptest/g; s/\{\{DOMAIN\}\}/csptest.example.com/g; s/\{\{CLIENT_NAME\}\}/CSP Test/g;
      s{\{\{BRAND_VERSION\}\}}{file:./brand-stub}g; s/\{\{SUB\}\}/A test of the policy/g;
      s/\{\{ONE_LINE_DESCRIPTION\}\}/A template built to prove the policy./g;
      s/\{\{HUMBLYTICS_SITE_ID\}\}/hb-test-1234/g; s/\{\{HEADING\}\}/Built to prove the policy/g;
      s/\{\{DESIGN_MODE_DATA\}\}/brand-provided/g; s/\{\{CTA_LABEL\}\}/See the work/g; s{\{\{CTA_HREF\}\}}{/contact}g;'

mkdir -p "$SITE/brand-stub"
cat > "$SITE/brand-stub/package.json" <<'JSON'
{ "name": "@palate-projects/csptest-brand", "version": "1.0.0", "type": "module",
  "main": "tailwind.preset.js",
  "exports": { "./tailwind.preset": "./tailwind.preset.js", "./tokens.css": "./tokens.css", "./fonts.css": "./fonts.css" } }
JSON
cat > "$SITE/brand-stub/tailwind.preset.js" <<'JS'
export default { theme: { extend: { colors: { brand: { bg: "#f7f5ee", text: "#1c1b19", accent: "#2f5d50", muted: "#6d6b65" } } } } };
JS
printf ':root { --brand-bg: #f7f5ee; --brand-text: #1c1b19; --brand-accent: #2f5d50; }\n' > "$SITE/brand-stub/tokens.css"
printf '/* the stub ships no webfont; the system stack renders */\n' > "$SITE/brand-stub/fonts.css"

( cd "$SITE" && npm install --no-audit --no-fund >"$TMP/install.log" 2>&1 ) || {
  echo "template-csp-live: npm install failed, so the policy is UNPROVEN. Last lines:" >&2
  tail -5 "$TMP/install.log" >&2; exit 2; }
( cd "$SITE" && ./node_modules/.bin/astro build >"$TMP/build.log" 2>&1 ) || {
  echo "template-csp-live: the template did not build, so the policy is UNPROVEN. Last lines:" >&2
  tail -10 "$TMP/build.log" >&2; exit 2; }
[ -f "$SITE/dist/client/index.html" ] && ok "the template builds" || { bad "the build produced no index.html"; exit 1; }

# ---- 2. SERVE IT with the headers vercel.json actually carries --------------------------
cat > "$TMP/serve.mjs" <<'JS'
// The host, in miniature: the same headers vercel.json serves, over the real build.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2]);
const vercelJson = JSON.parse(await readFile(path.join(process.argv[3], "vercel.json"), "utf8"));
const rule = (vercelJson.headers || []).find((h) => h.source === "/(.*)") || { headers: [] };
const headers = Object.fromEntries((rule.headers || []).map((h) => [h.key, h.value]));
if (!headers["Content-Security-Policy"]) {
  console.error("serve: vercel.json carries no CSP; refusing to serve a policy-free page as proof.");
  process.exit(2);
}
// The controls: drop a required host so a clean run under the real policy means something.
if (process.env.CSP_MODE === "break") {
  headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(/ https:\/\/app\.humblytics\.com/g, "");
}
if (process.env.CSP_MODE === "break-sanity") {
  headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(/ https:\/\/[^ ;]*sanity\.io/g, "");
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  // Vercel serves the web-analytics script itself. A static server does not, and a 404 there
  // reads as a console error the policy did not cause.
  if (url.pathname === "/_vercel/insights/script.js") {
    res.writeHead(200, { ...headers, "Content-Type": "text/javascript" });
    res.end("/* stub of the platform script */\n");
    return;
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  try { if ((await stat(p)).isDirectory()) p = path.join(p, "index.html"); }
  catch { p = p.endsWith("/") ? path.join(p, "index.html") : p + "/index.html"; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { ...headers, "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>404</title><h1>Not found</h1>");
  }
}).listen(Number(process.env.PORT), () => console.log("READY"));
JS

cat > "$TMP/probe.mjs" <<'JS'
// Every CSP violation the PAGE raises, which is the only way to see one on a host
// verify-rendered ignores as third-party noise.
// The capture engine owns the browser runtime, exactly as verify-rendered.sh does. This file
// lives in a temp directory, so the module is imported by absolute path rather than by name:
// NODE_PATH does not apply to ES modules.
const { chromium } = await import(process.env.PLAYWRIGHT_ENTRY);
const base = process.argv[2];
const routes = (process.argv[3] || "/").split(",");
const browser = await chromium.launch();
const ctx = await browser.newContext();
const violations = [];
// The third-party hosts the page actually reached. A lane that asserts "no violation" on a
// page that requested nothing has measured nothing, so the hosts are reported too.
const hosts = new Set();
for (const route of routes) {
  const page = await ctx.newPage();
  page.on("request", (r) => {
    try {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && !u.hostname.startsWith("localhost")) hosts.add(u.hostname);
    } catch { /* not a URL we can read */ }
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push({ directive: e.effectiveDirective, uri: e.blockedURI }));
  });
  await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  for (const v of await page.evaluate(() => window.__csp || [])) violations.push({ route, ...v });
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ violations, hosts: [...hosts].sort() }));
JS

serve() { # <mode>
  [ -n "${SRV_PID:-}" ] && { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; }
  CSP_MODE="$1" PORT="$PORT" node "$TMP/serve.mjs" "$SITE/dist/client" "$SITE" > "$TMP/serve.log" 2>&1 &
  SRV_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    grep -q READY "$TMP/serve.log" 2>/dev/null && return 0
    sleep 0.5
  done
  echo "template-csp-live: the preview server never came up:" >&2; cat "$TMP/serve.log" >&2; exit 2
}
export PLAYWRIGHT_ENTRY="$ROOT/scripts/reference-capture/node_modules/playwright/index.mjs"

# ---- 3. THE REAL POLICY: no page raises a violation -------------------------------------
serve enforce
v="$(node "$TMP/probe.mjs" "http://localhost:$PORT" /,/contact,/blog 2>"$TMP/probe.err")"
[ -n "$v" ] || { echo "template-csp-live: the probe returned nothing:" >&2; cat "$TMP/probe.err" >&2; exit 2; }
n="$(printf '%s' "$v" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).violations.length))')"
[ "$n" = "0" ] && ok "the built template raises NO CSP violation under the policy it ships" \
  || bad "the policy blocks $n thing(s) the template loads: $v"

# ---- 4. THE CONTROL: the probe must fire when the policy is wrong -----------------------
# Without this, a clean result above could mean the listener never worked.
serve break
v="$(node "$TMP/probe.mjs" "http://localhost:$PORT" / 2>/dev/null)"
case "$v" in
  *humblytics*) ok "removing a required host makes the probe fire, so a clean run means something" ;;
  *) bad "the probe stayed silent with a required host removed; it is measuring nothing ($v)" ;;
esac

# ---- 5. AND THE RENDERED GATE runs clean under the enforced policy ----------------------
serve enforce
out="$TMP/verify.txt"
bash "$ROOT/scripts/verify-rendered.sh" "http://localhost:$PORT" --routes /,/contact,/blog --no-vitals > "$out" 2>&1
rc=$?
[ "$rc" = "3" ] && { echo "template-csp-live: no browser available for verify-rendered. UNPROVEN." >&2; exit 2; }
c="$(grep -c 'console error\|request failed\|page error' "$out")"
[ "$c" = "0" ] && ok "verify-rendered reports no console error under the enforced policy" \
  || { bad "$c console/request error(s) under the policy"; grep -m3 'console error\|request failed' "$out" | sed 's/^/      /'; }
a="$(grep -c 'accessibility scan could not run' "$out")"
[ "$a" = "0" ] && ok "the accessibility scan still runs under the policy" \
  || bad "the policy blocks the verifier's own axe injection, so accessibility is UNMEASURED on $a route-viewport(s)"

# ---- 6. THE CMS BUILD, which needs hosts the base policy deliberately does not carry ----
# add-sanity.sh mounts the Studio at /studio and turns on the visual-editing overlay, both of
# which run in the browser. This lane is the reason that patch exists.
#
# WHAT IS NOT PROVED HERE. The overlay itself needs PUBLIC_SANITY_VISUAL_EDITING_ENABLED=true,
# which makes every route render on demand (astro.cms.mjs sets route.prerender = false), and a
# static file server cannot serve a server build. The Studio route IS served, it is the same
# Sanity client against the same hosts, and it is what a signing-in editor loads first.
if ! command -v jq >/dev/null 2>&1; then
  echo "skip - the CMS lane needs jq, which add-sanity.sh requires. NOT counted as a pass." >&2
else
  bash "$ROOT/scripts/add-sanity.sh" "$SITE" > "$TMP/add-sanity.out" 2>&1 || {
    echo "template-csp-live: add-sanity.sh failed, so the CMS policy is UNPROVEN:" >&2
    tail -5 "$TMP/add-sanity.out" >&2; exit 2; }
  grep -q "CSP extended" "$TMP/add-sanity.out" && ok "add-sanity extends the policy for the Studio" \
    || bad "add-sanity did not extend the policy: $(tail -2 "$TMP/add-sanity.out")"
  perl -pi -e 's/\{\{CLIENT_NAME\}\}/CSP Test/g' "$SITE/sanity.config.ts"
  ( cd "$SITE" && npm install --no-audit --no-fund >"$TMP/cms-install.log" 2>&1 ) || {
    echo "template-csp-live: the Sanity install failed, so the CMS policy is UNPROVEN." >&2
    tail -5 "$TMP/cms-install.log" >&2; exit 2; }
  ( cd "$SITE" && ./node_modules/.bin/astro build >"$TMP/cms-build.log" 2>&1 ) || {
    echo "template-csp-live: the CMS build failed, so the CMS policy is UNPROVEN." >&2
    tail -10 "$TMP/cms-build.log" >&2; exit 2; }
  [ -f "$SITE/dist/client/studio/index.html" ] && ok "the CMS build mounts the Studio at /studio" \
    || bad "the CMS build produced no /studio route, so this lane measures nothing"

  serve enforce
  v="$(node "$TMP/probe.mjs" "http://localhost:$PORT" /,/studio 2>/dev/null)"
  n="$(printf '%s' "$v" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).violations.length))')"
  [ "$n" = "0" ] && ok "the Studio raises NO CSP violation under the extended policy" \
    || bad "the extended policy still blocks $n thing(s) the Studio loads: $v"
  # And it really loaded: a lane that passes on a page which reached nothing proves nothing.
  case "$v" in
    *sanity.io*) ok "and the Studio actually reached Sanity, so the lane measured something" ;;
    *) bad "the Studio reached no Sanity host at all; this lane is inert ($v)" ;;
  esac

  # THE CONTROL: strip the Sanity hosts back out and the Studio must break again.
  serve break-sanity
  v="$(node "$TMP/probe.mjs" "http://localhost:$PORT" /studio 2>/dev/null)"
  case "$v" in
    *sanity.io*directive*|*directive*sanity.io*) ok "removing the Sanity hosts breaks the Studio, so the fix is load-bearing" ;;
    *) bad "the Studio raised no violation with the Sanity hosts removed; the lane is not measuring the policy ($v)" ;;
  esac
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
