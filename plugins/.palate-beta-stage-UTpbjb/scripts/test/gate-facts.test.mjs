/**
 * gate-facts.test.mjs - does the site contradict itself, and can the check say so without
 * crying wolf?
 *
 * THE COMPLAINT. An engineer's 3,400-page build said "42 reviews" in some places and "41
 * reviews" in others, and nothing noticed. The single-source rule this repo already has is
 * about PROVENANCE (one record, every surface reads it) and says nothing about CONSISTENCY,
 * because a number typed into two hand-written pages was never in the record to begin with.
 *
 * THE FAILURE MODE THAT MATTERS IS NOT THE MISS, IT IS THE FALSE ALARM. A consistency check
 * that fires on a blog post legitimately quoting a 2019 figure, or on a code sample, or on the
 * same phone number written two conventional ways, gets switched off inside a week and then
 * catches nothing at all. So most of what follows asserts SILENCE, and the assertions that
 * fire are deliberately narrow.
 *
 * Run: node --test scripts/test/gate-facts.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "gate-facts.mjs");
const DONE = join(ROOT, "scripts", "gate-done.sh");
const DEEP = join(HERE, "fixtures", "manifest-deep.json");

const { extractFacts, disagreements } = await import(join(ROOT, "scripts", "gate-facts.mjs"));

const SITE_FIXTURE = join(HERE, "fixtures", "gate-facts-site");

const TMP = mkdtempSync(join(tmpdir(), "gate-facts-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

let n = 0;
/** A throwaway project with a built dist. `pages` maps a route to its body markup. */
function site(pages, { head = "" } = {}) {
  const dir = join(TMP, `site-${++n}`);
  for (const [route, body] of Object.entries(pages)) {
    const file = route === "/" ? "index.html" : `${route.replace(/^\//, "")}/index.html`;
    const abs = join(dir, "dist", file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`);
  }
  return dir;
}

/** Run the gate. Never throws: the exit code is part of what is being asserted. */
function run(dir) {
  try {
    const out = execFileSync(process.execPath, [CLI, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}
/** stdout and stderr together, the way gate-done.sh captures a sub-gate. */
function runMerged(dir, ...flags) {
  const argv = ["node", JSON.stringify(CLI), JSON.stringify(dir), ...flags].join(" ");
  return { code: 0, out: execFileSync("bash", ["-c", `${argv} 2>&1; exit 0`], { encoding: "utf8" }) };
}

const labels = (html) => extractFacts(html).map((f) => `${f.label}=${f.value}`);

// ------------------------------------------------------------------ extraction

test("a labelled count is a fact, and the label is normalised", () => {
  assert.deepEqual(labels("<p>Rated by 42 reviews this year.</p>"), ["reviews=42"]);
  assert.deepEqual(labels("<p>1 review so far.</p>"), ["reviews=1"]);
  // The value is normalised, so a thousands separator is not a second opinion.
  assert.deepEqual(labels("<p>4,200 reviews</p>"), ["reviews=4200"]);
});

test("a bare number is not a fact", () => {
  // The whole design: a number bound to a label the page states, never any number.
  assert.deepEqual(labels("<p>We have 42 of them and 41 of those.</p>"), []);
});

test("stars and rating are ONE label, and 4.9 and 4.90 are ONE value", () => {
  assert.deepEqual(labels("<p>4.9 stars</p>"), ["rating=4.9"]);
  assert.deepEqual(labels("<p>Our rating: 4.90</p>"), ["rating=4.9"]);
  assert.deepEqual(labels("<p>4.9 out of 5</p>"), ["rating=4.9"]);
  assert.deepEqual(labels("<p>4.9/5 stars</p>"), ["rating=4.9"]);
});

test("a proportion is not a rating", () => {
  // FOUND BY REVIEW, reproduced on the committed code: "4 out of 5 customers recommend us"
  // extracted rating=4 and argued with the real 4.9 on the same page. It is ordinary
  // testimonial copy, and so is "4/5 calls answered within the hour".
  assert.deepEqual(labels("<p>4 out of 5 customers recommend us. We are rated 4.9 stars.</p>"), ["rating=4.9"]);
  assert.deepEqual(labels("<p>4/5 calls answered within the hour.</p>"), []);
  // A whole number IS a rating when something nearby says so. Both directions kept working.
  assert.deepEqual(labels("<p>Rated 5 out of 5 by the Guild.</p>"), ["rating=5"]);
  assert.deepEqual(labels("<p>5 out of 5 stars.</p>"), ["rating=5"]);
  assert.deepEqual(labels("<p>Scored 5 out of 5.</p>"), ["rating=5"]);
});

test("a rating word in the PREVIOUS sentence does not license the proportion", () => {
  // FOUND BY RE-REVIEW: the first guard was a window of twelve non-word characters, and a full
  // stop and a space fit inside it, so an adjacent sentence reopened the whole class on copy no
  // less ordinary than the sentence it was written for. A sentence terminator now ends the
  // window, and a review count no longer licenses anything at all.
  assert.deepEqual(
    labels("<p>Rated by 42 reviews. 4 out of 5 customers recommend us. We are rated 4.9 stars.</p>"),
    ["reviews=42", "rating=4.9"],
  );
  assert.deepEqual(labels("<p>4.9 stars. 4 out of 5 clients renew.</p>"), ["rating=4.9"]);
  assert.deepEqual(labels("<p>42 reviews, 4 out of 5 of them five star.</p>"), ["reviews=42"]);
  // The same rule on the other side, and the string is the one that actually reaches it: a
  // rating word OPENING the next sentence sits three characters away and licenses nothing.
  assert.deepEqual(labels("<p>Renewals run 4 out of 5. Stars are earned here.</p>"), []);
  assert.deepEqual(labels("<p>5 out of 5 stars.</p>"), ["rating=5"]);
});

test("a run of punctuation between the rating word and the number breaks the licence", () => {
  // FOUND BY THE CRITIC after I deleted both distance counts for being inert. They were inert
  // against an intervening WORD, which the character class already stops, and they were the only
  // guard against intervening PUNCTUATION. A star glyph row is punctuation, so the whole class
  // came back on the commonest markup there is for a rating.
  assert.deepEqual(
    labels("<p>Rated ★★★★★ 4 out of 5 customers recommend us. We are rated 4.9 stars.</p>"),
    ["rating=4.9"],
  );
  assert.deepEqual(labels("<p>Scored ..... 4 out of 5 sites.</p>"), []);
  // A COUNT THAT CAN FAIL. These two are what make the bound testable rather than decorative:
  // the short separators a real page puts between the word and the number still license it.
  assert.deepEqual(labels("<p>Rated: 5 out of 5.</p>"), ["rating=5"]);
  assert.deepEqual(labels("<p>Rated - 5 out of 5.</p>"), ["rating=5"]);
  assert.deepEqual(labels("<p>4 out of 5 ★★★★★</p>"), ["rating=4"]);
  assert.deepEqual(labels("<p>4 out of 5 &mdash;&mdash;&mdash;&mdash; stars</p>"), []);
});

test("a date is not a rating", () => {
  // FOUND BY READING THE OUTPUT: `1/5/2024` was read as a rating of one, so any site printing
  // a day/month date in May argued with its own star rating. The slash form now refuses a
  // neighbour on either side.
  assert.deepEqual(labels("<p>Posted 1/5/2024. Sale ends 4/5/2026.</p>"), []);
});

test("a five-star CATEGORY claim is not a measured rating", () => {
  // "5 star service" is a boast, not an average, and reading it as one puts every site that
  // says both "5 star service" and "4.9 stars" permanently in disagreement with itself.
  assert.deepEqual(labels("<p>Five star service. 5 star treatment.</p>"), []);
});

test("years is the experience claim, not any span of years", () => {
  assert.deepEqual(labels("<p>Over 20 years of experience.</p>"), ["years experience=20"]);
  assert.deepEqual(labels("<p>25 years in business.</p>"), ["years in business=25"]);
  assert.deepEqual(labels("<p>Backed by a 3 year warranty.</p>"), []);
  assert.deepEqual(labels("<p>We moved here over 20 years ago.</p>"), []);
});

test("two different year claims in one sentence are two labels, not a contradiction", () => {
  // MEASURED, not imagined: this fired on the clean fixture built to test exactly that. The
  // sentence is ordinary and both halves are true, so the qualifier has to be part of the label.
  assert.deepEqual(
    labels("<p>25 years in the trade, 20 years in business under this name.</p>"),
    ["years in the trade=25", "years in business=20"],
  );
  assert.deepEqual(disagreements({
    "/": extractFacts("<p>25 years in the trade, 20 years in business.</p>"),
    "/about": extractFacts("<p>20 years in business.</p>"),
  }), []);
});

test("a phone number ignores spaces, brackets and the country code", () => {
  assert.deepEqual(labels('<a href="tel:+61298765432">Call</a>'), ["phone=0298765432"]);
  // The commonest markup there is: the href and the link text are the same number twice.
  assert.deepEqual(labels('<a href="tel:+61298765432">(02) 9876 5432</a>'), ["phone=0298765432"]);
  assert.deepEqual(labels("<p>Call (02) 9876 5432 today.</p>"), ["phone=0298765432"]);
  assert.deepEqual(labels("<p>Call +61 2 9876 5432 today.</p>"), ["phone=0298765432"]);
  assert.deepEqual(labels("<p>Call 1300 123 456.</p>"), ["phone=1300123456"]);
  // Too short to be a number anyone is reachable on. An emergency link is not a business line.
  assert.deepEqual(labels('<a href="tel:000">Emergency</a>'), []);
});

test("a reference number is not a service number, and a stray digit is not part of one", () => {
  // Two ways the phone reader picked up something that was not a phone. A 1300 or 1800 service
  // number is ten digits; eight digits after an invoice word is a reference. And a lone digit in
  // the cell before a bracketed number was being absorbed into it, so the same number read two
  // ways depending on what sat beside it, which is the exact fault the normaliser exists to stop.
  assert.deepEqual(labels("<p>Quote reference INV 1300 4471.</p>"), []);
  assert.deepEqual(labels("<p>Depot 0 (02) 9876 5432</p>"), ["phone=0298765432"]);
  assert.deepEqual(labels("<p>Call 1300 123 456.</p>"), ["phone=1300123456"]);
});

test("a year range and a price are not phone numbers", () => {
  assert.deepEqual(labels("<p>Trading 2019 - 2024. From $1,299 installed.</p>").filter((l) => l.startsWith("phone")), []);
});

test("a written date is not a phone number", () => {
  // FOUND BY REVIEW, reproduced: "Effective 01.05.2024" extracted phone=01052024, so a policy
  // page carrying an effective date argued with the site's real phone number and the operator
  // was handed a phone disagreement whose second value was a date.
  assert.deepEqual(labels("<p>Effective 01.05.2024 until further notice.</p>"), []);
  assert.deepEqual(labels("<p>Signed 01-05-2024.</p>"), []);
  assert.deepEqual(labels("<p>Updated 2024-05-01.</p>"), []);
  // Dots are not how a phone number is punctuated at this length either.
  assert.deepEqual(labels("<p>0.5 1.0 2.0 4.5</p>"), []);
  // And every grouping a phone is actually written in is a different shape, so it still reads.
  assert.deepEqual(labels("<p>Call 02 9876 5432.</p>"), ["phone=0298765432"]);
  assert.deepEqual(labels("<p>Call 0412 345 678.</p>"), ["phone=0412345678"]);
});

test("a service number and a mobile fold onto their national form", () => {
  // The country-code fold missed the twelve-digit shapes, so a site writing both spellings of
  // its own number was permanently in disagreement with itself.
  assert.deepEqual(labels("<p>Call +61 1300 123 456 or 1300 123 456.</p>"), ["phone=1300123456"]);
  assert.deepEqual(labels("<p>Call +61 (0)412 345 678 or 0412 345 678.</p>"), ["phone=0412345678"]);
});

test("the written trunk zero folds outside Australia too", () => {
  // FOUND BY RE-REVIEW. The `(0)` strip was deleted in round 2 on a zero-failure mutation, and
  // the reason given was that the fold already leaves a leading zero alone. That is true inside
  // the AU branch and false everywhere else, so a UK or NZ site writing both spellings of one
  // number was permanently in disagreement with itself. A zero-failure mutation means the suite
  // did not cover the behaviour, not that nothing depended on it.
  assert.deepEqual(labels("<p>Call +44 (0)20 7946 0958 or 020 7946 0958.</p>"), ["phone=02079460958"]);
  assert.deepEqual(labels("<p>Call +44 20 7946 0958 or 020 7946 0958.</p>"), ["phone=02079460958"]);
  assert.deepEqual(labels("<p>Call +64 (0)9 123 4567 or 09 123 4567.</p>"), ["phone=091234567"]);
  assert.deepEqual(labels("<p>Call +64 21 123 4567 or 021 123 4567.</p>"), ["phone=0211234567"]);
  // A UK national number is nine or ten digits, so with the country code it is eleven or twelve.
  // The shorter one is why the fold is keyed on the country code and not on a single length.
  assert.deepEqual(labels("<p>Call +44 16977 3234 or 016977 3234.</p>"), ["phone=0169773234"]);
});

test("an ABN is eleven digits under its own label", () => {
  assert.deepEqual(labels("<p>ABN 12 345 678 901</p>"), ["ABN=12345678901"]);
  assert.deepEqual(labels("<p>ABN: 12345678901</p>"), ["ABN=12345678901"]);
});

test("an opening-hours line carries its days as the label and a 24-hour range as the value", () => {
  assert.deepEqual(labels("<p>Open Mon-Fri 9am-5pm</p>"), ["hours mon-fri=09:00-17:00"]);
  assert.deepEqual(labels("<p>Opening hours: Monday to Friday: 9:00am - 5:00pm</p>"), ["hours mon-fri=09:00-17:00"]);
  assert.deepEqual(labels("<p>Trading hours Saturday 9-1</p>"), ["hours sat=09:00-13:00"]);
  assert.deepEqual(labels("<p>Closed Sunday. Open Mon-Fri 9-5.</p>"), ["hours mon-fri=09:00-17:00"]);
});

test("a block of day lines is licensed once and reads to the end", () => {
  // A real hours block is a heading and then a line per day, so the licence has to carry down
  // the list rather than sit beside every line.
  //
  // THE TABLE IS SIX ROWS OF FULL TIMES ON PURPOSE, and the first version of this test was
  // three rows of "9-5" that fitted inside the 90-character window from the heading. It
  // therefore passed whether the chain existed or not, and the mutation row this report claimed
  // for the chain was produced by a patch that broke the file's syntax rather than removing the
  // line. Written out in full, Friday and Saturday sit past the window and only the chain
  // reaches them: with it, all six; without it, Monday to Thursday and nothing else.
  const day = (d, close) => `<tr><td>${d}</td><td>9:00am - ${close}</td></tr>`;
  const table = `<h2>Opening hours</h2><table>` +
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => day(d, "5:00pm")).join("") +
    day("Saturday", "1:00pm") + `</table>`;
  assert.deepEqual(labels(table), [
    "hours mon=09:00-17:00", "hours tue=09:00-17:00", "hours wed=09:00-17:00",
    "hours thu=09:00-17:00", "hours fri=09:00-17:00", "hours sat=09:00-13:00",
  ]);
});

test("a time range after a day name is not automatically the trading hours", () => {
  // MEASURED BY AN INDEPENDENT CRITIC as the second largest cause of a 46 per cent false-alarm
  // rate. A timetable, an inspection schedule, a market stall and an event all state a time
  // range after a day name, and none of them is when the business is open. The hours label now
  // needs a word that says these are the trading hours.
  assert.deepEqual(labels("<p>Inspections Saturday 10 - 12.</p>"), []);
  assert.deepEqual(labels("<p>Class timetable. Saturday 8am - 9:30am.</p>"), []);
  assert.deepEqual(labels("<p>Find us at the market, Sunday 7 - 11am.</p>"), []);
  assert.deepEqual(labels("<p>Committee meets Monday 6 - 7pm.</p>"), []);
});

test("a rating stacked above the word reviews is not nine reviews", () => {
  // A stat block renders the number and its label as separate elements, so the text collapses
  // to "4.9 reviews". Without the guard, the tail of the rating reads as a review count and
  // every site with a stat block permanently disagrees with its own review number.
  assert.deepEqual(labels("<div><span>4.9</span><span>reviews</span></div>"), []);
});

test("one claim is one fact, however many patterns notice it", () => {
  // "4.9/5 stars" answers two of the rating patterns. Counted twice it inflates every total
  // this gate prints, and on a real page it is one claim written once.
  assert.deepEqual(labels("<p>4.9/5 stars</p>"), ["rating=4.9"]);
});

test("every fact carries the context it was read from", () => {
  const [f] = extractFacts("<p>Trusted by 42 reviews from real customers.</p>");
  assert.ok(f.context.includes("42 reviews"), f.context);
});

// -------------------------------------------------------------- what is excluded

test("a code or pre block is not the site making a claim", () => {
  assert.deepEqual(labels("<pre>const n = 99; // 99 reviews</pre>"), []);
  assert.deepEqual(labels("<p>Use <code>42 reviews</code> as the label.</p>"), []);
});

test("a dated entry is excluded: a 2019 post legitimately says 38 reviews", () => {
  const post = `<article><h1>Our year</h1><p><time datetime="2019-06-01">1 June 2019</time></p>
    <p>We passed 38 reviews this month.</p></article>`;
  assert.deepEqual(labels(post), []);
});

test("a listing card carrying a date is excluded too", () => {
  const list = `<ul><li><a href="/blog/x"><h2>Old news</h2>
    <time datetime="2019-06-01">1 June 2019</time><p>38 reviews and counting.</p></a></li></ul>`;
  assert.deepEqual(labels(list), []);
});

test("a dated card is excluded whatever element wraps it", () => {
  // The shipped scaffold uses <li> and <article>, both covered, but a hand-built listing grid
  // of <div> or <a> cards is ordinary and that is what a customer build produces.
  //
  // THE CARDS SIT IN A PAGE, because that is the only condition under which they are cards. A
  // bare fragment with nothing around it is indistinguishable from a page wrapper, and after the
  // re-review the rule turns on exactly that difference.
  const page = (card) => `<body><header><h1>Latest</h1></header><main><div class="grid">${card}` +
    `</div></main><footer><p>Our 42 reviews are published in full.</p></footer></body>`;
  assert.deepEqual(labels(page('<div class="card"><time datetime="2019-06-01">2019</time><p>38 reviews</p></div>')), ["reviews=42"]);
  assert.deepEqual(labels(page('<a href="/p/1"><time datetime="2019-06-01">2019</time><p>38 reviews</p></a>')), ["reviews=42"]);
});

test("a dated element does not swallow the page around it, at any size", () => {
  // FOUND BY RE-REVIEW, and it is the important one: the guard was a 4,000-character bound, and
  // an ordinary built page body is smaller than that, so a whole small page wrapped in an app
  // div with a copyright <time> read as nothing at all. Every page in the committed fixture is
  // under 745 bytes. SIZE WAS THE WRONG AXIS: a card is a card because it sits INSIDE the page,
  // not because it is short. A block holding a page landmark, or covering nearly the whole
  // document, is the page.
  const small = `<div id="app"><p>42 reviews</p><p>Phone (02) 9876 5432.</p>` +
    `<footer><time datetime="2026">2026</time></footer></div>`;
  assert.deepEqual(labels(small), ["reviews=42", "phone=0298765432"]);
  // The tel: href is read from the same stripped body, so it went too. It comes back.
  assert.deepEqual(
    labels(`<div id="app"><a href="tel:+61298765432">Call</a><time datetime="2026">2026</time></div>`),
    ["phone=0298765432"],
  );
  // No landmark at all, and the wrapper is still almost the whole document.
  assert.deepEqual(labels(`<div><p>42 reviews</p><time datetime="2026">2026</time></div>`), ["reviews=42"]);
  const big = `<div id="app"><p>42 reviews</p>${"<p>filler</p>".repeat(400)}<footer><time datetime="2026">2026</time></footer></div>`;
  assert.deepEqual(labels(big), ["reviews=42"]);
  // A REAL PAGE HAS A HEAD, and that is what the landmark half of the rule is for. Here the app
  // div is well under the share threshold because the head carries the weight, so only the
  // `<footer>` inside it says this block is a page region rather than a card.
  const withHead = `<html><head><title>Northshore Joinery</title>` +
    `<meta name="description" content="${"Cabinetmakers on Sydney's north shore. ".repeat(12)}">` +
    `</head><body><div id="app"><p>42 reviews</p>` +
    `<footer><time datetime="2026">2026</time></footer></div></body></html>`;
  assert.ok(withHead.indexOf("<div") > withHead.length * 0.4, "the head must outweigh the div or this proves nothing");
  assert.deepEqual(labels(withHead), ["reviews=42"]);
  // And the card it was widened for is still excluded, inside a real page.
  const listing = `<body><header><h1>Latest</h1></header><main><div class="grid">` +
    `<div class="card"><time datetime="2019-06-01">2019</time><p>38 reviews</p></div>` +
    `</div></main><footer><p>Phone (02) 9876 5432.</p></footer></body>`;
  assert.deepEqual(labels(listing), ["phone=0298765432"]);
});

test("a page whose own JSON-LD calls it an article is a dated entry, whole", () => {
  // The scaffold's post page emits BlogPosting. That is the page declaring itself a dated
  // entry, which is a stronger signal than any guess about the URL.
  const html = `<html><head><script type="application/ld+json">{"@type":"BlogPosting","headline":"x"}</script></head>
    <body><p>We passed 38 reviews this month.</p></body></html>`;
  assert.deepEqual(extractFacts(html), []);
});

test("an undated article still speaks", () => {
  // The exclusion is DATED content, not the <article> element. A services page wrapped in
  // <article> is the site's current claim and must still be compared.
  assert.deepEqual(labels("<article><p>42 reviews</p></article>"), ["reviews=42"]);
});

// ----------------------------------------------------------------- disagreement

test("two values for one label across pages is a disagreement, named on both sides", () => {
  const found = disagreements({
    "/": extractFacts("<p>42 reviews</p>"),
    "/about": extractFacts("<p>41 reviews</p>"),
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].label, "reviews");
  assert.deepEqual(found[0].values.map((v) => v.value).sort(), ["41", "42"]);
  const pages = found[0].values.flatMap((v) => v.pages).sort();
  assert.deepEqual(pages, ["/", "/about"]);
});

test("one value everywhere is silent, and a label appearing once is silent", () => {
  assert.deepEqual(disagreements({
    "/": extractFacts("<p>42 reviews</p>"),
    "/about": extractFacts("<p>42 reviews</p>"),
    "/contact": extractFacts("<p>42 reviews</p>"),
  }), []);
  assert.deepEqual(disagreements({ "/": extractFacts("<p>42 reviews</p>"), "/about": [] }), []);
});

test("disagreements accepts a Map as well as an object", () => {
  const m = new Map([["/", extractFacts("<p>42 reviews</p>")], ["/about", extractFacts("<p>41 reviews</p>")]]);
  assert.equal(disagreements(m).length, 1);
});

// ------------------------------------------------------------------------- CLI

test("42 on one page and 41 on another fires exactly once, naming both pages", () => {
  const dir = site({ "/": "<p>Rated by 42 reviews.</p>", "/about": "<p>Read all 41 reviews.</p>" });
  const r = runMerged(dir);
  assert.equal(r.code, 0, r.out);                       // ADVISORY: never blocks
  assert.match(r.out, /gate-facts: 1 disagreement\(s\)/, r.out);
  assert.match(r.out, /\[reviews\]/, r.out);
  assert.match(r.out, /\b42\b/, r.out);
  assert.match(r.out, /\b41\b/, r.out);
  assert.match(r.out, /\/about/, r.out);
});

test("one value across every page is silent, and the clean line says how much it read", () => {
  const dir = site({ "/": "<p>42 reviews</p>", "/about": "<p>42 reviews</p>", "/contact": "<p>42 reviews</p>" });
  const r = runMerged(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /inspected 3 page\(s\)/, r.out);
});

test("two different phone numbers are a contact list, not a contradiction", () => {
  // A DELIBERATE DEPARTURE FROM THE BRIEF, forced by measurement. The brief's step-1 list says
  // two different phone numbers fire, and an independent critic then measured this gate firing
  // on 6 of 13 clean small-business builds, with a second number the single largest cause: an
  // after-hours mobile, a fax, a depot. A business having more than one number is NORMAL, so a
  // second number is not evidence of anything. Every other label here is single-valued by
  // nature (one review count, one rating, one ABN, one age, one set of trading hours per day)
  // and phone is the only one that is not, so phone is reported as a list and never as a clash.
  const dir = site({ "/": '<a href="tel:+61298765432">Call</a>', "/contact": "<p>Call (02) 9876 5433.</p>" });
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /phone \(2 values\)/, r.out);
  // Still visible, because setting something aside must never mean losing it.
  const all = runMerged(dir, "--all");
  assert.match(all.out, /^ +0298765432 {2}on \//m, all.out);
  assert.match(all.out, /^ +0298765433 {2}on \/contact/m, all.out);
});

test("two numbers in one footer are a contact list too", () => {
  // The commonest shape there is, and the one the rate was made of.
  const dir = site({
    "/": "<p>Call (02) 9876 5432. After hours 0412 660 118. Fax (02) 9876 5433.</p>",
    "/contact": "<p>Call (02) 9876 5432. After hours 0412 660 118. Fax (02) 9876 5433.</p>",
  });
  assert.match(runMerged(dir).out, /gate-facts: clean/);
});

test("the same phone written two conventional ways is NOT a disagreement", () => {
  const dir = site({ "/": "<p>+61 2 9876 5432</p>", "/contact": "<p>(02) 9876 5432</p>" });
  assert.match(runMerged(dir).out, /gate-facts: clean/);
});

test("4.9 stars against 4.7 rating is one label with two values", () => {
  const dir = site({ "/": "<p>4.9 stars</p>", "/reviews": "<p>Our rating: 4.7</p>" });
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: 1 disagreement\(s\)/, r.out);
  assert.match(r.out, /\[rating\]/, r.out);
});

