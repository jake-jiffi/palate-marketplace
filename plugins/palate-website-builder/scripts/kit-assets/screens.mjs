/**
 * Draws the four product-UI screenshots for the kit's DemoScreenshots demo.
 *
 * Everything here is invented: Roundhouse is not a real product and the people, addresses and
 * figures on these screens are not real. The point is that a reviewer can judge how the
 * component handles a real screenshot (a dense interface at a real aspect ratio, legible type,
 * four visibly different compositions) rather than judging a grey box.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

/* One palette, declared once per file. Each name falls through to a kit token first, so an SVG
   that is ever inlined picks up the brand; loaded as an <img> it is an isolated document and the
   literal after the comma is what renders. The literals are deliberately near-neutral: a
   screenshot carrying a saturated hue would fight whatever accent the brand brings. */
const STYLE = `<style>
    svg{--ink:var(--kit-text,#1b1d21);--muted:var(--kit-text-muted,#6e737b);--paper:var(--kit-bg,#ffffff);--panel:var(--kit-bg-subtle,#f3f4f6);--line:var(--kit-border,#dfe2e6);--steel:#46525d;--sand:#e6dccc;--sage:#dbe4dc;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    text{fill:var(--ink)}
    .m{fill:var(--muted)}
    .w{fill:#fff}
    .lbl{font-size:19px;letter-spacing:.06em;text-transform:uppercase}
    .sm{font-size:20px}
    .md{font-size:24px}
    .lg{font-size:30px;font-weight:600}
    .xl{font-size:40px;font-weight:600;letter-spacing:-.01em}
    .num{font-variant-numeric:tabular-nums}
    .ln{stroke:var(--line);stroke-width:2}
  </style>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* Callers pass a base class and sometimes a second one inside `extra`. Emitting both verbatim
   produces two class attributes, which is a fatal XML error and renders as a broken-image
   marker with nothing in the console, so they are merged here instead. */
const t = (x, y, s, cls = "sm", extra = "") => {
  let rest = extra;
  let classes = cls;
  const m = rest.match(/class="([^"]*)"/);
  if (m) {
    classes = [...new Set(`${cls} ${m[1]}`.trim().split(/\s+/))].join(" ");
    rest = rest.replace(m[0], "").replace(/\s+/g, " ").trim();
  }
  return `<text x="${x}" y="${y}" class="${classes}"${rest ? " " + rest : ""}>${esc(s)}</text>`;
};
const r = (x, y, w, h, fill, rx = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${rx ? ` rx="${rx}"` : ""}${extra ? " " + extra : ""}/>`;
const hr = (x1, x2, y) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="ln"/>`;
const vr = (x, y1, y2) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="ln"/>`;

function doc(title, body, w = 1600, h = 1000) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  ${STYLE}
  ${body}
