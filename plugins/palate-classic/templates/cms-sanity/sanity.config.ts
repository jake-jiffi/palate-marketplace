import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { presentationTool } from "sanity/presentation";
import { visionTool } from "@sanity/vision";
import { sanityClient } from "sanity:client";
import { schemaTypes } from "./src/sanity/schema";

/**
 * Embedded Sanity Studio for {{CLIENT_NAME}}.
 *
 * The @sanity/astro integration mounts this at /studio. projectId and dataset
 * are read from the integration config (astro.config.mjs) so there is one
 * source of truth. See references/cms-and-draft-preview.md.
 */
const { projectId, dataset } = sanityClient.config();

export default defineConfig({
  name: "default",
  title: "{{CLIENT_NAME}}",
  projectId: projectId!,
  dataset: dataset!,
  plugins: [
    structureTool(),
    // Presentation: live, click-to-edit preview. The site is same-origin as the
    // embedded Studio. Overlays appear on the deployment built with
    // PUBLIC_SANITY_VISUAL_EDITING_ENABLED=true (the preview deployment).
    presentationTool({
      previewUrl: { origin: "same-origin", preview: "/" },
    }),
    visionTool(),
  ],
  schema: { types: schemaTypes },
});
