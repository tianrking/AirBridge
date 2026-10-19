import { describe, expect, it, vi } from "vitest";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  directory,
  Directory,
  encodedName,
  offer,
  finish,
  ready,
} from "../../tests/fixtures";
import { deferred, VirtualPort } from "../../tests/virtual-port";
import { Receiver } from "./receiver";
import { Session, RECEIVE_IDLE_MS } from "./session";
import { WebBridge, RELEASE_TIMEOUT_MS } from "./bridge";
import { sha256, type Event } from "./protocol";
import type { DiskDirectory, DiskFile } from "./platform";

const peer = "02:11:22:33:44:66";
const file = new File([new Uint8Array(4097).fill(42)], "source.bin");
async function setup(
  port = new VirtualPort(),
  dir: DiskDirectory | undefined = undefined,
) {
  const folder = dir ?? (await directory());
  const choosePort = vi.fn(async () => port);
  vi.stubGlobal("window", {
    isSecureContext: true,
    showDirectoryPicker: async () => folder,
    showOpenFilePicker: async () => [{ getFile: async () => file }],
  });
  vi.stubGlobal("navigator", { serial: { requestPort: choosePort } });
  const bridge = new WebBridge();
  await bridge.call("choose_receive_folder");
  await bridge.call("connect_bridge");
  return { bridge, port, choosePort, folder };
}
async function advertise(port: VirtualPort, bridge: WebBridge) {
  port.emit({
    event: "scanner_status",
    peers: [{ mac: peer, airdrop_advertised: true, airdrop_port: 8770 }],
  });
  await vi.waitFor(() => expect(bridge.snapshot.peers).toHaveLength(1));
}
async function sending(bridge: WebBridge, port: VirtualPort) {
  await advertise(port, bridge);
  const selected = await bridge.call<{ id: string }>("choose_file");
  await bridge.call("send_file", { peer, fileId: selected.id });
  await vi.waitFor(() =>
    expect(port.records.some((r) => r.includes(" SEND "))).toBe(true),
  );
}
function outcome(
  port: VirtualPort,
  bridge: WebBridge,
  extra: Record<string, unknown> = {},
) {
  const t = bridge.snapshot.transfers[0];
  port.emit({
    event: "outgoing_complete",
    transfer_id: t.id,
    success: true,
    http_status: 200,
    bytes: t.bytes,
    sha256: t.sha256,
    ...extra,
  });
}
function incoming(port: VirtualPort) {
  port.emit({
    event: "transfer_begin",
    transfer_id: "TEST-1",
    files: 1,
    total_bytes: 3,
  });
  port.emit({
    event: "manifest_file",
    index: 0,
    size: 3,
    name_b64: encodedName("payload.bin"),
  });
  port.emit({
    event: "file_begin",
    index: 0,
    size: 3,
    name_b64: encodedName("payload.bin"),
    metadata: false,
  });
}

describe("session fault boundaries", () => {
  it("never opens an unapproved USB transport", async () => {
    const port = new VirtualPort();
    port.getInfo = () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 });
    const session = new Session(
      port,
      await directory(),
      () => {},
      () => {},
    );
    await expect(session.open()).rejects.toThrow(/native USB/);
    expect(port.openCalls).toBe(0);
    expect(port.records).toEqual([]);
  });
  it.each(["qualification_boot", "command_invalid"])(
    "fails once on %s and rejects pending work",
    async (event) => {
      const port = new VirtualPort(),
        faults: Error[] = [];
      const session = new Session(
        port,
        await directory(),
        () => {},
        (e) => faults.push(e),
      );
      await session.open();
      port.respond = false;
      const request = session.request("STATUS");
      const rejected = expect(request).rejects.toThrow(/closed/);
      port.emit({ event });
      await rejected;
      await session.close();
      expect(faults).toHaveLength(1);
      expect(port.closed).toBe(true);
      await expect(session.watch(() => true, 5000).promise).rejects.toThrow(
        /closed/,
      );
    },
  );
  it("rejects queued requests on the first deadline and never writes the next command", async () => {
    const port = new VirtualPort(),
      session = new Session(
        port,
        await directory(),
        () => {},
        () => {},
      );
    await session.open();
    vi.useFakeTimers();
    port.respond = false;
    const first = session.request("STATUS"),
      second = session.request("STATUS");
    const all = Promise.all([
      expect(first).rejects.toThrow(/uncertain/),
      expect(second).rejects.toThrow(/closed/),
    ]);
    await vi.advanceTimersByTimeAsync(5001);
    await all;
    await session.close();
    expect(port.records.filter((r) => r.includes(" STATUS "))).toHaveLength(1);
  });
});

