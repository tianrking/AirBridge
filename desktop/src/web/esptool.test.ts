import { beforeEach, describe, expect, it, vi } from "vitest";
import { md5 } from "js-md5";
const fake = vi.hoisted(() => ({
  detect: vi.fn(),
  stub: vi.fn(),
  write: vi.fn(),
  reset: vi.fn(),
  close: vi.fn(),
  digest: vi.fn(),
  security: {
    parsedFlags: { SECURE_BOOT_EN: false, SECURE_DOWNLOAD_ENABLE: false },
    flashCryptCnt: 0,
  },
}));
vi.mock("esptool-js", () => ({
  Transport: class {
    device = { readable: null, writable: null };
    disconnect = fake.close;
  },
  ESPLoader: class {
    chip = {
      CHIP_NAME: "ESP32-S3",
      getChipFeatures: async () => ["Embedded PSRAM 8MB"],
    };
    detectChip = fake.detect;
    runStub = fake.stub;
    writeFlash = fake.write;
    after = fake.reset;
    flashMd5sum = fake.digest;
    getSecurityInfo = async () => fake.security;
    detectFlashSize = async () => "16MB";
    flashSizeBytes = () => 16777216;
  },
}));
import { espDevice } from "./esptool";
beforeEach(() => {
  vi.clearAllMocks();
  fake.security.parsedFlags.SECURE_BOOT_EN = false;
  fake.security.parsedFlags.SECURE_DOWNLOAD_ENABLE = false;
  fake.security.flashCryptCnt = 0;
});
describe("Espressif adapter contract (mock ROM)", () => {
  it("keeps image headers and NVS, requires library MD5, then independently reads flash MD5", async () => {
    const device = await espDevice({});
    await device.inspect();
    const part = { address: 0, data: new Uint8Array([1, 2, 3, 4]) };
    await device.write([part], () => {});
    const options = fake.write.mock.calls[0][0];
    expect(options).toMatchObject({
      eraseAll: false,
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      compress: true,
    });
    expect(options.calculateMD5Hash(part.data)).toBe(md5(part.data));
    expect(options.fileArray[0].data).not.toBe(part.data);
    fake.digest.mockResolvedValue(md5(part.data));
    expect(await device.verify(part)).toBe(true);
    expect(fake.digest).toHaveBeenCalledWith(0, 4);
    fake.digest.mockResolvedValue("f".repeat(32));
    expect(await device.verify(part)).toBe(false);
    await device.reset();
    expect(fake.reset).toHaveBeenCalledWith("hard_reset");
    await device.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });
  for (const kind of [
    "SECURE_BOOT_EN",
    "SECURE_DOWNLOAD_ENABLE",
    "encryption",
  ] as const)
    it(`rejects ${kind} before loading a stub or writing`, async () => {
      if (kind === "encryption") fake.security.flashCryptCnt = 1;
      else fake.security.parsedFlags[kind] = true;
      const device = await espDevice({});
      expect((await device.inspect()).protected).toBe(true);
      expect(fake.stub).not.toHaveBeenCalled();
      expect(fake.write).not.toHaveBeenCalled();
      await device.close();
    });
});
