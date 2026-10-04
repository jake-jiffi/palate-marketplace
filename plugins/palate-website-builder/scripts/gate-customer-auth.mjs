#!/usr/bin/env node
/**
 * gate-customer-auth.mjs - is the Shopify Customer Account API wired up safely?
 *
 * ===================== WHY THIS EXISTS =====================
 *
 * There is no correct Astro reference implementation to copy. That is the whole problem.
 * Nine harvested Astro+Shopify repositories were searched for `code_verifier` and
 * `openid-configuration` and NONE of them implements this API. What people copy instead is
 * wrong in ways that pass review:
 *
 *   - `zeon-studio/storeplate`, a commercially sold template still maintained on Astro 7,
 *     sets `token=...; Path=/; SameSite=Lax` under a comment that SAYS HttpOnly. No HttpOnly,
 *     no Secure, and the same token is returned in the JSON body as well.
 *   - Shopify's OWN tutorial returns the access token to the browser and queries GraphQL from
 *     a useEffect. It is also built as an app client, the one client type that never receives
 *     a refresh token, so copying it yields a session that dies at 60 minutes with no
 *     server-side recovery.
 *   - Shopify's own API reference puts the `code_verifier` in `localStorage`.
 *   - The reference documents the GraphQL endpoint as `{shop}/customer/api/{v}/graphql`.
 *     No live store probed matches it: Polaroid serves
 *     `shopify.com/11628964/account/customer/api/...` and Allbirds
 *     `accounts.allbirds.com/customer/api/...`. Discovery at runtime is mandatory.
 *   - Discovery must hit the SHOPIFY-SERVED domain. Once the Astro app owns the apex,
 *     `yourbrand.com/.well-known/openid-configuration` returns YOUR 404 page, which is HTML,
 *     which fails `.json()` with a parse error rather than an HTTP error. Verified live on
 *     gymshark.com (a real Astro-on-Shopify store at scale).
 *   - `origin` and `user-agent` are required on the token and GraphQL endpoints. Browsers set
 *     both; Node's fetch sets neither. Code that works in a browser console returns a 401 in
 *     an Astro route, and the 401 reads like a bad token.
 *
 * ===================== HOW IT BEHAVES =====================
 *
 * SILENT unless this build actually has a customer-account surface (`src/pages/account/`, or a
 * CUSTOMER_ACCOUNT_CLIENT_ID in the environment or in source). Most merchants should NOT build
 * this at all: Shopify's hosted account pages on `accounts.theirbrand.com` are free, branded,
 * and the buyer cannot tell the difference. See commerce-doctrine.md §6g for when to build.
 *
 *   exit 0  clean, or no customer-account surface
 *   exit 1  findings
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const argv = process.argv.slice(2);
const dir = resolve(argv.find((a) => !a.startsWith("--")) ?? ".");
const JSON_OUT = argv.includes("--json");

const findings = [];
const passes = [];
const add = (id, msg, fix) => findings.push({ id, msg, fix });
const ok = (id) => passes.push(id);
const has = (p) => existsSync(join(dir, p));

function walk(d, out = []) {
  let ents = [];
  try { ents = readdirSync(d); } catch { return out; }
  for (const e of ents) {
    if (e === "node_modules" || e === "dist" || e === ".git" || e === ".vercel") continue;
    const p = join(d, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(astro|ts|tsx|js|mjs|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

const src = walk(join(dir, "src"));
const files = src.map((f) => {
  let t = ""; try { t = readFileSync(f, "utf8"); } catch { /* unreadable */ }
  // Comments are not code. A doc block naming a trap must not be read as committing it.
  const code = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return { f, t, code };
});
const all = files.map((x) => x.code).join("\n");
const rel = (f) => relative(dir, f);

/* ---------------------------------------------------------------- is this build in scope? */

