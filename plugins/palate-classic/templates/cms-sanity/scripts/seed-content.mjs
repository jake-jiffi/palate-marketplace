/**
 * Seed the Sanity dataset from src/lib/content.ts.
 *
 * content.ts is the single source of truth for page copy. The preview stage
 * renders straight from it; production runs this script once - after the Sanity
 * project exists - to push the same copy into the CMS so it becomes editable.
 *
 *   npm run seed
 *
 * Idempotent: every document has a stable _id, so re-running updates rather
 * than duplicating. Run via `tsx` (wired in package.json) so the .ts import
 * works on any Node version. Reads SANITY_* from .env (git-ignored).
 */
import { createClient } from "@sanity/client";
import { readFileSync } from "node:fs";
import { home } from "../src/lib/content.ts";

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

// One document per page. Stable _id => idempotent. Extend this list as pages
// are added; keep each document's shape in step with studio/schemas.
const docs = [{ _id: "page-home", _type: "page", slug: { current: "/" }, ...home }];

for (const doc of docs) {
  await client.createOrReplace(doc);
  console.log("seeded", doc._id);
}
console.log(`Done - ${docs.length} document(s) published. Edit them in the Studio.`);
