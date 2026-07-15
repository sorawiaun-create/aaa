import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#fe2c55",
          dark: "#25f4ee",
        },
      },
    },
  },
  plugins: [],
};

export default config;
