/**
 * The rubric, in the worker's runtime.
 *
 * SINGLE SOURCE OF TRUTH for scoring. The worker computes the score and writes the
 * rendered result to the database; the web app reads it and displays it. That is
 * deliberate: the previous arrangement had rubric.ts in apps/web recomputing a score
 * from stored fragments, which is two implementations of the same arithmetic waiting
 * to disagree about a number a stranger is going to dispute.
 *
 * Ported from apps/grader/src/lib/rubric.ts. Spec: docs/grader/rubric-v1.md.
 *
 * Two properties are load-bearing:
 *   1. Checks score CONTINUOUSLY in [0,1]. `interp` is the only scorer for anything
 *      numeric, so nothing drops a grade band for being 40ms over a threshold.
 *   2. Inapplicable checks leave the numerator AND the denominator. Zeroing a check
 *      we could not run would charge a stranger's site for our own missing feature.
 */

export const DIMENSIONS = [
  {
    id: "design", label: "Design craft and motion", weight: 40,
    checks: [
      { id: "originality_vs_template", label: "Designed, not templated", points: 30, fix: "Take one structural idea from a reference in your own field, a real grid break or a type moment, and rebuild the first screen around it. Recolouring the same template does not move this." },
      { id: "hierarchy_and_focal_placement", label: "Visual hierarchy", points: 11, fix: "Choose the one element that should dominate the first screen, then make everything else smaller, quieter or later." },
      { id: "type_system_discipline", label: "Type system", points: 8, fix: "Two faces and one scale: a display face for headings, one for body, no more than three sizes per section, body at 16px+ with line-height 1.5 to 1.7 on a phone." },
      { id: "colour_accent_discipline", label: "Colour discipline", points: 7, fix: "Replace the inherited accent with one you chose, and hold it to one or two accents against real neutrals." },
      { id: "responsive_integrity", label: "Mobile is designed, not squashed", points: 7, fix: "Design the 390px layout rather than letting it reflow: its own type scale, a real mobile nav, no horizontal scroll, tap targets 44px or larger." },
      { id: "reduced_motion_and_resting_state", label: "Content is visible at rest", points: 6, fix: "Make the resting state the visible state: animate reveals from visible rather than from opacity 0, honour prefers-reduced-motion, and read the page once with JavaScript off." },
      { id: "component_detail_craft", label: "Component detail", points: 6, fix: "Pick one radius, one border weight and one shadow depth and use them everywhere. Delete the row of three identical icon cards." },
      { id: "spacing_rhythm", label: "Spacing rhythm", points: 4, fix: "Put section padding on one ramp and reuse two or three values from it." },
      { id: "signature_move_present", label: "One considered idea", points: 15, fix: "Add one idea a template could not have produced: a type moment, an editorial grid break, or an interaction that belongs to this business specifically." },
      { id: "text_over_media_treatment", label: "Text over imagery", points: 3, fix: "Put a scrim, a plate or a crop between the text and the imagery instead of reaching for bolder type." },
      { id: "motion_quality", label: "Motion quality", points: 3, fix: "Give the page back to the scrollbar: no scroll hijacking, no cursor-follower, no infinite marquee." },
    ],
  },
  {
    id: "performance", label: "Performance", weight: 14,
    checks: [
      { id: "lcp", label: "Largest Contentful Paint", points: 30, fix: "Find what paints last and make it arrive first: compress the hero, serve it as AVIF or WebP at the size it renders, preload it, and stop fonts blocking first paint." },
      { id: "responsiveness", label: "Responsiveness to input", points: 20, fix: "Take third-party JavaScript off the main thread at load. Chat widgets, maps and heat-mapping can load on first interaction." },
      { id: "cls", label: "Layout stability", points: 16, fix: "Reserve the space: width and height on every image, a fixed height for every embed slot, and a fallback font whose metrics match the webfont." },
      { id: "lcp_resource_discovery", label: "Hero image discoverability", points: 12, fix: "Put the hero in the HTML with a preload link, drop loading=\"lazy\" above the fold, and stop injecting it from JavaScript." },
      { id: "third_party_blocking_cost", label: "Third-party main-thread cost", points: 10, fix: "Take the heaviest named third party off the critical path: load it on interaction, self-host it, or drop it." },
      { id: "js_execution_and_payload", label: "JavaScript weight", points: 7, fix: "Ship less JavaScript than the page needs to render, and split what is left so the first screen does not wait on the rest." },
      { id: "image_delivery_and_sizing", label: "Image delivery", points: 5, fix: "Serve images at the size they render, in AVIF or WebP." },
    ],
  },
  {
    id: "content", label: "Content clarity and substance", weight: 13,
    checks: [
      { id: "entity_fact_extractability", label: "Can a machine answer the basics", points: 26, fix: "State in plain text what you do, for whom, and where. A reader should not have to infer it from a photograph." },
      { id: "conversion_clarity", label: "One obvious next action", points: 22, fix: "Pick one primary action per page and make it the only thing at that visual weight." },
      { id: "title_and_snippet_targeting", label: "Title and description", points: 20, fix: "Write a title of 15 to 65 characters and a description of 70 to 165 that say what this page offers, not what the company is called." },
      { id: "factual_density_and_sourcing", label: "Specifics over adjectives", points: 18, fix: "Replace the adjectives with facts: numbers, names, dates, places." },
      { id: "quotable_chunk_structure", label: "Heading structure", points: 14, fix: "One h1, then h2s and h3s in order with nothing skipped." },
    ],
  },
  {
    id: "technical", label: "Technical foundations", weight: 11,
    checks: [
      { id: "index_eligibility", label: "Can search engines index it", points: 24, fix: "Remove the noindex directive from the page and the response headers." },
      { id: "canonical_integrity", label: "Canonical correctness", points: 18, fix: "Add a self-referencing canonical link to every page." },
      { id: "internal_link_graph", label: "Internal linking", points: 14, fix: "Link to your own important pages from the homepage in real anchor tags, not from a script-driven menu." },
      { id: "redirect_and_error_hygiene", label: "Redirects and errors", points: 12, fix: "Make the canonical URL load directly, with no redirect chain in front of it." },
      { id: "sitemap_and_discovery", label: "Sitemap and robots", points: 11, fix: "Publish a sitemap and declare it in robots.txt." },
      { id: "structured_data_that_earns", label: "Structured data", points: 11, fix: "Add the schema.org type that matches this business and currently earns a rich result." },
      // Added 2026-08-04 after comparing coverage against a conventional SEO audit. Every
      // link to this site that anyone shares — in a DM, a Slack channel, a LinkedIn post —
      // renders from these tags. Without them a share is a bare URL, which is the single
      // most visible SEO defect a business can have and the cheapest to fix. The other six
      // were each reduced slightly so the dimension still totals 100.
      { id: "social_preview_tags", label: "Link preview when shared", points: 10, fix: "Add og:title, og:description and a 1200x630 og:image, plus twitter:card set to summary_large_image. Without them every share of your site renders as a bare link." },
    ],
  },
  {
    id: "accessibility", label: "Accessibility", weight: 12,
    checks: [
      { id: "text_contrast", label: "Text contrast", points: 22, fix: "Raise text contrast to at least 4.5:1 against its background, 3:1 for large text." },
      { id: "control_accessible_names", label: "Controls have names", points: 20, fix: "Give every button and link text or an aria-label. An icon on its own announces nothing." },
      { id: "keyboard_operability", label: "Keyboard operability", points: 20, fix: "Make every control reachable with Tab and every overlay dismissible with Escape." },
      { id: "focus_visibility", label: "Visible focus", points: 14, fix: "Give focus a visible ring of at least 3:1 against its surroundings, and never remove the outline without replacing it." },
      { id: "structure_and_landmarks", label: "Structure and language", points: 14, fix: "Set lang on the html element, wrap the page in a main landmark, and write alt text that says what the image shows." },
      { id: "forms_and_errors", label: "Forms and errors", points: 10, fix: "Give every field a real label, and tie each error message to its field programmatically." },
    ],
  },
  {
    id: "ai", label: "AI answer-engine readiness", weight: 10,
    checks: [
      { id: "server_rendered_main_content", label: "Content exists without JavaScript", points: 32, fix: "Render your main content on the server. Google runs JavaScript; the AI crawlers do not." },
      { id: "ai_bot_fetch_parity", label: "AI crawlers are actually served", points: 28, fix: "Allow the answer-engine crawlers through your CDN or WAF. Your robots.txt permitting them counts for nothing if the edge returns 403." },
      { id: "answer_bot_robots_access", label: "Answer engines allowed in robots.txt", points: 22, fix: "Allow OAI-SearchBot, PerplexityBot and Claude-SearchBot in robots.txt. These are the ones that cite you, not the training crawlers." },
      { id: "snippet_eligibility", label: "Snippets permitted", points: 10, fix: "Remove the nosnippet or max-snippet:0 directive that is suppressing your own excerpt." },
      { id: "organization_schema_and_sameas", label: "Entity wiring", points: 8, fix: "Add Organization or LocalBusiness schema with a sameAs pointing at your real profiles." },
    ],
  },
];