const accountFiles = files.filter((x) => /src\/pages\/account\//.test(x.f.replace(/\\/g, "/")));
const configured = /CUSTOMER_ACCOUNT_CLIENT_ID|customer_account_api|customerAccountApi/i.test(all);
if (!accountFiles.length && !configured && !process.env.CUSTOMER_ACCOUNT_CLIENT_ID) {
  const out = { ok: true, scope: "none", findings: [], passes: [] };
  console.log(JSON_OUT ? JSON.stringify(out, null, 2)
    : "gate-customer-auth: no customer-account surface in this build, nothing to check.");
  process.exit(0);
}

/* ---------------------------------------------------------------- C1. on-demand routes */

// A baked login route serves ONE `state` and ONE `code_challenge` to every visitor, which
// defeats both CSRF protection and PKCE while looking completely normal.
const serverOutput = /output:\s*["']server["']/.test(
  ["astro.config.mjs", "astro.config.ts", "astro.config.js"].map((f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } }).join("\n"));
const baked = accountFiles.filter((x) => !/prerender\s*=\s*false/.test(x.code));
if (accountFiles.length && !serverOutput && baked.length) {
  add("C1-account-route-prerendered",
    `Account route(s) are not on-demand: ${baked.map((x) => rel(x.f)).join(", ")}.`,
    "A prerendered login route bakes ONE state and ONE code_challenge into HTML served to every visitor, so CSRF protection and PKCE are both defeated while the page looks fine. Export `prerender = false` on every route under src/pages/account/.");
} else ok("C1-account-route-prerendered");

/* ---------------------------------------------------------------- C2. the cookie flags */

