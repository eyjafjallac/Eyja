import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif";
import "@fontsource/instrument-serif/400-italic.css";
import "./theme.css";

/** Follows the system light/dark setting through `data-theme` on the root element. */
export function followSystemTheme() {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = query.matches ? "dark" : "light";
  };
  apply();
  query.addEventListener("change", apply);
}

/** Reads a theme color such as `--accent` as it is right now. */
export function themeValue(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