describe("repeated ownership and duplex history", () => {
  it("completes 30 reconnect cycles with fresh handshakes and no orphan reader", async () => {
    const { bridge, port } = await setup();
    await bridge.call("disconnect_bridge");
    for (let n = 0; n < 30; n++) {
      await bridge.call("connect_bridge");
      await bridge.call("disconnect_bridge");
      expect(
        port.closed && !port.readable.locked && !port.writable.locked,
      ).toBe(true);
    }
    const hello = port.records.filter((r) => r.includes("HELLO"));
    expect(hello).toHaveLength(31);
    expect(new Set(hello.map((r) => r.split(" ")[3])).size).toBe(31);
  });
  it("does not accept wire records posing as host-verified results", async () => {
    const { bridge, port } = await setup();
    port.emit({ event: "incoming_started", transfer_id: "FAKE", bytes: 3 });
    port.emit({
      event: "received",
      transfer_id: "FAKE",
      files: [],
      directory: "not-verified",
    });
    port.emit({ event: "scanner_status", peers: [] });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(bridge.snapshot.transfers).toEqual([]);
    await bridge.call("disconnect_bridge");
  });
  it("keeps repeated native receive IDs separate and preserves a completed receive across send loss", async () => {
    const { bridge, port } = await setup();
    await sending(bridge, port);
    const hash = await sha256(new TextEncoder().encode("abc"));
    for (let n = 0; n < 2; n++) {
      incoming(port);
      port.emit({ event: "file_chunk", index: 0, offset: 0, data: "YWJj" });
      port.emit({ event: "file_end", index: 0, bytes: 3, sha256: hash });
      port.emit(ready);
      await vi.waitFor(() =>
        expect(
          port.records.filter((r) => r.startsWith("COMMIT ")),
        ).toHaveLength(n + 1),
      );
      port.emit({
        event: "transfer_complete",
        transfer_id: "TEST-1",
        host_committed: true,
        response_written: true,
      });
      await vi.waitFor(() =>
        expect(
          bridge.snapshot.transfers.filter(
            (t) => t.direction === "receive" && t.state === "completed",
          ),
        ).toHaveLength(n + 1),
      );
    }
    const received = bridge.snapshot.transfers.filter(
      (t) => t.direction === "receive",
    );
    expect(new Set(received.map((t) => t.id)).size).toBe(2);
    expect(new Set(received.map((t) => t.directory)).size).toBe(2);
    expect(received.every((t) => t.native_id === "TEST-1")).toBe(true);
    const downloaded: Blob[] = [];
    vi.stubGlobal("document", {
      createElement: () => ({ href: "", download: "", click() {} }),
    });
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        downloaded.push(blob);
        return "blob:test";
      },
      revokeObjectURL: () => {},
    });
    vi.useFakeTimers();
    for (const t of received) {
      await bridge.call("open_receive_folder", { transferId: t.id });
      expect(JSON.parse(await downloaded.at(-1)!.text()).directory).toBe(
        t.directory,
      );
    }
    await vi.advanceTimersByTimeAsync(1001);
    vi.useRealTimers();
    port.end();
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(
      bridge.snapshot.transfers
        .filter((t) => t.direction === "receive")
        .every((t) => t.state === "completed"),
    ).toBe(true);
    expect(
      bridge.snapshot.transfers.find((t) => t.direction === "send")?.state,
    ).toBe("uncertain");
  });
  it.each([
    [-1, 5],
    [2, 1],
    [0.5, 1],
    [1, 1.5],
    [1, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects malformed byte progress %s/%s", async (done, total) => {
    const { bridge, port } = await setup();
    await sending(bridge, port);
    port.emit({
      event: "outgoing_progress",
      wire_bytes: done,
      wire_total: total,
    });
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(bridge.snapshot.transfers[0].state).toBe("uncertain");
    expect(port.closed).toBe(true);
  });
});

