/**
 * Three screens for the product example page, which describes a different invented product from
 * the DemoScreenshots demo: Paddockline, a livestock record for a mixed farm.
 *
 * They exist rather than being borrowed because the page's own alt text describes a paddock map,
 * a mob record and a phone in the yards. Pointing a trades-scheduling screenshot at a page about
 * livestock would make the page internally false, which is worse than an empty frame.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const STYLE = `<style>
    svg{--ink:var(--kit-text,#1b1d21);--muted:var(--kit-text-muted,#6e737b);--paper:var(--kit-bg,#ffffff);--panel:var(--kit-bg-subtle,#f3f4f6);--line:var(--kit-border,#dfe2e6);--steel:#46525d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
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
const t = (x, y, s, cls = "sm", extra = "") => {
  let rest = extra, classes = cls;
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

const doc = (title, body, w = 1600, h = 1000) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  ${STYLE}
  ${body}
</svg>
`;

function chrome(active) {
  const nav = ["Map", "Mobs", "Treatments", "Rainfall", "Reports"];
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
  ${t(80, 48, "Paddockline", "md", 'font-weight="600"')}
  ${r(1494, 22, 38, 38, "var(--steel)", 19)}
  ${t(1513, 48, "RB", "sm", 'text-anchor="middle" class="sm w"')}
  ${t(40, 122, "Nine Mile", "lbl", 'class="lbl m"')}
  ${items}
  ${hr(20, 228, 500)}
  ${t(40, 542, "2 mobs on farm", "sm", 'class="sm m"')}
  ${t(40, 578, "911 head counted", "sm", 'class="sm m"')}`;
}

/* ------------------------------------------------------- 1. the paddock map */
{
  /* Fourteen paddocks as a hand-laid irregular grid. A real map is not rectangles, so the seams
     are jogged: a tidy grid would read as a spreadsheet with a green fill. */
  const shades = ["#e4e9df", "#cfd9c7", "#b6c5aa", "#9ab189", "#7d9a6b"];
  const paddocks = [
    { p: "300,150 560,132 588,300 316,318", d: 4, n: "Top Ridge" },
    { p: "316,318 588,300 604,452 340,470", d: 2, n: "Long Flat" },
    { p: "340,470 604,452 620,630 356,646", d: 0, n: "Creek" },
    { p: "356,646 620,630 636,830 372,846", d: 3, n: "Nine Mile" },
    { p: "560,132 850,142 866,306 588,300", d: 1, n: "Stony" },
    { p: "588,300 866,306 878,462 604,452", d: 4, n: "Bore" },
    { p: "604,452 878,462 890,634 620,630", d: 3, n: "Middle" },
    { p: "620,630 890,634 900,838 636,830", d: 2, n: "Yards" },
    { p: "850,142 1130,160 1142,318 866,306", d: 0, n: "North Hut" },
    { p: "866,306 1142,318 1150,470 878,462", d: 2, n: "Wattle" },
    { p: "878,462 1150,470 1158,640 890,634", d: 4, n: "Dam" },
    { p: "890,634 1158,640 1164,842 900,838", d: 1, n: "Lane" },
    { p: "1130,160 1400,176 1408,470 1150,470", d: 3, n: "Far East" },
    { p: "1150,470 1408,470 1414,846 1164,842", d: 1, n: "River" },
  ];
  /* The polygons were laid out in their own space and are mapped into the map box numerically
     rather than with a transform, because a non-uniform scale would squash the paddock names
     with the shapes. Points move; type does not. */
  const FX = (x) => Math.round(300 + 1.122 * (x - 300));
  const FY = (y) => Math.round(252 + 0.856 * (y - 132));
  const shapes = paddocks
    .map((q) => {
      const pts = q.p.split(" ").map((pt) => pt.split(",").map(Number));
      const moved = pts.map(([x, y]) => `${FX(x)},${FY(y)}`).join(" ");
      const cx = Math.round(pts.reduce((a, [x]) => a + FX(x), 0) / pts.length);
      const cy = Math.round(pts.reduce((a, [, y]) => a + FY(y), 0) / pts.length);
      return `<polygon points="${moved}" fill="${shades[q.d]}" stroke="#ffffff" stroke-width="4"/>
  ${t(cx, cy, q.n, "sm", `text-anchor="middle" font-size="18"${q.d > 2 ? ' fill="#ffffff"' : ""}`)}`;
    })
    .join("\n  ");

  const legend = shades
    .map((c, i) => `${r(600 + i * 118, 900, 26, 26, c, 5)}${t(636 + i * 118, 921, ["0-3", "4-10", "11-20", "21-35", "36+"][i], "sm", 'class="sm m num" font-size="18"')}`)
    .join("\n  ");

  const pin = (x, y, label, head) =>
    `<circle cx="${x}" cy="${y}" r="26" fill="var(--steel)"/><circle cx="${x}" cy="${y}" r="9" fill="#ffffff"/>
  ${r(x + 34, y - 28, 216, 56, "var(--paper)", 8, 'stroke="var(--line)" stroke-width="2"')}
  ${t(x + 52, y - 4, label, "sm", 'font-weight="600" font-size="18"')}
  ${t(x + 52, y + 18, head, "sm", 'class="sm m num" font-size="17"')}`;

  const body = `${chrome("Map")}
  ${t(280, 148, "Nine Mile Merino", "xl")}
  ${t(280, 190, "Shaded by days since the paddock was last grazed", "md", 'class="md m"')}
  ${r(1330, 116, 230, 46, "var(--steel)", 8)}
  ${t(1445, 146, "Move a mob", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${r(280, 230, 1290, 640, "#eef1ea", 12)}
  ${shapes}
  <path d="M300 541 C546 567 815 507 1086 567 C1310 618 1444 583 1549 617" fill="none" stroke="#a9c3d4" stroke-width="14" stroke-linecap="round" opacity=".85"/>
  ${pin(392, 660, "Ewes and lambs", "612 head, in 4 days")}
  ${pin(1044, 700, "Weaners", "299 head, in 11 days")}
  ${t(300, 921, "Days since grazed", "lbl", 'class="lbl m"')}
  ${legend}`;

  writeFileSync(join(OUT, "screen-paddocks.svg"), doc("A paddock map shaded by days since last grazed, with two mobs pinned", body));
}

