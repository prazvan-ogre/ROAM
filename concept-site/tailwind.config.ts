import type { Config } from "tailwindcss";

/**
 * Design tokens for the Worth story site.
 * One accent (indigo "signal"), a warm neutral canvas, ink for text.
 * Semantic tones (warn / ok) are used sparingly, only inside product UI.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FAFAF7",
        paper: "#FFFFFF",
        ink: {
          DEFAULT: "#0E0E12",
          soft: "#3B3B44",
          muted: "#71717C",
          faint: "#A1A1AA",
        },
        line: {
          DEFAULT: "#E7E6E1",
          soft: "#F0EFEA",
        },
        accent: {
          DEFAULT: "#4F46E5",
          deep: "#3730A3",
          soft: "#EEF0FF",
          glow: "#A5B4FC",
        },
        warn: { DEFAULT: "#D97706", soft: "#FEF3E2" },
        ok: { DEFAULT: "#059669", soft: "#E7F7F0" },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["clamp(2.6rem, 6.2vw, 5.4rem)", { lineHeight: "0.98", letterSpacing: "-0.045em" }],
        headline: ["clamp(2.1rem, 4.6vw, 4rem)", { lineHeight: "1.02", letterSpacing: "-0.04em" }],
      },
      boxShadow: {
        card: "0 1px 0 rgba(14,14,18,0.04), 0 1px 2px rgba(14,14,18,0.04), 0 8px 24px -12px rgba(14,14,18,0.12)",
        float: "0 1px 0 rgba(14,14,18,0.04), 0 24px 60px -24px rgba(30,27,75,0.28), 0 8px 20px -12px rgba(14,14,18,0.12)",
        glow: "0 0 0 1px rgba(79,70,229,0.18), 0 12px 40px -12px rgba(79,70,229,0.45)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      transitionTimingFunction: {
        cine: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
