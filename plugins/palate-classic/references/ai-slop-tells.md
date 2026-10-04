# The AI-slop tell catalogue - the checklist a build is held to

This is the skill's canonical catalogue of the things that make a generated site
read as "AI made this". It is the source field guide (Jake's June 2026 compilation,
cross-referenced against the wider design + AI-writing conversation), framed here as
a checklist the build is held to and the verifier walks before emit.

It does not replace the enforcement layers, it names what they enforce and where the
last few tells still rely on judgement:

- The deterministic floor is `scripts/ux-lint.sh` (parsing `references/anti-patterns.md`):
  em dashes, banned / default-of-the-moment display faces, purple-pink and many-stop
  gradients, glassmorphism, raw untuned accent colours, the named AI-tell phrases.
- The structural / substance / trust-chrome tells a linter cannot reliably catch are
  doctrine in `references/anti-patterns.md` and the critique habits
  (`references/critique-discipline.md` habits 3, 5, 7).
- The taste failures that only show in the render are the verifier's job, scored
  against `references/visual-rubric.md` (the six axes + the defect checklist) and the
  Quick QA pass at the foot of this file.

Ratings: **Universal** (named by nearly every source) / **Very common** / **Common** /
**Contested** (soft signal only) / **Field observation** (lower confidence).

## The 5-second giveaways

- Indigo-to-pink gradient text on the headline (`bg-gradient-to-r from-indigo-500
  to-pink-500 bg-clip-text text-transparent`). Universal.
