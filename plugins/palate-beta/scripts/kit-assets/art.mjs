/**
 * Draws the non-screenshot kit assets: two video poster frames, six photographic stand-ins and
 * six invented wordmarks.
 *
 * THE PHOTOGRAPHIC STAND-INS ARE DELIBERATELY NOT PHOTOGRAPHS. A slot meant to carry a real
 * picture of a real roof cannot honestly be filled with a fake one, so these are plainly
 * synthetic: layered planes, a horizon and a light wash. They weigh what a photograph weighs and
 * crop the way a photograph crops, which is what the components need to be judged on, and nobody
 * looking at one could mistake it for a place that exists.
 *
 * Every asset is loaded through <img>, which makes it an isolated document: `var(--kit-*)` does
 * NOT resolve to the page's brand and the literal fallback is what renders. The tokens are still
 * written first, so an asset that is ever inlined picks the brand up, and the fallbacks are held
 * near-neutral so nothing here fights an accent it cannot see.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function doc(title, w, h, body, extra = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"${extra}>
<title>${esc(title)}</title>
${body}
</svg>
`;
}

/* ============================================================ photographic stand-ins ======= */

/**
 * One drawing, six settings. Planes stack from a low horizon, each a flat tone from the palette,
 * so the result reads as depth without pretending to be a place.
 *
 * `rough` breaks the plane edges into a saw, which is how the "before" of a matched pair says it
 * is the worse one without a caption doing the work.
 */
function terrain({ w, h, sky, planes, light, rough = false, seed = 1 }) {
  const rnd = (() => {
    let s = seed * 9301 + 49297;
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  })();

  const layers = planes
    .map((p, i) => {
      const base = h * (0.42 + i * 0.13);
      const pts = [];
      const steps = rough ? 14 : 5;
      for (let k = 0; k <= steps; k++) {
        const x = (w / steps) * k;
        const jitter = rough ? (rnd() - 0.5) * h * 0.14 : Math.sin(k * 1.1 + i) * h * 0.05;
        pts.push(`${x.toFixed(1)},${(base + jitter).toFixed(1)}`);
      }
      return `<path d="M0,${h} L${pts.join(" L")} L${w},${h} Z" fill="${p}"/>`;
    })
    .join("\n");

  /* One long shaft of light across the planes. It is what stops the stack reading as a chart. */
  const shaft = `<path d="M${w * 0.18},0 L${w * 0.46},0 L${w * 0.9},${h} L${w * 0.5},${h} Z" fill="${light}" opacity=".22"/>`;

  return `<rect width="${w}" height="${h}" fill="${sky}"/>
<rect width="${w}" height="${h}" fill="url(#wash${seed})"/>
${shaft}
${layers}
<defs><linearGradient id="wash${seed}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${light}" stop-opacity=".45"/><stop offset="1" stop-color="${light}" stop-opacity="0"/>
</linearGradient></defs>`;
}

const PALETTES = {
  /* Warm, low saturation. Chosen so a brand accent of any hue can sit beside it. */
  sand: { sky: "#d8cfc2", planes: ["#b9ad9c", "#9a8f7f", "#7b7264", "#5c554b"], light: "#f2ebe0" },
  slate: { sky: "#c2c8cd", planes: ["#9fa8b0", "#828d96", "#66707a", "#4a525a"], light: "#e8edf1" },
  moss: { sky: "#c9cec2", planes: ["#a8b09f", "#8b947f", "#6f7765", "#535a4c"], light: "#e9ede3" },
  dusk: { sky: "#4a525a", planes: ["#3d444b", "#31373d", "#262b30", "#1b1f23"], light: "#8f9aa4" },
};

/* The hero sits behind white type under a scrim, so it starts dark rather than being darkened. */
writeFileSync(
  join(OUT, "texture-hero.svg"),
  doc(
    "An abstract layered landscape standing in for a photograph",
    1920,
    1080,
    terrain({ w: 1920, h: 1080, ...PALETTES.dusk, seed: 1 }),
  ),
);

for (const [name, pal, seed] of [
  ["texture-case-1", "sand", 2],
  ["texture-case-2", "slate", 3],
  ["texture-case-3", "moss", 4],
]) {
  writeFileSync(
    join(OUT, `${name}.svg`),
    doc("An abstract layered landscape standing in for a photograph", 1200, 900, terrain({ w: 1200, h: 900, ...PALETTES[pal], seed })),
  );
}

/* A matched pair: same palette, same seed, and only the edges change. The "before" is broken. */
writeFileSync(
  join(OUT, "texture-before.svg"),
  doc("An abstract stand-in for the before photograph, with broken edges", 1200, 900, terrain({ w: 1200, h: 900, ...PALETTES.sand, seed: 5, rough: true })),
);
writeFileSync(
  join(OUT, "texture-after.svg"),
  doc("An abstract stand-in for the after photograph, with the edges made good", 1200, 900, terrain({ w: 1200, h: 900, ...PALETTES.sand, seed: 5 })),
);

/* ============================================================ video poster frames =========== */