describe("disconnect and reconnect ownership", () => {
  it.each(["end", "breakRead"] as const)(
    "retires peers after %s and revalidates the next port",
    async (mode) => {
      const { bridge, port, choosePort } = await setup();
      await advertise(port, bridge);
      port[mode]();
      await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
      expect(bridge.snapshot.peers).toEqual([]);
      expect(bridge.snapshot.can_resolve).toBe(false);
      expect(
        port.closed && !port.readable.locked && !port.writable.locked,
      ).toBe(true);
      const wrong = new VirtualPort();
      wrong.hardware = "00:00:00:00:00:00";
      choosePort.mockResolvedValueOnce(wrong);
      await expect(bridge.call("connect_bridge")).rejects.toThrow(/identity/);
      expect(wrong.closed).toBe(true);
      const next = new VirtualPort();
      choosePort.mockResolvedValueOnce(next);
      await bridge.call("connect_bridge");
      expect(bridge.snapshot.peers).toEqual([]);
      expect(next.records.filter((r) => r.includes("HELLO"))).toHaveLength(1);
      expect(
        next.records.some(
          (r) => r.includes(" SEND ") || r.includes(" RESOLVE "),
        ),
      ).toBe(false);
      await bridge.call("disconnect_bridge");
    },
  );
  it("keeps interrupted history terminal across a fresh connection", async () => {
    const { bridge, port, choosePort } = await setup();
    await sending(bridge, port);
    port.end();
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    const old = bridge.snapshot.transfers[0];
    expect(old.state).toBe("uncertain");
    const next = new VirtualPort();
    choosePort.mockResolvedValueOnce(next);
    await bridge.call("connect_bridge");
    await advertise(next, bridge);
    expect(bridge.snapshot.transfers[0].state).toBe("uncertain");
    expect(next.records.some((r) => r.includes(" SEND "))).toBe(false);
    await bridge.call("disconnect_bridge");
  });
  it("suppresses concurrent opens and cancels an unresolved chooser without opening its result", async () => {
    const { bridge, choosePort } = await setup();
    await bridge.call("disconnect_bridge");
    const choice = deferred<VirtualPort>(),
      next = new VirtualPort();
    choosePort.mockImplementationOnce(() => choice.promise);
    const opening = bridge.call("connect_bridge");
    const rejected = expect(opening).rejects.toThrow(/cancelled/);
    await expect(bridge.call("connect_bridge")).rejects.toThrow(/cleanup/);
    const closing = bridge.call("disconnect_bridge");
    choice.resolve(next);
    await rejected;
    await closing;
    expect(next.openCalls).toBe(0);
    expect(bridge.snapshot.connection).toBe("disconnected");
  });
  it("closes an actual in-flight open before releasing its owner", async () => {
    const port = new VirtualPort(),
      gate = deferred();
    port.openGate = gate.promise;
    const session = new Session(
      port,
      await directory(),
      () => {},
      () => {},
    );
    const opening = session.open();
    const rejected = expect(opening).rejects.toThrow(/closed/);
    const closing = session.close();
    gate.resolve();
    await closing;
    await rejected;
    expect(port.closed).toBe(true);
    expect(port.closeCalls).toBe(1);
    expect(port.records).toEqual([]);
  });
  it("blocks reuse after close failure and permits an explicit cleanup retry", async () => {
    const { bridge, port, choosePort } = await setup();
    port.closeFailures = 1;
    await expect(bridge.call("disconnect_bridge")).rejects.toThrow(
      /close failure/,
    );
    expect(bridge.snapshot.connection).toBe("cleanup_failed");
    const calls = choosePort.mock.calls.length;
    await expect(bridge.call("connect_bridge")).rejects.toThrow(/cleanup/);
    expect(choosePort.mock.calls.length).toBe(calls);
    await bridge.call("disconnect_bridge");
    expect(port.closed).toBe(true);
    const next = new VirtualPort();
    choosePort.mockResolvedValueOnce(next);
    await bridge.call("connect_bridge");
    await bridge.call("disconnect_bridge");
  });
  it("times out stuck cleanup without claiming port release", async () => {
    const { bridge, port, choosePort } = await setup();
    vi.useFakeTimers();
    const gate = deferred();
    port.closeGate = gate.promise;
    const closing = bridge.call("disconnect_bridge");
    const rejected = expect(closing).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(RELEASE_TIMEOUT_MS + 1);
    await rejected;
    expect(bridge.snapshot.connection).toBe("cleanup_failed");
    await expect(bridge.call("connect_bridge")).rejects.toThrow(/cleanup/);
    expect(choosePort).toHaveBeenCalledTimes(1);
    gate.resolve();
    await bridge.call("disconnect_bridge");
    expect(port.closed).toBe(true);
  });
});