test("4.9 stars against a 4.90 rating is silent", () => {
  assert.match(runMerged(site({ "/": "<p>4.9 stars</p>", "/reviews": "<p>Our rating: 4.90</p>" })).out, /gate-facts: clean/);
});

test("a post saying 38 reviews does not argue with the home page", () => {
  const dir = site({
    "/": "<p>41 reviews</p>",
    "/blog/2019": '<article><time datetime="2019-06-01">1 June 2019</time><p>We passed 38 reviews.</p></article>',
  });
  assert.match(runMerged(dir).out, /gate-facts: clean/);
});

test("Explore scaffolding is not a page of the site", () => {
  // `/explore` and the `/boards/bN` direction boards exist for one conversation and are deleted
  // at Compose: gate-shipready fails a hand-over that still carries them. Rungs differ in their
  // copy on purpose, so reading a board's number as a claim about the business reports the range
  // as a contradiction, during the one stage whose whole job is showing a range.
  // `palate-index.mjs` already names these routes and this gate now uses the same predicate.
  const dir = site({
    "/": "<p>137 reviews</p>",
    "/about": "<p>137 reviews</p>",
    "/explore": "<p>130 reviews</p>",
    "/boards/b1": "<p>120 reviews</p>",
    "/v3": "<p>110 reviews</p>",
  });
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /inspected 2 page\(s\)/, r.out);
});

