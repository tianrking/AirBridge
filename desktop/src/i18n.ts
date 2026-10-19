import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import zh from "./locales/zh-Hant";
import ar from "./locales/ar";
import type { Language } from "./types";
import { locales, numberLocale } from "./locales/registry";
export { locales } from "./locales/registry";
export type { Copy } from "./locales/schema";

export const languageKey = "airbridge.language.v1";
export const messages = { en, es, fr, "zh-Hant": zh, ar };
export const translations = {
  en: en.ui,
  es: es.ui,
  fr: fr.ui,
  "zh-Hant": zh.ui,
  ar: ar.ui,
};
export const webTranslations = {
  en: en.web,
  es: es.web,
  fr: fr.web,
  "zh-Hant": zh.web,
  ar: ar.web,
};
export const accessTranslations = {
  en: en.access,
  es: es.access,
  fr: fr.access,
  "zh-Hant": zh.access,
  ar: ar.access,
};

export function isLanguage(value: unknown): value is Language {
  return locales.some((locale) => locale.id === value);
}
export function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(languageKey);
    return isLanguage(saved) ? saved : "en";
  } catch {
    return "en";
  }
}
export function applyLanguage(language: Language) {
  document.documentElement.lang = language;
  document.documentElement.dir =
    locales.find((locale) => locale.id === language)?.dir ?? "ltr";
}
export function fileCount(count: number, language: Language): string {
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> =
    messages[language].files;
  const template =
    forms[new Intl.PluralRules(language).select(count)] ??
    messages[language].files.other;
  return template.replace(
    "{count}",
    new Intl.NumberFormat(numberLocale(language)).format(count),
  );
}
