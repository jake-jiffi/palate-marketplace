/**
 * THE STATE FIXTURES, AND WHAT CAN HONESTLY BE FORCED.
 *
 * Every variation in the manifest declares the states it must handle. Until this file existed
 * that declaration was a list of words on a page: a reviewer could read "handles empty, long,
 * open" and had no way to see any of them without editing code, which is the same as not having
 * been told. Spec section 7 names a browsable state per variation in acceptance, and the critic
 * named it as the second required item, so this is the surface that closes it.
 *
 * THE STATES SPLIT THREE WAYS, AND THE SPLIT IS THE HONEST PART.
 *
 * 1. CONTENT STATES (empty, long) are a matter of what the piece is given. They are fixtures:
 *    props chosen to put the piece under that condition, rendered by the real component at build
 *    time. Nothing is simulated, and a piece that cannot survive its own fixture fails the build.
 *
 * 2. RUNTIME STATES (open, loading, success, error) belong to the piece's own script. They are
 *    driven, never faked: the demo presses the piece's own control, or stubs the one network call
 *    the piece makes and lets the piece decide what to show. A CSS class that merely looks like a
 *    loading state would pass a screenshot and prove nothing about the code that ships.
 *
 * 3. POINTER AND KEYBOARD STATES cannot both be forced. `focus` can: focus is programmatic, so
 *    the demo moves focus into the piece and the real focus styling appears. `hover` cannot be
 *    synthesised at all, because the browser grants :hover only to a real pointer. The state page
 *    says so plainly rather than dressing a resting render up as a hovered one.
 *
 * A STATE BROWSER THAT LIES IS WORSE THAN THE TEXT LIST IT REPLACES, because the text list at
 * least does not claim to have been checked.
 *
 * The people, firms, figures and file paths below are invented for these demos. Nothing here is a
 * real business, and none of it is a component default: a component that defaulted any of it
 * would put an invented firm on a real client's site.
 */

export type KitDemoState = "empty" | "long" | "open" | "loading" | "success" | "error" | "focus" | "hover";

/** How a state is produced, which is what the state page tells the reader. */
export type StateKind = "content" | "driven" | "unforceable";

export const STATE_KIND: Record<KitDemoState, StateKind> = {
  empty: "content",
  long: "content",
  open: "driven",
  loading: "driven",
  success: "driven",
  error: "driven",
  focus: "driven",
  hover: "unforceable",
};

/**
 * ONE ORDER, EVERYWHERE THE STATES ARE LISTED.
 *
 * The index printed them in manifest order and the viewer re-sorted them, so 38 of the 45
 * variations showed a different row on the two pages a reader moves between. The fixed order is
 * right (a row that reshuffles between pieces is unreadable); having two of them was not.
 */
export const STATE_ORDER: KitDemoState[] = [
  "empty",
  "long",
  "open",
  "loading",
  "success",
  "error",
  "focus",
  "hover",
];

/** A variation's declared states, in the one order every surface prints them in. */
export function orderedStates(states: readonly string[]): KitDemoState[] {
  return STATE_ORDER.filter((s) => states.includes(s));
}

/** One line per state, written for whoever opens the page rather than for whoever wrote it. */
export const STATE_NOTE: Record<KitDemoState, string> = {
  empty:
    "The piece is given no items at all. This is what a client sees on the day the section goes " +
    "in and before anything has been written for it, so it has to read as deliberate rather than broken.",
  long:
    "Real content at roughly two to three times the usual length: the way a client who writes too " +
    "much actually writes. Nothing is repeated to pad it out, because repeated words wrap " +
    "differently from prose and would prove the wrong thing.",
  open:
    "The piece's own control has been pressed, so what you are looking at is the piece's script " +
    "deciding what open means. Press it again to close it.",
  loading:
    "The piece has been driven into its in-flight state and the one network call it makes is held " +
    "open on purpose, so it stays there to be looked at. Nothing was styled to imitate it.",
  success:
    "The piece was filled in and sent, with the network call answered as a success. What you see " +
    "is the piece's own confirmation, reached the way a visitor reaches it.",
  error:
    "The same submission, with the network call answered as a server fault. The piece has to say " +
    "what went wrong and leave the visitor a way through, and that is what is being shown.",
  focus:
    "Keyboard focus has been moved to the first thing in the piece that takes it. Nothing is " +
    "styled to imitate a ring. Some browsers paint the visible ring only when they believe the " +
    "last input was a keyboard, so if you cannot see one, press Tab once.",
  hover:
    "Hover cannot be forced. The browser grants it to a real pointer only, so this page will not " +
    "pretend: move your own pointer over the piece below to see it.",
};

/**
 * Where the state driver should aim, when the piece's own control is not the obvious first one.
 * Empty means "the first control the piece offers", which is right for most of them.
 */
export const OPEN_TARGET: Record<string, string> = {
  NavSimple: "[data-kit-sheet-toggle]",
  NavDropdown: "[data-kit-sheet-toggle]",
  NavMobileSheet: "[data-kit-sheet-toggle]",
  DemoScreenshots: "[data-ds-open]",
  FaqAccordion: "details[data-kit-disclosure] > summary",
};

/**
 * Pieces whose open state only exists below the small-screen breakpoint. The state page opens
 * these in the narrow frame by default, because opening a mobile sheet in a 1280px frame shows
 * the reader an empty bar and teaches them the piece is broken.
 */
export const NARROW_BY_DEFAULT = new Set(["NavSimple", "NavDropdown", "NavMobileSheet"]);

/**
 * Pieces that have NO desktop presence at all, in any state. NavMobileSheet is the small-screen
 * half of a navigation and renders a toggle that is display:none above the breakpoint, so its
 * page at full width is a blank frame. Found by sweeping every state page and reading what was
 * actually in the document rather than by looking at the component.
 */
export const MOBILE_ONLY = new Set(["NavMobileSheet"]);

/** Empty is one prop set to nothing. The key differs per piece, so it is stated rather than guessed. */
export const EMPTY_PROPS: Record<string, Record<string, unknown>> = {
  TrustLogos: { logos: [] },
  TrustRatings: { ratings: [] },
  TrustResults: { results: [] },
  BenefitCards: { items: [] },
  BenefitAlternating: { items: [] },
  DemoScreenshots: { screenshots: [] },
  ProcessDetailed: { stages: [] },
  UseCasesAudience: { audiences: [] },
  UseCasesIndustry: { industries: [] },
  UseCasesTask: { tasks: [] },
  TestimonialGrid: { items: [] },
  CaseResults: { results: [] },
  CaseCards: { studies: [] },
  FaqVisible: { items: [] },
  FaqAccordion: { items: [] },
  /**
   * A DIARY WITH NOTHING IN IT, WHICH IS NOT THE SAME AS AN EMPTY LIST.
   *
   * The first version set `services` and `openDays` and left `times` alone, so the branch the
   * component wrote for exactly this condition could never render, and `openDays: []` is read by
   * the piece as "every day is bookable". The state labelled empty therefore offered a diary open
   * seven days a week and accepted a Sunday: MORE permissive than at rest, which is the same fault
   * as a long fixture that shortens the page. `times` is what the branch is gated on.
   */
  FormBooking: { services: [], openDays: [], times: [] },

  // The nine below render an empty message their manifest entry never declared, so nothing could
  // show it. Declaring the state and giving it a fixture is what makes the message reachable.
  BenefitShowcase: { points: [] },
  CompareAlternatives: { attributes: [], alternatives: [] },
  CompareBeforeAfter: { pairs: [] },
  PricingCards: { plans: [] },
  PricingQuote: { drivers: [], send: [], range: "", turnaround: "" },
  PricingTable: { plans: [], attributes: [] },
  ProblemSideBySide: { pairs: [] },
  ProblemStory: { paragraphs: [] },
  ProcessThreeStep: { steps: [] },

  // The library-grounded pieces. A statement with no words, a coverage list with no places, and a
  // finder with nowhere to point all have to say something a visitor can act on.
  ProblemStatement: { statement: "" },
  ServiceArea: { areas: [] },
  CoverageChecker: { covered: [] },
  LocationFinder: { locations: [] },
};

