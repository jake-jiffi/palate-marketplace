/**
 * gate-customer-auth: every check, proven by breaking exactly one thing.
 *
 * The method matters more than the count. Each case starts from a fixture that PASSES, breaks
 * one thing, and asserts that check fires. A check with no failing case is a check nobody has
 * seen work, and this repo has shipped two of those (a check keyed on a literal string that
 * false-failed a correct build, and a check keyed on a file path that switched itself off when
 * you followed the neighbouring check's advice).
 *
 * The fixture is the implementation the research recommends: confidential client on the
 * Headless channel, runtime discovery against the SHOPIFY-SERVED domain, PKCE with S256,
 * sealed HttpOnly+Secure+Lax cookies, tokens server-side only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "gate-customer-auth.mjs");

const w = (dir, rel, body) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};
const rm = (dir, rel) => rmSync(join(dir, rel), { force: true });

/** A storefront whose customer-account flow is built the way the research says to build it. */
function correct() {
  const dir = mkdtempSync(join(tmpdir(), "ca-"));

  writeFileSync(join(dir, "astro.config.mjs"), `export default { output: "static" };`);

  // Discovery: against the Shopify-served domain, held in its OWN env var, never the public one.
  w(dir, "src/lib/customer-account/client.ts",
`const SHOP = import.meta.env.SHOPIFY_SHOP_DOMAIN;          // <shop>.myshopify.com
const CLIENT_ID = import.meta.env.CUSTOMER_ACCOUNT_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.CUSTOMER_ACCOUNT_CLIENT_SECRET;

export async function discover() {
  const r = await fetch(\`https://\${SHOP}/.well-known/openid-configuration\`);
  return r.json();   // authorization_endpoint, token_endpoint, graphql endpoint
}

export async function exchangeCode(code, verifier, redirectUri) {
  const d = await discover();
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: CLIENT_ID, code,
    code_verifier: verifier, redirect_uri: redirectUri,
  });
  // origin and user-agent are REQUIRED. Node's fetch sets neither.
  const r = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": import.meta.env.PUBLIC_SITE_ORIGIN,
      "user-agent": "palate-storefront",
      "authorization": "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET),
    },
    body,
  });
  const json = await r.json();
  return { token: json.access_token, expiresIn: json.expires_in ?? 900, refresh: json.refresh_token };
}

export async function refresh(session) {
  const d = await discover();
  const r = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "origin": import.meta.env.PUBLIC_SITE_ORIGIN, "user-agent": "palate-storefront" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refresh }),
  });
  const json = await r.json();
  // Refresh tokens ROTATE. Persist the new one or the session dies after exactly one hour.
  session.refresh = json.refresh_token;
  session.expiresIn = json.expires_in;
  return session;
}`);

  w(dir, "src/lib/customer-account/crypto.ts",
`export const challengeMethod = "S256";
export function pkce() { return { verifier: "v", challenge: "c", code_challenge_method: "S256" }; }`);

  w(dir, "src/pages/account/login.ts",
`export const prerender = false;
import { discover } from "../../lib/customer-account/client";
import { pkce } from "../../lib/customer-account/crypto";
export const GET = async ({ cookies, redirect }) => {
  const d = await discover();
  const { verifier, challenge } = pkce();
  const state = crypto.randomUUID();
  cookies.set("ca_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  cookies.set("ca_verifier", verifier, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return redirect(u.toString(), 302);
};`);

  w(dir, "src/pages/account/callback.ts",
`export const prerender = false;
import { exchangeCode } from "../../lib/customer-account/client";
export const GET = async ({ url, cookies, redirect }) => {
  const expected = cookies.get("ca_state")?.value;
  const got = url.searchParams.get("state");
  if (!expected || expected !== got) return new Response("bad state", { status: 400 });
  const s = await exchangeCode(url.searchParams.get("code"), cookies.get("ca_verifier")?.value, "https://x/account/callback");
  cookies.set("ca_session", seal(s), { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  return redirect("/account", 302);
};`);

  w(dir, "src/pages/account/logout.ts",
`export const prerender = false;
export const GET = async ({ cookies, redirect }) => {
  const idToken = readSession(cookies)?.idToken;
  const u = new URL("https://shopify.com/authentication/1/logout");
  u.searchParams.set("id_token_hint", idToken);
  cookies.delete("ca_session", { path: "/" });
  return redirect(u.toString(), 302);
};`);

  w(dir, "src/pages/account/index.astro",
`---
export const prerender = false;
const orders = await listOrders(Astro.locals.session);
---
<ul>{orders.map((o) => <li>{o.name}</li>)}</ul>`);

  w(dir, "src/pages/account/orders/[id].astro",
`---
export const prerender = false;
// The root order(id:) query's scoping is UNPROVEN, so confirm membership from the session.
const mine = await ownOrderIds(Astro.locals.session);
if (!mine.nodes.some((o) => o.id === Astro.params.id)) return new Response("Not found", { status: 404 });
const order = await getOrder(Astro.locals.session, Astro.params.id);
---
<h1>{order.name}</h1>`);

  return dir;
}

