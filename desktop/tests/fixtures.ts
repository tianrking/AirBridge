import { afterEach, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  open,
  stat,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { base64, sha256, type Event } from "../src/web/protocol";
import type { DiskDirectory, DiskFile, DiskWriter } from "../src/web/platform";
import { Receiver } from "../src/web/receiver";
const temporary: string[] = [];
export async function directory() {
  const path = await mkdtemp(join(tmpdir(), "airbridge-web-"));
  temporary.push(path);
  return new Directory(path);
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
// Actual host files back the storage contract tests. Browser-native storage is
// exercised separately; these tests are not serial or AirDrop qualification.
export class Directory implements DiskDirectory {
  name: string;
  constructor(
    public path: string,
    private corrupt = false,
    private denyClose = false,
  ) {
    this.name = path.split(/[\\/]/).pop()!;
  }
  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<Directory> {
    const path = join(this.path, name);
    if (options?.create) await mkdir(path, { recursive: true });
    try {
      await stat(path);
    } catch {
      throw new DOMException("Absent", "NotFoundError");
    }
    return new Directory(path, this.corrupt, this.denyClose);
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DiskFile> {
    const path = join(this.path, name);
    if (options?.create) await (await open(path, "a")).close();
    const corrupt = this.corrupt && name !== "airbridge-receipt.json";
    const denyClose = this.denyClose && name !== "airbridge-receipt.json";
    return {
      name,
      async getFile() {
        return Object.assign(new Blob([await readFile(path)]), { name });
      },
      async createWritable(): Promise<DiskWriter> {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        return {
          async write(data) {
            chunks.push(
              typeof data === "string"
                ? new TextEncoder().encode(data)
                : data.slice(),
            );
          },
          async close() {
            if (denyClose)
              throw new DOMException("Disk write refused", "NotAllowedError");
            const data = new Uint8Array(await new Blob(chunks).arrayBuffer());
            if (corrupt && data.length) data[0] ^= 1;
            await writeFile(path, data);
          },
          async abort() {
            chunks.length = 0;
          },
        };
      },
    };
  }
}
export const encodedName = (name: string) =>
  base64(new TextEncoder().encode(name));
export async function offer(
  receiver: Receiver,
  name = "測試.bin",
  size = 3,
  id = "TEST-1",
) {
  await receiver.handle({
    event: "transfer_begin",
    transfer_id: id,
    files: 1,
    total_bytes: size,
  });
  await receiver.handle({
    event: "manifest_file",
    index: 0,
    size,
    name_b64: encodedName(name),
  });
  await receiver.handle({
    event: "file_begin",
    index: 0,
    size,
    name_b64: encodedName(name),
    metadata: false,
  });
}
export async function finish(
  receiver: Receiver,
  bytes = new TextEncoder().encode("abc"),
) {
  if (bytes.length)
    expect(
      await receiver.handle({
        event: "file_chunk",
        index: 0,
        offset: 0,
        data: base64(bytes),
      }),
    ).toBe(`CHUNK TEST-1 0 ${bytes.length}\n`);
  await receiver.handle({
    event: "file_end",
    index: 0,
    bytes: bytes.length,
    sha256: await sha256(bytes),
  });
}
export const ready: Event = {
  event: "transfer_ready",
  transfer_id: "TEST-1",
  nonce: "a".repeat(32),
  files: 1,
  total_bytes: 3,
};
