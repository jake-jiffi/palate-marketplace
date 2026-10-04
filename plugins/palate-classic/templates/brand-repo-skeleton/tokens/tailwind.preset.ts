// GENERATED from tokens.json. Drop-in Tailwind v3 preset.
import type { Config } from "tailwindcss";

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        "brand-bg": "var(--brand-bg-default)",
        "brand-bg-inverse": "var(--brand-bg-inverse)",
        "brand-text": "var(--brand-text-primary)",
        "brand-muted": "var(--brand-text-muted)",
        "brand-inverse": "var(--brand-text-inverse)",
        "brand-accent": "var(--brand-accent-default)",
        "brand-accent-hover": "var(--brand-accent-hover)",
        "brand-border": "var(--brand-border-default)",
      },
      fontFamily: {
        display: ["BrandDisplay", "system-ui", "sans-serif"],
        body: ["BrandSans", "system-ui", "sans-serif"],
      },
      borderRadius: { brand: "var(--brand-radius)", "brand-lg": "var(--brand-radius-lg)" },
    },
  },
};
export default preset;
