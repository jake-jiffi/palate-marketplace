/**
 * THE WEBSITE KIT MANIFEST.
 *
 * Sixteen pieces from Jake's table plus one the library showed the table could not compose,
 * fifty variations. Every entry states the three things Jake's definition
 * of "finished" requires a reusable piece to carry: when to use it, what content it needs, and
 * where on a page it belongs. Read by the Compose stage when choosing sections, by the kit index
 * at /_kit, and by gate-kit-complete.mjs, which fails if a declared variation has no component.
 *
 * THE MANIFEST IS THE SOURCE OF TRUTH FOR WHAT EXISTS. A component with no entry is invisible to
 * Compose; an entry with no component fails the gate. Neither can drift silently.
 *
 * ==================== TWO PROPS EVERY PIECE TAKES ====================
 *
 * They are not listed under `needs` because they are not content, and repeating them forty-five
 * times would bury the fields that differ.
 *
 * `tone: "default" | "subtle" | "inverse"` is the ground the piece sits on. One name and one
 * vocabulary across the kit, so a page can alternate grounds without having to remember which
 * piece called it `variant` and which called the pale ground `plain`. Every semantic token flips
 * with it in foundations.css, so no piece restates a colour to survive a dark band. The one
 * exception is NavMobileSheet, which is not a band: it renders inside NavSimple or NavDropdown
 * and inherits whichever ground they set.
 *
 * `id: string` is the section's anchor, so a page can offer "jump to how it works" and a call to
 * action can point at it. It is never defaulted, because a defaulted anchor collides the moment a
 * page carries two of a piece; with no id the piece still wires its own aria correctly from a
 * per-render value.
 *
 * ==================== WHAT A PIECE MAY NOT INVENT ====================
 *
 * No piece defaults a person, a firm or a file. A build that forgets `siteName`, `businessName`,
 * a poster or a list of quotes gets nothing, not a plausible-looking fiction on a real client's
 * site. The demo pages at /kit/<piece>/<variation> pass sample content from src/lib/kit-sample.ts
 * instead, which no shipping page imports.
 */

export type KitState =
  | "hover" | "focus" | "open" | "loading" | "success" | "error" | "empty" | "long";

export interface KitVariation {
  /**
   * TRUE when this piece renders the PAGE's top-level heading rather than a section heading.
   * Only a hero does, and only because a hero's headline IS the page's h1 on a real page. It is
   * declared rather than inferred because a demo that renders one section alone still has to be a
   * valid document: the frame supplies a hidden h1 for every piece EXCEPT these, and without the
   * distinction it would either ship two h1s on a hero or none anywhere else.
   */
  ownsPageHeading?: boolean;
  /** Component file under src/components/kit/<piece>/<id>.astro */
  id: string;
  /** Jake's own words for this variation, from the spec table. */
  name: string;
  /** When to reach for THIS variation rather than its siblings. */
  when: string;
  /** The content it needs. If a build cannot supply this, pick another variation. */
  needs: string[];
  /** The states it implements beyond the resting state. */
  states: KitState[];
  /**
   * THE REFERENCES THIS VARIATION'S CONTRACT IS READ FROM. Every slug must appear in
   * src/lib/kit-survey.json, the plugin-recorded set of references actually opened during the
   * kit survey, and in the piece's donors in src/lib/kit-grounding.ts. gate-kit-complete refuses
   * anything else, so a `when` cannot cite a reference nobody read.
   */
  evidence: string[];
}

export interface KitPiece {
  id: string;
  name: string;
  /**
   * "spec" for the sixteen pieces in Jake's table. "library" for a piece the survey showed the
   * sixteen cannot compose: the library's local-service flagships all make PLACE concrete before
   * asking for a commitment, and nothing in the table could. A library piece cites at least three
   * references or the gate refuses it.
   */
  origin?: "spec" | "library";
  /** When to use the piece at all. */
  when: string;
  /** Where on a page it belongs. */
  where: string;
  variations: KitVariation[];
}

