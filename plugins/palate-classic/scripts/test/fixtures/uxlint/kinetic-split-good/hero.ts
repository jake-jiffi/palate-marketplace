// The same kinetic hero, but split to words THEN chars so words never break mid-word.
import SplitText from "gsap/SplitText";
const split = new SplitText(".hero h1", { type: "words,chars" });
gsap.from(split.chars, { yPercent: 100, stagger: 0.02 });
