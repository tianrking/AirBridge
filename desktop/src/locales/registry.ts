export const locales = [
  { id: "en", name: "English", dir: "ltr" },
  { id: "es", name: "Español", dir: "ltr" },
  { id: "fr", name: "Français", dir: "ltr" },
  { id: "zh-Hant", name: "繁體中文", dir: "ltr" },
  { id: "ar", name: "العربية", dir: "rtl" },
] as const;
export type Language = (typeof locales)[number]["id"];
// CLDR's default for bare `ar` differs across runtimes. Make this product's
// Arabic-Indic number choice explicit, in both the browser and native WebView.
export function numberLocale(language: string): string {
  return language === "ar" ? "ar-u-nu-arab" : language;
}