</svg>
`;
}

/* The application chrome three of the four screens share, so they read as one product rather
   than as four unrelated pictures. `active` names the sidebar item that is current. */
function chrome(active) {
  const nav = ["Schedule", "Jobs", "Quotes", "Customers", "Invoices"];
  const items = nav
    .map((label, i) => {
      const y = 178 + i * 62;
      const on = label === active;
      return (
        (on ? r(20, y - 34, 208, 50, "var(--paper)", 8) : "") +
        r(40, y - 18, 18, 18, on ? "var(--steel)" : "var(--muted)", 4) +
        t(72, y, label, "sm", on ? 'font-weight="600"' : 'class="sm m"')
      );
    })
    .join("\n  ");

  return `${r(0, 0, 1600, 1000, "var(--paper)")}
  ${r(0, 0, 248, 1000, "var(--panel)")}
  ${vr(248, 0, 1000)}
  ${r(0, 0, 1600, 78, "var(--paper)")}
  ${hr(0, 1600, 78)}
  ${r(40, 26, 26, 26, "var(--steel)", 6)}
  ${t(80, 48, "Roundhouse", "md", 'font-weight="600"')}
  ${r(640, 20, 520, 40, "var(--panel)", 20)}
  ${t(668, 47, "Search jobs, customers or quotes", "sm", 'class="sm m"')}
  ${r(1494, 22, 38, 38, "var(--steel)", 19)}
  ${t(1513, 48, "PR", "sm", 'text-anchor="middle" class="sm w"')}
  ${t(40, 122, "Fernbrook depot", "lbl", 'class="lbl m"')}
  ${items}
  ${hr(20, 228, 470)}
  ${t(40, 512, "3 vans on the road", "sm", 'class="sm m"')}
  ${t(40, 548, "1 unassigned job", "sm", 'class="sm m"')}`;
}

/* ------------------------------------------------------------------ 1. the week */
{
  const days = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17"];
  const vans = [
    { name: "Van 1", who: "Priya R." },
    { name: "Van 2", who: "Callum W." },
    { name: "Van 3", who: "Dee A." },
  ];
  /* Eight jobs across three vans, two of them running late, which is what the caption promises. */
  const jobs = [
    { d: 0, v: 0, span: 1, who: "Corbett St Dental", what: "Annual service", state: "" },
    { d: 0, v: 1, span: 2, who: "Ferndale Housing", what: "Roof, block C", state: "" },
    { d: 1, v: 0, span: 1, who: "Tumbleweed Coffee", what: "Extraction fault", state: "Late" },
    { d: 2, v: 0, span: 1, who: "M. Sowden", what: "Gutter repair", state: "" },
    { d: 2, v: 2, span: 2, who: "Copperline Brewing", what: "Heat exchange", state: "" },
    { d: 3, v: 1, span: 1, who: "Brindle Vet", what: "Quote visit", state: "Late" },
    { d: 4, v: 0, span: 1, who: "Kembla Ridge", what: "Drainage check", state: "Done" },
    { d: 4, v: 2, span: 1, who: "Harbourline", what: "Make good", state: "" },
  ];

  const gx = 400;
  const gw = 1600 - gx - 40;
  const cw = gw / 5;
  const gy = 240;
  const rh = 176;

  const head =
    days.map((d, i) => t(gx + i * cw + 16, gy - 22, d, "sm", 'font-weight="600"')).join("\n  ") +
    "\n  " +
    days.map((_, i) => (i ? vr(gx + i * cw, gy - 8, gy + rh * 3) : "")).join("\n  ");

  const rows = vans
    .map((v, i) => {
      const y = gy + i * rh;
      return [
        hr(280, 1560, y),
        t(280, y + 46, v.name, "md", 'font-weight="600"'),
        t(280, y + 78, v.who, "sm", 'class="sm m"'),
      ].join("\n  ");
    })
    .join("\n  ") + "\n  " + hr(280, 1560, gy + rh * 3);

  const chips = { Late: "var(--sand)", Done: "var(--sage)" };
  const blocks = jobs
    .map((j) => {
      const x = gx + j.d * cw + 10;
      const y = gy + j.v * rh + 22;
      const w = cw * j.span - 20;
      /* The badge sits on the TIME line, not the title line: at one column wide the title is
         the widest thing in the block and a badge beside it clipped two customer names. */
      const badge = j.state
        ? r(x + w - 72, y + 88, 62, 28, chips[j.state], 14) +
          t(x + w - 41, y + 108, j.state, "lbl", 'text-anchor="middle" font-size="16"')
        : "";
      return [
        r(x, y, w, 132, "var(--panel)", 10),
        r(x, y, 5, 132, j.state === "Late" ? "#a8703a" : "var(--steel)", 0, 'rx="3"'),
        t(x + 22, y + 44, j.who, "sm", 'font-weight="600"'),
        t(x + 22, y + 76, j.what, "sm", 'class="sm m"'),
        t(x + 22, y + 110, j.span > 1 ? "8:00am to 4:30pm" : "8:00am", "sm", 'class="sm m num" font-size="18"'),
        badge,
      ].join("\n  ");
    })
    .join("\n  ");

  const body = `${chrome("Schedule")}
  ${t(280, 148, "This week", "xl")}
  ${t(280, 190, "13 to 17 October, Fernbrook depot", "md", 'class="md m"')}
  ${r(1330, 116, 230, 46, "var(--steel)", 8)}
  ${t(1445, 146, "Add a job", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${head}
  ${rows}
  ${blocks}
  ${t(280, 858, "Unassigned", "lbl", 'class="lbl m"')}
  ${r(280, 880, 420, 84, "var(--paper)", 10, 'stroke="var(--line)" stroke-width="2" stroke-dasharray="8 6"')}
  ${t(304, 918, "Ashgrove, blocked downpipe", "sm")}
  ${t(304, 948, "Logged 7:42am, no van free", "sm", 'class="sm m" font-size="18"')}`;

  writeFileSync(join(OUT, "screen-schedule.svg"), doc("The Roundhouse week view: eight jobs across three vans, two marked late", body));
}

/* ------------------------------------------------------------------ 2. one job */
{
  const lines = [
    ["Valley iron replacement, 11.4m", "1", "$1,482.00"],
    ["Ridge capping, re-bed and point", "18m", "$1,116.00"],
    ["Scaffold hire, three days", "3", "$690.00"],
    ["Waste removal and make good", "1", "$240.00"],
  ];
  const rows = lines
    .map((l, i) => {
      const y = 470 + i * 62;
      return [
        t(300, y, l[0], "sm"),
        t(880, y, l[1], "sm", 'class="sm m num" text-anchor="end"'),
        t(1030, y, l[2], "sm", 'class="sm num" text-anchor="end"'),
        hr(300, 1030, y + 22),
      ].join("\n  ");
    })
    .join("\n  ");

  const notes = [
    "Side access is 780mm at the gate, so the scaffold goes in through the carport.",
    "Dog is friendly but bolts. Ring before opening the side gate.",
    "Owner works nights. No noise before 8:30am, agreed in writing.",
  ]
    .map((n, i) => {
      const y = 470 + i * 96;
      return r(1100, y - 24, 4, 68, "var(--line)") + wrap(n, 1124, y, 400, "sm");
    })
    .join("\n  ");

  const body = `${chrome("Jobs")}
  ${t(280, 148, "Ferndale Community Housing", "xl")}
  ${t(280, 190, "Block C, 14 Ferndale Road · Job 2418", "md", 'class="md m"')}
  ${r(1330, 116, 230, 46, "var(--steel)", 8)}
  ${t(1445, 146, "Start the job", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${r(280, 232, 1280, 68, "var(--panel)", 10)}
  ${r(304, 254, 14, 14, "#5c7d5f", 7)}
  ${t(332, 272, "Quote accepted 2 October", "sm", 'font-weight="600"')}
  ${t(640, 272, "Scheduled Tue 14 Oct, Van 2", "sm", 'class="sm m"')}
  ${t(1020, 272, "Priya Raghavan", "sm", 'class="sm m"')}
  ${t(300, 380, "Accepted quote", "lg")}
  ${t(1100, 380, "Site notes", "lg")}
  ${notes}
  ${t(300, 428, "Item", "lbl", 'class="lbl m"')}
  ${t(880, 428, "Qty", "lbl", 'class="lbl m" text-anchor="end"')}
  ${t(1030, 428, "Amount", "lbl", 'class="lbl m" text-anchor="end"')}
  ${hr(300, 1030, 444)}
  ${rows}
  ${t(300, 786, "Total including GST", "md", 'font-weight="600"')}
  ${t(1030, 786, "$3,528.00", "md", 'text-anchor="end" font-weight="600" class="md num"')}
  ${t(1100, 792, "From the last visit", "lbl", 'class="lbl m"')}
  ${photoTile(1100, 812, 200, 132, 1)}
  ${photoTile(1320, 812, 200, 132, 2)}`;

  writeFileSync(join(OUT, "screen-job.svg"), doc("One Roundhouse job, showing the accepted quote beside the site notes and two photographs", body));
}

/* A stand-in for a photograph inside a screenshot: plainly geometric, so nobody reads it as a
   real picture, but weighted like one so the layout is judged honestly. */
function photoTile(x, y, w, h, seed) {
  const a = seed === 1
    ? `<path d="M${x} ${y + h} L${x + w * 0.34} ${y + h * 0.42} L${x + w * 0.6} ${y + h} Z" fill="var(--muted)" opacity=".5"/><path d="M${x + w * 0.42} ${y + h} L${x + w * 0.74} ${y + h * 0.28} L${x + w} ${y + h} Z" fill="var(--ink)" opacity=".35"/><circle cx="${x + w * 0.22}" cy="${y + h * 0.26}" r="${h * 0.11}" fill="var(--muted)" opacity=".45"/>`
    : `<rect x="${x + w * 0.12}" y="${y + h * 0.3}" width="${w * 0.3}" height="${h * 0.7}" fill="var(--ink)" opacity=".3"/><rect x="${x + w * 0.5}" y="${y + h * 0.14}" width="${w * 0.36}" height="${h * 0.86}" fill="var(--muted)" opacity=".5"/><rect x="${x}" y="${y + h * 0.72}" width="${w}" height="${h * 0.28}" fill="var(--ink)" opacity=".18"/>`;
  return `<g clip-path="url(#c${seed})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--panel)"/>${a}</g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="var(--line)" stroke-width="2"/><defs><clipPath id="c${seed}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>`;
}

/* Naive greedy wrapper. Good enough because every string here is fixed and was eyeballed in the
   rendered file, which is the only test that counts for a picture. */
function wrap(text, x, y, width, cls, lh = 30) {
  const perChar = cls === "sm" ? 9.6 : 11.5;
  const max = Math.floor(width / perChar);
  const words = text.split(" ");
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.map((l, i) => t(x, y + i * lh, l, cls, i ? 'class="sm m"' : "")).join("");
}

/* ------------------------------------------------------------------ 3. quoting on a phone */
{
  const items = [
    ["Callout and first hour", "$180.00"],
    ["Thermostatic mixer, supply", "$248.00"],
    ["Labour, 2.5 hours", "$375.00"],
    ["Old unit removal", "$60.00"],
  ];
  const rows = items
    .map(([label, amt], i) => {
      const y = 466 + i * 74;
      return [
        t(628, y, label, "sm"),
        t(972, y, amt, "sm", 'text-anchor="end" class="sm num"'),
        hr(628, 972, y + 26),
      ].join("\n  ");
    })
    .join("\n  ");

  const body = `${r(0, 0, 1600, 1000, "var(--panel)")}
  ${t(120, 150, "Quoting from the van", "xl")}
  ${t(120, 238, "Four line items and a running total,", "md", 'class="md m"')}
  ${t(120, 276, "without going back to the office.", "md", 'class="md m"')}
  ${t(120, 372, "Started", "lbl", 'class="lbl m"')}
  ${t(120, 412, "9:52am", "lg", 'class="lg num"')}
  ${t(120, 480, "Sent", "lbl", 'class="lbl m"')}
  ${t(120, 520, "9:56am", "lg", 'class="lg num"')}
  ${r(560, 60, 480, 880, "var(--ink)", 44)}
  ${r(576, 76, 448, 848, "var(--paper)", 34)}
  ${r(736, 96, 128, 10, "var(--line)", 5)}
  ${t(628, 176, "9:56", "sm", 'class="sm num" font-size="18"')}
  ${t(972, 176, "82%", "sm", 'text-anchor="end" class="sm num" font-size="18"')}
  ${hr(576, 1024, 204)}
  ${t(628, 258, "New quote", "lg")}
  ${t(628, 296, "M. Sowden · 12 Ashgrove Rise", "sm", 'class="sm m"')}
  ${t(628, 380, "Line items", "lbl", 'class="lbl m"')}
  ${t(972, 380, "4", "lbl", 'class="lbl m num" text-anchor="end"')}
  ${hr(628, 972, 400)}
  ${rows}
  ${r(628, 776, 344, 2, "var(--ink)")}
  ${t(628, 816, "Total inc GST", "md", 'font-weight="600"')}
  ${t(972, 816, "$863.00", "md", 'text-anchor="end" font-weight="600" class="md num"')}
  ${r(628, 846, 344, 58, "var(--steel)", 10)}
  ${t(800, 883, "Send to customer", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${t(628, 752, "Mixer in stock. Can go in Thursday.", "sm", 'class="sm m" font-size="18"')}`;

  writeFileSync(join(OUT, "screen-quote.svg"), doc("A Roundhouse quote being built on a phone: four line items and a running total", body));
}

/* ------------------------------------------------------------------ 4. what the customer sees */
{
  const body = `${r(0, 0, 1600, 1000, "var(--panel)")}
  ${r(0, 0, 1600, 300, "var(--steel)")}
  ${t(120, 150, "Roundhouse", "md", 'class="md w" font-weight="600"')}
  ${t(120, 218, "You are booked in", "xl", 'class="xl w"')}
  ${r(120, 340, 1000, 520, "var(--paper)", 16)}
  ${t(168, 416, "Arrival window", "lbl", 'class="lbl m"')}
  ${t(168, 470, "Tuesday 14 October, 8:00am to 10:00am", "lg", 'class="lg num"')}
  ${t(168, 512, "We ring about twenty minutes out.", "sm", 'class="sm m"')}
  ${hr(168, 1072, 560)}
  ${t(168, 620, "Who is coming", "lbl", 'class="lbl m"')}
  ${r(168, 640, 56, 56, "var(--steel)", 28)}
  ${t(196, 678, "PR", "sm", 'text-anchor="middle" class="sm w"')}
  ${t(248, 668, "Priya Raghavan", "md", 'font-weight="600"')}
  ${t(248, 700, "Roofing lead, eleven years with us", "sm", 'class="sm m"')}
  ${t(680, 620, "Where", "lbl", 'class="lbl m"')}
  ${t(680, 668, "12 Ashgrove Rise", "md")}
  ${t(680, 700, "Fernbrook", "sm", 'class="sm m"')}
  ${r(168, 754, 300, 60, "var(--steel)", 10)}
  ${t(318, 792, "Add to calendar", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${r(492, 754, 260, 60, "var(--paper)", 10, 'stroke="var(--ink)" stroke-width="2"')}
  ${t(622, 792, "Reschedule", "sm", 'text-anchor="middle" font-weight="600"')}
  ${r(1180, 340, 300, 520, "var(--paper)", 16)}
  ${t(1216, 400, "Reference", "lbl", 'class="lbl m"')}
  ${t(1216, 440, "RH-2418", "md", 'class="md num" font-weight="600"')}
  ${hr(1216, 1444, 480)}
  ${t(1216, 532, "Quoted", "lbl", 'class="lbl m"')}
  ${t(1216, 572, "$863.00", "md", 'class="md num"')}
  ${t(1216, 606, "Approved 2 October", "sm", 'class="sm m" font-size="18"')}
  ${hr(1216, 1444, 646)}
  ${t(1216, 698, "Questions", "lbl", 'class="lbl m"')}
  ${t(1216, 738, "(02) 5550 0142", "sm", 'class="sm num"')}
  ${t(1216, 772, "Weekdays, 7am to 5pm", "sm", 'class="sm m" font-size="18"')}
  ${t(120, 928, "A confirmation goes out the moment a job is scheduled. Nothing here needs an account.", "sm", 'class="sm m"')}`;

  writeFileSync(join(OUT, "screen-confirm.svg"), doc("The customer's confirmation screen, showing an arrival window and the technician's name", body));
}

console.log("screens written");
