// "TV dark": the app-wide palette sampled from the user's own TradingView layout
// (background #14171f, text #d6d6d6, teal #2e796f/#389d8b, red #ee2e3f, blue
// #225ef9). Implemented as a class on <html> that remaps the Tailwind utility
// classes in index.css, so no page needed touching. Dark is the default; the
// header button flips it and the choice is remembered on this device.
const KEY = "uiTheme";
export type Theme = "dark" | "light";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme = getTheme()) {
  document.documentElement.classList.toggle("tv-dark", t === "dark");
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // best-effort
  }
  applyTheme(t);
}
