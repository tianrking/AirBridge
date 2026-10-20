import { md5 } from "js-md5";
import { InstallError, type FlashDevice, type Segment } from "./flasher";
// Loaded only after an explicit port choice. Never bundled into the demo's startup work.
export async function espDevice(port: unknown): Promise<FlashDevice> {
  const { ESPLoader, Transport } = await import("esptool-js");
  const transport = new Transport(port as SerialPort);
  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    debugLogging: false,
    terminal: { clean() {}, writeLine() {}, write() {} },
  });
  let opened = false;
  return {
    async inspect() {
      // Detect before uploading the RAM stub; protected chips are never flashed or altered.
      await loader.detectChip();
      opened = true;
      const security = await loader.getSecurityInfo();
      const protectedChip =
        security.parsedFlags.SECURE_BOOT_EN ||
        security.parsedFlags.SECURE_DOWNLOAD_ENABLE ||
        security.flashCryptCnt !== 0;
      const chip = loader.chip.CHIP_NAME;
      if (chip !== "ESP32-S3" || protectedChip)
        return { chip, protected: protectedChip, flashBytes: 0, features: [] };
      const features = await loader.chip.getChipFeatures(loader);
      await loader.runStub();
      const size = await loader.detectFlashSize();
      return {
        chip,
        protected: false,
        flashBytes: size ? loader.flashSizeBytes(size as "16MB") : 0,
        features,
      };
    },
    async write(parts, progress) {
      try {
        // Separate calls add a cancellation checkpoint before each next sector erase.
        // The library's initial progress event occurs AFTER flashDeflBegin.
        for (let index = 0; index < parts.length; index++) {
          progress(index, 0);
          const part = parts[index];
          await loader.writeFlash({
            fileArray: [{ address: part.address, data: part.data.slice() }],
            flashMode: "keep",
            flashFreq: "keep",
            flashSize: "keep",
            eraseAll: false,
            compress: true,
            reportProgress: (_, done, total) =>
              progress(index, total ? done / total : 0),
            calculateMD5Hash: (data) => md5(data),
          });
          progress(index, 1);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("MD5 of file does not match data in flash")
        )
          throw new InstallError("verify", error.message);
        throw error;
      }
    },
    async verify(part: Segment) {
      return (
        (
          await loader.flashMd5sum(part.address, part.data.length)
        ).toLowerCase() === md5(part.data)
      );
    },
    async reset() {
      await loader.after("hard_reset");
    },
    async close() {
      // detectChip can fail after opening; stream state is authoritative in that path.
      const device = transport.device;
      if (opened || device.readable || device.writable) {
        await transport.disconnect();
        opened = false;
      }
    },
  };
}
