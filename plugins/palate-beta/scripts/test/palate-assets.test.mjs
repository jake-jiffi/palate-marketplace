/**
 * palate-assets.test.mjs - the arithmetic that decides whether a photo survives a slot.
 *
 * The load-bearing claim is `visibleFraction`, because it is what turns "this looks wrong" into
 * a number a person can act on. It is checked against the REAL failure it was written for: a 2:3
 * portrait forced through a 3:1 letterbox, which was measured by hand at 22% of the frame before
 * this code existed. If that case ever stops returning ~0.22, the tool has stopped describing
 * the world.
 */
import { visibleFraction, orientationOf, maxCssWidth, assess } from "../palate-assets.mjs";

let pass = 0, fail = 0;
const ok = (desc, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { console.log(`ok   - ${desc}`); pass++; }
  else { console.log(`FAIL - ${desc} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); fail++; }
};
const near = (desc, got, want, tol = 0.005) => {
  if (Math.abs(got - want) <= tol) { console.log(`ok   - ${desc}`); pass++; }
  else { console.log(`FAIL - ${desc} (got ${got}, want ~${want})`); fail++; }
};

// THE case. Measured by hand at 22% before the tool existed.
near("2:3 portrait through a 3:1 letterbox shows ~22% of the frame", visibleFraction(2 / 3, 3 / 1), 0.222);
near("3:2 landscape through 3:1 shows 50%", visibleFraction(3 / 2, 3 / 1), 0.5);
near("a slot matching the source shows all of it", visibleFraction(4 / 5, 4 / 5), 1);
near("the maths is symmetric (wide photo in a tall slot loses just as much)",
  visibleFraction(3 / 1, 2 / 3), visibleFraction(2 / 3, 3 / 1));
ok("a nonsensical ratio returns 0 rather than NaN", visibleFraction(0, 3), 0);

ok("orientation bands", [0.67, 1.0, 1.5, 3.0].map(orientationOf),
  ["portrait", "square", "landscape", "panoramic"]);

// Retina is the constraint people forget: half the pixels are spent on density, not size.
ok("a 1600px photo is a 1600px slot at 1x and only 800px at 2x", maxCssWidth(1600), { at1x: 1600, at2x: 800 });

// A portrait photo must never be called hero-capable however many pixels it has.
const portrait = assess({ width: 2000, height: 3000 });
ok("a large portrait is NOT hero-capable", portrait.heroCapable, false);
ok("and it is told never to be letterboxed",
  portrait.notes.some((n) => /never letterbox/i.test(n)), true);
ok("a full-bleed hero is marked destructive for it",
  portrait.fits.find((f) => f.slot === "full-bleed hero").verdict, "destructive");

// Big enough AND landscape is the only combination that earns a hero.
ok("a 2400px landscape IS hero-capable", assess({ width: 2400, height: 1350 }).heroCapable, true);
ok("a small landscape is NOT, however well shaped", assess({ width: 900, height: 506 }).heroCapable, false);
ok("and the reason names its honest 2x limit",
  assess({ width: 900, height: 506 }).notes.some((n) => n.includes("450px")), true);

// The half pixels cannot decide must start empty, or the tool would be inventing subjects.
ok("subject and treatment start unrecorded", [portrait.subject, portrait.treatment, portrait.reviewed],
  [null, null, false]);

console.log("---");
console.log(`passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
