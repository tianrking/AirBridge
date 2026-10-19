import { afterEach, describe, expect, it, vi } from "vitest";
import { fileCount, isLanguage, locales, messages } from "./i18n";
import { isTheme, readTheme, resolveTheme, savePreference } from "./appearance";
import { formatBytes } from "./types";

afterEach(() => vi.unstubAllGlobals());
function leaves(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "string") return { [path]: value };
  return Object.assign(
    {},
    ...Object.entries(value as object).map(([key, child]) =>
      leaves(child, `${path}.${key}`),
    ),
  );
}
describe("complete locale contracts", () => {
  for (const { id } of locales) {
    it(`${id} covers every UI, web, permission message and required plural form`, () => {
      for (const namespace of ["ui", "web", "access"] as const) {
        const actual = leaves(messages[id][namespace]);
        expect(Object.keys(actual).sort()).toEqual(
          Object.keys(leaves(messages.en[namespace])).sort(),
        );
        for (const [key, text] of Object.entries(actual)) {
          expect(text.trim(), `${id}${key}`).not.toBe("");
          expect(text, `${id}${key}`).not.toMatch(
            /\uFFFD|\bundefined\b|\[TODO\]|lorem ipsum/i,
          );
        }
      }
      const forms: Partial<Record<Intl.LDMLPluralRule, string>> =
        messages[id].files;
      for (const rule of new Intl.PluralRules(id).resolvedOptions()
        .pluralCategories) {
        expect(forms[rule], `${id}: ${rule}`).toContain("{count}");
      }
    });
  }
  it("keeps a deterministic English default and rejects unsupported identifiers", () => {
    for (const value of ["zh-CN", "fr-FR", "AR", "__proto__", null, 0])
      expect(isLanguage(value)).toBe(false);
  });
  it("uses grammatical plurals and localized numerals, including all six Arabic categories", () => {
    expect(fileCount(1, "en")).toBe("1 file");
    expect(fileCount(2, "en")).toBe("2 files");
    expect(fileCount(2, "es")).toBe("2 archivos");
    expect(fileCount(2, "fr")).toBe("2 fichiers");
    expect(fileCount(2, "zh-Hant")).toBe("2 個檔案");
    expect([0, 1, 2, 3, 11, 102].map((n) => fileCount(n, "ar"))).toEqual([
      "لا ملفات (٠)",
      "ملف واحد (١)",
      "ملفان (٢)",
      "٣ ملفات",
      "١١ ملفًا",
      "١٠٢ ملف",
    ]);
    expect(formatBytes(1536, "fr")).toBe("1,5 KiB");
    expect(formatBytes(1536, "ar")).toBe("١٫٥ KiB");
  });
});
describe("appearance preferences", () => {
  it("validates persisted choices and safely defaults to the system", () => {
    for (const choice of ["light", "dark", "system"]) {
      vi.stubGlobal("localStorage", { getItem: () => choice });
      expect(isTheme(choice)).toBe(true);
      expect(readTheme()).toBe(choice);
    }
    for (const invalid of ["night", "DARK", "", null]) {
      vi.stubGlobal("localStorage", { getItem: () => invalid });
      expect(isTheme(invalid)).toBe(false);
      expect(readTheme()).toBe("system");
    }
  });
  it("survives denied storage for both reads and writes", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw Error("denied");
      },
      setItem() {
        throw Error("denied");
      },
    });
    expect(readTheme()).toBe("system");
    expect(() => savePreference("test", "dark")).not.toThrow();
  });
  it("honors an explicit choice independently of system changes", () => {
    for (const systemDark of [true, false]) {
      expect(resolveTheme("dark", systemDark)).toBe("dark");
      expect(resolveTheme("light", systemDark)).toBe("light");
      expect(resolveTheme("system", systemDark)).toBe(
        systemDark ? "dark" : "light",
      );
    }
  });
});