test("a 404 page is never compared", () => {
  const dir = site({ "/": "<p>Call (02) 9876 5432.</p>" });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "404.html"), "<html><body><p>Call (02) 9876 9999.</p></body></html>");
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /inspected 1 page\(s\)/, r.out);
});

test("a label with many values is a list, set aside by name rather than reported", () => {
  // A product grid rates every card and a multi-branch site has a phone per location. Every
  // value is correct, and calling twelve of them a contradiction is the false alarm that gets
  // a check switched off. It is NAMED, though: a check that quietly stops looking is worse.
  const dir = site({
    "/": "<p>4.9 stars</p>", "/a": "<p>4.7 stars</p>", "/b": "<p>4.5 stars</p>",
    "/c": "<p>4.2 stars</p>", "/d": "<p>3.9 stars</p>",
  });
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /set aside as a list/, r.out);
  assert.match(r.out, /rating \(5 values\)/, r.out);
});

test("a clash hidden inside a set-aside list has a route to it", () => {
  // THE HALF THAT WAS MISSING. A genuine clash can hide under a catalogue: the home page's 4.9
  // against the reviews page's 4.7, buried beneath three card ratings. Suppressing the label
  // was the right call and leaving the operator no way to look was not.
  const dir = site({
    "/": "<p>4.9 stars</p>", "/reviews": "<p>Our rating: 4.7</p>",
    "/a": "<p>4.5 stars</p>", "/b": "<p>4.2 stars</p>", "/c": "<p>3.9 stars</p>",
  });
  const quiet = runMerged(dir);
  assert.match(quiet.out, /gate-facts: clean/, quiet.out);
  assert.match(quiet.out, /Re-run with --all for their values and pages/, quiet.out);
  assert.doesNotMatch(quiet.out, /\/reviews/, quiet.out);      // no values printed without it

  const all = runMerged(dir, "--all");
  assert.match(all.out, /set aside as a list rather than a claim:/, all.out);
  assert.match(all.out, /4\.9 {2}on \//, all.out);
  assert.match(all.out, /4\.7 {2}on \/reviews/, all.out);
  // The clause stops advertising the flag once the flag is in use.
  assert.doesNotMatch(all.out, /Re-run with --all/, all.out);
});

test("a real disagreement still fires beside a list that was set aside", () => {
  const dir = site({
    "/": "<p>4.9 stars. 42 reviews.</p>", "/a": "<p>4.7 stars</p>", "/b": "<p>4.5 stars</p>",
    "/c": "<p>4.2 stars</p>", "/about": "<p>3.9 stars. 41 reviews.</p>",
  });
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: 1 disagreement\(s\)/, r.out);
  assert.match(r.out, /\[reviews\]/, r.out);
  assert.match(r.out, /set aside as a list/, r.out);
});