export const BANDS = [
  { min: 90, band: "A", name: "Exceptional", note: "Designed by someone with taste, and it holds up under measurement." },
  { min: 80, band: "B", name: "Strong", note: "Clearly considered. A handful of fixable faults, no structural problems." },
  { min: 70, band: "C", name: "Solid", note: "Works properly. Competent rather than distinctive." },
  { min: 60, band: "D", name: "Generic", note: "Nothing broken, nothing chosen. What a template plus a logo scores." },
  { min: 45, band: "E", name: "Underbuilt", note: "Real defects that cost real customers." },
  { min: 30, band: "F", name: "Failing visitors", note: "Several dimensions failing at once." },
  { min: 0, band: "G", name: "Broken", note: "Something fundamental is wrong." },
];

export const bandFor = (s) => BANDS.find((b) => s >= b.min) ?? BANDS[BANDS.length - 1];

export function interp(value, good, bad) {
  if (!Number.isFinite(value)) return 0;
  const raw = good < bad ? (bad - value) / (bad - good) : (value - bad) / (good - bad);
  return Math.max(0, Math.min(1, raw));
}

export const CAPS = [
  { id: "sitewide_noindex", cap: 55, reason: "the site tells search engines not to index it" },
  { id: "robots_disallow_all", cap: 55, reason: "robots.txt blocks crawlers from the whole site" },
  { id: "no_content_without_js", cap: 65, reason: "almost no content is present before JavaScript runs" },
  { id: "lcp_catastrophic", cap: 60, reason: "the main content takes more than 15 seconds to appear" },
];

