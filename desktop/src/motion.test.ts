import { afterEach, expect, it, vi } from "vitest";
import { MOTION, motionStyle, readMotionPaused, reflowDelta } from "./motion";
import { DEPARTURE_MS } from "./presence";

afterEach(() => vi.unstubAllGlobals());
it("derives shared CSS timing and exit retention from the same source", () => {
  expect(motionStyle).toMatchObject({
    "--motion-exit": `${DEPARTURE_MS}ms`,
    "--motion-progress": `${MOTION.progress}ms`,
    "--motion-ease": MOTION.ease,
  });
});
it("preserves the displayed position when a layout movement is interrupted", () => {
  expect(
    reflowDelta({ x: 200, y: 80 }, { x: 100, y: 40 }, { x: -35, y: 12 }),
  ).toEqual({ x: 65, y: 52 });
});
it("defaults to motion and respects an explicit stored pause", () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  expect(readMotionPaused()).toBe(false);
  vi.stubGlobal("localStorage", { getItem: () => "paused" });
  expect(readMotionPaused()).toBe(true);
});
it("stays usable when preference storage is blocked", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new DOMException("Blocked", "SecurityError");
    },
  });
  expect(readMotionPaused()).toBe(false);
});
