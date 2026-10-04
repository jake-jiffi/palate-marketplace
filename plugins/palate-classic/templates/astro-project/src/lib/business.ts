/**
 * business.ts - THE single source of truth for every fact about this business.
 *
 * ============================ THE ONE RULE ============================
 *
 * A fact in here is written ONCE and read everywhere. Never hardcode a phone
 * number, an email, an address, an opening hour or a service name into a page,
 * a layout, a component, an API route or a structured-data block. Import it.
 *
 * That is not tidiness, it is the whole mechanism behind changing a fact in one
 * place and having every rendered surface follow, structured data and footer
 * included. The moment a value is duplicated into a page, the next change
 * silently leaves one surface stale, and the stale one is usually the one a
 * customer phones. `scripts/test/single-source-facts.test.sh` fails the build
 * if a fact from this file is found hardcoded anywhere in src/.
 *
 * It is TypeScript rather than YAML on purpose: a bad edit fails the build
 * instead of rendering `undefined` into a page, and it is readable from a
 * layout, an API route and a script with no parser and no dependency.
 *
 * Claude fills this with the REAL business record during Phase A. Anything not
 * known yet is left `null`, never invented and never left as a placeholder that
 * could reach production.
 */

export interface BusinessRecord {
  /** Legal or trading name, exactly as the business writes it. */
  name: string;
  /** One line, plain, no marketing adjectives. Used for meta and llms.txt. */
  description: string;
  /** Primary contact address. */
  email: string;
  /** E.164 where possible (+61...), because structured data and tel: both want it. */
  telephone: string | null;
  /** Street address, or null for a business with no public premises. */
  address: {
    street: string;
    locality: string;
    region: string;
    postcode: string;
    country: string;
  } | null;
  /** Schema.org opening hours, e.g. "Mo-Fr 09:00-17:00". Empty for none. */
  openingHours: string[];
  /** The suburbs, cities or regions actually served. */
  serviceAreas: string[];
  /** What the business does, named the way the business names it. */
  services: string[];
  /** Profiles that prove the entity is real. Feeds schema.org sameAs. */
  sameAs: string[];
  /**
   * The schema.org type. "LocalBusiness" for anyone with a premises or a
   * service area; "Organization" for everyone else. Get this right: it changes
   * which rich results the page is eligible for.
   */
  schemaType: "LocalBusiness" | "Organization";
}

export const business: BusinessRecord = {
  name: "{{CLIENT_NAME}}",
  description: "{{ONE_LINE_DESCRIPTION}}",
  email: "hello@{{DOMAIN}}",
  telephone: null,
  address: null,
  openingHours: [],
  serviceAreas: [],
  services: [],
  sameAs: [],
  schemaType: "Organization",
};

/**
 * The JSON-LD node for this business, built from the record above.
 *
 * One builder, so the entity described in structured data can never drift from
 * the entity described in the copy. Fields that are unknown are omitted rather
 * than emitted empty: an empty `telephone` is worse than no `telephone`,
 * because validators treat it as a claim.
 */
export function businessJsonLd(siteUrl: string | undefined) {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": business.schemaType,
    name: business.name,
    description: business.description,
    email: business.email,
  };
  if (siteUrl) node.url = siteUrl;
  if (business.telephone) node.telephone = business.telephone;
  if (business.address) {
    node.address = {
      "@type": "PostalAddress",
      streetAddress: business.address.street,
      addressLocality: business.address.locality,
      addressRegion: business.address.region,
      postalCode: business.address.postcode,
      addressCountry: business.address.country,
    };
  }
  if (business.openingHours.length) node.openingHours = business.openingHours;
  if (business.serviceAreas.length) node.areaServed = business.serviceAreas;
  if (business.sameAs.length) node.sameAs = business.sameAs;
  return node;
}
