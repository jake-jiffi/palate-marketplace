# The site system

A consistent site comes from three things working together: one system that every page reads, a style guide that shows it, and a check that refuses anything else. Naming alone does not hold: a build that adopted every class name below still set 252 font sizes of its own.

The structure and names follow Finsweet's [Client-First](https://finsweet.com/client-first/docs), adapted for code: its page structure, its size scales, and heading styles that are independent of heading tags. The values come from the chosen direction, never from Client-First's defaults, so each client's rhythm stays its own.

## When

Design options explore freely. The system starts at the pick. Codify the chosen direction before building any other page, and before the critic's selected-direction pass.

## Codify the chosen direction

1. **Write `src/styles/system.css`.** If it grows long, split it into `src/styles/system/*.css` and import those from it. Use two layers of tokens: raw values first (`--color-ink: #1d1b19`), then roles that point at them (`--text-color-primary: var(--color-ink)`). Never name a role after a colour. Use rem units.
2. **Define the required parts.** The check refuses a system without them:
   - **Structure.** `.padding-global` is the page gutter (inline padding only). `.container-large`, `-medium` and `-small` set a centred max-width. `.padding-section-small`, `-medium` and `-large` set block padding. A section is `<section class="section_[name]">` containing `.padding-global.padding-section-[size]`, which contains `.container-[size]`. Navigation and footer sit outside `<main>`.
   - **Headings.** `h1` to `h6` each get a default size. `.heading-style-h1` to `-h6` carry the same values, so `<h1 class="heading-style-h2">` keeps the h1 tag with the h2 look. Add `.heading-style-display` only if the direction has a display size.
   - **Text.** `.text-size-regular` at least, plus whichever of `.text-size-large`, `-small`, `-tiny`, `.text-weight-*` and `.text-style-*` the design uses.
   - **Colour roles** (`.text-color-*`, `.background-color-*`) and **buttons** (`.button` and its variants), as the design uses them.
3. **Refactor the chosen direction's components onto the system.** Headings take their size from a class, and text sizes and colours come from tokens. Component CSS keeps layout (grid, flex, position) and the component's own spacing. Where a spacing value is shared, use its token.
4. **Write `src/style-guide/index.astro`.** It holds the site's layout, `<SystemSpecimen>` from `palate-preview/SystemSpecimen.astro`, and inside it every reusable component: navigation, footer, buttons, cards, and forms with their states. The local preview serves it at `/_palate/style-guide`. It is never published. The specimen reads `system.css` directly, so a token added to the system appears on reload.
5. Run `node scripts/palate.mjs system check`.

## Rules

- Bare tags carry the default look. A class expresses a deliberate variation.
- A heading's size comes only from its tag or a `heading-style-*` class. Page and component CSS never set a heading's font-size, not even with a token. That is how a title ends up looking like another level.
- Type (font-size, line-height, letter-spacing, font-weight, font-family) and colour come from the system. That means a `var(--token)`, a system class, or a relative unit (`em`, `%`). No literal values outside the system.
- Set type and colour only in `<style>` blocks, `.css` files or plain `style="..."` attributes. The check reads those three and nothing else, so an arbitrary utility class (`text-[17px]`) or a JavaScript style object would hide a value from it.
- Spacing uses a token where the value is shared. Spacing literals are reported, not refused.
- Layout lives in scoped component classes. There is no grid utility system.
- Not taken from Client-First, because it solves problems Webflow has and Astro does not: underscore "folder" class names, `is-` combo classes, two-class margin and padding utilities, and spacer divs. Scoped styles, component props and `gap` do those jobs.

## Changing the system

- **A new page or section:** open `/_palate/style-guide` first and compose from what it shows.
- **Something the system lacks** (a size, a colour, a component variant): add it to the system first, check it appears in the style guide, then use it.
- **A different value:** change the token. Every page and the style guide follow.
- **A deliberate one-off** (a poster-scale opening line, a colour a regulator requires): keep the literal with `/* system: <reason> */` on the line before or after the declaration. The check lists every exception, and the critic judges whether each one earns its place.

## Verification

`node scripts/palate.mjs system check` fails on:
- type or colour outside the system;
- a heading sized outside it;
- a system missing its required parts.

It reports spacing literals as warnings, and does nothing before a direction is chosen. `verify` requires it: `{"scope":"system","argv":["node","scripts/palate.mjs","system","check"]}`.

A project created before this check existed rejects the `system` command. Run `node <package>/scripts/palate.mjs system check --project <project>` instead. For a site being brought into the system, read the check's report first, codify, then fix the pages that report lists.
