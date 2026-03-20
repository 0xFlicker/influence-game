import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        void: "rgb(var(--void) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",
        "surface-overlay": "rgb(var(--surface-overlay) / <alpha-value>)",

        "text-primary": "rgb(var(--text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",

        border: "rgb(var(--border) / <alpha-value>)",
        "border-active": "rgb(var(--border-active) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",

        phase: "rgb(var(--phase-rgb) / <alpha-value>)",
        "brand-light": "rgb(var(--brand-light) / <alpha-value>)",
        "brand-silver": "rgb(var(--brand-silver) / <alpha-value>)",

        "agent-finn": "rgb(var(--agent-finn) / <alpha-value>)",
        "agent-atlas": "rgb(var(--agent-atlas) / <alpha-value>)",
        "agent-vera": "rgb(var(--agent-vera) / <alpha-value>)",
        "agent-lyra": "rgb(var(--agent-lyra) / <alpha-value>)",
        "agent-mira": "rgb(var(--agent-mira) / <alpha-value>)",
        "agent-rex": "rgb(var(--agent-rex) / <alpha-value>)",
        "agent-kael": "rgb(var(--agent-kael) / <alpha-value>)",
        "agent-echo": "rgb(var(--agent-echo) / <alpha-value>)",
        "agent-sage": "rgb(var(--agent-sage) / <alpha-value>)",
        "agent-jace": "rgb(var(--agent-jace) / <alpha-value>)",
      },
      boxShadow: {
        ambient: "var(--shadow-ambient)",
        panel: "var(--shadow-panel)",
        elevated: "var(--shadow-elevated)",
        "phase-sm": "0 0 24px rgb(var(--phase-rgb) / 0.12)",
        "phase-md": "0 0 48px rgb(var(--phase-rgb) / 0.18)",
        "phase-lg": "0 0 96px rgb(var(--phase-rgb) / 0.24)",
      },
      backdropBlur: {
        glass: "16px",
      },
      borderRadius: {
        panel: "16px",
        bubble: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