const run = (dir) => {
  const r = spawnSync("node", [GATE, dir, "--json"], { encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`bad output:\n${r.stdout}${r.stderr}`); }
};

test("a correctly built customer-account flow produces NO findings", () => {
  const d = correct();
  try {
    const r = run(d);
    assert.deepEqual(r.findings.map((f) => f.id), [], JSON.stringify(r.findings, null, 2));
    assert.ok(r.passes.length >= 15, `expected 15+ checks to run, got ${r.passes.length}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a build with no account surface is SILENT, never inventive", () => {
  const d = mkdtempSync(join(tmpdir(), "ca-none-"));
  try {
    w(d, "src/pages/index.astro", `<h1>a brochure site</h1>`);
    const r = run(d);
    assert.equal(r.scope, "none");
    assert.deepEqual(r.findings, []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const CASES = [
  ["C1-account-route-prerendered", "one state and one code_challenge served to every visitor", (d) =>
    w(d, "src/pages/account/login.ts", `export const GET = async () => new Response("login");`)],

  ["C2-auth-cookie-not-httponly", "the shipped-template bug: a comment claiming HttpOnly over a readable cookie", (d) =>
    w(d, "src/pages/account/callback.ts",
      `export const prerender = false;\n` +
      `export const GET = async ({ url, cookies }) => {\n` +
      `  if (cookies.get("ca_state")?.value !== url.searchParams.get("state")) return new Response("bad", { status: 400 });\n` +
      `  // Set token in cookie with HttpOnly flag\n` +
      `  cookies.set("token", tok, { path: "/", sameSite: "lax" });\n};`)],

  ["C3-auth-cookie-samesite-strict", "the state cookie is absent on the way back from Shopify, so login loops forever", (d) =>
    w(d, "src/pages/account/login.ts",
      `export const prerender = false;\n` +
      `export const GET = async ({ cookies }) => {\n` +
      `  cookies.set("ca_state", s, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });\n};`)],

  ["C4-callback-state-unchecked", "an attacker completes the callback and logs the victim into THEIR account", (d) =>
    w(d, "src/pages/account/callback.ts",
      `export const prerender = false;\n` +
      `import { exchangeCode } from "../../lib/customer-account/client";\n` +
      `export const GET = async ({ url, cookies, redirect }) => {\n` +
      `  const s = await exchangeCode(url.searchParams.get("code"), cookies.get("ca_verifier")?.value, "u");\n` +
      `  cookies.set("ca_session", seal(s), { httpOnly: true, secure: true, sameSite: "lax", path: "/" });\n` +
      `  return redirect("/account", 302);\n};`)],

  ["C5-pkce-incomplete", "PKCE theatre: the challenge is sent, the verifier never is", (d) => {
    w(d, "src/lib/customer-account/crypto.ts", `export function pkce() { return { challenge: "c" }; }`);
    w(d, "src/lib/customer-account/client.ts",
      `const SHOP = import.meta.env.SHOPIFY_SHOP_DOMAIN;\n` +
      `export async function discover() { const r = await fetch(\`https://\${SHOP}/.well-known/openid-configuration\`); return r.json(); }\n` +
      `export async function exchangeCode(code) {\n` +
      `  const d = await discover();\n` +
      `  return fetch(d.token_endpoint, { method: "POST", headers: { origin: "o", "user-agent": "u" }, body: new URLSearchParams({ grant_type: "authorization_code", code }) });\n}`);
    w(d, "src/pages/account/login.ts",
      `export const prerender = false;\nexport const GET = async () => { const u = new URL("https://x"); u.searchParams.set("code_challenge", "c"); };`);
  }],

  ["C6-endpoint-hardcoded", "the documented endpoint format matches no live store", (d) =>
    w(d, "src/lib/customer-account/query.ts",
      `const URL_ = "https://shop.myshopify.com/customer/api/2026-07/graphql";\nexport default URL_;`)],

  ["C7-discovery-on-own-domain", "discovery hits your own 404 page and dies with a JSON parse error", (d) =>
    w(d, "src/lib/customer-account/client.ts",
      `export async function discover() {\n` +
      `  const r = await fetch(\`\${import.meta.env.PUBLIC_SITE_ORIGIN}/.well-known/openid-configuration\`);\n` +
      `  return r.json();\n}`)],

  ["C8-missing-origin-user-agent", "a 401 that reads like a bad token and is actually a missing header", (d) =>
    w(d, "src/lib/customer-account/client.ts",
      `const SHOP = import.meta.env.SHOPIFY_SHOP_DOMAIN;\n` +
      `export async function discover() { const r = await fetch(\`https://\${SHOP}/.well-known/openid-configuration\`); return r.json(); }\n` +
      `export async function exchangeCode(code, verifier) {\n` +
      `  const d = await discover();\n` +
      `  return fetch(d.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },\n` +
      `    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier }) });\n}`)],

  ["C9-token-reaches-browser", "Shopify's own tutorial's defect, copied into Astro", (d) =>
    w(d, "src/pages/account/session.ts",
      `export const prerender = false;\n` +
      `export const GET = async ({ locals }) =>\n` +
      `  new Response(JSON.stringify({ customer: locals.customer, access_token: locals.session.token }));`)],

  ["C10-secrets-in-web-storage", "the reference's SPA sample, which turns any XSS into account takeover", (d) =>
    w(d, "src/pages/account/start.astro",
      `<script>localStorage.setItem("code-verifier", verifier);</script>`)],

  ["C11-secret-is-public", "the client secret ships in the browser bundle", (d) =>
    w(d, "src/lib/customer-account/secret.ts",
      `export const SECRET = import.meta.env.PUBLIC_CUSTOMER_CLIENT_SECRET;`)],

  ["C12-logout-without-id-token-hint", "sign out, sign in, and you are silently back in the same account", (d) =>
    w(d, "src/pages/account/logout.ts",
      `export const prerender = false;\n` +
      `export const GET = async ({ cookies, redirect }) => {\n` +
      `  cookies.delete("ca_session", { path: "/" });\n  return redirect("/", 302);\n};`)],

  ["C13-refresh-token-not-persisted", "works for exactly one hour, then logs everyone out permanently", (d) =>
    w(d, "src/lib/customer-account/client.ts",
      `const SHOP = import.meta.env.SHOPIFY_SHOP_DOMAIN;\n` +
      `export async function discover() { const r = await fetch(\`https://\${SHOP}/.well-known/openid-configuration\`); return r.json(); }\n` +
      `export async function doRefresh(old) {\n` +
      `  const d = await discover();\n` +
      `  const r = await fetch(d.token_endpoint, { method: "POST", headers: { origin: "o", "user-agent": "u" },\n` +
      `    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: old }) });\n` +
      `  const j = await r.json();\n  return j.access_token;\n}`)],

  ["C14-token-lifetime-hardcoded", "3600 is an observed value, not a documented guarantee", (d) =>
    w(d, "src/lib/customer-account/ttl.ts", `export const TTL = 3600;`)],

  ["C15-order-detail-idor", "an id straight off the URL into a query whose scoping is unproven", (d) =>
    w(d, "src/pages/account/orders/[id].astro",
      `---\nexport const prerender = false;\nconst order = await getOrder(Astro.locals.session, Astro.params.id);\n---\n<h1>{order.name}</h1>`)],

  ["C16-legacy-password-flow", "every sign-in fails at once the day the merchant switches accounts", (d) =>
    w(d, "src/pages/api/login.ts",
      `export const prerender = false;\n` +
      `const M = "mutation { customerAccessTokenCreate(input: $i) { customerAccessToken { accessToken } } }";\nexport default M;`)],
];

for (const [id, why, breakIt] of CASES) {
  test(`${id}: ${why}`, () => {
    const d = correct();
    try {
      breakIt(d);
      const r = run(d);
      assert.ok(r.findings.some((f) => f.id === id),
        `expected ${id}, got: ${r.findings.map((f) => f.id).join(", ") || "(none)"}`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
}

test("every check the gate can emit has a failing case above", () => {
  const src = readFileSync(GATE, "utf8");
  const emitted = [...src.matchAll(/add\(\s*"([A-Z]\d+-[a-z0-9-]+)"/g)].map((m) => m[1]);
  const tested = new Set(CASES.map(([id]) => id));
  const untested = [...new Set(emitted)].filter((id) => !tested.has(id));
  // NO EXEMPTION LIST. One was added here once and it contained exactly the three checks that
  // had never been proven to fire.
  assert.deepEqual(untested, [], `checks with no failing case: ${untested.join(", ")}`);
});
