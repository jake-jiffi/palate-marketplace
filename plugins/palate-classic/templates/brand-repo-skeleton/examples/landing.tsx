// Full-page example: assembles brand components into a landing page.
// Demonstrates the system; downstream sites compose the same way.
import { Hero } from "../components/Hero";
import { Button } from "../components/Button";

export default function Landing() {
  return (
    <main>
      <Hero
        headline="The headline goes here"
        subhead="One supporting line that explains the offer in plain language."
        ctaText="Get started"
        ctaHref="#start"
        secondaryText="Talk to us"
        secondaryHref="#contact"
      />
      <section className="bg-brand-bg px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-brand-text text-3xl">A section heading</h2>
          <p className="text-brand-muted mt-4">Supporting copy composed from brand tokens.</p>
          <div className="mt-8"><Button href="#more">Learn more</Button></div>
        </div>
      </section>
    </main>
  );
}
