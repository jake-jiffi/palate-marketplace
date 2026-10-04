// GENERATED from tokens.json. Do not hand-edit; edit tokens.json and regenerate.
export const tokens = {
  color: {
    bgDefault: "#ffffff",
    bgInverse: "#0f172a",
    textPrimary: "#0f172a",
    textMuted: "#64748b",
    textInverse: "#ffffff",
    accentDefault: "#2563eb",
    accentHover: "#1d4ed8",
    borderDefault: "#e2e8f0",
  },
  font: { display: "BrandDisplay", body: "BrandSans" },
  size: { sm: "0.875rem", base: "1rem", lg: "1.25rem", xl: "1.5rem", "2xl": "2rem", "3xl": "3rem" },
  space: { 1: "0.25rem", 2: "0.5rem", 4: "1rem", 8: "2rem", 16: "4rem" },
  radius: { sm: "0.25rem", default: "0.5rem", lg: "1rem" },
} as const;

// PptxGenJS wants colours without the leading hash
export const tokensNoHash = {
  bgDefault: "ffffff",
  bgInverse: "0f172a",
  textPrimary: "0f172a",
  textMuted: "64748b",
  textInverse: "ffffff",
  accentDefault: "2563eb",
  accentHover: "1d4ed8",
  borderDefault: "e2e8f0",
} as const;

export type BrandTokens = typeof tokens;
