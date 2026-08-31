/**
 * seed-shopify-dev-store: the guard, and only the guard.
 *
 * This script WRITES PRODUCTS TO SHOPIFY. Everything else in it is convenience; the one thing
 * that must never be wrong is its refusal to run against a live merchant. A metaobject type
 * identifier cannot be renamed after creation and a product created on a real store is not undone
 * by a revert, so "it was a typo in the --store flag" has no recovery path.
 *
 * IT SHIPPED WITH THE GUARD UNTESTED, and the first time it appeared to work was a lie: the CLI
 * returns the payload UNWRAPPED, the script read j.data, got undefined, and refused. The refusal
 * was correct and the reason was wrong, which is the most dangerous shape a guard can have,
 * because the next person "fixes" the parsing and the guard silently stops guarding.
 *
 * npx is stubbed so these cases never touch a real store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "seed-shopify-dev-store.mjs");

/**
 * Stub npx. `shape` chooses what `store execute` pretends the shop is.
 *   dev      a development store, unwrapped payload (what the CLI really returns)
 *   live     a REAL merchant
 *   wrapped  a development store inside a {data:...} envelope, the other shape
 *   garbage  no usable JSON at all
 */
function withNpx(shape) {
  const bin = mkdtempSync(join(tmpdir(), "seedbin-"));
  const stub = join(bin, "npx");
  const shopJson = {
    dev: `{"shop":{"name":"devstore","plan":{"displayName":"Developer Preview","partnerDevelopment":true}}}`,
    live: `{"shop":{"name":"Real Merchant","plan":{"displayName":"Advanced","partnerDevelopment":false}}}`,
    wrapped: `{"data":{"shop":{"name":"devstore","plan":{"displayName":"Developer Preview","partnerDevelopment":true}}}}`,
    garbage: `not json at all`,
  }[shape];
  writeFileSync(stub,
    `#!/bin/sh
case "$*" in
  *productCreate*)   echo '{"productCreate":{"product":{"id":"gid://shopify/Product/1","handle":"h"},"userErrors":[]}}' ;;
  *publications*)    echo '{"publications":{"nodes":[{"id":"gid://shopify/Publication/1","name":"Online Store"}]}}' ;;
  *publishablePublish*) echo '{"publishablePublish":{"userErrors":[]}}' ;;
  *productsCount*)   echo '{"productsCount":{"count":1}}' ;;
  *plan*)            echo '${shopJson}' ;;
  *)                 echo '{}' ;;
esac
`);
  chmodSync(stub, 0o755);
  return bin;
}

function seed(shape, extraArgs = []) {
  const bin = withNpx(shape);
  try {
    const r = spawnSync("node", [SEED, "--store", "example.myshopify.com", "--products", "1", ...extraArgs], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(bin, { recursive: true, force: true }); }
}

/* ---------------------------------------------------------------- the guard */

test("it REFUSES a live merchant", () => {
  const r = seed("live");
  assert.equal(r.code, 3, `a live store must exit 3, got ${r.code}:\n${r.out}`);
  assert.match(r.out, /REFUSING/);
  assert.doesNotMatch(r.out, /created \d+ product/, "nothing may be written to a live store");
});

test("it refuses when the plan cannot be read at all, rather than assuming", () => {
  const r = seed("garbage");
  assert.notEqual(r.code, 0, "an unreadable plan must not be treated as permission");
  assert.doesNotMatch(r.out, /created \d+ product/);
});

test("it PROCEEDS on a development store", () => {
  const r = seed("dev");
  assert.equal(r.code, 0, `a dev store must be allowed, got ${r.code}:\n${r.out}`);
  assert.match(r.out, /development=true/);
  assert.match(r.out, /created 1 product/);
});

test("it accepts BOTH response shapes, because reading only one is what broke it", () => {
  // The CLI returns the payload unwrapped. A wrapped {data:...} envelope is the other shape a
  // GraphQL client may hand back, and reading only j.data yielded undefined, which the guard
  // then reported as "this is not a development store": right refusal, wrong reason.
  const r = seed("wrapped");
  assert.equal(r.code, 0, `a wrapped envelope must be understood too:\n${r.out}`);
  assert.match(r.out, /development=true/);
});

/* ---------------------------------------------------------------- the dry run */

test("a dry run writes nothing and needs no credentials at all", () => {
  const bin = mkdtempSync(join(tmpdir(), "seedbin-"));
  const stub = join(bin, "npx");
  writeFileSync(stub, `#!/bin/sh\nexit 127\n`);   // npx is unusable
  chmodSync(stub, 0o755);
  try {
    const r = spawnSync("node", [SEED, "--store", "example.myshopify.com", "--dry-run"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, "a dry run must not require the CLI");
    assert.match(r.stdout, /would create/);
    assert.match(r.stdout, /nothing written and nothing authenticated/);
  } finally { rmSync(bin, { recursive: true, force: true }); }
});

test("the invented catalogue is not placeholder filler", () => {
  const bin = mkdtempSync(join(tmpdir(), "seedbin-"));
  writeFileSync(join(bin, "npx"), `#!/bin/sh\nexit 127\n`);
  chmodSync(join(bin, "npx"), 0o755);
  try {
    const r = spawnSync("node", [SEED, "--store", "x.myshopify.com", "--products", "12", "--dry-run"],
      { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    // "Product 1..N" would prove nothing about whether real content survives a design.
    assert.doesNotMatch(r.stdout, /Product \d+\s/, "generic titles teach a build nothing");
    const types = new Set([...r.stdout.matchAll(/^\s{3}(\w+)\s/gm)].map((m) => m[1]));
    assert.ok(types.size >= 4, `expected several product types, got ${[...types].join(", ")}`);
    assert.match(r.stdout, /\(\d\)/, "products must carry real option sets");
  } finally { rmSync(bin, { recursive: true, force: true }); }
});
