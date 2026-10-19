import { afterEach, describe, expect, it, vi } from "vitest";
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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  base64,
  BOARD_ID,
  command,
  Lines,
  manifest,
  safeName,
  sha256,
  unbase64,
  type Event,
} from "./protocol";
import type {
  DiskDirectory,
  DiskFile,
  DiskWriter,
  SerialPort,
} from "./platform";
import { Receiver } from "./receiver";
import { Session } from "./session";
import { WebBridge } from "./bridge";
const temporary: string[] = [];
async function directory() {
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
class Directory implements DiskDirectory {
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
const encodedName = (name: string) => base64(new TextEncoder().encode(name));
async function offer(
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
async function finish(
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
const ready: Event = {
  event: "transfer_ready",
  transfer_id: "TEST-1",
  nonce: "a".repeat(32),
  files: 1,
  total_bytes: 3,
};
describe("browser wire protocol", () => {
  it("matches the independent literal CRC fixture and rejects framing injection", () => {
    expect(new TextDecoder().decode(command(17, "HELLO"))).toBe(
      "AB2 17 HELLO *414b814b\n",
    );
    for (const body of ["", "x\ny", "x*y", "測試", "x".repeat(193)])
      expect(() => command(1, body)).toThrow();
    for (const n of [0, -1, 1.5, 2 ** 32])
      expect(() => command(n, "STATUS")).toThrow();
  });
  it("recovers JSON from fragmented diagnostics and fails closed on an oversized record", () => {
    const lines = new Lines();
    expect(
      lines.feed(new TextEncoder().encode('\nboot\n{"event":"scanner_')),
    ).toEqual([]);
    expect(lines.feed(new TextEncoder().encode('status"}\n\n'))).toEqual([
      { event: "scanner_status" },
    ]);
    expect(() => lines.feed(new Uint8Array(16385).fill(97))).toThrow(/16 KiB/);
  });
  it("rejects unsafe names, noncanonical base64 and oversized sources", () => {
    for (const name of [
      "../x",
      "CON",
      "nul.txt",
      "LPT².bin",
      "bad:name",
      "file.",
      "a\\b",
      "a\0b",
    ])
      expect(safeName(name)).toBe(false);
    expect(safeName("測試 & data.bin")).toBe(true);
    expect(() => unbase64("YR==")).toThrow();
    expect(() => manifest("file", 1048577, "000000000000", "TEST-1")).toThrow();
  });
  it("produces binary plists decoded independently by Python, including Unicode and empty files", async () => {
    // Python's stdlib plist decoder validates object refs/offsets/UTF-16/trailer.
    const dir = await directory();
    for (const [name, size] of [
      ["測試-😀.bin", 262145],
      ["empty.bin", 0],
    ] as const) {
      const file = join(dir.path, "ask.plist");
      await writeFile(file, manifest(name, size, "020102030405", "TEST-123"));
      const localPython =
        "C:\\Espressif\\tools\\python\\v6.1\\venv\\Scripts\\python.exe";
      const python =
        process.env.AIRBRIDGE_TEST_PYTHON ??
        (existsSync(localPython)
          ? localPython
          : process.platform === "win32"
            ? "python"
            : "python3");
      const output = execFileSync(
        python,
        [
          "-c",
          "import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))",
          file,
        ],
        { encoding: "utf8" },
      );
      const root = JSON.parse(output);
      expect(root.TransferID.id).toBe("TEST-123");
      expect(root.Files[0]).toMatchObject({
        FileName: name,
        FileSize: size,
        FileIsDirectory: false,
        FileBomPath: `./${name}`,
      });
      expect(root.TransferType).toEqual({ files: {} });
      expect(root.Items).toEqual([]);
    }
  });
});
describe("checked browser receive publication", () => {
  it("saves actual files, closes/reopens/hashes, commits, and waits for the native response", async () => {
    const dir = await directory(),
      events: Event[] = [];
    const receiver = new Receiver(dir, (e) => events.push(e));
    await offer(receiver);
    await finish(receiver);
    expect(await receiver.handle(ready)).toBe(`COMMIT ${"a".repeat(32)}\n`);
    expect(events.some((e) => e.event === "received")).toBe(false);
    await expect(
      receiver.handle({
        event: "transfer_complete",
        transfer_id: "TEST-1",
        host_committed: true,
        response_written: false,
      }),
    ).rejects.toThrow();
    await receiver.handle({
      event: "transfer_complete",
      transfer_id: "TEST-1",
      host_committed: true,
      response_written: true,
    });
    const event = events.find((e) => e.event === "received")!;
    const output = join(dir.path, String(event.directory).split("/").pop()!);
    expect(await readFile(join(output, "測試.bin"), "utf8")).toBe("abc");
    expect(
      JSON.parse(
        await readFile(join(output, "airbridge-receipt.json"), "utf8"),
      ),
    ).toMatchObject({ status: "completed", native_confirmed: true });
    await expect(receiver.handle(ready)).rejects.toThrow();
  });
  it("withholds COMMIT when persisted content differs from the serial bytes", async () => {
    const dir = await directory(),
      receiver = new Receiver(new Directory(dir.path, true), () => {});
    await offer(receiver);
    await expect(finish(receiver)).rejects.toThrow(/SHA256/);
    await expect(receiver.handle(ready)).rejects.toThrow(/incomplete/);
    await receiver.stop();
  });
  it("withholds COMMIT on close failure and rejects chunk replays or early commit", async () => {
    const dir = await directory(),
      receiver = new Receiver(new Directory(dir.path, false, true), () => {});
    await offer(receiver);
    await expect(
      receiver.handle({
        event: "file_chunk",
        index: 0,
        offset: 1,
        data: "YWJj",
      }),
    ).rejects.toThrow();
    await expect(receiver.handle(ready)).rejects.toThrow();
    await expect(finish(receiver)).rejects.toThrow(/refused/);
    await expect(receiver.handle(ready)).rejects.toThrow();
    await receiver.stop();
  });
  it("handles zero-byte files without inventing a chunk", async () => {
    const receiver = new Receiver(await directory(), () => {});
    await offer(receiver, "empty.bin", 0);
    await finish(receiver, new Uint8Array());
    expect(await receiver.handle({ ...ready, total_bytes: 0 })).toMatch(
      /^COMMIT/,
    );
  });
  it("rejects traversal, oversized offers, inconsistent manifests and stale identities", async () => {
    const receiver = new Receiver(await directory(), () => {});
    await expect(
      receiver.handle({
        event: "transfer_begin",
        transfer_id: "BAD",
        files: 17,
        total_bytes: 1,
      }),
    ).rejects.toThrow();
    await expect(offer(receiver, "../escape")).rejects.toThrow();
    await receiver.stop();
    await offer(receiver);
    await expect(
      receiver.handle({
        event: "file_chunk",
        transfer_id: "OTHER",
        index: 0,
        offset: 0,
        data: "YWJj",
      }),
    ).rejects.toThrow(/identity/);
    await expect(
      receiver.handle({
        event: "file_begin",
        index: 16,
        size: 3,
        name_b64: encodedName("other"),
        metadata: true,
      }),
    ).rejects.toThrow();
    await receiver.stop();
  });
});
// Deterministic virtual wire: explicitly not a substitute for COM4 / AirDrop.
class VirtualPort implements SerialPort {
  readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  writable: WritableStream<Uint8Array<ArrayBuffer>>;
  private controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  records: string[] = [];
  closed = false;
  signals?: { dataTerminalReady: boolean; requestToSend: boolean };
  respond = true;
  hardware = BOARD_ID;
  onCommand?: (record: string, sequence: number) => void;
  constructor() {
    this.readable = new ReadableStream({
      start: (c) => {
        this.controller = c;
      },
    });
    this.writable = new WritableStream({
      write: (bytes) => {
        const record = new TextDecoder().decode(bytes);
        this.records.push(record);
        if (!record.startsWith("AB2 ") || !this.respond) return;
        const sequence = Number(record.split(" ")[1]);
        const words = record.trim().split(" ");
        const offset = ["META", "DATA"].includes(words[3])
          ? Number(words[4]) + unbase64(words[5]).length
          : 0;
        this.emit({
          event: "command_reply",
          sequence,
          ok: true,
          offset,
          protocol: 2,
          max_file: 1048576,
          chunk_bytes: 112,
          radio_mac: "02:11:22:33:44:55",
          hardware_id: this.hardware,
          resolve: true,
        });
        this.onCommand?.(record, sequence);
      },
    });
  }
  getInfo() {
    return { usbVendorId: 0x303a, usbProductId: 0x1001 };
  }
  async open() {}
  async setSignals(s: { dataTerminalReady: boolean; requestToSend: boolean }) {
    this.signals = s;
  }
  async close() {
    this.closed = true;
  }
  emit(e: Event) {
    const bytes = new TextEncoder().encode(JSON.stringify(e) + "\n");
    this.controller.enqueue(bytes.slice(0, 9));
    this.controller.enqueue(bytes.slice(9));
  }
}
describe("single-owner asynchronous serial session", () => {
  it("negotiates without resetting, binds the factory identity and releases both locks", async () => {
    const port = new VirtualPort(),
      session = new Session(
        port,
        await directory(),
        () => {},
        () => {},
      );
    await session.open();
    expect(port.signals).toEqual({
      dataTerminalReady: false,
      requestToSend: false,
    });
    await session.request("STATUS");
    await session.close();
    expect(port.closed && !port.readable.locked && !port.writable.locked).toBe(
      true,
    );
    expect(port.records.filter((r) => r.includes("HELLO"))).toHaveLength(1);
  });
  it("closes on a missing or unexpected hardware identity before accepting transfers", async () => {
    const port = new VirtualPort();
    port.hardware = "00:11:22:33:44:55";
    const session = new Session(
      port,
      await directory(),
      () => {},
      () => {},
    );
    await expect(session.open()).rejects.toThrow(/identity/);
    expect(port.closed).toBe(true);
  });
  it("services incoming chunk acknowledgements while an outgoing command waits", async () => {
    const port = new VirtualPort(),
      session = new Session(
        port,
        await directory(),
        () => {},
        () => {},
      );
    await session.open();
    port.respond = false;
    const waiting = session.request("STATUS");
    port.emit({
      event: "transfer_begin",
      transfer_id: "WIRE-1",
      files: 1,
      total_bytes: 3,
    });
    port.emit({
      event: "manifest_file",
      index: 0,
      size: 3,
      name_b64: encodedName("test.bin"),
    });
    port.emit({
      event: "file_begin",
      index: 0,
      size: 3,
      name_b64: encodedName("test.bin"),
      metadata: false,
    });
    port.emit({ event: "file_chunk", index: 0, offset: 0, data: "YWJj" });
    await vi.waitFor(() =>
      expect(port.records).toContain("CHUNK WIRE-1 0 3\n"),
    );
    port.emit({ event: "command_reply", sequence: 2, ok: true });
    await waiting;
    await session.close();
  });
  it("does not automatically resend timed-out commands", async () => {
    const port = new VirtualPort(),
      failures: Error[] = [];
    const session = new Session(
      port,
      await directory(),
      () => {},
      (e) => failures.push(e),
    );
    await session.open();
    vi.useFakeTimers();
    port.respond = false;
    const waiting = session.request("STATUS");
    const assertion = expect(waiting).rejects.toThrow(/uncertain/);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    await session.close();
    expect(port.records.filter((r) => r.includes("STATUS"))).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
});
describe("browser workflow state", () => {
  const peer = "ea:fd:00:20:7d:38";
  async function connected() {
    const dir = await directory(),
      port = new VirtualPort();
    const file = new File(
      [new Uint8Array(4097).map((_, n) => n % 251)],
      "browser-測試.bin",
    );
    vi.stubGlobal("window", {
      isSecureContext: true,
      showDirectoryPicker: async () => dir,
      showOpenFilePicker: async () => [{ getFile: async () => file }],
    });
    vi.stubGlobal("navigator", { serial: { requestPort: async () => port } });
    const bridge = new WebBridge();
    await bridge.call("choose_receive_folder");
    await bridge.call("connect_bridge");
    port.emit({
      event: "scanner_status",
      peers: [
        {
          mac: peer,
          airdrop_advertised: true,
          airdrop_port: 8770,
          rssi: -70,
          host_label: "NOT-A-DISPLAY-NAME",
        },
      ],
    });
    await vi.waitFor(() => expect(bridge.snapshot.peers).toHaveLength(1));
    return { bridge, port, file };
  }
  it("exposes handshake provenance and missing RSSI without inventing a reading", async () => {
    const { bridge, port } = await connected();
    expect(bridge.snapshot.bridge_info).toMatchObject({
      protocol: 2,
      max_file: 1048576,
      chunk_bytes: 112,
      hardware_id: BOARD_ID,
      usb_serial: null,
      port: null,
    });
    port.emit({
      event: "scanner_status",
      peers: [
        {
          mac: peer,
          airdrop_advertised: true,
          airdrop_port: 8770,
          has_sync: true,
          has_election: false,
          root_metric: 0,
          channel6_mask: 65535,
        },
      ],
    });
    await vi.waitFor(() => expect(bridge.snapshot.peers[0].rssi).toBe(null));
    expect(bridge.snapshot.peers[0].observation).toMatchObject({
      has_sync: true,
      has_election: false,
      root_metric: 0,
      channel6_mask: 65535,
    });
    expect(bridge.snapshot.peers[0].name).toBe(null);
    await bridge.call("disconnect_bridge");
    expect(bridge.snapshot.bridge_info?.connected_at).toBeGreaterThan(0);
  });
  it("retains native names in history and scanner reports do not rewrite transfer timestamps", async () => {
    const { bridge, port } = await connected();
    port.emit({
      event: "peer_identity",
      mac: peer,
      error: 0,
      display_name: "Studio Mac",
    });
    await vi.waitFor(() =>
      expect(bridge.snapshot.peers[0].name).toBe("Studio Mac"),
    );
    const selected = await bridge.call<{ id: string }>("choose_file");
    let sending = false;
    port.onCommand = (record) => {
      if (record.includes(" SEND ")) sending = true;
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() => expect(sending).toBe(true));
    const stamp = bridge.snapshot.transfers[0].updated;
    expect(bridge.snapshot.transfers[0].peer_name).toBe("Studio Mac");
    port.emit({ event: "scanner_status", peers: [] });
    await vi.waitFor(() => expect(bridge.snapshot.peers).toHaveLength(0));
    expect(bridge.snapshot.transfers[0].updated).toBe(stamp);
    await bridge.call("disconnect_bridge");
    expect(bridge.snapshot.transfers[0].peer_name).toBe("Studio Mac");
    expect(bridge.snapshot.transfers[0].state).toBe("uncertain");
  });
  it("resolves real names without substituting DNS labels and expires stale advertisements", async () => {
    const { bridge, port } = await connected();
    expect(bridge.snapshot.peers[0].name).toBe(null);
    port.onCommand = (record) => {
      if (record.includes("RESOLVE")) {
        port.emit({
          event: "peer_resolved",
          mac: peer,
          name_b64: encodedName("測試 MacBook Pro"),
        });
        port.emit({
          event: "resolution_complete",
          mac: peer,
          error: 0,
          http_status: 200,
        });
      }
    };
    await bridge.call("resolve_peer", { peer });
    await vi.waitFor(() => expect(bridge.snapshot.resolving_peer).toBe(null));
    expect(bridge.snapshot.peers[0]).toMatchObject({
      name: "測試 MacBook Pro",
      name_source: "airdrop_discover",
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16000);
    await expect(bridge.call("resolve_peer", { peer })).rejects.toThrow(
      /expired/,
    );
    await bridge.call("disconnect_bridge");
  });
  it("stages a selected file, keeps 100% upload incomplete, and checks native completion identity and hash", async () => {
    const { bridge, port, file } = await connected();
    const selected = await bridge.call<{ id: string }>("choose_file");
    let sendSeen = false;
    port.onCommand = (record) => {
      if (record.includes(" SEND ")) {
        sendSeen = true;
        port.emit({ event: "outgoing_stage", stage: "awaiting_acceptance" });
        port.emit({
          event: "outgoing_progress",
          wire_bytes: 5000,
          wire_total: 5000,
        });
      }
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() => expect(sendSeen).toBe(true));
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("finishing"),
    );
    const hash = await sha256(new Uint8Array(await file.arrayBuffer()));
    port.emit({
      event: "outgoing_complete",
      transfer_id: bridge.snapshot.transfers[0].id,
      success: true,
      http_status: 200,
      bytes: file.size,
      sha256: hash,
    });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("completed"),
    );
    expect(bridge.snapshot.transfers[0]).toMatchObject({
      done: 4097,
      sha256: hash,
    });
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(1);
    await bridge.call("disconnect_bridge");
  });
  it("does not mark a mismatched native digest completed or retry the file", async () => {
    const { bridge, port } = await connected();
    const selected = await bridge.call<{ id: string }>("choose_file");
    port.onCommand = (record) => {
      if (record.includes(" SEND "))
        port.emit({
          event: "outgoing_complete",
          transfer_id: bridge.snapshot.transfers[0].id,
          success: true,
          http_status: 200,
          bytes: 4097,
          sha256: "0".repeat(64),
        });
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("uncertain"),
    );
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(1);
    await bridge.call("disconnect_bridge");
  });
  it("cancels staging without issuing native SEND or replaying commands", async () => {
    const { bridge, port } = await connected();
    const selected = await bridge.call<{ id: string }>("choose_file");
    let cancellation: Promise<unknown> | undefined;
    port.onCommand = (record) => {
      if (record.includes(" DATA ") && !cancellation)
        cancellation = bridge.call("cancel_transfer");
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("cancelled"),
    );
    await cancellation;
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(0);
    expect(port.records.filter((r) => r.includes(" CANCEL "))).toHaveLength(1);
    await bridge.call("disconnect_bridge");
  });
  it("cancels a native deadline cooperatively while keeping its destination result uncertain", async () => {
    const { bridge, port } = await connected();
    const selected = await bridge.call<{ id: string }>("choose_file");
    vi.useFakeTimers();
    let sending = false;
    port.onCommand = (record) => {
      if (record.includes(" SEND ")) sending = true;
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() => expect(sending).toBe(true));
    await vi.advanceTimersByTimeAsync(420001);
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("uncertain"),
    );
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(1);
    expect(port.records.filter((r) => r.includes(" CANCEL "))).toHaveLength(1);
    await bridge.call("disconnect_bridge");
  });
  it("keeps an explicit native refusal failed instead of completed or automatically retried", async () => {
    const { bridge, port } = await connected();
    const selected = await bridge.call<{ id: string }>("choose_file");
    port.onCommand = (record) => {
      if (record.includes(" SEND "))
        port.emit({
          event: "outgoing_complete",
          transfer_id: bridge.snapshot.transfers[0].id,
          success: false,
          error: -13,
          http_status: 403,
        });
    };
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("failed"),
    );
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(1);
    await bridge.call("disconnect_bridge");
  });
});
