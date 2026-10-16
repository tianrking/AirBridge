import { describe, expect, it, vi } from "vitest";
import { mergeSnapshot, terminal, type Snapshot } from "./types";
import { readLanguage, translations } from "./i18n";

describe("desktop event ordering", () => {
  it("does not roll a completed transfer back when initial IPC arrives late", () => {
    const current = {
      revision: 12,
      connection: "connected",
      transfers: [{ state: "completed" }],
    } as Snapshot;
    const old = {
      revision: 11,
      connection: "disconnected",
      transfers: [],
    } as unknown as Snapshot;
    expect(mergeSnapshot(current, old)).toBe(current);
    expect(mergeSnapshot(old, current)).toBe(current);
  });
  it("treats uncertain results as terminal and finishing as incomplete", () => {
    expect(terminal("uncertain")).toBe(true);
    expect(terminal("failed")).toBe(true);
    expect(terminal("finishing")).toBe(false);
    expect(terminal("waiting")).toBe(false);
  });
});
describe("language preference", () => {
  it("uses English when storage is unavailable or contains an unknown locale", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("unavailable");
      },
    });
    expect(readLanguage()).toBe("en");
    vi.stubGlobal("localStorage", { getItem: () => "zh-CN" });
    expect(readLanguage()).toBe("en");
    vi.unstubAllGlobals();
  });
  it("restores supported languages and includes every visible string", () => {
    for (const language of ["en", "zh-Hant", "es"] as const) {
      vi.stubGlobal("localStorage", { getItem: () => language });
      expect(readLanguage()).toBe(language);
      expect(Object.keys(translations[language]).sort()).toEqual(
        Object.keys(translations.en).sort(),
      );
      expect(
        Object.values(translations[language]).every(
          (value) => value.trim().length > 0,
        ),
      ).toBe(true);
    }
    vi.unstubAllGlobals();
  });
});
