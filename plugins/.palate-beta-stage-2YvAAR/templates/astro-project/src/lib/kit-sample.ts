/**
 * SAMPLE CONTENT FOR THE KIT DEMO PAGES, AND FOR NOTHING ELSE.
 *
 * ============================ WHY THIS FILE EXISTS ============================
 *
 * A component must never invent a person, a firm or a file. A build that forgets to pass
 * `siteName`, `businessName`, `poster` or a testimonial array has to get NOTHING back, because
 * the alternative is a plausible-looking fiction: a real client's header carrying an invented
 * joinery firm on every page, six invented customers saying invented things under their site's
 * own logo, or a broken-image marker where a video poster should be. This repo has already
 * shipped invented testimonials signed with real customers' names, so the defect is not
 * hypothetical.
 *
 * But the demo pages at /kit/<piece>/<variation> still have to look like something. A section
 * library shown entirely in its empty state proves nothing about whether the sections are any
 * good, and the kit index exists precisely so the kit can be judged rather than asserted.
 *
 * So the two needs are separated: the COMPONENT defaults to empty and renders its empty state,
 * and the DEMO PAGE passes sample props in from here. The fiction lives in one file that no
 * real page imports, rather than scattered through forty-five components where a forgotten prop
 * turns it into a claim about a real business.
 *
 * ============================== THE RULE ==============================
 *
 * NEVER import this from a page, a layout or a component that ships to a client. It is imported
 * by exactly one file, src/pages/kit/[piece]/[variation].astro, which is noindex and which
 * gate-shipready strips at handover along with the other working surfaces.
 *
 * Everyone and everything named below is invented. The names, firms, ratings, figures, licence
 * numbers and quotes are all fictional, and the phone numbers and email addresses use the
 * reserved example ranges so nothing here can reach a real person.
 *
 * ============================== THE ASSETS ==============================
 *
 * The media under public/images/kit/ and public/media/kit/ is drawn and encoded for this file.
 * Nothing in it is a real company's logo or a real person: the screens are an invented product
 * and the wordmarks are invented firms.
 *
 * PHOTOGRAPHS. public/images/kit/photo/ holds licensed Unsplash photography, every file listed
 * with its photographer in credits.json beside it, fetched and LOOKED AT before it was kept. They
 * exist so the composed example pages can be judged as pages rather than as grey boxes, which is
 * what the library's own notes say a photographic hero needs (aesop, lanserring: emptiness without
 * real photography reads as half-built). They are never presented as anybody's own work: no
 * caption on a demo page claims a photograph shows the invented business's job, and no
 * testimonial carries a face. A slot meant for the client's own photograph is still filled with
 * the client's own photograph on a real build, and gate-shipready strips these with the rest.
 *
 * They are real files rather than an empty frame because a component demonstrating its shape is
 * not the same as a component demonstrating its content. A gallery of grey boxes cannot show
 * whether the gallery is any good, and a video piece stuck on its poster cannot show that it
 * plays. All of it loads through <img> or <video>, which makes each asset an isolated document,
 * so the `var(--kit-*)` written inside them does NOT pick up the brand and the neutral literal
 * beside it is what renders. That is why they are neutral: an asset cannot read the accent it
 * would otherwise clash with.
 *
 * NOTHING HERE IS STRIPPED AUTOMATICALLY. gate-shipready retires the Explore surfaces and it has
 * no rule for these, so the whole sample footprint is this file, src/pages/kit/, and those two
 * asset directories. Delete all four at handover, or accept that they ship as dead weight on the
 * client's domain.
 */