export const kit: KitPiece[] = [
  {
    id: "navigation", name: "Navigation",
    when: "Every page. The only piece that is never optional.",
    where: "Above everything, in the page header.",
    variations: [
      { id: "NavSimple", name: "Simple navigation",
        when: "Five or fewer destinations and one action. The bar pins a single pill right, the only saturated colour on the page, and stays quiet under the hero.",
        needs: ["site name or logo", "2-6 links", "optional one call to action"],
        states: ["hover", "focus", "open", "long"], evidence: ["block-renovation", "habito", "parsley-health", "linear"] },
      { id: "NavDropdown", name: "Dropdown navigation",
        when: "Grouped destinations: a real suite or several service lines. Dropdowns reveal as cards, and audiences with different tracks get their own entry.",
        needs: ["site name or logo", "2-5 groups each with 2-10 links", "optional call to action"],
        states: ["hover", "focus", "open", "long"], evidence: ["mercury", "sealed-home", "habito", "webflow"] },
      { id: "NavMobileSheet", name: "Mobile menu",
        when: "The small-screen half of either bar. A drawer that keeps the booking or quote action visible.",
        needs: ["the same links as the desktop nav"],
        states: ["open", "focus", "long"], evidence: ["aesop", "warby-parker", "barrys"] },
      { id: "AnnouncementBar", name: "Announcement bar",
        when: "A live offer, a notice, or the persistent service action above the bar. One line, one link, dismissible; the ribbon is where 'Book' lives on every page.",
        needs: ["one line of notice or offer", "optional one link", "optional a dismiss"],
        states: ["hover", "focus", "long"], evidence: ["warby-parker", "parsley-health", "gymshark", "swillhouse", "1rebel", "attentive", "crisp", "vivvi"] },
    ],
  },
  {
    id: "hero", name: "Hero",
    when: "The first screen of a home page or a landing page.",
    where: "Directly under the navigation, once per page.",
    variations: [
      { id: "HeroTextImage", name: "Text with image",
        when: "A service or a system: the promise stated plainly beside or over a real photograph, one action, and trust directly beneath.",
        needs: ["headline", "1-2 sentence lede", "1-2 calls to action", "one image (16:9 or 4:3)"],
        states: ["hover", "focus", "long"], ownsPageHeading: true, evidence: ["block-renovation", "warby-parker", "parsley-health", "attentive", "re-bath"] },
      { id: "HeroCentredPreview", name: "Centred headline with product preview",
        when: "A product: a short headline with the real interface at full fidelity, never a stylised render (linear, dropbox, basecamp, crisp); a pair of actions only when there are genuinely two paths (loom, dropbox). The centring is this piece's own layout, not a library claim.",
        needs: ["headline", "short lede", "1-2 calls to action", "a product screenshot"],
        states: ["hover", "focus", "long"], ownsPageHeading: true, evidence: ["linear", "dropbox", "loom", "basecamp", "crisp"] },
      { id: "HeroServicePhoto", name: "Service hero with real photography",
        when: "Photography that is the brand: the image full-bleed with the headline set inside it, and at most one action on it (aesop's single outline pill).",
        needs: ["headline", "lede", "call to action", "a full-bleed photograph at 1600px or wider"],
        states: ["hover", "focus", "long"], ownsPageHeading: true, evidence: ["aesop", "mejuri"] },
    ],
  },
  {
    id: "trust", name: "Trust strip",
    when: "Directly under the hero on every page that sells, before any feature claim. The form depends on what this buyer recognises.",
    where: "The band immediately beneath the hero, slim: a breath rather than a section.",
    variations: [
      { id: "TrustLogos", name: "Customer logos",
        when: "Directly under the hero, and only when the names are known to THIS audience; a local business shows accreditations and partner badges instead.",
        needs: ["4-10 logo files", "optional one-line framing"],
        states: ["long", "empty"], evidence: ["attentive", "pilot-accounting", "loom", "avalon-accounting", "webflow"] },
      { id: "TrustRatings", name: "Review ratings",
        when: "A rating from a platform the buyer already trusts, with the count; the form of proof for consumer and appointment businesses.",
        needs: ["rating value", "review count", "source name and link"],
        states: ["empty"], evidence: ["habito", "lovevery"] },
      { id: "TrustResults", name: "Key results",
        when: "A count plus a character claim, or a measured outcome with its source; the right form where logos would read as borrowed, and in regulated categories.",
        needs: ["2-4 figures each with a label and a source note"],
        states: ["long", "empty"], evidence: ["mercury", "dropbox", "parsley-health", "greenwise-organic-lawn-care", "barrys", "sealed-home"] },
    ],
  },
  {
    id: "problem", name: "Problem and solution",
    when: "Right after trust, before any feature: name the buyer's problem, state the position, or tell the story. One idea per band.",
    where: "After the trust band and before the benefits; the statement form also works as the mission echo between proof and close.",
    variations: [
      { id: "ProblemBeforeAfter", name: "Before and after",
        when: "The outcome as a pair of the client's own images; the proof for anything with a visible result.",
        needs: ["before image", "after image", "one line each"],
        states: ["hover", "focus", "long"], evidence: ["re-bath", "lava-dental"] },
      { id: "ProblemSideBySide", name: "Side-by-side comparison",
        when: "The buyer's current experience against yours as paired statements: right after trust as the problem framing (pilot), or as the comparative pitch in its own section (plausible).",
        needs: ["3-6 paired statements", "a label for each column"],
        states: ["long", "empty"], evidence: ["pilot-accounting", "plausible"] },
      { id: "ProblemStory", name: "Short problem-to-outcome story",
        when: "The place, the heritage and the feeling before any action; for brands whose narrative is the differentiator.",
        needs: ["2-4 short paragraphs", "optional image", "optional attribution"],
        states: ["long", "empty"], evidence: ["dishoom", "lanserring", "swillhouse", "setia-law"] },
      { id: "ProblemStatement", name: "Positioning statement",
        when: "One statement of position on its own ground, with no call to action: right after the hero as the positioning paragraph, or between the proof and the close as the mission echo.",
        needs: ["one statement of two to four lines", "optional a short kicker naming what it is"],
        states: ["long", "empty"], evidence: ["anthropic", "avalon-accounting", "swillhouse", "mercury", "unoit", "sealed-home"] },
    ],
  },
  {
    id: "benefits", name: "Benefits and features",
    when: "The visitor is convinced there is a problem and wants to know what they get.",
    where: "The middle of the page, after the framing and before the proof.",
    variations: [
      { id: "BenefitCards", name: "Feature cards",
        when: "Three to six reasons where the proof is a claim; the 'why choose us' band directly after the problem.",
        needs: ["3-8 items each with a title and 1-2 sentences", "optional icon"],
        states: ["hover", "focus", "long", "empty"], evidence: ["block-renovation", "greenwise-organic-lawn-care", "vivvi", "avalon-accounting"] },
      { id: "BenefitAlternating", name: "Alternating text and images",
        when: "One capability per act with an image or the product as proof, on alternating grounds, the anatomy identical every time.",
        needs: ["2-4 items each with a title, a paragraph and an image"],
        states: ["long", "empty"], evidence: ["linear", "notion", "dropbox", "wealthsimple", "attentive"] },
      { id: "BenefitShowcase", name: "Detailed feature showcase",
        when: "One feature given a whole section: a title, a paragraph, three to five points and a single image or capture.",
        needs: ["title", "paragraph", "3-5 supporting points", "one large image"],
        states: ["hover", "focus", "long", "empty"], evidence: ["dropbox", "webflow", "lava-dental"] },
    ],
  },
  {
    id: "demo", name: "Product demonstration",
    when: "Seeing it work is more persuasive than reading about it.",
    where: "After benefits, before pricing.",
    variations: [
      { id: "DemoScreenshots", name: "Screenshot showcase",
        when: "Real screens at full fidelity with a caption each, for a product whose interface is the proof.",
        needs: ["2-6 screenshots each with a caption"],
        states: ["hover", "focus", "open", "long", "empty"], evidence: ["dropbox", "basecamp", "plausible", "crisp", "pitch"] },
      { id: "DemoVideo", name: "Video preview",
        when: "A real recording behind a real still, its length stated and a fallback beneath; the demo when the product moves.",
        needs: ["poster image", "video URL or file", "duration", "caption"],
        states: ["hover", "focus", "loading", "error"], evidence: ["loom", "crisp", "lanserring", "lava-dental"] },
      { id: "DemoEntryPoint", name: "Interactive demo entry point",
        when: "The product's own first step offered directly, one card per genuine path.",
        needs: ["headline", "what they will be able to do", "the entry link", "what it costs them"],
        states: ["hover", "focus"], evidence: ["webflow"] },
    ],
  },
  {
    id: "process", name: "How it works",
    when: "The visitor's hesitation is about what happens next, not about whether it works.",
    where: "After the offer is clear, before the final call to action.",
    variations: [
      { id: "ProcessThreeStep", name: "Three-step process",
        when: "Three numbered steps for any service where the sequence is the reassurance: re-bath's named process, mercury's ten-minute step list, and habito's numbered badges on each step.",
        needs: ["3 steps each with a title and 1-2 sentences"],
        states: ["long", "empty"], evidence: ["habito", "re-bath", "mercury"] },
      { id: "ProcessDetailed", name: "Detailed onboarding or delivery process",
        when: "Four or more stages with a duration each, for the high-anxiety purchase where the quiet part must be named in advance.",
        needs: ["4-8 stages each with a title, a description and optionally a duration"],
        states: ["long", "empty"], evidence: ["parsley-health", "lava-dental", "pitch", "re-bath"] },
    ],
  },
  {
    id: "usecases", name: "Use cases",
    when: "The same product serves several distinct audiences and each needs to see itself.",
    where: "After benefits. Often the section that routes people into deeper pages.",
    variations: [
      { id: "UseCasesAudience", name: "Organised by audience",
        when: "Distinct audiences routed to their own pages; one audience per page, never mixed.",
        needs: ["3-6 audiences each with a name, a one-line need and a link"],
        states: ["hover", "focus", "long", "empty"], evidence: ["sealed-home", "vivvi", "loom", "pitch"] },
      { id: "UseCasesIndustry", name: "Organised by industry",
        when: "Sectors as a photograph-card grid, each card a router to a real page.",
        needs: ["3-8 industries each with a name and a one-line application"],
        states: ["hover", "focus", "long", "empty"], evidence: ["dropbox", "block-renovation"] },
      { id: "UseCasesTask", name: "Organised by task",
        when: "The job the buyer already knows they need done, each row a router; the form that lets the buyer find themselves.",
        needs: ["3-8 tasks each with a name, an outcome and a link"],
        states: ["hover", "focus", "long", "empty"], evidence: ["loom", "bellroy", "unoit"] },
    ],
  },
  {
    id: "testimonials", name: "Testimonials",
    when: "After the argument and before the close. One real attributed quote beats many weak ones.",
    where: "Late-middle: after benefits or process, before pricing or the closing CTA.",
    variations: [
      { id: "TestimonialSingle", name: "Single standout quote",
        when: "One strong quote with a real attribution on its own panel; the proof before the close.",
        needs: ["the quote verbatim", "a name", "optionally a role and a photograph"],
        states: ["long"], evidence: ["sealed-home", "avalon-accounting", "habito"] },
      { id: "TestimonialGrid", name: "Testimonial grid",
        when: "Several quotes, each attributed, with a rating or a case link where either exists; after the argument, before the close.",
        needs: ["3-9 quotes each with a name", "optional role, company, photograph"],
        states: ["hover", "long", "empty"], evidence: ["avalon-accounting", "parsley-health", "pilot-accounting", "plausible"] },
      { id: "TestimonialVideo", name: "Video testimonial",
        when: "A real person, a real still, their own words transcribed; the strongest proof for a high-trust purchase.",
        needs: ["poster image", "video URL", "name", "a pull quote for people who will not press play"],
        states: ["hover", "focus", "loading", "error"], evidence: ["parsley-health", "lava-dental"] },
    ],
  },
  {
    id: "casestudies", name: "Case studies",
    when: "The purchase is considered and the visitor wants evidence of a comparable job.",
    where: "After proof of capability, often linking to full pages.",
    variations: [
      { id: "CaseFeatured", name: "Featured customer story",
        when: "One story given the whole stage, on a dark flip where the page is light (anthropic's headline project); the maker-site's selected work pushed to a project page (lanserring).",
        needs: ["customer", "the situation", "what was done", "the outcome", "an image", "a link"],
        states: ["hover", "focus", "long"], evidence: ["anthropic", "lanserring"] },
      { id: "CaseResults", name: "Results summary",
        when: "Figures from the customer's own records, named and consenting, and only where the numbers genuinely flex.",
        needs: ["3-6 results each with a figure, a label and the customer"],
        states: ["long", "empty"], evidence: ["mercury", "parsley-health", "dropbox"] },
      { id: "CaseCards", name: "Case study cards",
        when: "The rest of the work as a grid, each card a router to its own page.",
        needs: ["3-9 studies each with a title, a customer, a one-line outcome, an image and a link"],
        states: ["hover", "focus", "long", "empty"], evidence: ["lanserring", "re-bath", "attentive", "pitch"] },
    ],
  },
  {
    id: "pricing", name: "Pricing and packages",
    when: "The price is public. If it is not, use the custom quote variation.",
    where: "Late, after the value is established.",
    variations: [
      { id: "PricingCards", name: "Pricing cards",
        when: "Clearly priced tiers as product cards; on a high-trust purchase the price is part of the reassurance.",
        needs: ["2-4 plans each with a name, a price, a cadence, 3-8 inclusions and a call to action"],
        states: ["hover", "focus", "long", "empty"], evidence: ["parsley-health", "pilot-accounting", "mercury", "lava-dental"] },
      { id: "PricingTable", name: "Comparison table",
        when: "Several priced tiers whose differences are their inclusions. The library presents tiers as product cards, so reach for the table only when the inclusions run longer than a card can carry.",
        needs: ["2-5 plans", "6-20 attributes with a value per plan"],
        states: ["hover", "focus", "long", "empty"], evidence: ["parsley-health", "pilot-accounting"] },
      { id: "PricingQuote", name: "Custom quote option",
        when: "Where the price cannot be listed: the quote path as the primary action and a plain account of what moves the number.",
        needs: ["what drives the price", "what the visitor should send", "how long a quote takes", "a call to action"],
        states: ["hover", "focus", "long", "empty"], evidence: ["caliber", "block-renovation", "greenwise-organic-lawn-care", "re-bath"] },
    ],
  },
  {
    id: "comparison", name: "Comparisons",
    when: "The visitor is actively weighing an alternative, including doing nothing.",
    where: "Late, near pricing. It is a closing argument.",
    variations: [
      { id: "CompareAlternatives", name: "Your solution versus alternatives",
        when: "You against the real alternatives the buyer is weighing, with a fairness note; only with substance.",
        needs: ["your column", "1-3 alternative columns", "4-10 attributes", "a fairness note"],
        states: ["long", "empty"], evidence: ["parsley-health", "plausible"] },
      { id: "CompareBeforeAfter", name: "Current approach versus improved approach",
        when: "The buyer's current approach against yours, statement against statement: plausible's comparative pitch, or parsley's head-to-head table laid out as pairs.",
        needs: ["4-8 paired statements", "a label for each column"],
        states: ["long", "empty"], evidence: ["plausible", "parsley-health"] },
    ],
  },
  {
    id: "faq", name: "FAQs",
    when: "After the evidence and before the final action, framed as removing the unknowns that cause anxiety.",
    where: "Late: after comparison or pricing, immediately before the closing call to action.",
    variations: [
      { id: "FaqVisible", name: "Short visible answers",
        when: "The few questions everyone asks, answered in full and visible; after the evidence and before the final action.",
        needs: ["2-6 question and answer pairs, answers under 60 words"],
        states: ["long", "empty"], evidence: ["parsley-health", "lava-dental"] },
      { id: "FaqAccordion", name: "Expandable questions",
        when: "Everything else, framed as removing the unknowns that cause anxiety; the same position on the page.",
        needs: ["4-20 question and answer pairs"],
        states: ["open", "hover", "focus", "long", "empty"], evidence: ["parsley-health", "lava-dental"] },
    ],
  },
  {
    id: "cta", name: "CTA sections",
    when: "One closing action that echoes the hero's, only after the evidence (mercury, parsley-health); the same action repeated once as a one-line band before the close, for the reader already convinced (block-renovation, webflow).",
    where: "The end of the argument, and at most one echo band before it; no citation shows a banner mid-page.",
    variations: [
      { id: "CtaBanner", name: "Compact banner",
        when: "A one-line band that repeats the page's one action once the argument has landed: block's 'Renovate confidently' band repeats the start-now conversion before the footer, webflow echoes its enterprise CTA before the close.",
        needs: ["one line", "one call to action"],
        states: ["hover", "focus", "long"], evidence: ["block-renovation", "webflow"] },
      { id: "CtaClosing", name: "Full-width closing section",
        when: "The single closing action, echoing the hero's, after the evidence and never before it.",
        needs: ["headline", "a sentence", "1-2 calls to action"],
        states: ["hover", "focus", "long"], evidence: ["mercury", "parsley-health", "notion", "attentive", "unoit"] },
      { id: "CtaWithProof", name: "CTA with supporting proof",
        when: "The close with a real count or quote beside the action, where the brand has the numbers.",
        needs: ["headline", "call to action", "one quote or 2-3 figures"],
        states: ["hover", "focus", "long"], evidence: ["wealthsimple", "barrys", "greenwise-organic-lawn-care"] },
    ],
  },
  {
    id: "forms", name: "Conversion forms",
    when: "Wherever the visitor is asked to hand over their details. The page that has to work.",
    where: "On its own page, or as the closing section of a landing page.",
    variations: [
      { id: "FormContact", name: "Contact",
        when: "The general contact form, kept reachable throughout; the smallest ask first.",
        needs: ["name", "email", "message", "a destination for the submission"],
        states: ["focus", "loading", "success", "error", "long"], evidence: ["avalon-accounting", "block-renovation", "mercury"] },
      { id: "FormEnquiry", name: "Enquiry",
        when: "The structured enquiry for a quote, in view early on an anxious purchase.",
        needs: ["name", "contact", "what they need", "location", "optional detail and file"],
        states: ["focus", "loading", "success", "error", "long"], evidence: ["re-bath", "block-renovation", "greenwise-organic-lawn-care"] },
      { id: "FormBooking", name: "Booking",
        when: "Booking first, where the business runs on appointments or classes.",
        needs: ["name", "contact", "service", "preferred date and time", "availability rules"],
        states: ["focus", "loading", "success", "error", "empty"], evidence: ["barrys", "warby-parker", "myodetox", "dishoom"] },
      { id: "FormSignup", name: "Signup",
        when: "A low-pressure capture with the smallest possible ask; never the close.",
        needs: ["email", "optional name", "consent text where required"],
        states: ["focus", "loading", "success", "error"], evidence: ["habito", "aesop", "parsley-health"] },
    ],
  },
  {
    id: "locality", name: "Locality", origin: "library",
    when: "Any business that comes to you or that you go to: trades, clinics, studios, restaurants. Every local-service flagship in the survey makes place concrete before it asks for a commitment, and nothing in the sixteen pieces could.",
    where: "After trust for a quote business; inside or directly after the hero for a booking business; as a list in the footer on every page.",
    variations: [
      { id: "ServiceArea", name: "Service areas",
        when: "Named areas with per-area contact, so locality is concrete before the buyer commits.",
        needs: ["2-8 areas, each with a name and the suburbs or towns it covers", "optional a phone per area", "optional a link per area"],
        states: ["hover", "focus", "long", "empty"], evidence: ["greenwise-organic-lawn-care", "block-renovation", "parsley-health"] },
      { id: "CoverageChecker", name: "Coverage checker",
        when: "A postcode or suburb check that confirms coverage and routes to the quote: the smallest ask, then personalise.",
        needs: ["the list of covered postcodes or suburbs", "where a covered visitor goes next", "what an uncovered visitor is told"],
        states: ["focus", "success", "error", "empty"], evidence: ["greenwise-organic-lawn-care", "re-bath", "block-renovation"] },
      { id: "LocationFinder", name: "Location finder",
        when: "Locations as a list with a page each and the nearest one made bookable; in the hero for booking, after trust for a visit.",
        needs: ["2-12 locations, each with a name, an address and a link", "optional hours and a phone per location", "optional the booking action"],
        states: ["hover", "focus", "long", "empty"], evidence: ["barrys", "aesop", "unoit", "vivvi", "lava-dental"] },
    ],
  },
  {
    id: "footer", name: "Footer",
    when: "Every page.",
    where: "Last.",
    variations: [
      { id: "FooterSimple", name: "Simple footer",
        when: "A same-ground or inset footer for a page that already alternates; contact and legal, nothing more.",
        needs: ["business name", "one contact route", "2-6 links", "copyright"],
        states: ["hover", "focus", "long"], evidence: ["mercury"] },
      { id: "FooterGrouped", name: "Larger footer with grouped links and company details",
        when: "The mode-flipped close that weighs as much as the hero: link columns, newsletter, locations, the legal a regulated brand needs, and the wordmark at the bottom.",
        needs: ["business name", "contact details", "2-4 link groups", "company or licence details", "copyright"],
        states: ["hover", "focus", "long"], evidence: ["anthropic", "aesop", "parsley-health", "greenwise-organic-lawn-care", "swillhouse", "warby-parker"] },
    ],
  },
];

/** Every variation, flattened. Used by the kit index and the completeness gate. */
export const kitVariations = kit.flatMap((p) =>
  p.variations.map((v) => ({ ...v, piece: p.id, pieceName: p.name })),
);

/** Derived, never typed: 50 after the locality piece and the two library-added variations. The gate asserts the components match. */
export const KIT_VARIATION_COUNT = kitVariations.length;