describe("cancellation races and missing progress", () => {
  it.each([true, false])(
    "keeps cancellation pending until the authoritative result (success=%s)",
    async (success) => {
      const { bridge, port } = await setup();
      await sending(bridge, port);
      await Promise.all([
        bridge.call("cancel_transfer"),
        bridge.call("cancel_transfer"),
      ]);
      port.emit({ event: "outgoing_stage", stage: "uploading" });
      port.emit({ event: "outgoing_progress", wire_bytes: 8, wire_total: 10 });
      await vi.waitFor(() => expect(bridge.snapshot.transfers[0].done).toBe(8));
      expect(bridge.snapshot.transfers[0].state).toBe("cancelling");
      outcome(
        port,
        bridge,
        success ? {} : { success: false, http_status: 0, error: -125 },
      );
      await vi.waitFor(() =>
        expect(bridge.snapshot.transfers[0].state).toBe(
          success ? "completed" : "cancelled",
        ),
      );
      expect(port.records.filter((r) => r.includes(" CANCEL "))).toHaveLength(
        1,
      );
      expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(1);
      await bridge.call("disconnect_bridge");
    },
  );
  it("does not turn a cancel ACK followed by link loss into a confirmed cancellation", async () => {
    const { bridge, port } = await setup();
    await sending(bridge, port);
    await bridge.call("cancel_transfer");
    port.end();
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(bridge.snapshot.transfers[0].state).toBe("uncertain");
  });
  it("settles a name lookup on disconnect without issuing a later resolver command", async () => {
    const { bridge, port } = await setup();
    await advertise(port, bridge);
    await bridge.call("resolve_peer", { peer });
    await vi.waitFor(() =>
      expect(port.records.some((r) => r.includes(" RESOLVE "))).toBe(true),
    );
    await bridge.call("disconnect_bridge");
    expect(bridge.snapshot.resolving_peer).toBe(null);
    expect(port.records.filter((r) => r.includes(" RESOLVE "))).toHaveLength(1);
  });
  it("cancels a blocked source read and prevents its late result from staging", async () => {
    const { bridge, port } = await setup();
    await advertise(port, bridge);
    const gate = deferred<ArrayBuffer>(),
      source = new File(["abc"], "slow.bin");
    Object.defineProperty(source, "arrayBuffer", { value: () => gate.promise });
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      async () => [{ getFile: async () => source }];
    const chosen = await bridge.call<{ id: string }>("choose_file");
    await bridge.call("send_file", { peer, fileId: chosen.id });
    expect(bridge.snapshot.transfers[0].state).toBe("preparing");
    await bridge.call("cancel_transfer");
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("cancelled"),
    );
    await bridge.call("disconnect_bridge");
    gate.resolve(new TextEncoder().encode("abc").buffer);
    await Promise.resolve();
    expect(
      port.records.some((r) => r.includes(" BEGIN ") || r.includes(" SEND ")),
    ).toBe(false);
  });
  it("cleans rejected staging once without retrying the source", async () => {
    const { bridge, port } = await setup();
    await advertise(port, bridge);
    port.reply = (record, sequence) => ({
      event: "command_reply",
      sequence,
      ok: !record.includes(" META "),
      reason: "staging rejected",
    });
    const selected = await bridge.call<{ id: string }>("choose_file");
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0].state).toBe("failed"),
    );
    expect(port.records.filter((r) => r.includes(" CANCEL "))).toHaveLength(1);
    expect(port.records.filter((r) => r.includes(" BEGIN "))).toHaveLength(1);
    expect(port.records.some((r) => r.includes(" SEND "))).toBe(false);
    await bridge.call("disconnect_bridge");
  });
  it("fails closed on write errors and does not replay the source", async () => {
    const { bridge, port } = await setup();
    port.beforeWrite = async (record) => {
      if (record.includes(" DATA "))
        throw new Error("Injected serial write failure");
    };
    await advertise(port, bridge);
    const selected = await bridge.call<{ id: string }>("choose_file");
    await bridge.call("send_file", { peer, fileId: selected.id });
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(port.closed).toBe(true);
    expect(port.records.filter((r) => r.includes(" SEND "))).toHaveLength(0);
    expect(bridge.snapshot.transfers[0].state).not.toBe("completed");
  });
  it("expires a stalled receive even while scanner reports continue", async () => {
    const { bridge, port } = await setup();
    incoming(port);
    await vi.waitFor(() =>
      expect(bridge.snapshot.transfers[0]?.state).toBe("receiving"),
    );
    vi.useFakeTimers();
    // Arm a fresh receive deadline using a legitimate chunk, then unrelated scans.
    port.emit({ event: "file_chunk", index: 0, offset: 0, data: "YWJj" });
    await vi.waitFor(() => expect(bridge.snapshot.transfers[0].done).toBe(3));
    for (let n = 0; n < 5; n++) {
      await vi.advanceTimersByTimeAsync(10000);
      port.emit({ event: "scanner_status", peers: [] });
    }
    await vi.advanceTimersByTimeAsync(10001);
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(bridge.snapshot.transfers[0].state).toBe("uncertain");
    expect(port.records.some((r) => r.startsWith("COMMIT"))).toBe(false);
    expect(port.closed).toBe(true);
    expect(RECEIVE_IDLE_MS).toBe(60000);
  });
});