/**
 * LONG-CONTENT FIXTURES, one per variation that declares the state.
 *
 * "Built to handle short and long real content" is one of the six things that make a piece
 * finished, and until now nothing demonstrated or protected it. These are REALISTIC at two to
 * three times the default: the way a client who writes too much actually writes, not a word
 * repeated. A repeated word wraps differently from prose and would prove the wrong thing.
 *
 * Only the fields that carry the wrap risk are overridden. Everything else stays on the piece's
 * own defaults, so what you are comparing against the resting page is the length and nothing else.
 */
export const LONG_PROPS: Record<string, Record<string, unknown>> = {
  AnnouncementBar: {
    text:
      "Storm season bookings are open across the inner west, the lower north shore and the northern " +
      "beaches, so get the roof checked before the first big front comes through, and ask about the " +
      "gutter-clearing add-on while the crew is already up the ladder rather than paying a call-out twice.",
    link: { label: "Book a roof check for your place before the weather turns", href: "/book" },
  },
  NavSimple: {
    siteName: "Ridgeway, Calder and Associates",
    links: [
      { href: "/services", label: "Everything we do for you" },
      { href: "/approach", label: "How we approach a project" },
      { href: "/case-studies", label: "Work we finished recently" },
      { href: "/about", label: "The people you will deal with" },
      { href: "/contact", label: "Start a conversation" },
    ],
    cta: { label: "Ask for a written quote today", href: "/quote" },
  },
  NavDropdown: {
    siteName: "Ridgeway, Calder and Associates",
    groups: [
      {
        label: "Everything we make and fit",
        links: [
          { href: "/windows", label: "Windows, awning and double hung" },
          { href: "/doors", label: "Doors, including bifold and stacker" },
          { href: "/screens", label: "Security screens and flyscreens" },
          { href: "/repairs", label: "Repairs to frames nobody still makes" },
        ],
      },
      {
        label: "How we work with you",
        links: [
          { href: "/measure", label: "The measure, and why it comes first" },
          { href: "/lead-times", label: "What a realistic lead time looks like" },
          { href: "/warranty", label: "What the warranty actually covers" },
          { href: "/payment", label: "Deposits, progress payments and the final invoice" },
          { href: "/access", label: "What we need from you on installation day" },
        ],
      },
      {
        label: "Who we usually work for",
        links: [
          { href: "/homeowners", label: "Homeowners partway through a renovation" },
          { href: "/builders", label: "Builders who need one supplier on site" },
          { href: "/strata", label: "Strata managers and building owners" },
          { href: "/heritage", label: "Heritage architects and conservators" },
        ],
      },
    ],
    links: [
      { href: "/about", label: "The people you will deal with" },
      { href: "/work", label: "Work we finished recently" },
      { href: "/reviews", label: "What people said afterwards" },
    ],
    cta: { label: "Book a measure at your place", href: "/measure" },
  },
  NavMobileSheet: {
    groups: [
      {
        label: "Everything we make and fit",
        links: [
          { href: "/windows", label: "Windows, awning and double hung" },
          { href: "/doors", label: "Doors, including bifold and stacker" },
          { href: "/screens", label: "Security screens and flyscreens" },
        ],
      },
    ],
    links: [
      { href: "/approach", label: "How we approach a project" },
      { href: "/about", label: "The people you will deal with" },
    ],
    cta: { label: "Book a measure at your place", href: "/measure" },
  },
  HeroTextImage: {
    headline: "Windows and doors measured at your place, made in our own workshop and fitted by the people who made them",
    lede:
      "Nothing here is ordered in and passed on. Somebody comes out and records the opening as it " +
      "actually sits, including the out of square that a drawing will never show you, and the same " +
      "hands that cut and assembled it are the ones adjusting the hardware on the day.",
    ctas: [
      { label: "Book a measure at your place", href: "/measure", variant: "primary" },
      { label: "See work we finished recently", href: "/work", variant: "secondary" },
    ],
  },
  HeroCentredPreview: {
    headline: "Every quote we send names the profile, the glass and the hardware, so you can compare it against anyone else's",
    lede:
      "Most quotes in this trade are a single number with a line of description, which makes them " +
      "impossible to compare and easy to cut corners inside. Ours lists what is going in, so the " +
      "difference between two prices is a difference you can actually see.",
    ctas: [
      { label: "Ask for a written quote today", href: "/quote", variant: "primary" },
      { label: "Read a sample quote first", href: "/sample-quote", variant: "secondary" },
    ],
    note: "No obligation, and we will tell you honestly when a repair beats a replacement.",
  },
  HeroServicePhoto: {
    headline: "Twenty three years of repairs to frames that nobody has manufactured since the eighties",
    lede:
      "If a supplier has told you the whole unit has to come out, it is worth one phone call before " +
      "you agree. We hold cutters for profiles that left production decades ago, and that is what " +
      "lets a repair be a real answer rather than a polite way of declining the work.",
    ctas: [
      { label: "Send a photo and we will tell you", href: "/repairs", variant: "primary" },
      { label: "What a repair usually costs", href: "/repairs/pricing", variant: "secondary" },
    ],
  },
  TrustLogos: {
    intro:
      "Builders, strata managers and heritage architects who send us the openings nobody else will " +
      "quote, and have kept doing it long enough that most of this year's work came from one of them.",
    logos: [
      { name: "Harrowgate Building Company (Southern Region)" },
      { name: "Millbrook Strata and Facilities Management" },
      { name: "Ashcombe Heritage Architects and Conservators" },
      { name: "The Fennimore Group, Residential Division" },
      { name: "Pentworth and Vale Construction Partners" },
      { name: "The Calloway Trust (Property and Facilities)" },
    ],
  },
  TrustResults: {
    heading: "What twenty three years of trading under one name actually adds up to",
    results: [
      {
        figure: "1,480",
        label: "Separate installations completed across the region since the workshop opened",
        source: "Counted from job records, not estimated",
      },
      {
        figure: "23 years",
        label: "Continuously trading under the same ownership and the same name",
        source: "Registered 2003",
      },
      {
        figure: "94%",
        label:
          "Of last year's work came from a referral or a customer who had used us before, which is " +
          "the only number here we would be embarrassed to see fall",
        source: "Measured across the 2025 financial year, from the job register rather than from memory",
      },
      {
        figure: "11 days",
        label:
          "Median time from the measure to a written, itemised quote landing in somebody's inbox, " +
          "including the weeks we are flat out",
        source: "Median across 214 quotes issued in the 2025 financial year",
      },
    ],
  },
  ProblemBeforeAfter: {
    heading: "The same opening, before and after a repair that three other firms had already declined to quote",
    lede:
      "The frame is original to the house and the profile has not been manufactured since 1987, " +
      "which is why every quote before ours was for a full replacement plus making good.",
    before: {
      label: "What was there on the day we first came out to measure it",
      caption:
        "Corroded sill, hardware seized solid, and a previous repair that had pulled the whole frame " +
        "about four millimetres out of square without anybody noticing, which is enough to stop a " +
        "sash moving and nowhere near enough to see from the ground. Two of the three firms who had " +
        "already quoted had measured around the architrave rather than opening it up, so neither of " +
        "their numbers could have survived install day.",
    },
    after: {
      label: "The same opening once the repair was finished and the hardware adjusted",
      caption:
        "Original frame kept, the corroded sill section cut out and replaced on the bench, and new " +
        "hardware fitted into the same footprint so nothing about the room had to change. The render " +
        "was never touched, which on this elevation was most of what the replacement quotes were " +
        "actually charging for, and the whole thing came in under a third of the cheapest of them.",
    },
  },
  ProblemSideBySide: {
    heading: "What changes when the people who made it are the people who fit it",
    lede:
      "Every line below is something a customer has actually told us went wrong somewhere else, " +
      "which is the only reason it is on the list.",
    pairs: [
      {
        from: "Measured from the builder's plan, so the first anyone knows about the out of square is on install day",
        to: "Measured on site with the existing frame opened up, and the opening recorded as it actually sits",
      },
      {
        from: "Fabrication subcontracted out, so a fault on the day belongs to somebody who is not there",
        to: "Cut and assembled in our own workshop, by the person who will be adjusting it in front of you",
      },
      {
        from:
          "A single price with one line of description underneath it, which is impossible to compare " +
          "against anyone else's and very easy to be cheap inside in a way you will not find out " +
          "about for four years",
        to:
          "Profile, glass specification and hardware all named on the page, so two quotes can be read " +
          "side by side and a substitution is something you can see rather than something you " +
          "discover later",
      },
      {
        from:
          "The lead time given as a feeling rather than a figure, so the fortnight where nothing " +
          "visible happens reads as a job that has quietly stalled",
        to:
          "A real number of weeks with the quiet part named in advance, because the long stretch is " +
          "fabrication on our own bench and nothing about it happens at your house",
      },
      {
        from:
          "A variation raised after the work has started, when saying no costs more than saying yes",
        to:
          "Anything found during the measure is priced before you agree to anything, and anything " +
          "found later is put to you in writing before it is done",
      },
    ],
  },
  ProblemStory: {
    heading: "A heritage sash that three firms had already written off, and what it took to keep it",
    paragraphs: [
      "The owners rang us in the second week of a very wet March, after a builder had told them the " +
      "whole bank of windows on the western elevation would have to come out. They had two quotes " +
      "for a full replacement and neither of them mentioned the render, which would also have had " +
      "to be cut back and made good afterwards.",
      "What we found when we opened the first frame up was that the timber was sound everywhere " +
      "except a two hundred millimetre run of sill, and that a repair some years earlier had pulled " +
      "the whole assembly about four millimetres out of square. That is enough to seize the hardware " +
      "and not nearly enough to see from the ground, which is why nobody had found it.",
      "The repair took eleven days, most of which was the sill sections being made on the bench " +
      "rather than anything happening at the house. The render was never touched, the frames are " +
      "the ones the house was built with, and the total came to a little under a third of the " +
      "cheapest replacement quote they had been given.",
      "The part worth saying out loud is that none of the three earlier quotes was dishonest. A " +
      "firm that does not hold cutters for a profile which left production in 1987 genuinely " +
      "cannot repair that window, so replacement is the only answer they have, and it is a real " +
      "one. What none of the three did was mention the render, which would have had to be cut " +
      "back and made good afterwards on every one of those quotes and appeared on none of them.",
    ],
  },
  ProblemStatement: {
    kicker: "Where we stand, and why we keep saying it",
    statement:
      "A roof should be the part of the house you think about least, and most of the calls we take " +
      "are from people who were made to think about theirs far too often. We fix it once, in the " +
      "material it was built in, with the flashing and the fixings the original roofer should have " +
      "used, and we tell you plainly when a repair is the honest answer and a new roof is a sale " +
      "somebody else wanted to make. That is the whole position, and it has not changed since 2009.",
  },
  BenefitCards: {
    heading: "Three things about how we work that are worth knowing before you ask anyone for a price",
    lede:
      "None of these are unusual on their own. Together they are the reason a quote from us reads " +
      "differently from the two either side of it.",
    items: [
      {
        title: "Measured on site rather than estimated from a plan",
        body:
          "Somebody comes out, opens what is already there, and records the opening as it actually " +
          "sits, including the out of square that a drawing will never show you. It costs nothing " +
          "and it is the single biggest reason install day goes quietly.",
        href: "/approach/the-measure",
      },
      {
        title: "Made in our own workshop instead of ordered in",
        body:
          "That is what lets us match a profile nobody has manufactured for thirty years, and why a " +
          "repair is a real answer rather than a polite way of declining the work.",
        href: "/approach/the-workshop",
      },
      {
        title: "Fitted by the same people who made it",
        body:
          "Nothing is subcontracted, so the person adjusting the hardware on the day is the person " +
          "who cut and assembled it, and there is nobody to blame in between.",
        href: "/approach/installation",
      },
    ],
  },
  BenefitAlternating: {
    heading: "The parts of the job that most people never see, and where the difference actually lives",
    lede:
      "A finished window looks much the same whoever made it. What separates them is decided weeks " +
      "earlier, on a bench nobody visits.",
    items: [
      {
        title: "The measure, which is the only part that cannot be corrected later",
        body:
          "We open the existing frame rather than measuring around it, because a previous repair " +
          "will have moved something and a rendered reveal hides more than it shows. Everything " +
          "downstream is cut to what that measure says, so an hour spent here saves a day on site.",
      },
      {
        title: "Fabrication, where a profile nobody still makes stops being a problem",
        body:
          "The cutters we hold cover profiles that left production in the eighties. That is a room " +
          "full of tooling earning nothing most weeks, and it is the entire reason we can quote a " +
          "repair on an opening where the answer everywhere else is a replacement plus cutting the " +
          "render back and making it good. Keeping that tooling is a commercial decision that only " +
          "makes sense across twenty years, which is roughly how long it has been paying for itself.",
      },
      {
        title: "The measure again, a fortnight after it is in",
        body:
          "Hardware beds in, and a sash that was perfect on the day sometimes wants a quarter turn " +
          "once it has been used properly for a couple of weeks. Nobody rings to say so, because it " +
          "reads as something you did rather than something we did, so we ring instead. It takes ten " +
          "minutes and it is the difference between a window that is right and one that is nearly right.",
      },
      {
        title: "Installation, which is the shortest part and the one people remember",
        body:
          "Most openings are finished inside a day, and the person adjusting the hardware in front " +
          "of you is the person who cut and assembled it three weeks earlier. That is not " +
          "sentimentality about craft: it is the reason the adjustment actually happens on the day " +
          "rather than becoming a callback, because nobody has to be sent for and nobody in the " +
          "chain can reasonably say the problem belongs to somebody else.",
      },
    ],
  },
  BenefitShowcase: {
    title: "Why the quote names the glass, the profile and the hardware instead of giving you one number",
    body:
      "Most quotes in this trade are a single figure with a line of description underneath. That " +
      "makes them impossible to compare, and it makes it very easy for the cheapest of three to be " +
      "cheap in a way you will not find out about for four years, because the part that fails first " +
      "is the part nobody itemises. Ours is itemised for exactly that reason, and we are happy for " +
      "you to take it to whoever else is quoting: if somebody comes back cheaper on the same " +
      "specification then they are genuinely cheaper, and that is worth knowing before you decide.",
    // ShowcasePoint is a string or { label, detail }, never { title, body }. The first version of
    // this fixture used the wrong keys and rendered three empty points, which looked like a
    // component fault and was a fixture fault.
    points: [
      {
        label: "The glass specification is set by where the panel sits, not by preference",
        detail: "A panel within 500mm of a floor is toughened because the standard says so, and the quote says which ones and why.",
      },
      {
        label: "The profile is named, so a substitution is visible",
        detail: "If somebody quotes cheaper on a lighter profile, that is a legitimate choice, and you should be able to see that it was made.",
      },
      {
        label: "Hardware is listed by manufacturer and range",
        detail: "It is the part that fails first and the part nobody itemises, which is not a coincidence.",
      },
      {
        label: "Making good is a line, not an assumption",
        detail:
          "If the render has to be cut back the price for putting it right is on the page, rather " +
          "than arriving as a variation once the wall is already open.",
      },
    ],
    ctaLabel: "Read a sample quote before you ask for yours",
    ctaHref: "/sample-quote",
  },
  DemoScreenshots: {
    heading: "What the written quote looks like when it lands in your inbox, page by page",
    lede:
      "There is nothing clever about it. It is simply itemised, and being able to see it before you " +
      "ask for one is the point of putting it here.",
    screenshots: [
      {
        src: "/images/kit/screen-quote.svg",
        alt: "The first page of a written quote, showing the opening schedule",
        caption:
          "Page one lists every opening with its measured size, so you can check against your own " +
          "plan before you read a single price.",
      },
      {
        src: "/images/kit/screen-job.svg",
        alt: "The second page of a written quote, showing glass and hardware",
        caption:
          "Page two names the glass specification for each panel and the reason it is what it is, " +
          "which is usually the standard rather than a preference.",
      },
      {
        src: "/images/kit/screen-schedule.svg",
        alt: "The third page of a written quote, showing terms and lead time",
        caption:
          "Page three is the lead time and the payment terms, both as real figures rather than as " +
          "the word shortly, with the deposit, the progress payment and what is owing at completion " +
          "all named so there is nothing to discover at the end.",
      },
      {
        src: "/images/kit/screen-confirm.svg",
        alt: "The confirmation that arrives once a job is booked into the diary",
        caption:
          "Page four is what arrives once you accept: the dates, who will be on site, and the one " +
          "thing we need you to have done before they get there.",
      },
    ],
  },
  ProcessThreeStep: {
    heading: "Three steps from the first phone call to a window that opens the way it should",
    lede:
      "The whole thing usually runs three to five weeks, and the longest part is the one where " +
      "nothing appears to be happening at your house.",
    steps: [
      {
        title: "The measure, usually within a week of you ringing",
        body:
          "Somebody comes out, opens the existing frame and records the opening as it actually sits. " +
          "It costs nothing, and you get the written quote from it whether or not you go ahead.",
      },
      {
        title: "Fabrication on our own bench, which is where the time goes",
        body:
          "Everything is cut to your opening rather than picked off a shelf, so this is two to three " +
          "weeks and it is not a queue we can jump for you or for anybody else.",
      },
      {
        title: "Installation by the people who made it",
        body:
          "Most openings are done inside a day, and the person adjusting the hardware in front of you " +
          "is the person who cut and assembled it three weeks earlier. That is the reason the " +
          "adjustment happens on the day rather than becoming a callback: nobody has to be sent for, " +
          "and nobody in the chain can reasonably say the problem belongs to somebody else.",
      },
      {
        title: "The check a fortnight later, which nobody asks us for",
        body:
          "Hardware beds in, and a sash that was perfect on the day sometimes wants a quarter turn " +
          "after a couple of weeks of real use. We ring rather than wait to be rung.",
      },
    ],
    footnote: "If something is genuinely urgent, say so when you ring and we will tell you honestly whether it can be moved.",
  },
  ProcessDetailed: {
    heading: "What actually happens between the first phone call and the last adjustment",
    lede:
      "Written out in full because the middle of it is quiet, and a quiet fortnight is the part " +
      "people ring up worried about.",
    stages: [
      {
        title: "The call, and the questions we will ask you on it",
        body:
          "Roughly where the property is, how many openings, and whether anything has been repaired " +
          "before. That last one matters more than it sounds, because a previous repair is the " +
          "commonest reason an opening is not square.",
        duration: "About ten minutes",
      },
      {
        title: "The measure at your place",
        body:
          "We open the existing frame rather than measuring around it. You do not need to be there " +
          "for all of it, but it is worth being there at the start so we can be told what has been " +
          "annoying you about the current windows.",
        duration: "Half an hour to two hours",
      },
      {
        title: "The written quote, itemised",
        body:
          "Every opening with its measured size, the glass specification for each panel and the " +
          "reason for it, the hardware by manufacturer and range, then the lead time and terms.",
        duration: "Two to three working days",
      },
      {
        title: "Fabrication, which is the long quiet part",
        body:
          "Everything is cut to your opening on our own bench, in the order the workshop is already " +
          "committed to, which is why the figure beside this is a range rather than a date. Nothing " +
          "visible happens at your house during it and that is expected rather than a sign anything " +
          "has gone wrong: this is the stretch people ring about, and it is also the stretch that " +
          "makes install day take an afternoon instead of a fortnight.",
        duration: "Two to three weeks",
      },
      {
        title: "Installation and the adjustment that follows it",
        body:
          "Most openings are finished within a day. The hardware is adjusted while the person who " +
          "assembled it is still standing there, which is the only reason it gets adjusted properly " +
          "rather than written down as something to come back for, and it is also the moment to say " +
          "if anything about the way it moves is not what you were expecting.",
        duration: "One day per opening, usually",
      },
      {
        title: "The check a fortnight later",
        body:
          "Hardware beds in. A sash that was perfect on the day sometimes wants a quarter turn after " +
          "a couple of weeks of real use, so we ring rather than wait to be rung.",
        duration: "Ten minutes, usually on the phone",
      },
    ],
  },
  UseCasesAudience: {
    heading: "Different people ring us for completely different reasons, so here is the one that probably applies to you",
    lede: "Each of these is a real pattern in the work rather than a category we invented to fill a grid.",
    audiences: [
      {
        name: "Homeowners partway through a renovation that has gone sideways",
        need:
          "Usually because the windows were the last thing anyone thought about and the opening " +
          "sizes on the plan have stopped matching the building. We measure what is actually there.",
        href: "/homeowners",
        linkLabel: "What we do for homeowners mid-renovation",
      },
      {
        name: "Builders who need one supplier who will answer the phone on site",
        need:
          "The value is not the price, it is that the person who made the unit is the person who " +
          "turns up when something does not fit, and that happens the same week rather than the next month.",
        href: "/builders",
        linkLabel: "How we work with builders",
      },
      {
        name: "Strata managers holding a maintenance budget and forty identical openings",
        need:
          "Repeatable work, priced once, scheduled around residents rather than around us, with a " +
          "written condition report for every opening before anything is touched, because the next " +
          "manager will inherit that file and should be able to use it.",
        href: "/strata",
        linkLabel: "Strata and multi-unit work",
      },
      {
        name: "Heritage architects who need a repair a council will accept",
        need:
          "Documentation as much as joinery: what was found, what was kept, what was replaced and " +
          "why, in a form that can go into a submission without being rewritten first.",
        href: "/heritage",
        linkLabel: "Heritage and conservation work",
      },
    ],
  },
  UseCasesIndustry: {
    heading: "The kinds of buildings we spend most of our time in, and what each one usually needs",
    lede: "Ordered by how much of last year's work each accounted for, rather than by how interesting it is.",
    industries: [
      {
        name: "Federation and interwar housing stock across the inner suburbs",
        application:
          "Almost always a repair rather than a replacement, because the profile is long out of " +
          "production and the render around it would have to be cut back and made good.",
        href: "/heritage",
      },
      {
        name: "Nineteen seventies and eighties walk-up apartment blocks",
        application:
          "Forty or more identical openings, one condition report each, and a schedule built around " +
          "residents being at work rather than around our own convenience.",
        href: "/strata",
      },
      {
        name: "New residential builds where the opening has moved off the plan",
        application:
          "Measured on site once the frame is up, which is later in the programme than most suppliers " +
          "will accept and is the entire reason install day goes quietly rather than becoming an " +
          "afternoon of argument about whose drawing was right.",
        href: "/new-builds",
      },
      {
        name: "Schools and community halls working inside a term break",
        application:
          "The constraint is the calendar rather than the joinery: everything is measured a term " +
          "ahead, made while the building is still in use, and fitted in the two weeks nobody is in it.",
        href: "/education",
      },
      {
        name: "Light industrial and workshop buildings on coastal sites",
        application:
          "Corrosion rather than wear is what ends these openings, so the work is usually a sill or " +
          "a section rather than a unit, and the specification matters more than the price.",
        href: "/industrial",
      },
    ],
  },
  UseCasesTask: {
    heading: "If you already know what you need doing, start from the job rather than from the category",
    lede: "Every one of these ends in a real page with real prices on it, not a contact form.",
    tasks: [
      {
        name: "A window that has stopped opening, or opens and will not stay where you put it",
        outcome:
          "Usually a hardware failure rather than a frame failure, which means one visit and a " +
          "fraction of what anyone quoting a replacement will have told you.",
        href: "/repairs/hardware",
      },
      {
        name: "Condensation and draughts through frames that are otherwise sound",
        outcome:
          "Reglazing or a seal replacement, done in place, and worth doing before you spend anything " +
          "at all on heating the room it is in.",
        href: "/repairs/seals",
      },
      {
        name: "A whole elevation being replaced as part of a renovation",
        outcome:
          "Measured on site after the frame is up rather than off the drawings, made on our own " +
          "bench, and fitted by the people who made it.",
        href: "/replacements",
      },
      {
        name: "A profile you have been told nobody manufactures any more",
        outcome:
          "Often true and usually beside the point, because we hold the cutters and can make the " +
          "section rather than the whole unit.",
        href: "/repairs/heritage",
      },
      {
        name: "A security screen or flyscreen that has been forced or has sagged",
        outcome:
          "Rehung or remeshed in the existing frame where the frame is sound, which it usually is.",
        href: "/screens",
      },
      {
        name: "A door that has dropped and now catches on the frame every time",
        outcome:
          "Almost always the hinges or the packing rather than the door, and almost always an hour " +
          "rather than a replacement, whatever the last person to look at it said.",
        href: "/repairs/doors",
      },
      {
        name: "Ten openings or more across one building, on a maintenance budget",
        outcome:
          "A condition report for every opening first, then one price for the programme and a " +
          "schedule built around residents rather than around us.",
        href: "/strata",
      },
    ],
  },
  TestimonialSingle: {
    quote:
      "Three other firms had told us the whole western elevation had to come out, and none of them " +
      "had mentioned that the render would have to be cut back and made good afterwards, which was " +
      "most of the real cost. The repair took eleven days, the frames are the ones the house was " +
      "built with, and the whole thing came to under a third of the cheapest replacement quote.",
    name: "Marguerite Ashby-Pell",
    role: "Owner and project manager on the restoration",
    location: "Ashfield",
  },
  TestimonialGrid: {
    heading: "What people said afterwards, including the parts we would rather they had left out",
    lede: "Published as written. Where somebody has been critical it is here with the rest.",
    items: [
      {
        quote:
          "The quote was the only one of four that told me which panels were being toughened and " +
          "why, which meant I could finally compare the other three against something.",
        name: "Desmond Halloway-Reid",
        role: "Homeowner partway through a first-floor addition",
        location: "Marrickville",
      },
      {
        quote:
          "They were a fortnight later than the original estimate and they rang to tell us about it " +
          "rather than letting us find out. The work itself was faultless and the adjustment was " +
          "done while they were still on site.",
        name: "Priyanka Venkataraman",
        role: "Building manager, forty two unit block",
        location: "Rosebery",
      },
      {
        quote:
          "I had been told twice that nobody makes that profile any more, which turned out to be " +
          "true and also completely beside the point, because they cut it themselves rather than " +
          "ordering it in from anyone.",
        name: "Terrence Okonkwo-Barrett",
        role: "Owner, Federation semi",
        location: "Stanmore",
      },
      {
        quote:
          "They talked me out of replacing four windows that did not need replacing, which cost them " +
          "most of the job and is the reason they got the next one without being asked to quote.",
        name: "Wilhelmina Strachan-Doyle",
        role: "Homeowner",
        location: "Haberfield",
      },
      {
        quote:
          "The written quote named the glass for every panel and why, so when I took it to the two " +
          "cheaper firms I could finally ask them what they had actually allowed for.",
        name: "Ignatius Fairweather",
        role: "Owner-builder",
        location: "Dulwich Hill",
      },
      {
        quote:
          "Everything ran to the day they gave us at the start, including the fortnight in the " +
          "middle where nothing appeared to be happening at the house and they had told us in " +
          "advance that it would not, which is the only reason we did not spend it ringing them.",
        name: "Rosalind Ngata-Pemberton",
        role: "Project manager",
        location: "Petersham",
      },
      {
        quote:
          "They were the dearest of the four quotes we had and the only one that had opened the " +
          "frame up before writing a number down. Two of the other three came back with variations " +
          "when I asked them what they had allowed for the render, which answered the question.",
        name: "Ambrose Teodorescu-Hale",
        role: "Owner, interwar bungalow",
        location: "Croydon Park",
      },
    ],
  },
  CaseFeatured: {
    heading: "A forty two unit block, every opening different from its condition report, and a schedule built around residents",
    customer: "Millbrook Strata and Facilities Management",
    title: "Forty two openings replaced over nine weeks without a single resident having to take a day off work",
    situation:
      "The block was built in 1978 and the previous manager had left a maintenance file describing " +
      "openings that no longer matched the building, because at least two elevations had been " +
      "repaired at some point without anything being written down. Three of the four quotes the " +
      "committee held were priced off that file, which meant three of them were priced off a " +
      "building that had not existed for some years, and nobody had noticed because nobody had " +
      "gone and looked.",
    action:
      "Every opening was measured and condition-reported before anything was ordered, which took a " +
      "fortnight and was the only reason the rest of it ran. The work was then scheduled in runs of " +
      "four so that no resident lost access to more than one room at a time, every run was " +
      "confirmed with the resident by phone the week before, and the two openings that turned out " +
      "to need more than the report allowed were put to the committee in writing before they were " +
      "touched.",
    outcome:
      "Nine weeks end to end against an eleven week estimate, no variations raised after the quote " +
      "was accepted, and a written record for every opening that the next manager will actually be " +
      "able to use rather than another file describing a building that has moved on.",
    outcomeFigures: [
      { value: "42", label: "Openings replaced and condition-reported individually" },
      { value: "9 weeks", label: "End to end, against an eleven week estimate" },
      { value: "0", label: "Variations raised after the quote was accepted" },
    ],
    linkLabel: "Read the full account of the Millbrook job",
  },
  CaseResults: {
    heading: "Results from jobs where the customer has agreed to let us publish the numbers",
    lede:
      "Every figure below came from the customer's own records rather than ours, which is why there " +
      "are fewer of them than there are jobs.",
    results: [
      {
        figure: "68%",
        label: "Less than the cheapest of three replacement quotes, for a repair that kept the original frames",
        customer: "A Federation semi in Stanmore",
        note: "Compared against written quotes the owner still holds",
      },
      {
        figure: "9 weeks",
        label: "To replace forty two openings across a 1978 walk-up, against an eleven week estimate",
        customer: "Millbrook Strata and Facilities Management",
      },
      {
        figure: "0",
        label: "Variations raised after the quote was accepted, across the whole of that job",
        customer: "Millbrook Strata and Facilities Management",
        note: "Which is a consequence of measuring first, not of good luck",
      },
      {
        figure: "3 days",
        label: "From the first phone call to a temporary make-safe on a shopfront that had been forced overnight",
        customer: "Pentworth and Vale Construction Partners",
        note: "The permanent repair took another fortnight, which is the honest figure",
      },
    ],
    sourceNote:
      "Figures supplied by the customers named and used with their permission. Where a customer has " +
      "asked not to be named, the job is not listed here at all rather than listed anonymously.",
  },
  CaseCards: {
    heading: "Jobs worth reading about, mostly because something on them went wrong first",
    lede: "Three accounts, each written after the job finished rather than while it was being sold.",
    studies: [
      {
        title: "The western elevation three firms had already declined to quote",
        customer: "A Federation semi in Stanmore",
        outcome:
          "Original frames kept, render never touched, and a final figure under a third of the " +
          "cheapest replacement quote the owner had been given.",
        href: "/work/stanmore-semi",
        tag: "Heritage repair",
      },
      {
        title: "Forty two openings, forty two condition reports, nine weeks",
        customer: "Millbrook Strata and Facilities Management",
        outcome:
          "Scheduled in runs of four so no resident lost access to more than one room at a time, " +
          "and finished two weeks inside the estimate with no variations.",
        href: "/work/millbrook-block",
        tag: "Strata",
      },
      {
        title: "A new build where the openings had moved 30mm off the plan",
        customer: "Harrowgate Building Company",
        outcome:
          "Measured on site after the frame went up rather than off the drawings, which is why " +
          "install day took one afternoon instead of a fortnight of arguing about whose drawing " +
          "was right while a client watched.",
        href: "/work/harrowgate-new-build",
        tag: "New build",
      },
      {
        title: "A shopfront forced overnight, made safe in three days and repaired in a fortnight",
        customer: "Pentworth and Vale Construction Partners",
        outcome:
          "The make-safe is the number people remember and the fortnight is the honest one, because " +
          "the replacement section had to be cut to an opening that had been damaged out of square.",
        href: "/work/pentworth-shopfront",
        tag: "Commercial",
      },
    ],
  },
  PricingCards: {
    heading: "Three ways of working with us, priced so you can tell which one you are actually asking for",
    lede:
      "Most people want the middle one. The other two exist because a single emergency repair and a " +
      "forty two unit programme are not the same purchase.",
    plans: [
      {
        name: "Single repair or one opening",
        price: "From $480",
        cadence: "per opening",
        description: "For one window or door that has stopped working, where the frame itself is sound.",
        features: [
          "Attendance, diagnosis and a written report on what is actually wrong with it",
          "Hardware replacement from stock where the range is still manufactured",
          "A firm price before anything is ordered, rather than an hourly rate",
          "The honest answer when a repair is not worth doing, before you spend anything",
          "Seven-year warranty on our own work, hardware to its manufacturer's own terms",
        ],
        ctaLabel: "Book a repair visit",
        ctaHref: "/repairs",
      },
      {
        name: "Measured, made and fitted",
        price: "Quoted per job",
        description: "The usual arrangement: a measure at your place, an itemised quote, then fabrication and installation.",
        features: [
          "Site measure with the existing frame opened up, at no charge and no obligation",
          "Itemised written quote naming the profile, the glass specification and the hardware",
          "Fabrication on our own bench and installation by the people who made it",
          "Adjustment on the day, while the person who assembled it is still standing there",
          "A check a fortnight later, because hardware beds in and nobody rings to say so",
          "Seven-year warranty on our own work, hardware to its manufacturer's own terms",
        ],
        ctaLabel: "Book a measure at your place",
        ctaHref: "/measure",
        recommended: true,
        recommendedLabel: "What most people are asking for",
      },
      {
        name: "Programme work across a building",
        price: "Scheduled",
        description: "Ten openings or more, usually for a strata manager or a building owner holding a maintenance budget.",
        features: [
          "A written condition report for every opening before anything is ordered",
          "Runs scheduled around residents rather than around our own convenience",
          "One price for the programme, with variations agreed in writing or not at all",
          "Every resident confirmed by phone the week before their own run",
          "A file the next building manager can actually use, rather than another one to correct",
          "Seven-year warranty on our own work, hardware to its manufacturer's own terms",
        ],
        ctaLabel: "Talk to us about a programme",
        ctaHref: "/strata",
      },
    ],
    footnote:
      "All figures include GST. A measure costs nothing whether or not you go ahead, and we will " +
      "tell you when a repair beats a replacement even though the replacement is worth more to us.",
  },
  PricingTable: {
    heading: "The three arrangements side by side, including the parts that are deliberately not included",
    lede: "Read down the left column first. Most of the differences are about who does what, rather than about price.",
    caption: "What is included in a single repair, a measured installation and a building programme",
    plans: [
      { name: "Single repair or one opening", price: "From $480", cadence: "per opening", ctaLabel: "Book a repair", ctaHref: "/repairs" },
      { name: "Measured, made and fitted", price: "Quoted per job", ctaLabel: "Book a measure", ctaHref: "/measure", recommended: true, recommendedLabel: "Most common" },
      { name: "Programme work across a building", price: "Scheduled", ctaLabel: "Talk to us", ctaHref: "/strata" },
    ],
    attributes: [
      { name: "Site measure with the existing frame opened up, at no charge", values: [false, true, true] },
      { name: "Written condition report for every opening before anything is ordered", values: [false, "", true] },
      { name: "Itemised quote naming the profile, the glass specification and the hardware range", values: [true, true, true] },
      {
        name: "Fabrication on our own bench rather than ordered in from a national supplier",
        values: ["", true, true],
        note: "A single hardware repair usually needs no fabrication at all, which is why the first column is blank rather than a cross.",
      },
      { name: "Runs scheduled around residents rather than around our own convenience", values: [false, false, true] },
    ],
    footnote: "All figures include GST. A blank cell means the item does not apply to that arrangement, not that it has been left out.",
  },
  PricingQuote: {
    heading: "Why there is no price list on this page, and what actually decides the number",
    lede:
      "Anyone quoting a per-window figure without seeing the opening is quoting the opening they " +
      "hope it is. Here is what really moves it, so you can work out roughly where you sit before " +
      "you ring anyone.",
    range: "$1,900 to $4,600 per opening",
    rangeNote: "The middle eighty per cent of last year's residential work, including GST and installation.",
    drivers: [
      {
        title: "The size of the opening, and whether it is square",
        detail:
          "The single biggest factor and the one nobody can guess from a photograph. A previous " +
          "repair will usually have moved something, and that only shows up once the frame is opened.",
      },
      {
        title: "Whether the existing frame can be kept",
        detail:
          "Keeping it removes both the removal and the making good, which between them are often " +
          "more than the unit itself.",
      },
      {
        title: "The glass specification, which is set by where the panel sits",
        detail:
          "A panel within 500mm of a floor is toughened because the standard says so, and a panel in " +
          "a bathroom or beside a door is decided the same way. None of that is a preference and none " +
          "of it is negotiable, so it belongs in the quote as a line with a price rather than in a " +
          "conversation on the day, which is where it turns into a variation.",
      },
      {
        title: "Access, which nobody thinks of and everybody pays for",
        detail:
          "A first-floor opening over a garden bed is a different job from the same opening over a " +
          "driveway, and on a block of units it decides whether the work happens from inside.",
      },
      {
        title: "How many openings, because the second one is always cheaper than the first",
        detail:
          "Most of the cost of coming out is coming out. Six openings on one elevation are not six " +
          "times one opening, and a quote that prices them as though they were is a quote nobody " +
          "has actually thought about.",
      },
    ],
    send: [
      "A photograph of each opening from inside, taken square on rather than at an angle, because a photograph taken from the side hides exactly the thing we are looking for",
      "The rough width and height, measured anywhere with anything, just so we know what scale we are talking about before somebody drives out",
      "Anything you already know about previous repairs, even if it is only that there were some and nobody wrote down what was done",
      "The suburb, so we can tell you honestly whether we are the right people to be quoting it at all",
    ],
    turnaround: "Two to three working days from the measure",
    ctaLabel: "Book a measure at your place",
    ctaHref: "/measure",
    secondaryLabel: "Or send photos first and we will tell you whether it is worth a visit",
    secondaryHref: "/photos",
    note:
      "A measure costs nothing whether or not you go ahead, and it is the only way anybody can give " +
      "you a real number rather than the opening they are hoping you have. If somebody has quoted " +
      "you without opening the frame, the number you have is a guess wearing a letterhead.",
  },
  CompareAlternatives: {
    heading: "Us against the two things most people are actually choosing between",
    lede:
      "Written to be fair rather than flattering. Both of the alternatives beat us on something, " +
      "and those rows are in the table with the rest.",
    caption: "How a local fabricator compares against a national supplier and doing it yourself",
    yourName: "A local fabricator, which is us",
    alternatives: ["A national window supplier", "Buying the units and fitting them yourself"],
    attributes: [
      {
        name: "Who measures the opening, and when",
        yours: "We do, on site, with the existing frame opened up, before anything is ordered",
        others: [
          "Usually from your builder's plan, with the site measure happening on install day",
          "You do, and the risk of an error the whole way through is yours",
        ],
      },
      {
        name: "What happens when something does not fit on the day",
        yours: "The person who made it is standing there and fixes it that week",
        others: [
          "Logged with a national service desk and rebooked, typically three to six weeks",
          "You take it back, or you live with it",
        ],
      },
      {
        name: "Price for a straightforward, square, standard-size opening",
        yours: "Usually more, because a bench-made unit costs more than a production line one",
        others: [
          "Usually less, and genuinely so on volume standard sizes",
          "Least of all by a wide margin, if nothing goes wrong",
        ],
        source: "Compared against three written quotes on the same job, March 2026",
      },
      {
        name: "Lead time from order to installation",
        yours:
          "Three to five weeks, most of it fabrication on our own bench, and the figure we give at " +
          "the start is the one we are measured against rather than a hope",
        others: [
          "Often faster on stock sizes, sometimes considerably, because the unit already exists",
          "Immediate, if the size you need happens to be on a shelf near you",
        ],
      },
      {
        name: "What you are left holding if something goes wrong in year four",
        yours:
          "The people who made it are still here, still hold the cutters for your profile, and can " +
          "make the one section that failed rather than the whole unit again",
        others: [
          "A national warranty process, which is real and works, and replaces rather than repairs",
          "Whatever the manufacturer offers on a unit you fitted yourself, which is usually less",
        ],
        source: "Read from the warranty documents of all three, March 2026",
      },
    ],
    fairnessNote:
      "Written by us in March 2026 and checked against three written quotes on one real job, which " +
      "is the only reason any of the figures above are in it. A national supplier will usually beat " +
      "us on price and on lead time for a square, standard-size opening, and if that is what you " +
      "have then that is the honest answer and you should take it. Doing it yourself will beat both " +
      "of us on price by a wide margin if nothing goes wrong, and the whole question is what happens " +
      "if something does. We are the expensive option on an easy opening and the cheap one on a hard " +
      "opening, and the measure is what tells you which of those you are holding.",
  },
  CompareBeforeAfter: {
    heading: "What changes about the job itself once somebody has actually measured the opening",
    lede: "Every line is something that has genuinely happened on a job, which is why the list is this specific.",
    beforeLabel: "Quoted from the plan, measured on install day",
    afterLabel: "Measured on site before anything is ordered",
    pairs: [
      {
        before: "The out of square is discovered by an installer standing in your hallway with a unit that does not fit",
        after: "The out of square is in the quote, and the unit is cut to it three weeks earlier",
      },
      {
        before: "A previous repair nobody recorded turns into a variation and a fortnight of delay",
        after: "The previous repair is found during the measure and priced before you agree to anything",
      },
      {
        before: "The render has to be cut back and made good, which was not in anybody's number",
        after: "Either the frame is kept, or the making good is in the quote as its own line",
      },
      {
        before: "The glass specification is decided on the day by whoever is holding the panel",
        after: "It is decided by where the panel sits, written into the quote, and priced there",
      },
      {
        before: "The lead time is a feeling, so the quiet fortnight reads as a job that has stalled",
        after: "It is a number of weeks, with the quiet part named in advance and explained",
      },
    ],
    note:
      "None of this makes us cheaper on a straightforward opening. It makes the number you are given " +
      "at the start much more likely to be the number you pay at the end.",
  },
  FaqVisible: {
    title: "The questions we get asked on almost every first phone call, answered at the length they deserve",
    intro:
      "Written out properly rather than in one line each, because the one-line versions are what " +
      "make people ring up again a fortnight later.",
    items: [
      {
        question: "How long does a job like this normally take from the first phone call to being finished?",
        answer:
          "Most jobs run three to five weeks from the measure, and the measure itself is usually " +
          "within a week of you ringing. Fabrication is the longest part and it is where the time " +
          "actually goes, because everything is cut to your opening rather than picked off a shelf. " +
          "If something is genuinely urgent, say so when you ring and we will tell you honestly " +
          "whether it can be moved rather than promising and then apologising.",
      },
      {
        question: "What happens if the opening turns out to be different from what was measured?",
        answer:
          "It sometimes does, particularly in older houses where a previous repair has moved " +
          "something. We measure before we cut for exactly that reason, and if what we find on the " +
          "day differs from what we recorded, we tell you before anything is made rather than after.",
      },
      {
        question: "Is it worth repairing, or should we just replace the lot while the scaffolding is up?",
        answer:
          "Sometimes replacing is genuinely right, and we will say so even though a repair is worth " +
          "less to us. The thing that usually decides it is whether the frame is sound everywhere " +
          "except one run, because a bench repair to a sound frame is a fraction of a replacement " +
          "plus the render being cut back and made good afterwards.",
      },
      {
        question: "Do you take deposits, and what happens if the job stops partway through?",
        answer:
          "A deposit covers the material we have to buy before anything can be cut, and it is on the " +
          "quote as a figure rather than a percentage. If a job stops partway through for a reason " +
          "on either side, you are invoiced for what has actually been made and fitted and nothing " +
          "else, and anything already cut to your opening is yours whether or not we install it.",
      },
    ],
  },
  FaqAccordion: {
    title: "Everything else people ask, in the order they usually ask it",
    intro: "Open whichever applies. Nothing here is a sales answer wearing a question mark.",
    items: [
      {
        question: "How long does a job like this normally take from the first phone call to being finished?",
        answer:
          "Most jobs run three to five weeks from the measure, and the measure itself is usually " +
          "within a week of you ringing. Fabrication is the longest part and it is where the time " +
          "actually goes, because everything is cut to your opening rather than picked off a shelf. " +
          "If something is genuinely urgent, say so when you ring and we will tell you honestly " +
          "whether it can be moved rather than promising and then apologising.",
      },
      {
        question: "What happens if the opening turns out to be different from what was measured?",
        answer:
          "It sometimes does, particularly in older houses where a previous repair has moved " +
          "something. We measure before we cut for exactly that reason, and if what we find on the " +
          "day differs from what we recorded, we tell you before anything is made rather than after.",
      },
      {
        question: "Do you charge for the measure, and am I committed to anything once it is done?",
        answer:
          "It costs nothing and it commits you to nothing. You get the written quote from it either " +
          "way, and a fair number of people use ours to check the two they already had, which we " +
          "would rather they did than have them accept a number nobody could compare.",
      },
      {
        question: "Can you work around us if the house is occupied the whole time?",
        answer:
          "Yes, and most of our work is in occupied houses. An opening is out for a matter of hours " +
          "rather than days, because the unit is finished before anybody arrives, and where an " +
          "elevation has to come out in stages we do it in runs so that no room is unusable overnight.",
      },
      {
        question: "What does the warranty actually cover, and for how long?",
        answer:
          "Our own work, which is the fabrication and the installation, for seven years. Hardware " +
          "carries whatever its manufacturer offers and that is named in the quote rather than " +
          "described, because hardware is the part that fails first and a warranty that covers " +
          "everything except the thing most likely to go is not really a warranty. Glass is covered " +
          "for breakage caused by the way it was installed and not for breakage caused by anything " +
          "else, which is the honest boundary and the one every insurer will ask about.",
      },
    ],
  },
  CtaBanner: {
    text:
      "A measure costs nothing, takes about an hour, and is the only way anybody can give you a real " +
      "number rather than the opening they hope you have.",
    action: { label: "Book a measure at your place", href: "/measure" },
    note: "Usually within a week of you ringing, and we will tell you when a repair beats a replacement.",
  },
  CtaClosing: {
    headline: "If three firms have told you the whole lot has to come out, it is worth one more phone call before you agree",
    body:
      "We hold cutters for profiles that left production in the eighties, which is the entire reason " +
      "a repair can be a real answer here rather than a polite way of declining the work. Send a " +
      "photograph and we will tell you honestly whether it is worth us coming out at all.",
    primary: { label: "Book a measure at your place", href: "/measure" },
    secondary: { label: "Send a photograph first", href: "/photos" },
    note: "No obligation either way, and no charge for the measure whether or not you go ahead.",
  },
  CtaWithProof: {
    headline: "Twenty three years, fourteen hundred installations, and most of last year's work came from somebody's recommendation",
    body:
      "None of which means we are right for your job, and on a straightforward square opening in a " +
      "standard size a national supplier will very likely beat us on both price and lead time. What " +
      "it means is that if we tell you a repair will hold, there is a long enough record behind that " +
      "claim for you to go and check it rather than take our word for it.",
    primary: { label: "Book a measure at your place", href: "/measure" },
    secondary: { label: "Read what people said afterwards", href: "/reviews" },
    quote: {
      text:
        "Three other firms had told us the whole western elevation had to come out, and none of them " +
        "had mentioned the render being cut back afterwards, which was most of the real cost.",
      name: "Marguerite Ashby-Pell",
      role: "Owner and project manager on the restoration",
    },
    figures: [
      { value: "1,480", label: "Installations completed since the workshop opened", note: "Counted from job records" },
      { value: "94%", label: "Of last year's work came from a referral or a returning customer" },
    ],
  },
  FormContact: {
    title:
      "Tell us roughly what you have got and we will tell you honestly whether it is worth somebody " +
      "driving out to look at it",
    intro:
      "You do not need measurements or a specification. What is useful is where the property is, " +
      "roughly how many openings there are, and anything you already know about repairs somebody " +
      "has done to them before, because that is the commonest reason an opening is not square.",
    aside: {
      heading: "If you would rather just ring, which most people do and we would prefer",
      lines: [
        "The workshop line is answered between seven and four on weekdays by somebody who has actually stood in front of the jobs, so you get an answer rather than a promise that somebody will call you back about it",
        "Outside those hours it goes to a message that is read the next morning by the same person, not to an answering service in another country reading from a script about your enquiry being important",
        "If it is genuinely urgent, a shopfront forced overnight or a ground-floor opening that will not close, say so in the first sentence and it is dealt with the same day",
      ],
    },
    submitLabel: "Send this straight through to the workshop",
    privacyNote:
      "What you send here goes to the workshop email address and nowhere else. It is not added to a " +
      "mailing list, it is not passed to anybody who supplies us, and nobody will ring you about " +
      "anything other than the opening you have just described. If you would rather not leave an " +
      "address at all, the phone number at the bottom of the page reaches the same people.",
  },
  FormEnquiry: {
    title:
      "An enquiry with enough detail that the first thing we send back is an actual answer rather " +
      "than a request for the details that were left out",
    intro:
      "The more of this you fill in, the more likely the first thing we send back is an actual " +
      "answer rather than a request for the details you left out, which is the exchange that turns " +
      "a two-day reply into a two-week one. If you would rather leave most of it blank and talk it " +
      "through instead, that is completely fine and the workshop number is at the bottom of every " +
      "page: nothing here is required except an address we can reply to.",
    services: [
      "Repair to a window or a door that has stopped working the way it should",
      "Replacing one or two openings as part of a renovation already under way",
      "A whole elevation, or a whole house, on a programme with a date attached",
      "Programme work across a building with ten openings or more, on a maintenance budget",
      "A heritage repair somebody else has already declined to quote",
      "Security screens or flyscreens, new or rehung in an existing frame",
      "Something else, or I genuinely do not know yet and would rather describe it",
    ],
    submitLabel: "Send this enquiry to the workshop",
    privacyNote:
      "What you send here goes to the workshop email and nowhere else. It is not added to a mailing " +
      "list, and we do not pass it on to anybody who supplies us.",
  },
  ServiceArea: {
    areas: [
      {
        name: "Inner west, from the harbour to the Cooks River",
        covers:
          "Marrickville, Dulwich Hill, Summer Hill, Ashfield, Croydon, Burwood, Leichhardt, Lilyfield, " +
          "Annandale, Petersham, Stanmore, Enmore, Newtown, Tempe, Sydenham and St Peters, including " +
          "the older terraces where the original slate is still worth saving.",
        phone: "(02) 5550 0142",
        href: "/areas/inner-west",
        linkLabel: "The inner west crew and what they carry on the truck",
      },
      {
        name: "Lower north shore and the Lane Cove valley",
        covers:
          "Lane Cove, Lane Cove North, Chatswood, Chatswood West, Willoughby, Artarmon, Naremburn, " +
          "St Leonards, Crows Nest, Wollstonecraft and Greenwich; the steep blocks here are why this " +
          "crew carries the longest ladders.",
        phone: "(02) 5550 0143",
        href: "/areas/lower-north-shore",
        linkLabel: "The north shore crew and what they carry on the truck",
      },
      {
        name: "Northern beaches, Manly to Mona Vale",
        covers:
          "Manly, Fairlight, Balgowlah, Freshwater, Curl Curl, Dee Why, Brookvale, Collaroy, Narrabeen, " +
          "Warriewood and Mona Vale, where salt air shortens the life of every fixing and we specify " +
          "marine-grade fasteners as standard.",
        phone: "(02) 5550 0144",
        href: "/areas/northern-beaches",
        linkLabel: "The beaches crew and what they carry on the truck",
      },
      {
        name: "Upper north shore and the Hills, by arrangement",
        covers:
          "Gordon, Pymble, Turramurra, Wahroonga, Hornsby, Castle Hill and Baulkham Hills; we take " +
          "larger jobs here and combine them so nobody pays for the drive.",
        phone: "(02) 5550 0145",
        href: "/areas/upper-north-shore",
        linkLabel: "How the by-arrangement areas work",
      },
      {
        name: "Sutherland Shire, larger jobs only",
        covers:
          "Cronulla, Caringbah, Miranda, Sutherland, Engadine and Menai for full re-roofs and " +
          "guttering across a whole house; not for single-tile repairs, which a local roofer will do " +
          "quicker and cheaper than we can from the inner west.",
        phone: "(02) 5550 0146",
        href: "/areas/sutherland-shire",
        linkLabel: "What counts as a larger job",
      },
    ],
  },
  LocationFinder: {
    lede:
      "Drop in with a sample of your tile, a length of the gutter profile or a photo of the flashing " +
      "and we will match it on the spot from the profile library, which holds cutters for sections " +
      "that left production in the eighties; ring ahead for the two collection points, which are staffed part-time.",
    locations: [
      {
        name: "Marrickville workshop and profile library",
        address: "Unit 4, 118 Wentworth Parade, Marrickville NSW 2204 (enter from the rear lane off Carrington Road)",
        href: "/locations/marrickville",
        hours: "Mon to Fri 7am to 4pm, Sat 8am to 12pm, closed public holidays and the week between Christmas and New Year",
        phone: "(02) 5550 0142",
      },
      {
        name: "Artarmon yard, sheet metal and guttering",
        address: "31 Kiln Lane, Artarmon NSW 2064, behind the timber merchant",
        href: "/locations/artarmon",
        hours: "Mon to Fri 7am to 3.30pm, by appointment on Saturday mornings",
        phone: "(02) 5550 0143",
      },
      {
        name: "Brookvale depot and tile yard",
        address: "9 Cooperage Way, Brookvale NSW 2100, gate two",
        href: "/locations/brookvale",
        hours: "Mon to Fri 7am to 3.30pm",
        phone: "(02) 5550 0144",
      },
      {
        name: "Hornsby collection point",
        address: "Unit 12, 6 Salisbury Road, Hornsby NSW 2077",
        href: "/locations/hornsby",
        hours: "Tue and Thu 8am to 2pm only",
        phone: "(02) 5550 0145",
      },
      {
        name: "Caringbah collection point",
        address: "3 Tannery Street, Caringbah NSW 2229",
        href: "/locations/caringbah",
        hours: "Wed 8am to 2pm only",
        phone: "(02) 5550 0146",
      },
    ],
  },
  FooterSimple: {
    businessName: "Ridgeway, Calder and Associates Window Fabrication",
    tagline:
      "Measured at your place, made on our own bench, and fitted by the people who made it. Trading " +
      "under one name in the same workshop since 2003.",
    links: [
      { label: "Everything we make and fit", href: "/services" },
      { label: "How we approach a project", href: "/approach" },
      { label: "Work we finished recently", href: "/work" },
      { label: "The people you will actually deal with", href: "/about" },
    ],
    legalLinks: [
      { label: "Privacy and what we do with an enquiry", href: "/privacy" },
      { label: "Terms of trade and warranty", href: "/terms" },
    ],
  },
  FooterGrouped: {
    businessName: "Ridgeway, Calder and Associates Window Fabrication",
    description:
      "Measured at your place, made on our own bench, and fitted by the people who made it. We hold " +
      "cutters for profiles that left production in the eighties, which is why a repair is often a " +
      "real answer here rather than a polite way of declining the work.",
    groups: [
      {
        heading: "Everything we make and fit",
        links: [
          { label: "Windows, awning and double hung", href: "/windows" },
          { label: "Doors, including bifold and stacker", href: "/doors" },
          { label: "Security screens and flyscreens", href: "/screens" },
          { label: "Repairs to frames nobody still makes", href: "/repairs" },
        ],
      },
      {
        heading: "How we work with you",
        links: [
          { label: "The measure, and why it comes first", href: "/measure" },
          { label: "What a realistic lead time looks like", href: "/lead-times" },
          { label: "What the warranty actually covers", href: "/warranty" },
          { label: "Deposits, progress payments and the final invoice", href: "/payment" },
        ],
      },
      {
        heading: "Who we usually work for",
        links: [
          { label: "Homeowners partway through a renovation", href: "/homeowners" },
          { label: "Builders who need one supplier on site", href: "/builders" },
          { label: "Strata managers and building owners", href: "/strata" },
          { label: "Heritage architects and conservators", href: "/heritage" },
        ],
      },
    ],
    companyDetails: [
      { term: "Licence number", value: "Contractor licence 214-887-C" },
      { term: "Workshop address", value: "Unit 4, 118 Wentworth Parade, Marrickville" },
    ],
    legalLinks: [
      { label: "Privacy and what we do with an enquiry", href: "/privacy" },
      { label: "Terms of trade and warranty", href: "/terms" },
    ],
  },
};

/**
 * The props a state renders with, on top of whatever the resting demo already passes.
 *
 * A driven state renders the resting content on purpose: the point of `loading` is what the
 * piece's own script does to the piece you already saw, so changing the content underneath it at
 * the same time would make the two pages incomparable.
 */
export function statePropsFor(variationId: string, state: KitDemoState): Record<string, unknown> {
  if (state === "empty") return EMPTY_PROPS[variationId] ?? {};
  if (state === "long") return LONG_PROPS[variationId] ?? {};
  return {};
}
