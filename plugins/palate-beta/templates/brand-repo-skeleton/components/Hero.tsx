// Reference Hero. Heading + subhead + CTAs, brand-tokenised.
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Hero({
  headline,
  subhead,
  ctaText,
  ctaHref,
  secondaryText,
  secondaryHref,
  children,
}: {
  headline: string;
  subhead: string;
  ctaText: string;
  ctaHref: string;
  secondaryText?: string;
  secondaryHref?: string;
  children?: ReactNode;
}) {
  return (
    <section className="bg-brand-bg px-6 py-24 text-center">
      <h1 className="font-display text-brand-text mx-auto max-w-3xl text-4xl md:text-6xl">{headline}</h1>
      <p className="text-brand-muted mx-auto mt-6 max-w-xl text-lg">{subhead}</p>
      <div className="mt-8 flex items-center justify-center gap-4">
        <Button href={ctaHref}>{ctaText}</Button>
        {secondaryText && secondaryHref && (
          <Button variant="secondary" href={secondaryHref}>{secondaryText}</Button>
        )}
      </div>
      {children && <div className="mt-16">{children}</div>}
    </section>
  );
}
