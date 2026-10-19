import { describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  base64,
  command,
  Lines,
  manifest,
  safeName,
  sha256,
  unbase64,
  type Event,
} from "./protocol";
import { Receiver } from "./receiver";
import { Session } from "./session";
import { WebBridge } from "./bridge";
import {
  directory,
  Directory,
  encodedName,
  offer,
  finish,
  ready,
} from "../../tests/fixtures";
import { VirtualPort } from "../../tests/virtual-port";
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
    await expect(receiver.handle(ready)).rejects.toThrow(/failed/);
    await receiver.stop();
  });
  it("withholds COMMIT on close failure and rejects chunk replays or early commit", async () => {
    const dir = await directory(),
      receiver = new Receiver(new Directory(dir.path, false, true), () => {});
    await offer(receiver);
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
    const other = new Receiver(await directory(), () => {});
    await offer(other);
    await expect(
      other.handle({
        event: "file_chunk",
        transfer_id: "OTHER",
        index: 0,
        offset: 0,
        data: "YWJj",
      }),
    ).rejects.toThrow(/identity/);
    await expect(
      other.handle({
        event: "file_begin",
        index: 16,
        size: 3,
        name_b64: encodedName("other"),
        metadata: true,
      }),
    ).rejects.toThrow();
    await other.stop();
  });
});
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
  it("closes on a missing or invalid hardware identity before accepting transfers", async () => {
    const port = new VirtualPort();
    port.hardware = "00:00:00:00:00:00";
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
  async function connected(pairing = true) {
    const dir = await directory(),
      port = new VirtualPort();
    port.pairing = pairing;
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
      hardware_id: "a0:b7:65:12:34:56",
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
  it("explicitly authorizes and revokes a fresh observed incoming peer", async () => {
    const { bridge, port } = await connected();
    expect(bridge.snapshot.bridge_info?.paired_peer).toBeNull();
    await bridge.call("pair_peer", { peer });
    expect(bridge.snapshot.bridge_info?.paired_peer).toBe(peer);
    expect(port.records.some((r) => r.includes(`PAIR ${peer} 8770`))).toBe(
      true,
    );
    await bridge.call("unpair_peer");
    expect(bridge.snapshot.bridge_info?.paired_peer).toBeNull();
    await bridge.call("disconnect_bridge");
  });
  it("rejects unobserved peers and mismatched authorization replies", async () => {
    const { bridge, port } = await connected();
    const before = port.records.length;
    await expect(
      bridge.call("pair_peer", { peer: "02:00:00:00:00:12" }),
    ).rejects.toThrow();
    expect(port.records).toHaveLength(before);
    port.reply = (_record, sequence) => ({
      event: "command_reply",
      sequence,
      ok: true,
      paired_peer: "02:00:00:00:00:12",
    });
    await expect(bridge.call("pair_peer", { peer })).rejects.toThrow(
      /mismatch/,
    );
    expect(bridge.snapshot.bridge_info?.paired_peer).toBeNull();
    await bridge.call("disconnect_bridge");
  });
  it("old firmware cannot silently bypass the incoming authorization capability", async () => {
    const { bridge, port } = await connected(false);
    const before = port.records.length;
    await expect(bridge.call("pair_peer", { peer })).rejects.toThrow(
      /firmware/,
    );
    expect(port.records).toHaveLength(before);
    await bridge.call("disconnect_bridge");
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
  it("retains every checked receipt file and waits for native confirmation", async () => {
    const { bridge, port } = await connected();
    const data = new TextEncoder().encode("abc"),
      hash = await sha256(data);
    port.emit({
      event: "transfer_begin",
      transfer_id: "MULTI-1",
      files: 2,
      total_bytes: 6,
    });
    for (const index of [0, 1])
      port.emit({
        event: "manifest_file",
        index,
        size: 3,
        name_b64: encodedName(`part-${index}.bin`),
      });
    for (const index of [0, 1]) {
      port.emit({
        event: "file_begin",
        index,
        size: 3,
        name_b64: encodedName(`part-${index}.bin`),
        metadata: false,
      });
      port.emit({ event: "file_chunk", index, offset: 0, data: base64(data) });
      port.emit({ event: "file_end", index, bytes: 3, sha256: hash });
    }
    port.emit({
      event: "transfer_ready",
      transfer_id: "MULTI-1",
      files: 2,
      total_bytes: 6,
      nonce: "a".repeat(32),
    });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0]?.state).toBe("finishing"),
    );
    expect(bridge.snapshot.transfers[0]).toMatchObject({
      name: "Incoming files",
      file_count: 2,
      done: 6,
      sha256: null,
    });
    port.emit({
      event: "transfer_complete",
      transfer_id: "MULTI-1",
      host_committed: true,
      response_written: true,
    });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("completed"),
    );
    expect(bridge.snapshot.transfers[0].files).toEqual(
      [0, 1].map((index) => ({
        name: `part-${index}.bin`,
        bytes: 3,
        sha256: hash,
        metadata: false,
      })),
    );
    expect(bridge.snapshot.transfers[0].sha256).toBe(null);
    await bridge.call("disconnect_bridge");
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
