/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
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
        muted: "#8a8578",
        hoverbg: "#e8e4d8",
        // 暗色主题 token
        dpaper: "#20201e",
        dcream: "#2a2a27",
        dink: "#e8e6df",
        dmuted: "#9a958a",
        dline: "#3c3c38",
        dhover: "#34342f",
        dnavy: "#8aa4e8",
        dgold: "#c9a94e",
      },
      fontFamily: {
        serif: ["Georgia", "Songti SC", "serif"],
      },
    },
  },
  plugins: [],
};
