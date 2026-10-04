/**
 * Publish every pending draft in the dataset, in one command:
 *
 *   npm run publish-all
 *
 * For each `drafts.*` document it writes the published version and deletes the
 * draft - the same thing the Studio's Publish button does, batched into one
 * transaction. Handy after a content sprint where many pages were edited.
 * Reads SANITY_* from .env (git-ignored); needs SANITY_API_WRITE_TOKEN.
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

const drafts = await client.fetch(`*[_id in path("drafts.**")]`);
if (!drafts.length) {
  console.log("No pending drafts - everything is already published.");
  process.exit(0);
}

let tx = client.transaction();
for (const draft of drafts) {
  const published = { ...draft, _id: draft._id.replace(/^drafts\./, "") };
  delete published._rev;
  tx = tx.createOrReplace(published).delete(draft._id);
}
await tx.commit();
console.log(`Published ${drafts.length} document(s).`);
