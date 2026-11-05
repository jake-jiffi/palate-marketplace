// A kinetic hero that splits to chars only - no word wrappers, so it breaks mid-word.
import SplitText from "gsap/SplitText";
const split = new SplitText(".hero h1", { type: "chars" });
gsap.from(split.chars, { yPercent: 100, stagger: 0.02 });