test("no built output is a SKIP with a reason, never a pass", () => {
  const dir = join(TMP, "unbuilt");
  mkdirSync(join(dir, "src", "pages"), { recursive: true });
  const r = run(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /gate-facts: skipped \(/, r.out);
  assert.match(r.out, /NOT a pass/, r.out);
});

test("a built output with no page in it is a SKIP, never a pass", () => {
  const dir = join(TMP, "emptydist");
  mkdirSync(join(dir, "dist", "_astro"), { recursive: true });
  writeFileSync(join(dir, "dist", "_astro", "x.html"), "<html><body><p>42 reviews</p></body></html>");
  const r = run(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /gate-facts: skipped \(/, r.out);
});

test("a page too big to be prose is not inspected, and inspecting nothing is a SKIP", () => {
  const dir = join(TMP, "huge");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), `<html><body><p>42 reviews</p>${"x".repeat(2_100_000)}</body></html>`);
  const r = run(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /gate-facts: skipped \(/, r.out);
});

test("it refuses to grade the plugin itself", () => {
  const r = run(ROOT);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /gate-facts: refused:/, r.out);
});

// ------------------------------------------- the standing false-positive measurement

/**
 * The fixture is copied out of the repo before it is read, because it lives inside a plugin
 * checkout and the gate refuses to grade one. Every other suite here does the same.
 */
