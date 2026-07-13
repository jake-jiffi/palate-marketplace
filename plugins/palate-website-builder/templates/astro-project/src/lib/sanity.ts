import imageUrlBuilder from "@sanity/image-url";
import { sanityClient } from "sanity:client";

/**
 * Image URL helper. The Sanity client itself comes from the @sanity/astro
 * integration - import it directly as `sanityClient` from "sanity:client".
 * Page content is fetched through loadPage() in ./load.ts; use that rather
 * than a raw client so the content.ts fallback always applies.
 *
 * Usage:  <img src={urlFor(image).width(800).url()} />
 */
const builder = imageUrlBuilder(sanityClient);

export const urlFor = (src: Parameters<typeof builder.image>[0]) => builder.image(src);
