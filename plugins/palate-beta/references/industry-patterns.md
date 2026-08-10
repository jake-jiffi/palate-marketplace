# Per-industry anti-patterns

A short, opinionated set of design and copy rules per Palate-typical industry.
The Explore stage detects the industry from the brief and applies the
matching rules as overlays to the variant generation; `scripts/ux-lint.sh`
loads them as per-build rule additions where they can be expressed as regex.

Each industry gets 3 to 5 specific anti-patterns. The aim is sharpness, not
coverage; a senior reviewer would flag these in the first scroll.

---

## SaaS (product-led marketing)

- **No "trusted by 1000+ teams" without naming three.** A logo strip is
  fine; an unfounded count is filler. If the count is real, place a small
  label below ("Including {three specific names}").
- **No three-feature cards with identical icons in identical positions.**
  This is the most-copied SaaS hero pattern of 2023-2024 and reads as a
  template now. Vary card aspect ratios, mix in a screenshot, or split the
  features across two visual treatments.
- **No "Coming soon" without a date.** If a feature is announced, give a
  month or "Q1 2026". Without a date it reads as vapourware.
- **No animated dashboard chart in the hero without real data.** If the
  chart is decorative, take it out. If it is meaningful, label it.

## Professional services (consultancies, accountants, lawyers, agencies-of-record)

- **No team grid of stock-smiling-people on a coloured background.** Either
  shoot the real team (preferred), or do not show a team grid at all.
- **No "Our process" graphic with four circles + arrows.** The process
  graphic is the most cliche professional-services visual. Either explain
  the process in named, specific stages with examples, or skip the graphic.
- **No "Founded in {year} with a passion for {craft}".** Replace with one
  specific founding story, named.
- **No "Bespoke solutions for your business".** Specify what kind of bespoke.

## Consumer / e-commerce

- **No "Discover our collection" / "Explore the range" CTA.** Use a
  product-naming verb: "Shop the autumn range", "See the new releases".
- **No lifestyle hero with model holding the product centred at 0.4 opacity
  with text on top.** Either commit to product-first photography or to
  editorial lifestyle; do not water down both.
- **No "Free shipping" badge above the fold without the conditions inline.**
  If free shipping has a threshold, name it ("Free shipping over $80").
- **No infinite-scroll homepage where every section looks like an Instagram
  ad.** Differentiate sections by aspect ratio and density.

## Agency / creative

- **No "We are a design-led {x} agency".** Show the work; the description is
  filler. Lead with case studies.
- **No grid of square case study tiles with title-on-hover.** Hover-reveal is
  a desktop-only pattern that loses the title on mobile. Show titles always.
- **No abstract 3D shape hero with no connection to the work.** If the hero
  visual is generic, replace it with an excerpt from a real project.

## Recruitment (agencies, job boards, in-house careers)

- **No stock photos of diverse smiling teams in an open-plan office.** Use
  real photos of the workplace, or no team photo at all. Stock signals the
  opposite of "we care about who you'll work with".
- **No animated stat counters on scroll ("500+ placements! 10 years!").**
  The animation reads as a tell; the numbers are stronger as plain type.
- **No "Why work with us" tile grid identical to the next ten recruiter
  sites.** Lead with a specific opinion about hiring or about the industry,
  then back it with one piece of evidence.
- **No application CTA hidden in the page footer.** "Apply" should be the
  most visible action above the fold of any role page.

## Hospitality / venue / events

- **No looping background video of food on the hero at 4MB.** A still image
  loads faster and looks better. If video is essential, lazy-load it.
- **No "Book now" CTA that opens a generic booking form on a different
  domain with no context.** The booking flow is the moment; design it
  in-brand.
- **No menu rendered as a PDF download.** Always render menus as HTML; PDFs
  are unsearchable and indistinguishable on mobile.

---

## How Explore applies these

At Phase A.4, before the variant set is generated, Claude reads the brief,
identifies the industry, loads the matching block from this file, and treats
each anti-pattern as a hard "do not generate this" rule for the variant set.
At Compose (A.6), the same rules are applied to the canonical page. If a
client explicitly asks for a banned pattern ("we want the team grid"), the
client preference wins, but Claude states the deviation in the variant
write-up.

## Adding an industry

Add a `## Industry name` heading and 3 to 5 rules with the same shape. Keep
each rule observable (a senior reviewer would name it in the first scroll)
rather than abstract. Resist the temptation to bloat - a sharp short list
beats a long generic one.