function fixtureSite(name) {
  const dir = join(TMP, name);
  cpSync(SITE_FIXTURE, dir, { recursive: true });
  return dir;
}

test("the adversarial fixture is silent, and not because it read nothing", () => {
  // THIS IS THE MEASUREMENT. Seven pages of ordinary trade copy that contradict nothing, carrying
  // every shape known to have misfired: an out-of-five proportion after a review count, three
  // written dates, prices, order numbers, a code sample, a retired number in a pre block, a
  // product grid of ratings, one phone in two conventions, one ABN in two spellings, two year
  // claims in one sentence, a page wrapped in an app div with a copyright time, and a 2019 post
  // quoting the review count of its day. A check that fires here gets switched off in a week.
  //
  // THE VALUE COUNT IS THE REGRESSION DETECTOR and it is pinned deliberately. Reverting the
  // proportion guard, the dated-block fix, the hours licence, the Explore filter or the
  // reference-number guard each changes this line, and reverting the phone, hours or Explore
  // fixes turns the whole fixture from clean into a disagreement. All were watched.
  const r = runMerged(fixtureSite("fixture-clean"));
  assert.match(r.out, /gate-facts: clean/, r.out);
  assert.match(r.out, /inspected 7 page\(s\), 33 labelled value\(s\)/, r.out);
  // Seven, not nine: /explore and /boards/b1 are in the build and are not pages of the site.
  assert.match(r.out, /2 label\(s\) set aside as a list rather than a claim: phone \(3 values\), rating \(5 values\)/, r.out);
});

