# The website kit

Sixteen pieces, forty-five variations, and the six foundations under them. Read this when
composing any page, and read `src/lib/kit.ts` in the project for the inventory: every variation
states when to use it, what content it needs, and where on a page it belongs.

## What it is for

A build should not invent a testimonial block from scratch on every project. The structural
questions (what states does a form have, how does a nav behave on a phone, what happens when a
list is empty) have the same answers every time, and getting them wrong is how a site ships with
an invisible submit button or a grid that breaks on the fourth item. The kit answers those once.

## THE RULE THAT LETS IT EXIST

**A piece owns the STRUCTURE and the STATES. The brand owns the SURFACE.**

Our own doctrine says sharing MARKUP homogenises output and reusing the level of DECISION does
not. A forty-five piece section library is a shared markup library, which is the thing this
product argues against, and Bootstrap homogenises the web because everybody ships its default
skin.

So no kit component may contain a literal colour, font family, font size, radius, shadow or
spacing value. Every visual decision reads a `--kit-*` token from `src/styles/foundations.css`.
`gate-kit-tokens.mjs` fails the build on one, and it resolves local aliases, so laundering a
literal through a component-level custom property does not work either.

**What this means in practice: the kit is where you START a section, not where you finish it.**
The donor assigned to the rung governs how the piece is skinned, and skinning happens in the
brand tokens, never in the component. If two sites you have built with the same piece read as the
same site, the tokens were not doing any work and the build is not finished.

## Choosing a variation

Read the manifest entry, not the name. Each variation says when to reach for IT rather than its
siblings, and the answer usually turns on what the client actually has:

- `HeroServicePhoto` needs a photograph 1600px or wider. Three usable images out of three hundred
  means the answer is a different hero, not an upscaled one.
- `PricingCards` needs public prices. `PricingQuote` is the honest variation for most trades, and
  it is a real section rather than an apology.
- `TestimonialGrid` needs several real quotes. If there are two, use `TestimonialSingle`.
- `CompareAlternatives` needs attributes you can defend in front of the competitor named.

A variation whose content the client cannot supply is the wrong variation. Do not fill the gap
with invented content: that is the failure mode this whole build exists to stop.

## Testimonials are somebody else's words

Every testimonial component's header comment says this and it is repeated here because it is the
most expensive mistake available. Quotes are transcribed verbatim or cut. Never attach a real
name to words the person did not say. Never add a role, a company or a location to a quote that
does not carry one. A build has already shipped five invented testimonials signed with real
customers' names, and no gate caught it, because a fabricated fact used once is internally
consistent.

## What "finished" means for a piece

Six criteria, and they are checkable rather than aspirational:

1. Renders correctly at 390, 768 and 1440 with no horizontal overflow and no clipped text.
2. Meets 4.5:1 on body text against its own ground, is keyboard operable, and shows a visible
   focus ring on every interactive element.
3. Renders correctly with the shortest and the longest realistic content.
4. Implements every state it can be in: hover, focus, open, loading, success, error, empty.
5. Its manifest entry says when to use it, what content it needs, and where it belongs.
6. Adds no runtime dependency, and the whole kit's JavaScript stays under 10 KB gzipped.

`gate-kit-complete.mjs` enforces 4 and 5 statically and follows delegation, so a nav that gets
its open state from the mobile sheet it renders is not asked to duplicate it.

## The example pages

`/kit/product`, `/kit/service` and `/kit/campaign` compose real pieces with real content and
prove they sit together. `/kit` itself indexes every piece and variation with its guidance.

## Browsing a state

`/kit/<piece>/<Variation>` shows the piece at rest and lists every state its manifest entry
declares. Each of those is a page: `/kit/<piece>/<Variation>/empty`, `/long`, `/open`, `/loading`
and so on. Three width buttons put the same render at 390, 768 and 1024, which is how a mobile
menu that only exists below a breakpoint can be opened without resizing the browser.

**The piece itself is rendered in a frame, and the frame has its own URL.** `/kit-frame/...` is
the piece alone, no chrome, which is what a screenshot wants and what you send a colleague. The
frame is the viewport, so media queries behave, and a sticky nav is not pinned under a breadcrumb
bar. It still renders inside the ordinary layout, view transitions included: the kit has to be
demonstrated in the configuration it ships in, since the one defect that made every form in the
kit dead was caused by that router and would have been invisible in a stripped-down harness.

**Nothing on those pages is a picture of a state.** Content states come from a fixture in
`src/lib/kit-states.ts` and are rendered by the real component at build time. Runtime states are
DRIVEN: the demo presses the piece's own control, or answers the one network call the piece makes
and lets the piece decide what to show. `focus` is moved programmatically, which is real focus.
`hover` is the one state that cannot be forced at all, because the browser grants it to a real
pointer only, and the page says so instead of dressing a resting render up as a hovered one.

**Height follows the content, unless you ask for a device.** The frame reports its own height, and
that height counts everything that renders, including a fixed panel, an absolutely positioned
dropdown and a dialog in the top layer, so an opened menu is never clipped to the closed bar. Two
consequences are stated in the chrome rather than hidden: a piece sized in `vh` is measured against
the content rather than a device, and the **Device height** toggle beside the width buttons gives
the frame the device's height (390 x 844, 768 x 1024, 1024 x 768) with the piece scrolling inside
it, which is the only honest way to review a 72vh hero. The chrome is bound per document, so
clicking from state to state with the view-transition router keeps every control live; the first
version bound once per session and every page after the first rendered in a letterbox.

Adding a state to a variation in the manifest is therefore a two-part change: declare it, and, if
it is `empty` or `long`, add its fixture. `gate-kit-complete.mjs` fails a declared content state
with no fixture, and a fixture no declared state can reach.