/**
 * Roll checks up to dimensions and an overall.
 *
 * `results` is a Map of id -> {raw, detail, applicable?, lowConfidence?}. Anything
 * absent or applicable:false leaves the denominator, and the dimension reports how
 * many of its checks were actually measured so the report can say "5 of 11" rather
 * than implying a full reading.
 */
export function score(results, capIds = []) {
  let weighted = 0, weightUsed = 0, lowConfWeight = 0;

  const dimensions = DIMENSIONS.map((d) => {
    const rows = d.checks
      .map((c) => {
        const r = results.get(c.id);
        if (!r || r.applicable === false) return null;
        return { ...r, id: c.id, label: c.label, points: c.points, fix: c.fix };
      })
      .filter(Boolean);

    const denom = rows.reduce((a, r) => a + r.points, 0);
    const num = rows.reduce((a, r) => a + r.points * r.raw, 0);
    const dScore = denom > 0 ? (100 * num) / denom : 0;
    if (denom > 0) {
      weighted += d.weight * dScore;
      weightUsed += d.weight;
      lowConfWeight += d.weight * (rows.filter((r) => r.lowConfidence).reduce((a, r) => a + r.points, 0) / denom);
    }
    return {
      id: d.id, label: d.label, weight: d.weight,
      score: Math.round(dScore), measured: rows.length, total: d.checks.length,
      checks: rows.sort((a, b) => a.raw - b.raw),
    };
  });

  let overall = weightUsed > 0 ? Math.round(weighted / weightUsed) : 0;
  const caps = CAPS.filter((c) => capIds.includes(c.id)).map((c) => ({ reason: c.reason, cap: c.cap }));
  for (const c of caps) overall = Math.min(overall, c.cap);

  // THE DESIGN CEILING. Overall cannot exceed design craft by more than 15.
  //
  // Without it this grader rewards hygiene, and hygiene is precisely what a template
  // ships correctly. Measured on 2026-07-30: a template dentist site scored 69 overall
  // against linear.app's 66, because the template had cleaner markup, better structured
  // data and faster mobile paint, while scoring 49 on design against Linear's 68. A
  // report that ranks those two that way is not one we can put our name on, let alone
  // point advertising at.
  //
  // This is not a thumb on the scale, it is the product's actual claim. Palate grades
  // taste. Valid HTML, a sitemap and a fast LCP are table stakes that a page builder
  // gives you for free; they cannot add up to a well-designed site, so they must not add
  // up to a good grade. +15 leaves real room for a plain-but-solid site to be rewarded
  // for the things it does well, and stops the composite from burying the one dimension
  // the reader came for.
  const designScore = dimensions.find((d) => d.id === "design")?.score ?? null;
  if (designScore != null && dimensions.find((d) => d.id === "design")?.measured > 0) {
    const ceiling = designScore + 15;
    if (overall > ceiling) {
      overall = ceiling;
      caps.push({ reason: "design craft is what this grade measures first, and it is holding the rest back", cap: ceiling });
    }
  }

  // Publish the noise rather than pretending there is none. A run with a wide band is
  // telling the truth about itself.
  const measuredWeight = weightUsed;
  const unmeasured = 100 - measuredWeight;
  const confidence = Math.max(2, Math.min(10,
    Math.ceil((lowConfWeight / Math.max(1, measuredWeight)) * 6) + 2 + Math.round(unmeasured / 25)));

  // Findings, ranked by points RECOVERABLE across the whole rubric rather than by raw
  // score: a 0.2 on a 30-point check matters more than a 0 on a 5-point one.
  const findings = dimensions
    .flatMap((d) => d.checks.map((c) => ({ ...c, dimension: d.id, recoverable: (c.points * (1 - c.raw) * d.weight) / 100 })))
    .filter((c) => c.raw < 0.75)
    .sort((a, b) => b.recoverable - a.recoverable);

  return { overall, band: bandFor(overall), confidence, dimensions, caps, findings, measuredWeight };
}