- That one shade of purple. Violet / indigo (~#6366F1) as the primary accent, raw
  Tailwind default. Universal.
- Instrument Serif headers. A trendy display serif bolted onto a generic sans body.
  Universal.
- Eyebrow pill, big centred heading, one-line subhead, two buttons (the hero
  skeleton). Very common.
- A serif italic accent word dropped into a sans heading (the Reseed "slop"
  treatment). Very common.

## Typography

- Instrument Serif / any of-the-moment display serif as the header font. Universal.
- Sans body with a serif-italic accent word. Very common.
- Two-tone, gradient, or italic-and-colour headings (faking hierarchy). Very common.
- **Bricolage Grotesque (display) + Hanken Grotesk (body)** as the default pairing.
  This is THIS skill's own 2025-2026 reflex: the faces the model reaches for build
  after build when it has no opinion, so they now read as the Palate self-tell. The
  recurring face is the smell, not the family; decide the face per brief.
- One font for everything, raw Inter or Geist at three sizes. Universal as a root
  pattern.
- AI-invented typographic hierarchy (e.g. five distinct type styles in a single
  hero). Common.

Do instead: type that carries the brand, a real scale, weight + spacing for
hierarchy not rainbow text.

## Colour and gradients

- Indigo-to-pink gradient text. Universal.
- Default Tailwind palette raw (indigo-500, purple-500, green-500, no tuned brand
  colour). Universal.
- Cyan-on-dark. Very common.
- Gradient on everything + glassmorphism. Very common, now in backlash.
- Green-as-accent SaaS default (emerald CTA). Common.
- The "friendly" alternate palette: soft beige bg + teal-green highlight (~#008275)
  + curved friendly fonts. Common.

Do instead: one disciplined accent, real neutrals, gradients only where they earn
their place.

## Imagery cliches (the 12 motifs - the imagery-originality gate, gap3 W11)

Generated/stock imagery has its own tells. Walk this closed list over EVERY image slot in
the render; any hit is a FAIL with the slot named (it pairs with the imagery mode router in
`references/asset-sourcing.md` - the fix is usually a real asset or a procedural fill, not a
different stock photo):

1. The purple-to-blue (or teal-to-magenta) gradient blob / mesh as a hero or section background.
2. Isometric people / tiny 3D characters at desks, the "corporate Memphis" / Alegria figures.
3. Floating glassy 3D abstract shapes (spheres, toruses, ribbons) with no meaning.
4. Generic diverse-team-at-laptop / handshake / "business people pointing at a screen" stock.
5. A glowing AI brain / neural-network / circuit-board motif for anything "AI".
6. Hexagon / connected-dots "network" or "blockchain" background texture.
7. A lone founder-ish portrait that is obviously a stock model, not the real person.
8. Mock device frames (a laptop/phone) wrapping a fabricated dashboard the product does not show.
9. Hand-holding-phone / over-the-shoulder generic lifestyle filler.
10. A world map with glowing connection arcs for "global".
11. Overly-perfect flat-lay or "founder's desk" arranged props that read as a stock set.
12. The same generic abstract texture reused across multiple slots (no per-slot intent).

Also flag **trademark / likeness**: a recognisable third-party logo, mascot, or a real
identifiable face that is NOT the client's (a likeness/IP risk), named and removed.

The heavier half of this gate (a DINO / pHash near-stock-copy check and a mean pairwise
set-consistency threshold over the build's images) needs image-embedding infrastructure and
is the W11 measurement follow-up; the 12-motif checklist + the trademark flag are the v1 gate.

## Layout and structure

- Untouched starter-template bones (v0 / Lovable / Bolt / Next starters). Universal
  as the root cause.
- The identical hero formula (eyebrow pill, centred H1, subhead, primary + ghost
  button). Very common.
- Feature pill rows (Automated / Scalable / Efficient / Intelligent ...). Common.
- The universal feature card: a small rounded-square icon container above a heading.
  Very common.
- Thick coloured border on one side of a rounded card. Very common.
- Bento grids (done lazily, a plain card grid wearing a trendy name). Very common, in
  backlash.
- Decorative motion for its own sake (cursor-following line; hover that hides
  buttons). Common.
- Inconsistent visual language across sections (generated piecemeal, no shared
  constraints). Common.
- Vanity stat strips (rows of numbers with no context). Common.

Do instead: keep the useful structure, rebuild how it is presented around the actual
brand.

## Copywriting

- Adjective soup / vague value props ("Improve Visibility. Increase Velocity.").
  Very common.
<!-- ux-lint-disable ai-tell-rich-tapestry quoted as a tell -->
- Tapestry talk / stock metaphors ("rich tapestry", "the landscape of", "in today's <!-- ux-lint-disable ai-tell-landscape-of quoted as a tell -->
  fast-paced world", tricolons). Common.
<!-- ux-lint-disable ai-tell-contrast-framing the contrast-framing shape is named here as a tell, quoted not used -->
- Headline formulas / contrast framing ("Stop your X from Y", "it's X, not Y",
  everything emphasised). Common.
- Em-dashes. Contested (soft signal only, Claude overuses them too; never proof). The
  skill blocks them as house style, not because they prove slop.
<!-- ux-lint-disable ai-tell-and-honestly quoted as a tell -->
- Therapy-mode / opener tics ("And honestly?", "you're not alone / not broken"). <!-- ux-lint-disable ai-tell-youre-not-alone quoted as a tell -->
  Common.
- Generic or faked social proof. Common.
<!-- ux-lint-disable ai-tell-simple-honest-pricing the exact stock phrase is catalogued as a tell, quoted not used -->
- "Simple, honest pricing" as an exact phrase. Field observation.
<!-- ux-lint-disable ai-tell-free-forever the free-forever microcopy is catalogued as a tell, quoted not used -->
- Free-forever eyebrow microcopy ("completely free forever", "No Registration
  Required"). Field observation.

Do instead: say the specific thing your product does for a specific person; cut any
word that would survive find-and-replace onto a competitor.

## Substance and product

<!-- ux-lint-disable ai-washing-copy the AI-washing claim is catalogued as a tell here, quoted not used -->
- "AI-powered" bolted onto something that isn't (AI-washing). Universal, now
  regulated. **If removing "AI" doesn't change the product, the AI is decoration.**
- A "native app" that is just a browser wrapper. Field observation.
- Token / credit pricing pages that over-explain. Field observation.
- Fake-looking polished mockups instead of real product UI. Common.

Do instead: lead with the outcome not the mechanism; if the AI is real, show it doing
something only it could do.

## Trust chrome (mostly "smells like a generated agency site", not hard proof)

- A cookie banner on a brand-new microsite. Field observation.
- "As seen on Product Hunt" badge. Field observation.
- Dual "Book a free call" + "Get a free audit" CTA. Field observation.
- Generic security flex ("AES-256", "BYOK") with nothing earned. Field observation.

Do instead: earn trust with specifics, real names / numbers / proof; drop the
stickers.

## The pattern underneath

Every tell traces to the same root: AI reaches for the most common pattern in its
training data (the popular starter template), the mathematical average of the
internet. The structure (hero, CTA, pricing) is fine; what is missing is brand
identity and the last ten percent of polish, the part that needs taste and a human
call. The strongest consensus is about INTENTION: set the visual constraints BEFORE
generating, do not patch inconsistencies after, do not start by asking the AI to
design then tweak the output. This is exactly what the DIVERGE / CONVERGE concept
spine and the build commission exist to do.

## Quick QA pass (tick more than two and it is still AI-default)

Run this before emit, in addition to the six axes and the defect checklist. More than
two ticks means the build has regressed to the AI default, name the failing item and
revise.

- Gradient text headline, especially indigo to pink
- Untuned purple, cyan-on-dark, or default-green accent
- Instrument Serif or a serif-italic accent word used by reflex
- Eyebrow-pill, centred-hero, two-button formula left untouched
- Rounded icon-tile feature cards, or a thick coloured side-border on cards
- Feature pill row (bonus tell if any pill repeats)
- Bento grid or glassmorphism used as decoration, not for clarity
- Different sections that look like different sites (no shared constraints)
<!-- ux-lint-disable ai-tell-simple-honest-pricing the stock phrase is named as a Quick-QA tick here, quoted not used -->
- "Simple, honest pricing" or an equivalent stock phrase
- Tapestry talk, contrast framing, or everything emphasised at once
- Cookie banner, Product Hunt badge, or dual free-call CTA with nothing behind them
- Glossy mockups where real product screenshots should be
- Remove the word "AI" and the product is unchanged

(Em-dashes deliberately left off this list: too unreliable to score. The skill still
blocks them as house style.)