// The storeplate bug exactly: a comment claiming HttpOnly over a cookie that has neither
// HttpOnly nor Secure.
const cookieSets = [];
for (const { f, code } of files) {
  // Capture to the END of the call, not the first ")": a nested call like seal(s) in
  // `cookies.set("x", seal(s), { httpOnly: true })` would otherwise truncate the match before
  // the options object and report a correct cookie as leaky.
  for (const m of code.matchAll(/cookies\.set\(\s*([`"'][^`"']*[`"']|[A-Za-z_$][\w$]*)[\s\S]{0,400}?\)\s*;/g)) {
    cookieSets.push({ f, name: m[1], body: m[0] });
  }
  for (const m of code.matchAll(/["'`]Set-Cookie["'`]\s*,\s*[`"'][^`"']*[`"']/gi)) {
    cookieSets.push({ f, name: m[0], body: m[0] });
  }
}
const AUTHISH = /token|session|verifier|nonce|state|auth/i;
const authish = cookieSets.filter((c) => AUTHISH.test(c.name) || AUTHISH.test(c.body));
const leaky = authish.filter((c) => !(/httpOnly\s*:\s*true|HttpOnly/i.test(c.body) && /secure\s*:\s*true|Secure/i.test(c.body)));
if (authish.length && leaky.length) {
  add("C2-auth-cookie-not-httponly",
    `An auth cookie is set without both HttpOnly and Secure: ${[...new Set(leaky.map((c) => rel(c.f)))].join(", ")}.`,
    "This is the shipped-template bug verbatim: a comment claiming HttpOnly over `token=...; Path=/; SameSite=Lax`, which any script on the page can read. An access or refresh token in a readable cookie is a session anyone with an XSS can take. Set httpOnly AND secure.");
} else ok("C2-auth-cookie-not-httponly");

/* ---------------------------------------------------------------- C3. SameSite=Strict */

// Strict is not sent on the top-level navigation BACK from Shopify's hosted login, so the
// state cookie is missing exactly when the callback needs it: an infinite login loop.
const strict = authish.filter((c) => /sameSite\s*:\s*["']strict["']|SameSite=Strict/i.test(c.body));
if (strict.length) {
  add("C3-auth-cookie-samesite-strict",
    `An auth cookie uses SameSite=Strict: ${[...new Set(strict.map((c) => rel(c.f)))].join(", ")}.`,
    "The buyer returns from Shopify's hosted login by top-level navigation, and a Strict cookie is NOT sent on it. The state and verifier cookies are therefore absent at the callback, every time, and the buyer loops back to login. Use Lax.");
} else ok("C3-auth-cookie-samesite-strict");

/* ---------------------------------------------------------------- C4. state comparison */

const callback = files.filter((x) => /account\/callback/.test(x.f.replace(/\\/g, "/")));
if (callback.length) {
  const compares = callback.some((x) =>
    /state/.test(x.code) && /(===|!==|!=|==|\.localeCompare|timingSafeEqual)/.test(x.code));
  if (!compares) {
    add("C4-callback-state-unchecked",
      `The callback route never compares the returned state: ${callback.map((x) => rel(x.f))[0]}.`,
      "state is the CSRF defence for the whole flow. Without comparing the returned value against the one you stored, an attacker can complete the callback with their own authorisation code and log the victim into the ATTACKER's account. Compare, and reject on mismatch.");
  } else ok("C4-callback-state-unchecked");
} else ok("C4-callback-state-unchecked");

/* ---------------------------------------------------------------- C5. PKCE completed */

if (/code_challenge/.test(all)) {
  const s256 = /code_challenge_method\s*[=:]\s*["'`]?S256/.test(all);
  const verifierSent = /code_verifier/.test(all);
  if (!s256 || !verifierSent) {
    add("C5-pkce-incomplete",
      `PKCE is declared but not completed (${!s256 ? "no S256 method" : "no code_verifier on the exchange"}).`,
      "A code_challenge with no verifier sent at the token exchange is PKCE theatre: the authorisation code is interceptable exactly as it would be without PKCE, and the flow still works, so nothing reveals it. Send the verifier and declare S256.");
  } else ok("C5-pkce-incomplete");
} else ok("C5-pkce-incomplete");

/* ---------------------------------------------------------------- C6. hardcoded endpoint */

// The documented format matches NO live store probed.
if (/["'`][^"'`]*\/customer\/api\/[^"'`]*["'`]/.test(all)) {
  add("C6-endpoint-hardcoded",
    "The Customer Account GraphQL endpoint is written as a literal string.",
    "The reference documents `{shop}/customer/api/{version}/graphql` and NO live store matches it: one serves shopify.com/<id>/account/customer/api/..., another accounts.<brand>.com/customer/api/.... Read the endpoint from /.well-known/openid-configuration at runtime. Hardcoding it is one of the two commonest reported failures.");
} else ok("C6-endpoint-hardcoded");

/* ---------------------------------------------------------------- C7. discovery domain */

// Once the Astro app owns the apex, discovery against the public origin returns YOUR 404 page,
// which is HTML, which fails .json() with a parse error rather than an HTTP error.
const discovery = files.filter((x) => /openid-configuration/.test(x.code));
if (discovery.length) {
  const wrongHost = discovery.filter((x) =>
    /(PUBLIC_[A-Z_]*(?:SITE|ORIGIN|URL|DOMAIN)|Astro\.site|Astro\.url\.origin|site\.origin)[^\n]{0,80}openid-configuration|openid-configuration[^\n]{0,80}(Astro\.site|Astro\.url\.origin)/.test(x.code));
  if (wrongHost.length) {
    add("C7-discovery-on-own-domain",
      `Discovery is fetched from the storefront's own origin: ${wrongHost.map((x) => rel(x.f))[0]}.`,
      "Once your app owns the primary domain, /.well-known/openid-configuration hits YOUR server and returns YOUR 404 page. That is HTML, so it fails .json() with a parse error rather than an HTTP error, and the message points nowhere near the cause. Verified live: gymshark.com returns their Astro 404, gymshark.myshopify.com returns the JSON. Discover against the Shopify-served domain, kept in its own env var.");
  } else ok("C7-discovery-on-own-domain");
} else if (accountFiles.length && !/authorization_endpoint|token_endpoint/.test(all)) {
  add("C7-discovery-on-own-domain",
    "No OIDC discovery anywhere: the endpoints must be hardcoded.",
    "Every OIDC endpoint is per-shop and two live stores disagree with the documented format. Fetch /.well-known/openid-configuration from the Shopify-served domain and read authorization_endpoint, token_endpoint and logout from it.");
} else ok("C7-discovery-on-own-domain");

/* ---------------------------------------------------------------- C8. the two headers */

const tokenCalls = files.filter((x) => /token_endpoint|\/oauth\/token|grant_type/.test(x.code) && /fetch\s*\(/.test(x.code));
if (tokenCalls.length) {
  const missing = tokenCalls.filter((x) => !(/["'`]origin["'`]\s*:/i.test(x.code) && /["'`]user-agent["'`]\s*:/i.test(x.code)));
  if (missing.length) {
    add("C8-missing-origin-user-agent",
      `Server-side auth calls omit the origin and/or user-agent header: ${missing.map((x) => rel(x.f))[0]}.`,
      "Shopify returns 401 invalid_token without `origin` and 403 'You do not have permission to access this website' without `user-agent`. Browsers set both automatically and Node's fetch sets NEITHER, so the same code works pasted into a console and fails in an Astro route, with a 401 that reads like a bad token. Set both explicitly, and register the origin in the Customer Account API settings.");
  } else ok("C8-missing-origin-user-agent");
} else ok("C8-missing-origin-user-agent");

/* ---------------------------------------------------------------- C9. tokens in the browser */

// Shopify's own tutorial's defect: the access token returned to the client.
const clientLeak = files.filter((x) => {
  const island = /client:(load|idle|visible|only|media)/.test(x.code) || /define:vars\s*=\s*\{[^}]*token/i.test(x.code);
  const bodyLeak = /src\/pages\//.test(x.f.replace(/\\/g, "/")) &&
    /(JSON\.stringify|Response)\s*\([^)]{0,200}\b(access_?[Tt]oken|refresh_?[Tt]oken|id_?[Tt]oken)\b/.test(x.code);
  return (island && /\b(access_?[Tt]oken|refresh_?[Tt]oken|id_?[Tt]oken)\b/.test(x.code)) || bodyLeak;
});
if (clientLeak.length) {
  add("C9-token-reaches-browser",
    `A customer token is reachable from the browser: ${[...new Set(clientLeak.map((x) => rel(x.f)))].join(", ")}.`,
    "Shopify's own tutorial does this and it is written for a client-side SPA. With Astro you have a server: the access, refresh and id tokens belong in server-side session state or a sealed HttpOnly cookie, never in a hydrated island's props, define:vars, or a JSON response body.");
} else ok("C9-token-reaches-browser");

/* ---------------------------------------------------------------- C10. web storage */

if (/(localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*["'`][^"'`]*(verifier|token|nonce|state)/i.test(all)) {
  add("C10-secrets-in-web-storage",
    "A verifier, token or nonce is written to localStorage or sessionStorage.",
    "Shopify's API reference sample does exactly this (`localStorage.setItem('code-verifier', ...)`) because it is written for an SPA with no server. Web storage is readable by every script on the origin, so this converts any XSS into full account takeover. Use an HttpOnly cookie with a ten-minute life.");
} else ok("C10-secrets-in-web-storage");

/* ---------------------------------------------------------------- C11. PUBLIC_ secrets */

if (/PUBLIC_[A-Z_]*(CLIENT_SECRET|SESSION_SECRET|SECRET)/.test(all)) {
  add("C11-secret-is-public",
    "A client secret or session secret is read from a PUBLIC_ variable.",
    "Astro inlines every PUBLIC_ variable into the client bundle at build time, so the secret ships to every visitor and cannot be rotated without rebuilding. Drop the prefix and read it server-side only.");
} else ok("C11-secret-is-public");

/* ---------------------------------------------------------------- C12. logout */

const logout = files.filter((x) =>
  /account\/logout/.test(x.f.replace(/\\/g, "/")) || /logout_endpoint|end_session/.test(x.code));
if (logout.length && !/id_token_hint/.test(all)) {
  add("C12-logout-without-id-token-hint",
    "Logout does not send id_token_hint.",
    "Without it Shopify does not end its own session, so the buyer 'signs out', clicks sign in, and is silently signed straight back into the same account with no prompt. On a shared machine that is the next person's order history. Note the refresh grant does NOT return a new id_token, so carry the original forward.");
} else ok("C12-logout-without-id-token-hint");

/* ---------------------------------------------------------------- C13. refresh rotation */

if (/grant_type[^\n]{0,40}refresh_token|refreshToken\s*\(/.test(all)) {
  // Refresh tokens rotate: the response carries a NEW one and it must be persisted.
  const persists = /(set|save|store|persist|session)[^\n]{0,60}refresh_?[Tt]oken|refresh_?[Tt]oken\s*[:=][^\n]{0,60}(data|json|res|response|body)\.?/.test(all);
  if (!persists) {
    add("C13-refresh-token-not-persisted",
      "The rotated refresh_token from a refresh response is never persisted.",
      "Each refresh returns a NEW refresh token and invalidates the old one. Reusing the original works exactly once, so the session survives the first hour and then logs the buyer out permanently, which reads as an intermittent bug and is completely deterministic. Persist the returned token.");
  } else ok("C13-refresh-token-not-persisted");
} else ok("C13-refresh-token-not-persisted");

/* ---------------------------------------------------------------- C14. hardcoded lifetime */

const hardTtl = files.filter((x) =>
  x.code.split("\n").some((ln) => /\b3600\b/.test(ln) && /ttl|expir|lifetime|max_?age|session|token/i.test(ln)) &&
  !/expires_?in/.test(x.code));
if (hardTtl.length) {
  add("C14-token-lifetime-hardcoded",
    `The access-token lifetime is hardcoded to 3600: ${hardTtl.map((x) => rel(x.f))[0]}.`,
    "3600 is an OBSERVED value from a forum report, not a documented guarantee; the reference states only that expires_in is returned in seconds and never names a number. If Shopify shortens it your sessions expire before you think they do and every buyer sees random 401s. Read expires_in from the response.");
} else ok("C14-token-lifetime-hardcoded");

/* ---------------------------------------------------------------- C15. the IDOR surface */

const orderDetail = files.filter((x) => /account\/orders\/\[/.test(x.f.replace(/\\/g, "/")));
if (orderDetail.length) {
  const checksMembership = orderDetail.some((x) =>
    /orders\s*\([^)]*\)\s*\{[\s\S]{0,200}nodes|\.some\(|\.includes\(|\.find\(/.test(x.code));
  if (!checksMembership) {
    add("C15-order-detail-idor",
      `The order-detail route takes an id from the URL with no membership check: ${orderDetail.map((x) => rel(x.f))[0]}.`,
      "Every other route reads from the session; this one reads from the buyer. The API is buyer-scoped by construction, but the reference for the root order(id:) query never states the scoping and it is UNPROVEN. Until you have tested it with two real accounts, fetch the session customer's own order ids and confirm membership. Return 404 on failure, never 403: a 403 on a real id and a 404 on a fake one tells an attacker which ids exist.");
  } else ok("C15-order-detail-idor");
} else ok("C15-order-detail-idor");

/* ---------------------------------------------------------------- C16. the legacy flow */

if (/customerAccessTokenCreate/.test(all)) {
  add("C16-legacy-password-flow",
    "The build uses the legacy customerAccessTokenCreate password flow.",
    "Shopify's reference labels this 'For legacy customer accounts only'. It is NOT marked deprecated in the schema, which is exactly why commercial templates keep shipping it and why nothing visibly breaks until the merchant switches to the new customer accounts, at which point every sign-in fails at once. Use the Customer Account API's OAuth flow.");
} else ok("C16-legacy-password-flow");

/* ---------------------------------------------------------------- report */

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: !findings.length, findings, passes }, null, 2));
} else if (!findings.length) {
  console.log(`\ngate-customer-auth: clean over ${passes.length} check(s).`);
} else {
  console.log(`\ngate-customer-auth: ${findings.length} finding(s) over ${findings.length + passes.length} check(s).\n`);
  for (const f of findings) console.log(`  [${f.id}] ${f.msg}\n      FIX: ${f.fix}\n`);
}
process.exit(findings.length ? 1 : 0);