/* The tour poster is the product at rest, dimmed, so the component's own play control reads on
   top of it. Drawing the app rather than an abstraction is the honest thing here: the video is a
   product tour, so the still frame should be the product. */
{
  const W = 1920, H = 1080;
  /* Cropped in so the window bleeds off the bottom edge. A still that shows the whole
     browser and a wide dark margin reads as a slide, not as a frame of a recording. */
  const bx = 120, by = 104, bw = 1680, bh = 1060;
  const blocks = [
    [0, 0, 2, "Ferndale Housing"],
    [1, 1, 1, "Corbett St Dental"],
    [2, 0, 1, "M. Sowden"],
    [2, 2, 2, "Copperline Brewing"],
    [4, 1, 1, "Harbourline"],
  ];
  const gx = bx + 340, gw = bw - 380, cw = gw / 5, gy = by + 220, rh = 190;
  const drawn = blocks
    .map(([d, v, span, who]) => {
      const x = gx + d * cw + 10, y = gy + v * rh + 20, w = cw * span - 20;
      return `<rect x="${x}" y="${y}" width="${w.toFixed(0)}" height="140" rx="10" fill="#e9ebee"/>
<rect x="${x}" y="${y}" width="5" height="140" rx="3" fill="#46525d"/>
<text x="${x + 22}" y="${y + 48}" font-size="22" font-weight="600" fill="#1b1d21">${esc(who)}</text>
<rect x="${x + 22}" y="${y + 70}" width="${Math.min(w - 60, 150)}" height="12" rx="6" fill="#c4c9cf"/>
<rect x="${x + 22}" y="${y + 98}" width="${Math.min(w - 90, 110)}" height="12" rx="6" fill="#d5d9de"/>`;
    })
    .join("\n");
  const rows = [0, 1, 2, 3]
    .map((i) => `<line x1="${gx - 20}" y1="${gy + i * rh}" x2="${bx + bw - 40}" y2="${gy + i * rh}" stroke="#e2e5e9" stroke-width="2"/>`)
    .join("\n");
  const nav = ["Schedule", "Jobs", "Quotes", "Customers", "Invoices"]
    .map((label, i) => `<rect x="${bx + 30}" y="${by + 150 + i * 58}" width="18" height="18" rx="4" fill="${i === 0 ? "#46525d" : "#aeb4ba"}"/>
<text x="${bx + 62}" y="${by + 166 + i * 58}" font-size="21" fill="${i === 0 ? "#1b1d21" : "#6e737b"}"${i === 0 ? ' font-weight="600"' : ""}>${label}</text>`)
    .join("\n");

  const body = `<rect width="${W}" height="${H}" fill="#20252a"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<g font-family="system-ui,-apple-system,&quot;Segoe UI&quot;,sans-serif">
<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="18" fill="#ffffff"/>
<rect x="${bx}" y="${by}" width="340" height="${bh}" rx="18" fill="#f3f4f6"/>
<rect x="${bx + 322}" y="${by}" width="18" height="${bh}" fill="#f3f4f6"/>
<rect x="${bx}" y="${by}" width="${bw}" height="76" rx="18" fill="#ffffff"/>
<line x1="${bx}" y1="${by + 76}" x2="${bx + bw}" y2="${by + 76}" stroke="#e2e5e9" stroke-width="2"/>
<rect x="${bx + 30}" y="${by + 24}" width="28" height="28" rx="7" fill="#46525d"/>
<text x="${bx + 72}" y="${by + 47}" font-size="25" font-weight="600" fill="#1b1d21">Roundhouse</text>
<rect x="${bx + 640}" y="${by + 18}" width="480" height="40" rx="20" fill="#f3f4f6"/>
${nav}
<text x="${bx + 340}" y="${by + 150}" font-size="46" font-weight="600" fill="#1b1d21">This week</text>
<text x="${bx + 340}" y="${by + 190}" font-size="24" fill="#6e737b">13 to 17 October, Fernbrook depot</text>
${rows}
${drawn}
</g>
<rect width="${W}" height="${H}" fill="#0d1013" opacity=".34"/>
<defs><radialGradient id="glow" cx=".5" cy=".38" r=".75">
<stop offset="0" stop-color="#5b6975" stop-opacity=".65"/><stop offset="1" stop-color="#20252a" stop-opacity="0"/>
</radialGradient></defs>`;
  writeFileSync(join(OUT, "poster-tour.svg"), doc("A still frame of the Roundhouse schedule, dimmed behind the play control", W, H, body));
}