test("the fixture's contact numbers are a list, and every one of them is readable", () => {
  // A landline, an after-hours mobile and a fax, which is what a trade footer carries. Before
  // this round every one of these was reported as the site contradicting itself.
  const out = runMerged(fixtureSite("fixture-phones"), "--all").out;
  assert.match(out, /\[phone\] 3 values, set aside: a business can legitimately have more than one/, out);
  for (const v of ["0298765432", "0298765433", "0412660118"]) {
    assert.match(out, new RegExp(`^ +${v} {2}on `, "m"), out);
  }
  // The invoice reference that begins like a service number is not among them.
  assert.doesNotMatch(out, /^ +13004471 {2}on /m, out);
});

test("the fixture's only ratings are the ones the catalogue really carries", () => {
  // The set-aside rule means a rating clash can never be REPORTED on this fixture, so the class
  // it was built for would show only as a count. This names the values instead: five card
  // ratings and the site's own 4.9, and no proportion smuggled in among them.
  const out = runMerged(fixtureSite("fixture-ratings"), "--all").out;
  for (const v of ["3.9", "4.2", "4.5", "4.7", "4.9"]) {
    assert.match(out, new RegExp(`^ +${v.replace(".", "\\.")} {2}on `, "m"), out);
  }
  assert.doesNotMatch(out, /^ +4 {2}on /m, out);
  assert.doesNotMatch(out, /^ +5 {2}on /m, out);
});

