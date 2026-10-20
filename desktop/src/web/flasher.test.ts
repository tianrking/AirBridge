import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  FirmwareInstaller,
  firmwareRelease,
  ownsFlash,
  type FlashDevice,
  type Board,
  type FlashDependencies,
} from "./flasher";
import { assertHostAvailable } from "./serial-owner";
import { firmwareMessages } from "../locales/flasher";
function setup(
  overrides: Partial<FlashDevice> = {},
  options: Partial<FlashDependencies> = {},
) {
  const calls: string[] = [];
  const board: Board = {
    chip: "ESP32-S3",
    flashBytes: 16777216,
    features: ["Embedded PSRAM 8MB (AP_3v3)"],
    protected: false,
  };
  const device: FlashDevice = {
    async inspect() {
      calls.push("inspect");
      return board;
    },
    async write(parts, report) {
      calls.push("write");
      expect(parts.map((p) => p.address)).toEqual([0, 0x8000, 0x10000]);
      report(2, 1);
    },
    async verify(part) {
      calls.push(`verify:${part.address}`);
      return true;
    },
    async reset() {
      calls.push("reset");
    },
    async close() {
      calls.push("close");
    },
    ...overrides,
  };
  const deps: FlashDependencies = {
    hostIdle: () => true,
    async choose() {
      calls.push("choose");
      return {};
    },
    async device() {
      return device;
    },
    async fetchPart(path) {
      return new Uint8Array(
        readFileSync(new URL(`../../public/${path}`, import.meta.url)),
      );
    },
    async hash(data) {
      return createHash("sha256").update(data).digest("hex");
    },
    ...options,
  };
  const installer = new FirmwareInstaller(deps);
  return { installer, calls, device, board, deps };
}
const cleanup: FirmwareInstaller[] = [];
afterEach(async () => {
  for (const i of cleanup.splice(0)) {
    await i.cancel();
    if (i.getSnapshot().phase === "cleanup_failed") await i.retryRelease();
  }
});
async function ready(...args: Parameters<typeof setup>) {
  const f = setup(...args);
  cleanup.push(f.installer);
  await f.installer.prepare();
  await f.installer.choose();
  return f;
}
describe("browser firmware installation (virtual device, no hardware)", () => {
  it("pins published bytes and keeps every erase sector outside NVS", async () => {
    const f = setup();
    await f.installer.prepare();
    expect(f.installer.getSnapshot().phase).toBe("ready");
    expect(f.calls).toEqual([]);
    for (const p of firmwareRelease.segments) {
      const end = Math.ceil((p.address + p.bytes) / 4096) * 4096;
      expect(end <= 0x9000 || p.address >= 0xf000).toBe(true);
    }
  });
  it("requires prepare, inspection and explicit memory confirmation before writing", async () => {
    const f = setup();
    await f.installer.choose();
    await f.installer.install(true);
    expect(f.calls).toEqual([]);
    cleanup.push(f.installer);
    await f.installer.prepare();
    await f.installer.choose();
    await f.installer.install(false);
    expect(f.calls).toEqual(["choose", "inspect"]);
    await f.installer.install(true);
    expect(f.calls).toEqual([
      "choose",
      "inspect",
      "write",
      "verify:0",
      "verify:32768",
      "verify:65536",
      "reset",
      "close",
    ]);
    expect(f.installer.getSnapshot()).toMatchObject({
      phase: "complete",
      progress: 1,
    });
    expect(assertHostAvailable).not.toThrow();
  });
  for (const which of ["size", "hash", "download"] as const)
    it(`rejects ${which} before opening a port`, async () => {
      const f = setup(
        {},
        which === "size"
          ? { fetchPart: async () => new Uint8Array(1) }
          : which === "hash"
            ? { hash: async () => "0".repeat(64) }
            : {
                fetchPart: async () => {
                  throw Error("offline");
                },
              },
      );
      await f.installer.prepare();
      await f.installer.choose();
      expect(f.installer.getSnapshot()).toMatchObject({
        phase: "error",
        error: which === "download" ? "download" : "integrity",
      });
      expect(f.calls).toEqual([]);
    });
  for (const [patch, error] of [
    [{ chip: "ESP32" }, "chip"],
    [{ chip: "ESP32-C3" }, "chip"],
    [{ flashBytes: 8388608 }, "flash"],
    [{ flashBytes: NaN }, "flash"],
    [{ features: ["Embedded PSRAM 2MB"] }, "psram"],
    [{ features: ["Unknown Embedded PSRAM"] }, "psram"],
    [{ protected: true }, "security"],
  ] as const)
    it(`refuses incompatible board ${JSON.stringify(patch)}`, async () => {
      const f = setup();
      Object.assign(f.board, patch);
      cleanup.push(f.installer);
      await f.installer.prepare();
      await f.installer.choose();
      expect(f.installer.getSnapshot()).toMatchObject({
        phase: "error",
        error,
      });
      expect(f.calls).not.toContain("write");
      expect(f.calls.at(-1)).toBe("close");
      expect(assertHostAvailable).not.toThrow();
    });
  it("blocks inspection while host cleanup is pending", async () => {
    const f = await ready({}, { hostIdle: () => false });
    expect(f.installer.getSnapshot().error).toBe("busy");
    expect(f.calls).toEqual([]);
  });
  it("holds an exclusive lease until cancellation is released", async () => {
    const a = await ready();
    expect(assertHostAvailable).toThrow();
    const b = await ready();
    expect(b.installer.getSnapshot().error).toBe("busy");
    await a.installer.cancel();
    expect(assertHostAvailable).not.toThrow();
  });
  it("never reports success when readback differs", async () => {
    const f = await ready({ verify: async () => false });
    await f.installer.install(true);
    expect(f.installer.getSnapshot()).toMatchObject({
      phase: "error",
      error: "verify",
    });
    expect(f.calls).not.toContain("reset");
    expect(assertHostAvailable).not.toThrow();
  });
  it("distinguishes verified flash from an unconfirmed reset", async () => {
    const f = await ready({
      reset: async () => {
        throw Error("USB lost");
      },
    });
    await f.installer.install(true);
    expect(f.installer.getSnapshot()).toMatchObject({
      phase: "error",
      error: "reset",
    });
  });
  it("releases after a dismissed chooser without writing", async () => {
    const f = await ready(
      {},
      {
        choose: async () => {
          throw new DOMException("dismissed", "NotFoundError");
        },
      },
    );
    expect(f.installer.getSnapshot().phase).toBe("cancelled");
    expect(f.calls).toEqual([]);
    expect(assertHostAvailable).not.toThrow();
  });
  it("keeps ownership when cleanup fails and only unlocks after successful retry", async () => {
    let fail = true;
    const f = await ready({
      close: async () => {
        if (fail) throw Error("locked");
      },
    });
    await f.installer.cancel();
    expect(f.installer.getSnapshot().phase).toBe("cleanup_failed");
    expect(assertHostAvailable).toThrow();
    fail = false;
    await f.installer.retryRelease();
    expect(f.installer.getSnapshot().phase).toBe("cancelled");
    expect(assertHostAvailable).not.toThrow();
  });
  it("a failed final release cannot auto-retry and masquerade as a clean installation", async () => {
    const close = vi
      .fn()
      .mockRejectedValueOnce(Error("locked"))
      .mockResolvedValue(undefined);
    const f = await ready({ close });
    await f.installer.install(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(f.installer.getSnapshot().phase).toBe("cleanup_failed");
    expect(assertHostAvailable).toThrow();
    await f.installer.retryRelease();
    expect(f.installer.getSnapshot().phase).toBe("cancelled");
    expect(assertHostAvailable).not.toThrow();
  });
  it("timeout retains the pending close instead of overlapping cleanup", async () => {
    let finish!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const f = await ready({ close }, { releaseTimeout: 5 });
    await f.installer.cancel();
    expect(f.installer.getSnapshot().phase).toBe("cleanup_failed");
    expect(assertHostAvailable).toThrow();
    finish();
    await f.installer.retryRelease();
    expect(close).toHaveBeenCalledTimes(1);
    expect(assertHostAvailable).not.toThrow();
  });
  it("cancels a write at an acknowledged boundary before verification or reset", async () => {
    let advance!: () => void;
    let started!: () => void;
    const began = new Promise<void>((r) => {
      started = r;
    });
    const f = await ready({
      write: async (_, progress) => {
        started();
        await new Promise<void>((r) => {
          advance = r;
        });
        progress(0, 0.5);
      },
    });
    const task = f.installer.install(true);
    await began;
    await f.installer.cancel();
    expect(assertHostAvailable).toThrow();
    advance();
    await task;
    expect(f.installer.getSnapshot().phase).toBe("cancelled");
    expect(f.calls).not.toContain("reset");
    expect(f.calls.some((c) => c.startsWith("verify"))).toBe(false);
    expect(assertHostAvailable).not.toThrow();
  });
  it("late chooser results cannot open or write after cancellation", async () => {
    let select!: (port: unknown) => void;
    const f = setup(
      {},
      {
        choose: () =>
          new Promise((r) => {
            select = r;
          }),
      },
    );
    cleanup.push(f.installer);
    await f.installer.prepare();
    const task = f.installer.choose();
    await f.installer.cancel();
    select({});
    await task;
    expect(f.installer.getSnapshot().phase).toBe("cancelled");
    expect(f.calls).toEqual(["close"]);
  });
  it("has complete translated states, failures and recovery instructions", () => {
    for (const copy of Object.values(firmwareMessages)) {
      expect(Object.keys(copy).sort()).toEqual(
        Object.keys(firmwareMessages.en).sort(),
      );
      expect(Object.values(copy).every((v) => v.trim())).toBe(true);
    }
    expect(ownsFlash({ phase: "cleanup_failed", progress: 0 })).toBe(true);
  });
});
