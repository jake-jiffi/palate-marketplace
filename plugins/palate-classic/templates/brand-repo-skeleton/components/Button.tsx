// Reference Button. Consumes brand tokens via Tailwind preset classes.
// Composes into both the brand examples and downstream sites.
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  children,
  variant = "primary",
  href,
}: {
  children: ReactNode;
  variant?: Variant;
  href?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-brand px-5 py-2.5 font-body font-semibold transition-colors";
  const styles: Record<Variant, string> = {
    primary: "bg-brand-accent text-brand-inverse hover:bg-brand-accent-hover",
    secondary: "border border-brand-border text-brand-text hover:bg-brand-bg-inverse/5",
    ghost: "text-brand-accent hover:text-brand-accent-hover",
  };
  const cls = `${base} ${styles[variant]}`;
  return href ? <a href={href} className={cls}>{children}</a> : <button className={cls}>{children}</button>;
}
