/**
 * The scaffold's robots.txt endpoint, exercised as CODE rather than as text.
 *
 * gate-seo can only see whether the file mentions an environment and can emit a Disallow. That
 * is enough to catch the old unconditional `Allow: /`, and nowhere near enough to catch a
 * conditional wired up backwards, which would read as fixed while deindexing production.
 *
 * The four directions, and why each one is a real risk rather than a hypothetical:
 *
 *   PREVIEW MUST CLOSE           the fault being fixed: a preview is a public origin, and
 *                                indexing it puts a client's content at a URL they do not own.
 *   PRODUCTION MUST OPEN         the expensive way to get this wrong. A robots.txt that blocks
 *                                the live site is a silent, total loss of search traffic.
 *   THE PLACEHOLDER MUST NOT     `site` holds https://{{DOMAIN}} until the scaffold is filled
 *   BLOCK ANYTHING               in, and a host comparison against a placeholder matches
 *                                nothing, so a naive version blocks every environment there is.
 *   A NON-CANONICAL HOST CLOSES  the half that works on a host which sets no env var at all.
 *
 * Run: node --test scripts/test/gate-seo-robots.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "templates", "astro-project", "src", "pages", "robots.txt.ts");

// The endpoint is TypeScript and reads import.meta.env, neither of which node runs. Rather than
// pull in a transpiler, strip exactly the two things that stop it loading and keep the logic
// byte for byte. If either substitution stops matching, the assertions below fail loudly rather
// than testing a rewritten copy.
const raw = readFileSync(SRC, "utf8");
const withoutTypes = raw
  .replace(/^import type .*\n/m, "")
  .replace(/export const GET: APIRoute =/, "export const GET =");
assert.notEqual(withoutTypes, raw, "the type strip matched nothing: this test is no longer reading the real endpoint");
const shimmed = withoutTypes.replace(/import\.meta\.env\.PUBLIC_SITE_ENV/g, "globalThis.__SITE_ENV");
assert.notEqual(shimmed, withoutTypes, "the endpoint no longer reads PUBLIC_SITE_ENV");

const dir = mkdtempSync(join(tmpdir(), "robots-"));
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
const mod = join(dir, "robots.mjs");
writeFileSync(mod, shimmed);
const { GET } = await import(pathToFileURL(mod).href);

async function robots({ siteEnv = "", vercelEnv = "", site = "https://ex.com/", asked = "https://ex.com/robots.txt" }) {
  globalThis.__SITE_ENV = siteEnv || undefined;
  if (vercelEnv) process.env.VERCEL_ENV = vercelEnv; else delete process.env.VERCEL_ENV;
  const res = await GET({ site: new URL(site), url: new URL(asked) });
  return { body: await res.text(), headers: res.headers };
}

const opens = (b) => /^Allow: \/$/m.test(b) && !/Disallow: \//.test(b);
const closes = (b) => /^Disallow: \/$/m.test(b) && !/^Allow: \//m.test(b);

test("production on the canonical host is open, and hands over the sitemap", async () => {
  const { body } = await robots({ siteEnv: "production" });
  assert.ok(opens(body), body);
  assert.match(body, /Sitemap: https:\/\/ex\.com\/sitemap-index\.xml/);
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot"]) assert.match(body, new RegExp(`User-agent: ${bot}`));
});

test("an unknown environment on the canonical host still opens", async () => {
  // The fail direction. A host that sets no env var must not deindex a live site.
  assert.ok(opens((await robots({})).body));
});

test("a preview deployment closes", async () => {
  const { body, headers } = await robots({ siteEnv: "preview" });
  assert.ok(closes(body), body);
  assert.match(body, /environment is "preview"/);
  assert.equal(headers.get("x-robots-tag"), "noindex");
});

test("a preview closes on VERCEL_ENV alone, with no PUBLIC_SITE_ENV baked in", async () => {
  assert.ok(closes((await robots({ vercelEnv: "preview" })).body));
});

test("the sitemap is withheld when the origin is closed", async () => {
  // Handing a crawler the map while telling it to stay out is the mixed signal that gets the
  // Disallow ignored.
  assert.doesNotMatch((await robots({ siteEnv: "preview" })).body, /Sitemap:/);
});

test("a non-canonical host closes even when the environment says production", async () => {
  const { body } = await robots({ siteEnv: "production", asked: "https://site-git-abc-team.vercel.app/robots.txt" });
  assert.ok(closes(body), body);
  assert.match(body, /is not the canonical ex\.com/);
});

test("www and the bare domain are the same site", async () => {
  assert.ok(opens((await robots({ siteEnv: "production", asked: "https://www.ex.com/robots.txt" })).body));
  assert.ok(opens((await robots({ siteEnv: "production", site: "https://www.ex.com/" })).body));
});

test("the unfilled {{DOMAIN}} placeholder does not block every environment", async () => {
  // A host comparison against a placeholder matches nothing, so the obvious implementation
  // closes the site on localhost, in CI and in production alike.
  assert.ok(opens((await robots({ site: "https://{{DOMAIN}}/", asked: "http://localhost:4321/robots.txt" })).body));
});