/* ------------------------------------------------------- 2. one mob */
{
  const moves = [
    ["14 Oct", "Creek to Nine Mile", "4 days ago"],
    ["3 Oct", "Bore to Creek", "15 days ago"],
    ["21 Sep", "Stony to Bore", "27 days ago"],
  ];
  const rows = moves
    .map(([d, what, ago], i) => {
      const y = 500 + i * 74;
      return [
        t(300, y, d, "sm", 'class="sm num" font-weight="600"'),
        t(430, y, what, "sm"),
        t(900, y, ago, "sm", 'class="sm m" text-anchor="end"'),
        hr(300, 900, y + 26),
      ].join("\n  ");
    })
    .join("\n  ");

  const body = `${chrome("Mobs")}
  ${t(280, 148, "Weaners, 2025 drop", "xl")}
  ${t(280, 190, "Merino wethers, Nine Mile paddock", "md", 'class="md m"')}
  ${r(1330, 116, 230, 46, "var(--steel)", 8)}
  ${t(1445, 146, "Record a move", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${r(280, 232, 1290, 116, "var(--panel)", 10)}
  ${t(310, 274, "Head", "lbl", 'class="lbl m"')}
  ${t(310, 318, "218", "lg", 'class="lg num"')}
  ${t(520, 274, "Counted", "lbl", 'class="lbl m"')}
  ${t(520, 318, "14 October", "lg")}
  ${t(830, 274, "Paddock", "lbl", 'class="lbl m"')}
  ${t(830, 318, "Nine Mile", "lg")}
  ${t(1180, 274, "Days on feed", "lbl", 'class="lbl m"')}
  ${t(1180, 318, "4", "lg", 'class="lg num"')}
  ${t(300, 420, "Last three moves", "lg")}
  ${t(300, 462, "Paddock", "lbl", 'class="lbl m"')}
  ${t(900, 462, "When", "lbl", 'class="lbl m" text-anchor="end"')}
  ${hr(300, 900, 478)}
  ${rows}
  ${r(1000, 400, 570, 330, "var(--paper)", 12, 'stroke="var(--line)" stroke-width="2"')}
  ${r(1000, 400, 570, 8, "#a8703a", 0, 'rx="4"')}
  ${t(1032, 462, "Withholding in force", "lg")}
  ${t(1032, 506, "Drench, 7 October", "sm", 'class="sm m"')}
  ${r(1032, 542, 506, 16, "var(--panel)", 8)}
  ${r(1032, 542, 232, 16, "#a8703a", 8)}
  ${t(1032, 596, "11 days", "md", 'font-weight="600" class="md num"')}
  ${t(1130, 596, "left to run, of 28", "md", 'class="md m"')}
  ${t(1032, 654, "Do not sell or send to slaughter", "sm", 'class="sm m"')}
  ${t(1032, 686, "before 4 November.", "sm", 'class="sm m"')}
  ${t(300, 812, "Nothing on this mob has been entered twice. The yards app writes to the same record.", "sm", 'class="sm m"')}`;

  writeFileSync(join(OUT, "screen-mob.svg"), doc("One mob record: 218 head, its last three moves and a drench with withholding still running", body));
}

