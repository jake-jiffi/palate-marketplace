---
description: Change a business fact once, in the record, and report every surface that changed with it.
argument-hint: "[the fact, e.g. \"new phone 07 5555 1234\" or \"we now open Saturdays 9-1\"]"
---

Change a fact about the business: the phone number, the email, the address, the opening hours,
the service areas, the services, the social profiles, the trading name.

You change it here once. Every rendered surface follows, structured data and footer included.
That is not a convenience, it is the point of the command: the moment a number is retyped into a
page, the next change leaves one surface stale, and the stale one is usually the one a customer
phones.

`$ARGUMENTS` is the new fact. If it is empty, show the current record and ask which field.

## 1. The one rule

**You edit `src/lib/business.ts` and nothing else.**

If completing this request appears to need a fact typed into a page, a layout, a component, an
API route or a structured-data block, that is a bug in the site, not a reason to type it. Stop
and report it. Forking a fact is how a surface goes stale without anyone noticing: both copies look
right on their own, and the wrong one is usually the one a customer acts on.

Be precise about what enforces this, because the two are often confused.
`scripts/test/single-source-facts.test.sh` keeps the SCAFFOLD single-sourced: it runs in the
plugin's own repo, against `templates/astro-project`, and it is wired into no customer build. On a
live site the fork check is section 5 of this command. Nothing fails a customer's build today if a
fact is retyped, so the check has to be run, not assumed.

The one legitimate follow-up edit is a page that should render a fact and currently hardcodes
it. In that case you REPLACE the hardcoded literal with an import from `lib/business`, which
removes a copy rather than adding one. Say clearly that this is what you did.

## 2. Orient

1. Resolve the project dir. Confirm `src/lib/business.ts` exists. If it does not, this site does
   not have a fact record: say so, and that adding one is a structural change, and stop.
2. Read the record. Show the current value of the field about to change.
3. **Show the blast radius BEFORE editing**, so the person knows what they are about to move:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir> --reads business.ts
   ```
   That is every route whose render reaches the record, transitively. A page that shows the
   business name through the shared layout is on that list even though it never imports the
   record, which is exactly the surface a grep would have missed.

## 3. Edit the record

Type-check what you write against `BusinessRecord`:

- `telephone` in E.164 where possible (`+61...`), because `tel:` and schema.org both want it.
  If the person gives a local format, convert it and show both.
- `address` is all five fields or `null`. A half-filled address is worse than none.
- `openingHours` in schema.org form, `"Mo-Fr 09:00-17:00"`. Adding Saturday is a new array
  element, not an edit to the weekday line.
- `schemaType` is `LocalBusiness` for anyone with a premises or a service area, `Organization`
  for everyone else. It changes which rich results the page is eligible for, so if the fact
  being changed is an address being added or removed, check whether this needs to move with it.
- Unknown stays `null`. Never a placeholder, never invented, never a guess that reads plausible.

`businessJsonLd()` builds the structured data from the same record and omits unknown fields
rather than emitting them empty, so you do not touch the JSON-LD separately. If you find
yourself editing structured data by hand, go back to the one rule.

## 4. Plan and check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed src/lib/business.ts --json
```

It classifies the record as `content`, and the route list should match what `--reads` reported.
If it comes back wider, something else got touched.

Run the lanes:

- `npx astro check` then `npm run build`. TypeScript is why this file is not YAML: a bad edit
  fails the build instead of rendering `undefined` into a page.
- `"${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" <dir>`.
- Serve and verify the affected routes:
  ```
  "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
    <SERVE_URL> --routes <the routes from --reads> --out .palate-shots
  ```
  A longer trading name or a longer address is a real layout risk in a footer and a nav.

No MCP call is needed. Do not mention the taste layer.

## 5. Prove the propagation

This is the step that makes the claim true rather than asserted. Against the served build:

1. Grep the built output or fetch each affected route and confirm the NEW value appears.
2. Grep for the OLD value across the served routes. Any hit is a fork: a surface that had its
   own copy. Report it by route, replace the literal with the import, and re-run.
3. Confirm the JSON-LD block on the home route carries the new value.

## 6. Show

- The field, the old value, the new value.
- Every route that changed, from `--reads`, with a count.
- Confirmation that the old value no longer appears anywhere served, or the list of places it
  still does and what you did about them.
- The lane results.

Apply on agree.