**All of it goes at hand-over.** These pages render invented firms, invented people and invented
quotes, which is exactly the content a real client build had to correct four separate times, so
`gate-shipready.mjs` fails a production-stage build that still carries `/kit`, `/kit-frame`, the
demo artwork or the two sample files. The composed pages keep working, because a page imports the
COMPONENTS and never the demos.

All of it is `noindex` and `gate-shipready` removes it at handover, exactly as it removes the
Explore surfaces. It is a working document, not a page of the client's site.

**Demo photography never names a job.** The composed pages carry licensed, credited Unsplash
photography so they can be judged as pages. A caption describes what is in the frame ("paving laid
to a fall, planting chosen for a hot western wall") and never claims the frame is the story beside
it, because a stock photograph captioned as the client's own project is the exact fabrication a
real build had to correct four times, and the example pages are what a build copies. The one image
a stock library cannot honestly supply (a report page, a product screen) is drawn.

## Rhythm

A composed page follows one of the rhythms in `src/lib/kit-grounding.ts` (`kitRhythms`) and
declares which at the top of its source. Every rhythm was read from the library's own "rhythm to
borrow" notes on the references it names, and `gate-kit-complete` fails a rhythm that cites a
reference the survey never deep-read. None of them was invented, and a page that follows none of
them should say why.

| Rhythm | For | After |
|---|---|---|
| Relief through process | A high-anxiety service: renovation, dental, legal, anything the buyer dreads. Hero with the "made easy" promise and the next step in view, trust beneath, locality, benefits, outcome gallery, the named numbered process, FAQ as reassurance and transparent price, a close that echoes the hero, deep footer with locations. | re-bath, block-renovation, lava-dental |
| Evidence spine | A high-trust, high-consideration purchase. Badges under the hero CTA, differentiation, the journey as steps, named credentials, a measurable outcome, priced cards, testimonials and press, head-to-head comparison, FAQ, then the single CTA repeated. | parsley-health, lava-dental |
| Repeated identical shape | A product with several capabilities. Hero with real product proof, then a run of sections with identical anatomy (heading, subhead, proof), one deeper data-rich section, social proof as a counted claim, one warm closing block, the CTA, a dense footer. | linear, dropbox, webflow |
| Short page, deep nav | A big product whose breadth belongs in the navigation. Hero, two alternating-row capability sections, proof, a short direct CTA. Only with a real suite behind the nav. | notion, basecamp |
| Alternate buy and read | Editorial commerce. One photograph that is the brand, product row, essay, product row, a lower-commitment entry, stories, store finder and newsletter, mode-flipped footer. Only with photography good enough to carry full-bleed acts. | aesop, gymshark, mejuri |
| Values and locality | A recurring local service. Values-and-place headline over warm photography with a quote CTA, a why-choose band, services, service-area cards with per-area contact, a coverage check, a genuine story, a quote form close, a footer with services and areas. | greenwise-organic-lawn-care, block-renovation |
| Five acts | A service or consultancy selling judgement. State the position on the calmest canvas, one flagship project given the whole stage, a small proof grid, the mission repeated as a statement with no CTA, a footer that weighs as much as the hero. | anthropic, setia-law, swillhouse |
| One product per act | An adviser or multi-service firm. Warm serif hero, one service per act on alternating grounds, a trust count, a single dark-pill CTA. | wealthsimple, pilot-accounting, avalon-accounting |
| Paid landing | A campaign page carrying paid traffic to one offer. The promise and the next step one click away, trust beneath, the problem shown, the offer in detail, real results and one customer, the position stated once with no action, comparison and price, a close that echoes the hero, a slim footer with no exploration. | attentive, mercury, pilot-accounting |
| Booking first | Class or appointment businesses. A hero that does discovery and booking together, trust strip, alternating photographic and human bands, services as browsable rows, locations, community proof, a warm closing booking CTA. | barrys, warby-parker, unoit, dishoom |

What the gate holds a citation to, after the eighth and ninth critic passes: an anti-pattern
(`avoid`) is never evidence, so a variation may cite only a piece's donors and rules; a rhythm may
cite one reference where that reference's own note states the whole order (anthropic's five acts);
a rhythm that names several references is a COMPOSITE and every step carries, in parentheses, the
reference whose "rhythm to borrow" note states it, from the rhythm's own list only; every reference
a rhythm names has to be some piece's donor; and the survey snapshot is sealed, declares any
windows of reads that are not the builder's (a critic's verification reads are recorded by the same
hook), records its cut-off, and is re-derived inside those windows wherever the recorder's manifest
is present, so a hand-added reference fails and a later read is reported rather than absorbed.

Three rules cut across every rhythm, each with the references whose notes state it:

- **Trust lands directly under the hero**, before any feature claim, and its form depends on what
  this buyer recognises: logos only when the names are known to the audience, otherwise a count
  plus a character claim, an accreditation, a partner badge or a rating (attentive, warby-parker,
  pilot-accounting, mercury, habito).
- **The FAQ sits before the final call to action**, framed as reassurance, and a statement band
  carries no action at all (parsley-health, lava-dental, anthropic).
- **Consecutive sections must not share a ground.** Alternate `kit-section--subtle`, the default
  and `kit-section--inverse` deliberately: two adjacent sections on the same ground read as one
  long section, which is the commonest way a composed page turns into a wall. Note that a piece
  which ships its own inverse ground (HeroServicePhoto) counts as one, so the section under it
  takes a subtle ground, not an inverse one.

The three example pages each follow one rhythm exactly: `/kit/product` is repeated shape,
`/kit/service` is values and locality, `/kit/campaign` is paid landing. The kit index at `/kit`
lists every rhythm with its steps, and under every piece the donors, rules and anti-patterns its
contract was read from.
