import { useEffect, useLayoutEffect, useState } from "react";
import { applyLanguage, languageKey, readLanguage } from "./i18n";
import {
  applyTheme,
  readTheme,
  resolveTheme,
  savePreference,
  themeKey,
  themeQuery,
  type Theme,
} from "./appearance";
import "./theme.css";

export function usePreferences() {
  const [language, setLanguage] = useState(readLanguage);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia(themeQuery).matches,
  );
  const resolvedTheme = resolveTheme(theme, systemDark);
  useEffect(() => {
    const query = matchMedia(themeQuery);
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // Direction and scheme change before painting, also in the native Tauri view.
  useLayoutEffect(() => {
    applyLanguage(language);
    applyTheme(resolvedTheme);
  }, [language, resolvedTheme]);
  useEffect(() => savePreference(languageKey, language), [language]);
  useEffect(() => savePreference(themeKey, theme), [theme]);
  return { language, setLanguage, theme, setTheme, resolvedTheme };
}