/* ------------------------------------------------------- 3. the yards, offline */
{
  const body = `${r(0, 0, 1600, 1000, "var(--panel)")}
  ${t(120, 150, "Recording in the yards", "xl")}
  ${t(120, 238, "The yards have no signal and never will.", "md", 'class="md m"')}
  ${t(120, 276, "Entries queue on the phone and go up", "md", 'class="md m"')}
  ${t(120, 314, "when it next sees the house.", "md", 'class="md m"')}
  ${t(120, 410, "Queued", "lbl", 'class="lbl m"')}
  ${t(120, 450, "6 entries", "lg", 'class="lg num"')}
  ${t(120, 518, "Last sync", "lbl", 'class="lbl m"')}
  ${t(120, 558, "7:04am", "lg", 'class="lg num"')}
  ${r(560, 60, 480, 880, "var(--ink)", 44)}
  ${r(576, 76, 448, 848, "var(--paper)", 34)}
  ${r(736, 96, 128, 10, "var(--line)", 5)}
  ${t(628, 176, "11:42", "sm", 'class="sm num" font-size="18"')}
  ${t(972, 176, "No signal", "sm", 'text-anchor="end" class="sm m" font-size="18"')}
  ${r(576, 196, 448, 52, "#e6dccc")}
  ${r(604, 214, 16, 16, "#a8703a", 8)}
  ${t(632, 228, "Offline. 6 entries waiting.", "sm", 'font-size="18"')}
  ${t(628, 306, "Record a treatment", "lg")}
  ${t(628, 344, "Weaners, 218 head", "sm", 'class="sm m"')}
  ${t(628, 416, "Product", "lbl", 'class="lbl m"')}
  ${r(628, 432, 344, 62, "var(--paper)", 8, 'stroke="var(--line)" stroke-width="2"')}
  ${t(652, 472, "Abamectin drench", "sm")}
  ${t(628, 552, "Dose", "lbl", 'class="lbl m"')}
  ${r(628, 568, 164, 62, "var(--paper)", 8, 'stroke="var(--line)" stroke-width="2"')}
  ${t(652, 608, "4.5 mL", "sm", 'class="sm num"')}
  ${t(808, 552, "Withholding", "lbl", 'class="lbl m"')}
  ${r(808, 568, 164, 62, "var(--panel)", 8)}
  ${t(832, 608, "28 days", "sm", 'class="sm m num"')}
  ${t(628, 688, "Applies to the whole mob unless", "sm", 'class="sm m" font-size="18"')}
  ${t(628, 714, "you tag individual head.", "sm", 'class="sm m" font-size="18"')}
  ${r(628, 764, 344, 62, "var(--steel)", 10)}
  ${t(800, 804, "Save to the queue", "sm", 'text-anchor="middle" class="sm w" font-weight="600"')}
  ${t(800, 866, "Nothing is lost if you close it", "sm", 'text-anchor="middle" class="sm m" font-size="18"')}`;

  writeFileSync(join(OUT, "screen-yards.svg"), doc("A treatment being recorded on a phone in the yards, with no network connection", body));
}

console.log("farm written");
