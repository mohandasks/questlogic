import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b14",
        panel: "#13131f",
        border: "#2a2a3d",
        ink: "#e7e7f3",
        mute: "#8e8eb2",
        accent: "#7c5cff",
        accent2: "#22d3ee",
        danger: "#ff5c7c",
        ok: "#5ce0a8",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