test("the same fixture fires the moment one number disagrees", () => {
  // Silence is only evidence if the fixture is capable of speaking. One number changed on one
  // page reproduces the engineer's complaint exactly, and names both sides.
  const dir = fixtureSite("fixture-clash");
  const page = join(dir, "build", "about", "index.html");   // `build`, not `dist`: the repo gitignores dist/
  writeFileSync(page, readFileSync(page, "utf8").replace("42 reviews", "41 reviews"));
  const r = runMerged(dir);
  assert.match(r.out, /gate-facts: 1 disagreement\(s\)/, r.out);
  assert.match(r.out, /\[reviews\]/, r.out);
  assert.match(r.out, /42 {2}on \//, r.out);
  assert.match(r.out, /41 {2}on \/about/, r.out);
});

test("the fixture's hours are the trading hours and nothing else", () => {
  // The services page states a delivery run and a site-measure window, both after a day name
  // and neither of them when the workshop is open. If either were read as trading hours the
  // fixture would report the opening hours as contradicting themselves.
  const out = runMerged(fixtureSite("fixture-hours"), "--all").out;
  assert.match(out, /gate-facts: clean/, out);
  assert.doesNotMatch(out, /hours tue/, out);
});

// -------------------------------------------------------- folded into the done gate

/** A project the done gate will actually read: manifest, verifier report and shots. */
function doneProject(name, pages) {
  const dir = join(TMP, name);
  mkdirSync(join(dir, ".palate-shots"), { recursive: true });
  cpSync(DEEP, join(dir, "build-manifest.json"));
  writeFileSync(join(dir, ".palate-shots", "desktop-full.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(dir, ".palate-shots", "manifest.json"), JSON.stringify({ status: "captured", console_errors: 0, shots: { desktop_full: "desktop-full.png" } }));
  writeFileSync(join(dir, ".palate-shots", "errors.json"), "[]");
  writeFileSync(join(dir, "verify-report.json"), JSON.stringify({
    verdict: "pass",
    visual: { ran: true, pass: true, console_errors: 0, iterations: [{ i: 1, axes: { philosophy: 5 }, score: 25, shots: { desktop_full: ".palate-shots/desktop-full.png" } }] },
    shots_dir: ".palate-shots",
  }));
  for (const [route, body] of Object.entries(pages || {})) {
    const file = route === "/" ? "index.html" : `${route.replace(/^\//, "")}/index.html`;
    const abs = join(dir, "dist", file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`);
  }
  return dir;
}

function done(dir) {
  try {
    return { code: 0, out: execFileSync("bash", ["-c", `bash ${JSON.stringify(DONE)} ${JSON.stringify(join(dir, "build-manifest.json"))} 2>&1; exit 0`], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

test("the done gate folds the count in and does not block on it", () => {
  const dir = doneProject("done-clash", { "/": "<p>42 reviews</p>", "/about": "<p>41 reviews</p>" });
  const r = done(dir);
  assert.match(r.out, /Done gate: /, r.out);
  assert.match(r.out, /facts=1 disagreement\(s\)/, r.out);
  assert.doesNotMatch(r.out, /Done gate FAILED/, r.out);
});

test("the summary names the command that prints the detail", () => {
  // A count with no route to it is a finding nobody can act on. The operator should not have
  // to already know this script exists, and the line has to be INDENTED or the Stop hook drops
  // it: it forwards a matched headline's indented continuation lines and nothing else.
  const dir = doneProject("done-detail", { "/": "<p>42 reviews</p>", "/about": "<p>41 reviews</p>" });
  const r = done(dir);
  assert.match(r.out, /^ {2}Facts: 1 label\(s\) carry two values across pages\./m, r.out);
  assert.match(r.out, /node "[^"]*gate-facts\.mjs" "[^"]*done-detail"/, r.out);
});

test("the done gate reports a clean facts pass as clean, and says nothing more", () => {
  const dir = doneProject("done-clean", { "/": "<p>42 reviews</p>", "/about": "<p>42 reviews</p>" });
  const r = done(dir);
  assert.match(r.out, /facts=clean/, r.out);
  // No pointer when there is nothing to point at: the summary is read every build.
  assert.doesNotMatch(r.out, /^ {2}Facts:/m, r.out);
});

test("the done gate carries the route to a set-aside list too", () => {
  // `facts=clean` over a suppressed label reads as a bill of health. The summary says a label
  // was set aside and how to look at it, on its own indented line so the Stop hook forwards it.
  const dir = doneProject("done-aside", {
    "/": "<p>4.9 stars</p>", "/reviews": "<p>Our rating: 4.7</p>",
    "/a": "<p>4.5 stars</p>", "/b": "<p>4.2 stars</p>", "/c": "<p>3.9 stars</p>",
  });
  const r = done(dir);
  assert.match(r.out, /facts=clean/, r.out);
  assert.match(r.out, /^ {2}Facts: 1 label\(s\) set aside as a list/m, r.out);
  assert.match(r.out, /gate-facts\.mjs" "[^"]*done-aside" --all/, r.out);
});

test("with no dist the done gate reports facts as skipped, with a reason", () => {
  const dir = doneProject("done-nodist", null);
  const r = done(dir);
  assert.match(r.out, /facts=skipped/, r.out);
  assert.match(r.out, /facts: /, r.out);          // the reason travels in the count clause
  assert.doesNotMatch(r.out, /facts=clean/, r.out);
});
