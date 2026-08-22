/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#B7C0BB",
        bull: "#63C46E",
        bear: "#E3776A",
        mgmt: "#C4A8E8",
      },
    },
  },
  plugins: [],
};
