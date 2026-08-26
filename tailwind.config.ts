import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F7F7F5",
        foreground: "#1D1D1F",
        card: "#FFFFFF",
        border: "#E5E5EA",
        disabled: "#C7C7CC",
        primary: {
          DEFAULT: "#2076A3",
          hover: "#1A6490",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#F2F2F7",
          foreground: "#3A3A3C",
        },
        muted: {
          DEFAULT: "#F2F2F7",
          foreground: "#6E6E73",
        },
        accent: {
          DEFAULT: "#EEF6FC",
          foreground: "#2076A3",
        },
        destructive: {
          DEFAULT: "#FF3B30",
          foreground: "#FFFFFF",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