/** Keyed by the variation id in src/lib/kit.ts. Spread into the component by the demo page. */
export const kitSamples: Record<string, Record<string, unknown>> = {
  // ---------------------------------------------------------------- navigation
  NavSimple: {
    siteName: "Halbrook Joinery",
  },
  NavDropdown: {
    siteName: "Marram Supply",
  },

  AnnouncementBar: {
    text: "Storm season bookings are open: a roof check now beats a bucket in the hallway in July.",
    link: { label: "Book a roof check", href: "/book" },
  },

  // ---------------------------------------------------------------- hero
  HeroTextImage: {
    /* Only the picture. The component's own headline and lede are about a joinery workshop and
       are correct as they stand, so restating them here would be one more copy to keep in step. */
    image: {
      src: "/images/kit/texture-case-2.svg",
      alt: "",
      width: 1200,
      height: 900,
    },
    ratio: "photo",
  },
  HeroCentredPreview: {
    /*
     * The copy is restated here, which the other hero entries do not do, because this one has to
     * agree with the picture. The shipped screenshots are an invented scheduling tool called
     * Roundhouse, and the component's own default copy names a different invented product, so a
     * demo page taking the screenshot and leaving the words would read as two products in one
     * hero. The words follow the asset rather than the asset being redrawn per hero.
     */
    headline: "Quote it in the van, before you have driven home",
    lede: "Roundhouse keeps the costs, the hours and the materials on the one screen, so the total is in front of you while the quote is still editable.",
    note: "Free for one van. Nothing to pay until you add a second.",
    preview: {
      src: "/images/kit/screen-quote.svg",
      alt: "A quote on a phone, four line items deep, with the running total pinned under them.",
      width: 1600,
      height: 1000,
    },
    ratio: "wide",
  },
  HeroServicePhoto: {
    /* A full-bleed slot with white type and a scrim over it, so the stand-in is drawn dark to
       begin with rather than relying on the scrim to rescue a light one. */
    photo: {
      src: "/images/kit/texture-hero.svg",
      alt: "",
      width: 1920,
      height: 1080,
    },
  },

  // ---------------------------------------------------------------- trust
  TrustLogos: {
    /*
     * Six invented wordmarks, one ink, each at its own natural proportion. TrustLogos constrains
     * a mark by HEIGHT, so the widths differ on purpose: a strip where every file is the same
     * shape proves nothing about how the piece handles a tall monogram beside a long wordmark.
     *
     * The mark drops the trade word ("Northbeam", not "Northbeam Civil") the way a real one does.
     * `name` carries the full name because it is the alt text and the no-file fallback.
     */
    logos: [
      { name: "Northbeam Civil", src: "/images/kit/logo-northbeam.svg", width: 372, height: 80 },
      { name: "Harbourline Freight", src: "/images/kit/logo-harbourline.svg", width: 352, height: 80 },
      { name: "Tallow Creek Dairy", src: "/images/kit/logo-tallowcreek.svg", width: 372, height: 80 },
      { name: "Verrall & Sons Joinery", src: "/images/kit/logo-verrall.svg", width: 392, height: 80 },
      { name: "Kestrel Signage", src: "/images/kit/logo-kestrel.svg", width: 322, height: 80 },
      { name: "Merrivale Health", src: "/images/kit/logo-merrivale.svg", width: 332, height: 80 },
    ],
  },
  TrustRatings: {
    ratings: [
      {
        value: 4.8,
        outOf: 5,
        count: 312,
        sourceName: "Coastwide Trades Register",
        sourceUrl: "#",
        note: "Verified jobs only, collected since March 2024.",
      },
      {
        value: 4.6,
        outOf: 5,
        count: 87,
        sourceName: "Fernbrook Business Directory",
        sourceUrl: "#",
      },
    ],
  },

  // ---------------------------------------------------------------- problem
  ProblemBeforeAfter: {
    /*
     * A matched pair: the same drawing, the same palette and the same seed, with only the edges
     * changing. The "before" is broken and the "after" is made good, so the pair carries the
     * difference itself instead of leaning on the two captions to explain it.
     *
     * The labels and captions repeat the component's own defaults verbatim. They have to be
     * restated because `before` and `after` are whole objects and passing one replaces it.
     */
    before: {
      src: "/images/kit/texture-before.svg",
      alt: "",
      label: "Before",
      caption: "Rusted valley irons, two failed inspections and water tracking into the back bedroom.",
    },
    after: {
      src: "/images/kit/texture-after.svg",
      alt: "",
      label: "After",
      caption: "New valleys, re-bedded ridge capping and a report the insurer accepted without a second visit.",
    },
  },
  ProblemStory: {
    heading: "A dairy that had stopped answering its own phone",
    image: {
      src: "/images/kit/texture-case-3.svg",
      ratio: "photo",
      alt: "",
      caption: "The order board in the Tallow Creek dispatch shed, photographed the week the form went live.",
    },
    paragraphs: [
      "Tallow Creek took orders on a mobile that lived in the milk room. Half of them arrived while the plant was running, which meant nobody heard it, and the voicemail box had been full since the previous spring.",
      "They were not losing customers to a competitor. They were losing them to a busy signal. The first thing we did was count it: over six weeks, 118 calls went unanswered and 41 of those callers never rang back.",
      "The fix was not a bigger website. It was an order form that worked on a phone, a number that rang two handsets, and a page that said plainly what could be delivered and when.",
      "Orders through the site now cover about a third of weekly volume, and the milk room phone rings for the things a form cannot handle.",
    ],
    attribution: { name: "Tallow Creek Dairy", role: "Wholesale orders", org: "Fernbrook" },
  },

  ProblemStatement: {
    kicker: "Where we stand",
    statement:
      "A roof should be the part of the house you think about least. We fix it once, in the material " +
      "it was built in, and we tell you plainly when a repair is the honest answer and a new roof is not.",
  },

  // ---------------------------------------------------------------- benefits
  BenefitShowcase: {
    /* Only the picture and its caption. `image` is a single object, so passing it replaces the
       component's own default image and nothing else; its title, paragraph and points stand.
       BenefitAlternating is deliberately NOT here: its images live inside an items array, so
       filling them would mean copying three paragraphs of its default prose into this file and
       then keeping the two in step forever. It renders its ratio boxes instead. */
    image: {
      src: "/images/kit/texture-case-1.svg",
      ratio: "wide",
      alt: "",
      caption: "A scope from a recent bathroom job, with the exclusions section on the second page.",
    },
  },

  // ---------------------------------------------------------------- demo
  DemoScreenshots: {
    /* Four screens of an invented trades scheduling tool, drawn for this file. They are
       deliberately unlike each other (a dense week grid, a two-column job record, a phone, a
       customer-facing confirmation) because a gallery of four near-identical screens cannot show
       whether the gallery is doing its job. */
    screenshots: [
      {
        src: "/images/kit/screen-schedule.svg",
        width: 1600,
        height: 1000,
        alt: "A week view with eight jobs laid out across three vans, two of them marked as running late.",
        caption: "The week, before anyone rings to change it",
      },
      {
        src: "/images/kit/screen-job.svg",
        width: 1600,
        height: 1000,
        alt: "One job opened, showing the accepted quote, the site notes and two photographs from the last visit.",
        caption: "One job, with the quote and the site notes in the same place",
      },
      {
        src: "/images/kit/screen-quote.svg",
        width: 1600,
        height: 1000,
        alt: "A quote being built on a phone, with four line items and a running total at the bottom of the screen.",
        caption: "Quoting from the van, in about four minutes",
      },
      {
        src: "/images/kit/screen-confirm.svg",
        width: 1600,
        height: 1000,
        alt: "The customer's confirmation screen, showing an arrival window and the name of the technician.",
        caption: "What the customer sees when you book them in",
      },
    ],
  },
  DemoVideo: {
    /*
     * A real six-second file, so the demo page shows the piece PLAYING rather than the piece
     * stuck on its poster, which is the only state a missing file can demonstrate.
     *
     * That does cost the error state a route: it used to be reachable here by pointing at a file
     * that was never going to load. It is still reachable, on the campaign example page, which
     * carries a deliberately absent src for exactly that reason.
     */
    src: "/media/kit/product-tour.mp4",
    poster: "/images/kit/poster-tour.svg",
    posterAlt: "",
  },

  // ---------------------------------------------------------------- testimonials
  TestimonialGrid: {
    items: [
      {
        quote: "They turned up when they said they would, three times running. I know that sounds like a low bar. It is not one our last two trades cleared.",
        name: "Priya Raghavan",
        company: "Corbett Street Dental",
      },
      {
        quote: "The quote explained what was optional and what was not, so we could actually choose. Nobody had done that for us before.",
        name: "Tomas Lindqvist",
        role: "Facilities lead",
        company: "Ferndale Community Housing",
      },
      {
        quote: "Half the job was undoing someone else's shortcut, and they showed me photographs of it rather than just adding a line to the bill.",
        name: "Dee Ashworth",
        location: "Pemberton",
      },
      {
        quote: "We were quoted six weeks by two other firms. This came in at nine days and it held.",
        name: "Owen Brickhill",
        company: "Tumbleweed Coffee Roasters",
      },
      {
        quote: "Careful with the floors, careful with the dog, and they swept up. Small things, but they are the things I remember.",
        name: "Marguerite Sowden",
        location: "Ashgrove",
      },
      {
        quote: "The follow-up call six months later was not a sales call. They wanted to know whether the drainage had held through the wet season. It had.",
        name: "Callum Whittaker",
        company: "Brindle Veterinary",
      },
    ],
  },
  TestimonialVideo: {
    /* The poster is a drawn silhouette against a window, not a face. A rendered person would be
       both uncanny and dishonest, and a silhouette is a real way to frame an interview, so the
       piece gets a plausible composition without anybody being invented into existence. */
    poster: "/images/kit/poster-testimonial.svg",
    videoUrl: "/media/kit/testimonial.mp4",
    name: "Dee Ashworth",
    role: "Owner",
    location: "Pemberton",
  },

  /**
   * BENEFIT CARDS ARE SHOWN LINKED, because the manifest says the piece has hover and focus
   * states and the component's own defaults carry no href, so at rest there was nothing in the
   * piece that could take focus at all. Found by driving the focus state rather than by reading
   * the component: the driver reported "nothing in this piece takes keyboard focus", which is a
   * true statement about a demo that was not showing the piece in the shape its states describe.
   */
  BenefitCards: {
    items: [
      {
        title: "Measured on site, not from a plan",
        body: "Somebody comes out and records the opening as it actually sits, including the out of square a drawing never shows.",
        href: "/approach/the-measure",
      },
      {
        title: "Made on our own bench",
        body: "Which is what lets us match a profile nobody has manufactured for thirty years.",
        href: "/approach/the-workshop",
      },
      {
        title: "Fitted by the people who made it",
        body: "The person adjusting the hardware assembled it, so there is nobody in between to blame.",
        href: "/approach/installation",
      },
    ],
  },

  // ---------------------------------------------------------------- case studies
  CaseFeatured: {
    customer: "Ferndale Community Housing",
    image: {
      src: "/images/kit/texture-case-1.svg",
      alt: "Roofers working on one section of a terrace roof while the flats below remain occupied",
    },
  },
  CaseResults: {
    results: [
      {
        figure: "9 days",
        label: "On site for a roof replacement across eleven occupied units",
        customer: "Ferndale Community Housing",
        note: "Quoted elsewhere at three weeks plus rehousing.",
      },
      {
        figure: "31%",
        label: "Lower gas use across a full brewing season",
        customer: "Copperline Brewing",
        note: "Season on season, measured from their own meter readings.",
      },
      {
        figure: "0",
        label: "Callbacks in two winters since handover",
        customer: "Ferndale Community Housing",
      },
      {
        figure: "4 hours",
        label: "Total downtime during the changeover",
        customer: "Tumbleweed Coffee Roasters",
        note: "Overnight, so no trading hours were lost.",
      },
    ],
  },
  CaseCards: {
    studies: [
      {
        title: "Eleven occupied units re-roofed in nine days",
        customer: "Ferndale Community Housing",
        outcome: "No tenant was rehoused and the work came in under the original rehousing budget alone.",
        image: {
          src: "/images/kit/texture-case-1.svg",
          alt: "A terrace roof part way through replacement, with the flats below still occupied",
        },
        href: "/case-studies/ferndale-community-housing",
        tag: "Social housing",
      },
      {
        title: "Heat recovery retrofitted around a working brewhouse",
        customer: "Copperline Brewing",
        outcome: "Gas use fell 31 per cent across a full season, with no lost brewing days.",
        image: {
          src: "/images/kit/texture-case-2.svg",
          alt: "Stainless heat exchange pipework running above brewing vessels",
        },
        href: "/case-studies/copperline-brewing",
        tag: "Food and drink",
      },
      {
        title: "A four-hour overnight changeover for a roastery",
        customer: "Tumbleweed Coffee Roasters",
        outcome: "The old system came out and the new one went in between close and the first roast.",
        image: {
          src: "/images/kit/texture-case-3.svg",
          alt: "A coffee roaster with new extraction ducting fitted overhead",
        },
        href: "/case-studies/tumbleweed-coffee-roasters",
        tag: "Manufacturing",
      },
    ],
  },

  // ---------------------------------------------------------------- locality
  ServiceArea: {
    lede: "Three crews, each based in the area it covers, so the person who quotes is the person who turns up.",
    areas: [
      {
        name: "Inner west",
        covers: "Marrickville, Dulwich Hill, Summer Hill, Ashfield, Leichhardt and Petersham.",
        phone: "(02) 5550 0142",
        href: "/areas/inner-west",
        linkLabel: "Inner west crew",
      },
      {
        name: "Lower north shore",
        covers: "Lane Cove, Chatswood, Willoughby, Artarmon and Naremburn.",
        phone: "(02) 5550 0143",
        href: "/areas/lower-north-shore",
        linkLabel: "North shore crew",
      },
      {
        name: "Northern beaches",
        covers: "Manly, Dee Why, Brookvale, Narrabeen and Mona Vale.",
        phone: "(02) 5550 0144",
        href: "/areas/northern-beaches",
        linkLabel: "Beaches crew",
      },
    ],
    outsideNote: "Not on the list?",
    outsideHref: "/contact",
    outsideLabel: "Ask whether we can come to you",
  },
  CoverageChecker: {
    lede: "Type your postcode or suburb and we will tell you straight away, no form first.",
    covered: [
      "2204", "2203", "2130", "2131", "2040", "2049",
      "2066", "2067", "2068", "2064", "2065",
      "2095", "2099", "2100", "2101", "2103",
      "Marrickville", "Dulwich Hill", "Summer Hill", "Ashfield", "Leichhardt", "Petersham",
      "Lane Cove", "Chatswood", "Willoughby", "Artarmon", "Naremburn",
      "Manly", "Dee Why", "Brookvale", "Narrabeen", "Mona Vale",
    ],
    state: "NSW",
    city: "Sydney",
    nextHref: "/quote",
    nextLabel: "Ask for a quote",
    errorHref: "/contact",
  },
  LocationFinder: {
    lede: "Drop in with a sample of your tile or gutter profile and we will match it on the spot.",
    locations: [
      {
        name: "Marrickville workshop",
        address: "Unit 4, 118 Wentworth Parade, Marrickville NSW 2204",
        href: "/locations/marrickville",
        hours: "Mon to Fri 7am to 4pm, Sat 8am to 12pm",
        phone: "(02) 5550 0142",
      },
      {
        name: "Artarmon yard",
        address: "31 Kiln Lane, Artarmon NSW 2064",
        href: "/locations/artarmon",
        hours: "Mon to Fri 7am to 3.30pm",
        phone: "(02) 5550 0143",
      },
      {
        name: "Brookvale depot",
        address: "9 Cooperage Way, Brookvale NSW 2100",
        href: "/locations/brookvale",
        hours: "Mon to Fri 7am to 3.30pm",
        phone: "(02) 5550 0144",
      },
    ],
    bookLabel: "Book a visit",
    allHref: "/locations",
  },

  // ---------------------------------------------------------------- footer
  FooterSimple: {
    businessName: "Harrow & Vale",
    contact: { label: "(02) 5550 0142", href: "tel:+61255500142" },
    contactSecondary: { label: "hello@harrowandvale.example", href: "mailto:hello@harrowandvale.example" },
  },
  FooterGrouped: {
    businessName: "Harrow & Vale",
    description: "Roofing, guttering and repairs across the northern suburbs since 2009.",
    contacts: [
      { label: "(02) 5550 0142", href: "tel:+61255500142" },
      { label: "hello@harrowandvale.example", href: "mailto:hello@harrowandvale.example" },
    ],
    companyDetails: [
      { term: "ABN", value: "12 345 678 901" },
      { term: "Builder's licence", value: "BL-204417" },
      { term: "Insurance", value: "Public liability to $20m" },
    ],
  },
};
