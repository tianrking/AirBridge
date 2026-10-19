export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;
export const themeKey = "airbridge.theme.v1";
export const themeQuery = "(prefers-color-scheme: dark)";
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}
export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(themeKey);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}
export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage denial never prevents changing the interface preference.
  }
}