/**
 * The testimonial poster: a backlit silhouette against a window.
 *
 * A drawn person with a face, or with skin and hair colour, is uncanny and dishonest at once: it
 * looks like a failed photograph of somebody who does not exist. A SILHOUETTE is neither. It is a
 * real and common way to frame an interview, it is plainly a graphic rather than a picture, and
 * it gives the piece the thing it actually needs to be judged on, a subject placed off centre
 * with the light behind them and room on one side for the lower third.
 */
{
  const W = 1920, H = 1080;
  /* Drawn twice, the lower copy nudged left, so the rim of window light reads along the edge
     facing the window. Cheaper and steadier than stroking an arc by hand. */
  const figure = (dx, fill, opacity) => `<g transform="translate(${dx} 0)" fill="${fill}" opacity="${opacity}">
<path d="M812 1080 C824 928 904 848 1034 800 C1116 770 1162 736 1186 700 L1258 700 C1282 736 1328 770 1410 800 C1540 848 1620 928 1632 1080 Z"/>
<path d="M1178 592 L1262 592 L1276 742 L1164 742 Z"/>
<ellipse cx="1220" cy="500" rx="127" ry="140"/>
</g>`;

  const body = `<rect width="${W}" height="${H}" fill="#b8b2a7"/>
<rect width="${W}" height="${H}" fill="url(#wall)"/>
<rect x="120" y="70" width="620" height="740" rx="4" fill="#f6f3ec"/>
<rect x="120" y="70" width="620" height="740" rx="4" fill="url(#pane)"/>
<line x1="430" y1="70" x2="430" y2="810" stroke="#9a958c" stroke-width="12"/>
<line x1="120" y1="430" x2="740" y2="430" stroke="#9a958c" stroke-width="12"/>
<rect x="104" y="54" width="652" height="772" rx="6" fill="none" stroke="#8f8a81" stroke-width="14"/>
<path d="M756 826 L1180 1080 L400 1080 Z" fill="#f6f3ec" opacity=".2"/>
${figure(-11, "#e9e3d8", 0.62)}
${figure(0, "#24282c", 0.97)}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="1" y2=".6">
<stop offset="0" stop-color="#e2ddd3" stop-opacity=".95"/><stop offset=".62" stop-color="#8e887e" stop-opacity=".55"/><stop offset="1" stop-color="#5f5a53" stop-opacity=".75"/>
</linearGradient>
<linearGradient id="pane" x1="0" y1="0" x2=".5" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#ffffff" stop-opacity=".1"/>
</linearGradient>
<radialGradient id="vig" cx=".42" cy=".42" r=".8">
<stop offset=".5" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".38"/>
</radialGradient>
</defs>`;
  writeFileSync(join(OUT, "poster-testimonial.svg"), doc("A drawn stand-in for a customer interview: a silhouette against a window", W, H, body));
}

/* ============================================================ invented wordmarks ============ */

/**
 * Six fictional customers for the logo strip. TrustLogos constrains every mark by HEIGHT, so
 * each file declares its own natural proportion and the strip does the rest.
 *
 * They are one ink on purpose. A strip of six invented brand colours would be six decisions
 * nobody made, and the component already dims the marks so the names carry the band.
 */
const INK = "#22262a";
const SANS = "system-ui,-apple-system,'Segoe UI',sans-serif";
function wordmark(file, { name, width, mark, tracking = "0", weight = "600", family = SANS, size = 34 }) {
  const h = 80;
  const body = `<g fill="${INK}">
${mark}
<text x="68" y="${h / 2 + size * 0.36}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${esc(name)}</text>
</g>`;
  writeFileSync(join(OUT, file), doc(`${name} logo`, width, h, body));
}

wordmark("logo-northbeam.svg", {
  name: "NORTHBEAM",
  width: 372,
  tracking: "3",
  size: 30,
  mark: `<path d="M12 50 L32 22 L52 50 Z"/><rect x="12" y="55" width="40" height="7"/>`,
});
wordmark("logo-harbourline.svg", {
  name: "Harbourline",
  width: 352,
  size: 36,
  weight: "500",
  mark: `<circle cx="32" cy="40" r="17" fill="none" stroke="${INK}" stroke-width="6"/><rect x="6" y="36.5" width="52" height="7"/>`,
});
wordmark("logo-tallowcreek.svg", {
  name: "Tallow Creek",
  width: 372,
  size: 36,
  weight: "400",
  family: "Georgia,'Times New Roman',serif",
  mark: `<path d="M32 18 C46 37 52 45 52 52 A20 20 0 0 1 12 52 C12 45 18 37 32 18 Z"/>`,
});
wordmark("logo-verrall.svg", {
  name: "Verrall & Sons",
  width: 392,
  size: 33,
  weight: "400",
  family: "Georgia,'Times New Roman',serif",
  mark: `<rect x="12" y="20" width="40" height="40" fill="none" stroke="${INK}" stroke-width="6"/><rect x="24" y="32" width="16" height="16"/>`,
});
wordmark("logo-kestrel.svg", {
  name: "KESTREL",
  width: 322,
  tracking: "2",
  size: 32,
  weight: "700",
  mark: `<path d="M12 56 L32 20 L52 56 L32 44 Z"/>`,
});
wordmark("logo-merrivale.svg", {
  name: "Merrivale",
  width: 332,
  size: 36,
  weight: "500",
  mark: `<rect x="25" y="20" width="14" height="40" rx="7"/><rect x="12" y="33" width="40" height="14" rx="7"/>`,
});

console.log("art written");
