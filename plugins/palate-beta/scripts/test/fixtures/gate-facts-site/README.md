# gate-facts-site

A CLEAN five-page site, built to be as hostile to `scripts/gate-facts.mjs` as ordinary copy
gets. Nothing here contradicts anything: every fact is stated once and repeated in a second
conventional spelling, which is the shape most likely to read as a disagreement.

The built output is `build/` rather than `dist/`, because the repo gitignores `dist/` and a
fixture nobody can commit is not a standing measurement. `build` is one of the four output roots
`palate-index.mjs` already looks for, so the gate reads it exactly as it reads a real one.

**This is the standing false-positive measurement.** `gate-facts` must be silent on it. When the
extractor changes, run it here first: a check that fires on this fixture is a check somebody
switches off inside a week, and then it catches nothing at all.

What is deliberately planted, and which false positive each one is the regression test for:

| Page | Planted | The class |
|---|---|---|
| `/` | `4 out of 5 customers recommend us` beside a real `4.9 stars` | a proportion read as a rating |
| `/` | the phone in a header `tel:` href and again in the footer text | one number, two conventions |
| `/policies` | `Effective 01.05.2024`, `Signed 01-05-2024`, `Updated 2024-05-01` | a written date read as a phone number |
| `/services` | `$1,299`, `$20,000,000`, order numbers, a hinge angle, a runner load | numbers with no label |
| `/services` | a retired number inside `<pre>` and an invoice reference inside `<code>` | a sample read as a claim |
| `/products` | a grid of five distinct card ratings | a catalogue read as a contradiction |
| `/about` | `ABN 12 345 678 901` against `/services` `ABN: 12345678901` | one identifier, two spellings |
| `/about` | `25 years in the trade, 20 years in business` | two claims sharing a word |
| `/blog/2019-milestone` | `38 reviews`, in a page declaring itself a BlogPosting | a dated entry quoting its own day |
| `/blog` | a listing of `<div>` cards each carrying a `<time datetime>` | a dated card in a hand-built wrapper |
| `/services` | the whole body inside `<div id="app">` with a copyright `<time>` in its footer | a page silenced wholesale by the dated-block rule |
| `/` | `Rated ★★★★★ 4 out of 5 customers recommend us` | a star row between a rating word and a proportion |
| `/`, `/about` | a landline, an after-hours mobile and a fax in one footer | a second contact number read as a contradiction |
| `/` | a contact table with a bay number in the cell before the line | a stray digit absorbed into the number beside it |
| `/services` | delivery and site-measure times after a day name | a time range that is not the trading hours |
| `/policies` | `INV 1300 4471` | a reference read as a service number |
| `/explore`, `/boards/b1` | rung copy naming a different review count and a different line | Explore scaffolding read as a claim about the business |

The real facts, consistent everywhere they appear: 42 reviews, 4.9 stars, `(02) 9876 5432`,
ABN 12345678901, Mon-Fri 09:00 to 17:00, Sat 09:00 to 13:00.