class FaultDirectory implements DiskDirectory {
  name: string;
  constructor(
    readonly inner: Directory,
    readonly fault: (action: string, name: string) => Promise<void> | void,
  ) {
    this.name = inner.name;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    return new FaultDirectory(
      await this.inner.getDirectoryHandle(name, options),
      this.fault,
    );
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DiskFile> {
    const handle = await this.inner.getFileHandle(name, options),
      fault = this.fault;
    return {
      name,
      async getFile() {
        await fault("read", name);
        return handle.getFile();
      },
      async createWritable() {
        await fault("create", name);
        const stream = await handle.createWritable();
        return {
          async write(data) {
            await fault("write", name);
            await stream.write(data);
          },
          async close() {
            await fault("close", name);
            await stream.close();
            await fault("after_close", name);
          },
          abort: () => stream.abort(),
        };
      },
    };
  }
}
describe("fail-closed receive and saved-data verification", () => {
  it.each(["create", "write", "close", "read"])(
    "withholds completion and rejects later records after file %s failure",
    async (action) => {
      const root = await directory(),
        events: Event[] = [];
      const disk = new FaultDirectory(root, (a, name) => {
        if (a === action && name !== "airbridge-receipt.json")
          throw new Error(`Injected file ${action} failure`);
      });
      const receiver = new Receiver(disk, (e) => events.push(e));
      await expect(
        (async () => {
          await offer(receiver);
          await finish(receiver);
          await receiver.handle(ready);
        })(),
      ).rejects.toThrow(/Injected/);
      await expect(receiver.handle(ready)).rejects.toThrow(/failed/);
      expect(events.find((e) => e.event === "incoming_failed")).toMatchObject({
        uncertain: false,
      });
      expect(events.some((e) => e.event === "received")).toBe(false);
      await receiver.stop();
    },
  );
  it.each(["receiving", "files_verified", "completed"])(
    "withholds receipt %s success when receipt close fails",
    async (status) => {
      const root = await directory(),
        events: Event[] = [];
      let count = 0;
      const nth =
        ["receiving", "files_verified", "completed"].indexOf(status) + 1;
      const disk = new FaultDirectory(root, (action, name) => {
        if (
          name === "airbridge-receipt.json" &&
          action === "close" &&
          ++count === nth
        )
          throw new Error("Injected receipt close failure");
      });
      const receiver = new Receiver(disk, (e) => events.push(e));
      await expect(
        (async () => {
          await offer(receiver);
          await finish(receiver);
          await receiver.handle(ready);
          await receiver.handle({
            event: "transfer_complete",
            transfer_id: "TEST-1",
            host_committed: true,
            response_written: true,
          });
        })(),
      ).rejects.toThrow(/receipt close/);
      expect(events.some((e) => e.event === "received")).toBe(false);
      expect(events.find((e) => e.event === "incoming_failed")).toMatchObject({
        uncertain: status === "completed",
      });
      await receiver.stop();
    },
  );
  it.each(
    ["create", "write", "read"].flatMap((action) =>
      ["receiving", "files_verified", "completed"].map((status) => ({
        action,
        status,
      })),
    ),
  )(
    "rejects receipt $action failure during $status",
    async ({ action, status }) => {
      const root = await directory(),
        events: Event[] = [];
      let count = 0;
      const nth =
        ["receiving", "files_verified", "completed"].indexOf(status) + 1;
      const disk = new FaultDirectory(root, (a, name) => {
        if (
          name === "airbridge-receipt.json" &&
          a === action &&
          ++count === nth
        )
          throw new Error(`Injected receipt ${action} failure`);
      });
      const receiver = new Receiver(disk, (e) => events.push(e));
      await expect(
        (async () => {
          await offer(receiver);
          await finish(receiver);
          await receiver.handle(ready);
          await receiver.handle({
            event: "transfer_complete",
            transfer_id: "TEST-1",
            host_committed: true,
            response_written: true,
          });
        })(),
      ).rejects.toThrow(/Injected receipt/);
      expect(events.some((e) => e.event === "received")).toBe(false);
      expect(events.find((e) => e.event === "incoming_failed")).toMatchObject({
        uncertain: status === "completed",
      });
      await expect(receiver.handle(ready)).rejects.toThrow(/failed/);
      await receiver.stop();
    },
  );
  it("detects persisted receipt corruption instead of trusting a resolved close", async () => {
    const root = await directory(),
      events: Event[] = [];
    const disk = new FaultDirectory(root, async (action, name) => {
      if (action === "after_close" && name === "airbridge-receipt.json") {
        const dirs = await readdir(root.path);
        await writeFile(join(root.path, dirs[0], name), "{}");
      }
    });
    const receiver = new Receiver(disk, (e) => events.push(e));
    await expect(offer(receiver)).rejects.toThrow(/receipt readback/);
    expect(events.some((e) => e.event === "received")).toBe(false);
    await receiver.stop();
  });
  it.each([false, true])(
    "rechecks actual files before %s publication",
    async (afterCommit) => {
      const root = await directory(),
        events: Event[] = [];
      const receiver = new Receiver(root, (e) => events.push(e));
      await offer(receiver);
      await finish(receiver);
      if (afterCommit) await receiver.handle(ready);
      const [dir] = await readdir(root.path);
      await writeFile(join(root.path, dir, "測試.bin"), "xyz");
      await expect(
        receiver.handle(
          afterCommit
            ? {
                event: "transfer_complete",
                transfer_id: "TEST-1",
                host_committed: true,
                response_written: true,
              }
            : ready,
        ),
      ).rejects.toThrow(/SHA256/);
      const receipt = JSON.parse(
        await readFile(join(root.path, dir, "airbridge-receipt.json"), "utf8"),
      );
      expect(receipt.status).toBe(afterCommit ? "files_verified" : "receiving");
      expect(events.find((e) => e.event === "incoming_failed")).toMatchObject({
        uncertain: afterCommit,
      });
      expect(events.some((e) => e.event === "received")).toBe(false);
      await receiver.stop();
    },
  );
  it("keeps native response failure terminal and does not accept a later success for that job", async () => {
    const receiver = new Receiver(await directory(), () => {});
    await offer(receiver);
    await finish(receiver);
    await receiver.handle(ready);
    await expect(
      receiver.handle({
        event: "transfer_complete",
        transfer_id: "TEST-1",
        host_committed: true,
        response_written: false,
      }),
    ).rejects.toThrow(/confirm/);
    await expect(
      receiver.handle({
        event: "transfer_complete",
        transfer_id: "TEST-1",
        host_committed: true,
        response_written: true,
      }),
    ).rejects.toThrow(/failed/);
    await receiver.stop();
  });
  it("does not ACK a write that resolves after receiver shutdown", async () => {
    const root = await directory(),
      gate = deferred(),
      events: Event[] = [];
    const disk = new FaultDirectory(root, (a, n) =>
      a === "write" && n !== "airbridge-receipt.json"
        ? gate.promise
        : undefined,
    );
    const receiver = new Receiver(disk, (e) => events.push(e));
    await offer(receiver);
    const write = receiver.handle({
      event: "file_chunk",
      index: 0,
      offset: 0,
      data: "YWJj",
    });
    const rejected = expect(write).rejects.toThrow(/stopped/);
    await receiver.stop();
    gate.resolve();
    await rejected;
    expect(
      events.some(
        (e) => e.event === "incoming_progress" || e.event === "received",
      ),
    ).toBe(false);
  });
  it("propagates storage failure through the serial owner and keeps it failed after recovery", async () => {
    const root = await directory();
    const disk = new FaultDirectory(root, (action, name) => {
      if (action === "close" && name !== "airbridge-receipt.json")
        throw new Error("Disk full at close");
    });
    const { bridge, port } = await setup(new VirtualPort(), disk);
    incoming(port);
    port.emit({ event: "file_chunk", index: 0, offset: 0, data: "YWJj" });
    port.emit({
      event: "file_end",
      index: 0,
      bytes: 3,
      sha256: await sha256(new TextEncoder().encode("abc")),
    });
    await vi.waitFor(() => expect(bridge.snapshot.connection).toBe("error"));
    expect(bridge.snapshot.transfers[0]).toMatchObject({ state: "failed" });
    expect(bridge.snapshot.transfers[0].error).toContain("Disk full");
    expect(port.records.some((r) => r.startsWith("COMMIT"))).toBe(false);
  });
});
