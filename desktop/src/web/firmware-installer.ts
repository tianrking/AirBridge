import { FirmwareInstaller } from "./flasher";
import { webBridge } from "./bridge";
export const firmwareInstaller = new FirmwareInstaller({
  hostIdle: webBridge.canInstallFirmware,
  choose: () => navigator.serial.requestPort(),
  device: async (port) => (await import("./esptool")).espDevice(port),
  async fetchPart(path) {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
      cache: "no-cache",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Bound even an unexpectedly large server response before buffering.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty firmware response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2 * 1024 * 1024)
          throw new Error("Firmware response exceeds limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return data;
  },
  async hash(data) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  },
});
