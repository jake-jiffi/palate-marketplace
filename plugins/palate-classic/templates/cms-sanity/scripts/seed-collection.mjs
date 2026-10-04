/**
 * Seed one example collection item so the blog / news / job route renders with
 * content straight away. Run after `npm run seed`:
 *
 *   npm run seed-collection
 *
 * It creates a single `collectionItem`; duplicate and edit it in the Studio, or
 * extend the `items` array below. Idempotent (stable _id). Reads SANITY_* from
 * .env (git-ignored); needs SANITY_API_WRITE_TOKEN.
 */
import { createClient } from "@sanity/client";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

const env = loadEnv();
const projectId = env.SANITY_PROJECT_ID || process.env.SANITY_PROJECT_ID;
const dataset = env.SANITY_DATASET || process.env.SANITY_DATASET || "production";
const token = env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_WRITE_TOKEN;

if (!projectId || !token) {
  console.error("Missing SANITY_PROJECT_ID or SANITY_API_WRITE_TOKEN - check .env");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: "2025-02-19",
  token,
  useCdn: false,
});

const items = [
  {
    _id: "collection-welcome",
    _type: "collectionItem",
    title: "Welcome",
    slug: { _type: "slug", current: "welcome" },
    excerpt: "An example collection item - edit or delete this in the Studio.",
    publishedAt: new Date().toISOString(),
    body: [
      {
        _type: "block",
        _key: "intro",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "This is the first item. Replace it with real content." }],
      },
    ],
  },
];

for (const item of items) {
  await client.createOrReplace(item);
  console.log("seeded", item._id);
}
console.log(`Done - ${items.length} collection item(s).`);
