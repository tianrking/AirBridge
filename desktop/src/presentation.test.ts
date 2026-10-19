import { describe, expect, it } from "vitest";
import {
  filteredTransfers,
  progressOf,
  timeLabel,
  transferName,
} from "./presentation";
import { translations } from "./i18n";
import type { Transfer } from "./types";
const base: Transfer = {
  id: "ONE",
  name: "report.bin",
  direction: "send",
  peer: "02:11:22:33:44:55",
  peer_name: "Studio Mac",
  state: "preparing",
  bytes: 3,
  done: 3,
  progress_total: 3,
  sha256: null,
  directory: null,
  error: null,
  updated: 0,
};
describe("honest presentation", () => {
  it("does not turn complete preparation or archive bytes into delivery", () => {
    expect(progressOf(base)).toBe(100);
    expect(base.state).toBe("preparing");
    expect(progressOf({ ...base, state: "finishing", progress_total: 0 })).toBe(
      null,
    );
    expect(progressOf({ ...base, done: NaN })).toBe(null);
    expect(progressOf({ ...base, done: -1 })).toBe(0);
    expect(
      progressOf({
        ...base,
        state: "completed",
        bytes: 0,
        done: 0,
        progress_total: 0,
      }),
    ).toBe(100);
  });
  it("searches retained names and all received files without mutating history", () => {
    const incoming = {
      ...base,
      id: "TWO",
      direction: "receive" as const,
      file_count: 2,
      state: "completed",
      files: [
        {
          name: "diagram.png",
          bytes: 3,
          metadata: false,
          sha256: "a".repeat(64),
        },
      ],
    };
    const history = [base, incoming];
    expect(filteredTransfers(history, "receive", "DIAGRAM")).toEqual([
      incoming,
    ]);
    expect(filteredTransfers(history, "send", "studio mac")).toEqual([base]);
    expect(filteredTransfers(history, "active", "")).toEqual([base]);
    expect(filteredTransfers(history, "all", "missing")).toEqual([]);
    expect(history).toEqual([base, incoming]);
    expect(transferName(incoming, translations.en)).toBe("2 files");
  });
  it("renders unavailable dates explicitly instead of a fabricated timestamp", () => {
    for (const time of [undefined, 0, NaN, Infinity, Number.MAX_VALUE])
      expect(timeLabel(time, "en", "Unknown")).toBe("Unknown");
    expect(timeLabel(1790000000000, "en", "Unknown")).not.toBe("Unknown");
  });
});
