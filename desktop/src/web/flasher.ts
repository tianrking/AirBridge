import release from "./firmware-release.json";
import { claimFlash, releaseFlash } from "./serial-owner";
export { release as firmwareRelease };
export type Phase =
  | "idle"
  | "loading"
  | "ready"
  | "choosing"
  | "inspecting"
  | "confirm"
  | "writing"
  | "verifying"
  | "resetting"
  | "releasing"
  | "complete"
  | "error"
  | "cancelled"
  | "cleanup_failed"
  | "cancelling";
export type Failure =
  | "busy"
  | "download"
  | "integrity"
  | "chip"
  | "flash"
  | "psram"
  | "security"
  | "serial"
  | "verify"
  | "reset"
  | "release";
export class InstallError extends Error {
  constructor(
    public code: Failure,
    detail = code as string,
  ) {
    super(detail);
  }
}
export interface Segment {
  address: number;
  data: Uint8Array<ArrayBuffer>;
}
export interface Board {
  chip: string;
  flashBytes: number;
  features: string[];
  protected: boolean;
}
export interface FlashDevice {
  inspect(): Promise<Board>;
  write(
    parts: Segment[],
    progress: (file: number, ratio: number) => void,
  ): Promise<void>;
  verify(part: Segment): Promise<boolean>;
  reset(): Promise<void>;
  close(): Promise<void>;
}
export interface FlashDependencies {
  hostIdle(): boolean;
  choose(): Promise<unknown>;
  device(port: unknown): Promise<FlashDevice>;
  fetchPart(path: string): Promise<Uint8Array<ArrayBuffer>>;
  hash(data: Uint8Array<ArrayBuffer>): Promise<string>;
  releaseTimeout?: number;
}
export interface FlashState {
  phase: Phase;
  progress: number;
  board?: Board;
  error?: Failure;
  detail?: string;
}
const livePhases: Phase[] = [
  "choosing",
  "inspecting",
  "confirm",
  "writing",
  "verifying",
  "resetting",
  "releasing",
  "cleanup_failed",
  "cancelling",
];
export function ownsFlash(state: FlashState) {
  return livePhases.includes(state.phase);
}
export class FirmwareInstaller {
  private state: FlashState = { phase: "idle", progress: 0 };
  private listeners = new Set<() => void>();
  private parts?: Segment[];
  private device?: FlashDevice;
  private cancelled = false;
  private running = false;
  private closing?: Promise<void>;
  constructor(private deps: FlashDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<FlashState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private checkpoint() {
    if (this.cancelled)
      throw new DOMException("Installation cancelled", "AbortError");
  }
  async prepare() {
    if (this.running || ownsFlash(this.state)) return;
    this.running = true;
    this.parts = undefined;
    this.publish({
      phase: "loading",
      progress: 0,
      error: undefined,
      detail: undefined,
      board: undefined,
    });
    try {
      const parts: Segment[] = [];
      for (const item of release.segments) {
        let data: Uint8Array<ArrayBuffer>;
        try {
          data = await this.deps.fetchPart(
            `firmware/v${release.version}/${item.path}`,
          );
        } catch (error) {
          throw new InstallError("download", String(error));
        }
        if (
          data.byteLength !== item.bytes ||
          (await this.deps.hash(data)) !== item.sha256
        )
          throw new InstallError("integrity", item.path);
        parts.push({ address: item.address, data });
      }
      this.parts = parts;
      this.publish({ phase: "ready" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.running = false;
    }
  }
  // This must be called directly from the user's click, without an awaited import/fetch first.
  async choose() {
    if (this.running || !this.parts || ownsFlash(this.state)) return;
    try {
      claimFlash(this, this.deps.hostIdle);
    } catch (error) {
      this.publish({ phase: "error", error: "busy", detail: String(error) });
      return;
    }
    this.running = true;
    this.cancelled = false;
    this.publish({
      phase: "choosing",
      error: undefined,
      detail: undefined,
      board: undefined,
      progress: 0,
    });
    try {
      const port = await this.deps.choose();
      // Retain an adapter before cancellation, so even a late chooser has a cleanup path.
      this.device = await this.deps.device(port);
      this.checkpoint();
      this.publish({ phase: "inspecting" });
      const board = await this.device.inspect();
      this.checkpoint();
      this.publish({ board });
      if (board.chip !== release.chip)
        throw new InstallError("chip", board.chip);
      if (board.protected) throw new InstallError("security");
      if (
        !Number.isSafeInteger(board.flashBytes) ||
        board.flashBytes < release.flash_bytes
      )
        throw new InstallError("flash", String(board.flashBytes));
      if (
        board.features.some(
          (f) => /Embedded PSRAM/.test(f) && !/Embedded PSRAM 8MB/.test(f),
        )
      )
        throw new InstallError("psram");
      this.publish({ phase: "confirm" });
    } catch (error) {
      await this.fail(error);
    } finally {
      this.running = false;
    }
  }
  async install(memoryConfirmed: boolean) {
    if (
      this.running ||
      this.state.phase !== "confirm" ||
      !this.device ||
      !this.parts ||
      !memoryConfirmed
    )
      return;
    this.running = true;
    try {
      this.checkpoint();
      this.publish({ phase: "writing", progress: 0 });
      const parts = this.parts;
      await this.device.write(parts, (index, ratio) => {
        this.checkpoint();
        this.publish({
          progress: Math.min(
            0.9,
            ((index + Math.max(0, Math.min(1, ratio))) / parts.length) * 0.9,
          ),
        });
      });
      this.checkpoint();
      this.publish({ phase: "verifying", progress: 0.9 });
      for (let i = 0; i < parts.length; i++) {
        if (!(await this.device.verify(parts[i])))
          throw new InstallError(
            "verify",
            `0x${parts[i].address.toString(16)}`,
          );
        this.checkpoint();
        this.publish({ progress: 0.9 + ((i + 1) / parts.length) * 0.09 });
      }
      this.publish({ phase: "resetting" });
      try {
        await this.device.reset();
      } catch (error) {
        throw new InstallError("reset", String(error));
      }
      this.checkpoint();
      await this.release();
      this.publish({ phase: "complete", progress: 1 });
    } catch (error) {
      await this.fail(error);
    } finally {
      this.running = false;
    }
  }
  async cancel() {
    if (!ownsFlash(this.state) || this.state.phase === "cleanup_failed") return;
    this.cancelled = true;
    this.publish({ phase: "cancelling" });
    // Commands finish/timeout before cleanup; never release the lease while a write can still run.
    if (!this.running)
      await this.fail(new DOMException("Installation cancelled", "AbortError"));
  }
  async retryRelease() {
    if (this.running || this.state.phase !== "cleanup_failed") return;
    this.running = true;
    try {
      await this.release();
      this.publish({ phase: "cancelled", error: undefined, detail: undefined });
    } catch (error) {
      this.publish({
        phase: "cleanup_failed",
        error: "release",
        detail: String(error),
      });
    } finally {
      this.running = false;
    }
  }
  private async release() {
    this.publish({ phase: "releasing" });
    if (this.device) {
      this.closing ??= this.device.close().catch((error) => {
        this.closing = undefined;
        throw error;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.closing,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new InstallError("release", "Port release timed out")),
              this.deps.releaseTimeout ?? 5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      this.device = undefined;
      this.closing = undefined;
    }
    releaseFlash(this);
  }
  private showError(error: unknown) {
    const aborted =
      (error instanceof DOMException && error.name === "NotFoundError") ||
      (error instanceof DOMException && error.name === "AbortError");
    this.publish({
      phase: aborted ? "cancelled" : "error",
      error: aborted
        ? undefined
        : error instanceof InstallError
          ? error.code
          : "serial",
      detail: aborted ? undefined : String(error),
    });
  }
  private async fail(error: unknown) {
    if (this.state.phase === "releasing" || this.state.phase === "cleanup_failed") {
      this.publish({ phase: "cleanup_failed", error: "release", detail: String(error) });
      return;
    }
    try {
      await this.release();
      this.showError(error);
    } catch (cleanup) {
      this.publish({
        phase: "cleanup_failed",
        error: "release",
        detail: `${String(error)}; ${String(cleanup)}`,
      });
    }
  }
}
