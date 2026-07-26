/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#fbfaf7",
        cream: "#f3f1ea",
        ink: "#2b2b28",
        navy: "#1a3a8a",
        gold: "#8a6d1a",
        line: "#e0dcd2",
      },
      fontFamily: {
        serif: ["Georgia", "Songti SC", "serif"],
      },
    },
  },
  plugins: [],
};
