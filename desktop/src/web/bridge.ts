import {
  terminal,
  type SelectedFile,
  type Snapshot,
  type Transfer,
  type TransferFile,
} from "../types";
import {
  base64,
  check,
  digest,
  mac,
  manifest,
  MAX_SEND,
  nativeName,
  sha256,
  type Event,
} from "./protocol";
import {
  supportIssue,
  type BrowserPlatform,
  type DiskDirectory,
  type SerialAPI,
} from "./platform";
import { Session } from "./session";
export const RELEASE_TIMEOUT_MS = 5000;
function interruptible<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new Error("Source preparation cancelled"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Source preparation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export class WebBridge {
  snapshot: Snapshot = {
    revision: 0,
    can_resolve: false,
    resolving_peer: null,
    connection: "disconnected",
    radio_mac: null,
    peers: [],
    transfers: [],
    receive_directory: "",
    error: null,
  };
  private listeners = new Set<() => void>();
  private directory?: DiskDirectory;
  private selected?: { id: string; file: Blob & { name: string } };
  private names = new Map<string, string>();
  private session?: Session;
  private operation: "send" | "resolve" | "pair" | null = null;
  private operationAbort?: AbortController;
  private cancelRequested = false;
  private cancelTask?: Promise<Event>;
  private nativeStarted = false;
  private outgoingId: string | null = null;
  private running?: Promise<void>;
  private incomingParts = new Map<string, number>();
  private receipts = new Map<string, Event>();
  private expiry?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private connecting = false;
  private opening?: Promise<void>;
  private cleanup?: Promise<void>;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish() {
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      peers: this.snapshot.peers.map((p) => ({ ...p })),
      transfers: this.snapshot.transfers.map((t) => ({ ...t })),
    };
    for (const fn of this.listeners) fn();
  }
  private outgoing() {
    return this.snapshot.transfers.find((t) => t.id === this.outgoingId);
  }
  private incoming(id: unknown) {
    return this.snapshot.transfers.find(
      (t) =>
        t.direction === "receive" &&
        (t.native_id ?? t.id) === id &&
        !terminal(t.state),
    );
  }
  private start(e: Event, send: boolean) {
    const transfer: Transfer = {
      id: send ? String(e.transfer_id) : crypto.randomUUID(),
      native_id: String(e.transfer_id),
      name: String(e.name ?? "Incoming files"),
      direction: send ? "send" : "receive",
      peer: send ? String(e.peer) : null,
      peer_name: send ? (this.names.get(String(e.peer)) ?? null) : null,
      file_count: send ? 1 : Number(e.files ?? 1),
      started: Date.now(),
      files: [],
      state: send ? "preparing" : "receiving",
      bytes: Number(e.bytes),
      done: 0,
      progress_total: Number(e.bytes),
      sha256: typeof e.sha256 === "string" ? e.sha256 : null,
      directory: typeof e.directory === "string" ? e.directory : null,
      error: null,
      updated: Date.now(),
    };
    this.snapshot.transfers = [transfer, ...this.snapshot.transfers].slice(
      0,
      100,
    );
  }
  private setName(peer: unknown, name: string) {
    check(
      typeof peer === "string" && mac(peer),
      "Invalid native name identity",
    );
    this.names.set(peer, name);
    if (this.names.size > 128)
      this.names.delete(this.names.keys().next().value!);
    this.snapshot.peers = this.snapshot.peers.map((p) =>
      p.mac === peer ? { ...p, name, name_source: "airdrop_discover" } : p,
    );
    for (const t of this.snapshot.transfers)
      if (t.peer === peer) t.peer_name = name;
  }
  private event = (e: Event) => {
    const outgoing = this.outgoing();
    switch (e.event) {
      case "scanner_status":
        if (Array.isArray(e.peers))
          this.snapshot.peers = e.peers
            .slice(0, 64)
            .flatMap((value: unknown) => {
              if (!value || typeof value !== "object") return [];
              const p = value as Record<string, unknown>;
              if (typeof p.mac !== "string" || !mac(p.mac)) return [];
              const port = Number(p.airdrop_port);
              const name = this.names.get(p.mac) ?? null;
              return [
                {
                  mac: p.mac,
                  name,
                  name_source: name ? "airdrop_discover" : null,
                  advertised:
                    p.airdrop_advertised === true &&
                    Number.isInteger(port) &&
                    port > 0 &&
                    port <= 65535,
                  port:
                    Number.isInteger(port) && port > 0 && port <= 65535
                      ? port
                      : 0,
                  rssi:
                    typeof p.rssi === "number" &&
                    Number.isFinite(p.rssi) &&
                    p.rssi >= -127 &&
                    p.rssi <= 0
                      ? p.rssi
                      : null,
                  observation: {
                    host_label:
                      typeof p.host_label === "string" ? p.host_label : null,
                    service_instance:
                      typeof p.service_instance === "string"
                        ? p.service_instance
                        : null,
                    channel6_mask:
                      typeof p.channel6_mask === "number" &&
                      Number.isInteger(p.channel6_mask) &&
                      p.channel6_mask >= 0 &&
                      p.channel6_mask <= 65535
                        ? p.channel6_mask
                        : null,
                    root_metric:
                      typeof p.root_metric === "number" &&
                      Number.isSafeInteger(p.root_metric) &&
                      p.root_metric >= 0
                        ? p.root_metric
                        : null,
                    has_sync:
                      typeof p.has_sync === "boolean" ? p.has_sync : null,
                    has_election:
                      typeof p.has_election === "boolean"
                        ? p.has_election
                        : null,
                  },
                  last_seen: Date.now(),
                },
              ];
            });
        break;
      case "peer_identity":
        if (
          e.error === 0 &&
          typeof e.display_name === "string" &&
          e.display_name &&
          new TextEncoder().encode(e.display_name).length <= 256
        )
          this.setName(e.mac, e.display_name);
        break;
      case "peer_resolved":
        this.setName(e.mac, nativeName(String(e.name_b64)));
        break;
      case "outgoing_peer":
        if (outgoing)
          this.setName(outgoing.peer, nativeName(String(e.name_b64)));
        break;
      case "outgoing_stage":
        if (outgoing && !terminal(outgoing.state)) {
          outgoing.state = this.cancelRequested
            ? "cancelling"
            : e.stage === "awaiting_acceptance"
              ? "waiting"
              : ["accepted", "uploading"].includes(String(e.stage))
                ? "sending"
                : "connecting";
          outgoing.updated = Date.now();
          outgoing.done = 0;
          outgoing.progress_total = 0;
        }
        break;
      case "outgoing_progress":
        if (outgoing && !terminal(outgoing.state)) {
          check(
            typeof e.wire_bytes === "number" &&
              Number.isSafeInteger(e.wire_bytes) &&
              typeof e.wire_total === "number" &&
              Number.isSafeInteger(e.wire_total) &&
              e.wire_bytes >= 0 &&
              e.wire_bytes <= e.wire_total,
            "Invalid upload progress",
          );
          outgoing.updated = Date.now();
          outgoing.done = e.wire_bytes;
          outgoing.progress_total = e.wire_total;
          outgoing.state = this.cancelRequested
            ? "cancelling"
            : outgoing.done === outgoing.progress_total
              ? "finishing"
              : "sending";
        }
        break;
      case "outgoing_complete":
        check(
          outgoing && e.transfer_id === outgoing.id,
          "Unexpected native transfer completion",
        );
        // The sender waiter verifies success, bytes and digest before publishing.
        break;
      case "incoming_started":
        this.incomingParts.clear();
        this.start(e, false);
        break;
      case "incoming_file": {
        const t = this.incoming(e.transfer_id);
        if (t) {
          if ((t.file_count ?? 1) <= 1) t.name = String(e.name);
          t.updated = Date.now();
        }
        break;
      }
      case "incoming_progress": {
        const t = this.incoming(e.transfer_id);
        if (t) {
          this.incomingParts.set(String(e.name), Number(e.bytes));
          t.done = [...this.incomingParts.values()].reduce((a, b) => a + b, 0);
          t.updated = Date.now();
        }
        break;
      }
      case "incoming_failed": {
        let t = this.incoming(e.transfer_id);
        if (!t) {
          this.start(e, false);
          t = this.incoming(e.transfer_id);
        }
        if (t && !terminal(t.state)) {
          t.state = e.uncertain === true ? "uncertain" : "failed";
          t.error = `${e.phase ?? "receive"}: ${e.message}`;
          t.updated = Date.now();
        }
        break;
      }
      case "incoming_verifying": {
        const t = this.incoming(e.transfer_id);
        if (t) {
          t.state = "finishing";
          t.updated = Date.now();
        }
        break;
      }
      case "received": {
        const t = this.incoming(e.transfer_id);
        if (t) this.receipts.set(t.id, e);
        if (this.receipts.size > 100)
          this.receipts.delete(this.receipts.keys().next().value!);
        if (t) {
          t.state = "completed";
          t.done = t.bytes;
          t.directory = String(e.directory);
          t.files = (e.files as TransferFile[]).map((f) => ({ ...f }));
          t.file_count = t.files.filter((f) => !f.metadata).length;
          t.sha256 =
            t.file_count === 1
              ? (t.files.find((f) => !f.metadata)?.sha256 ?? null)
              : null;
          t.updated = Date.now();
        }
        break;
      }
      default:
        return;
    }
    this.publish();
  };
  private retire(error: string) {
    clearInterval(this.expiry);
    this.operationAbort?.abort();
    this.snapshot.can_resolve = false;
    this.snapshot.resolving_peer = null;
    this.snapshot.peers = [];
    for (const t of this.snapshot.transfers)
      if (!terminal(t.state)) {
        t.updated = Date.now();
        t.state = "uncertain";
        t.error = error;
      }
  }
  private failure = (error: Error) => {
    this.epoch++;
    this.snapshot.error = error.message;
    this.retire(error.message);
    this.snapshot.connection = "recovering";
    this.publish();
    void this.release("error").catch(() => {});
  };
  private async release(next: "error" | "disconnected") {
    if (this.cleanup) return this.cleanup;
    const session = this.session;
    const task = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (session)
          await Promise.race([
            session.close(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Serial cleanup timed out. Port ownership is unconfirmed; retry disconnect before reconnecting",
                    ),
                  ),
                RELEASE_TIMEOUT_MS,
              );
            }),
          ]);
        if (this.session === session) this.session = undefined;
        await this.running;
        this.operation = null;
        this.snapshot.connection = next;
      } catch (error) {
        this.snapshot.connection = "cleanup_failed";
        this.snapshot.error = `Port release not confirmed: ${String(error)}`;
        throw error;
      } finally {
        clearTimeout(timer);
        this.publish();
      }
    })();
    this.cleanup = task;
    try {
      await task;
    } finally {
      if (this.cleanup === task) this.cleanup = undefined;
    }
  }
  async call<T>(verb: string, args: Record<string, unknown> = {}): Promise<T> {
    switch (verb) {
      case "dismiss_error":
        this.snapshot.error = null;
        this.publish();
        return null as T;
      case "choose_receive_folder": {
        check(
          !this.session && !this.operation && !this.connecting && !this.cleanup,
          "Disconnect before changing the receive folder",
        );
        const pick = (window as BrowserPlatform).showDirectoryPicker;
        check(
          pick,
          "Directory access is unavailable; use desktop Chrome or Edge",
        );
        this.directory = await pick.call(window, {
          mode: "readwrite",
          id: "airbridge-receive",
        });
        this.snapshot.receive_directory = this.directory.name;
        this.publish();
        return this.directory.name as T;
      }
      case "choose_file": {
        check(!this.operation, "Wait for the current operation");
        const pick = (window as BrowserPlatform).showOpenFilePicker;
        check(pick, "File selection is unavailable");
        const [handle] = await pick.call(window, { multiple: false });
        const file = await handle.getFile();
        check(file.size <= MAX_SEND, "Sending is limited to 1 MiB per file");
        // Validate name before retaining bytes or presenting a selectable source.
        manifest(file.name, file.size, "000000000000", "VALIDATE");
        const id = crypto.randomUUID();
        this.selected = { id, file };
        return { id, name: file.name, bytes: file.size } as SelectedFile as T;
      }
      case "connect_bridge":
        await this.connect();
        return null as T;
      case "disconnect_bridge":
        await this.disconnect();
        return null as T;
      case "pair_peer":
      case "unpair_peer": {
        check(
          this.session &&
            this.snapshot.connection === "connected" &&
            this.session.capabilities?.pairing === true,
          "Update the bridge firmware to enable peer authorization",
        );
        check(
          !this.operation &&
            !this.snapshot.transfers.some((t) => !terminal(t.state)),
          "Wait for the active operation before changing receive permissions",
        );
        const peer = verb === "pair_peer" ? this.endpoint(args.peer) : null;
        this.operation = "pair";
        try {
          const reply = await this.session.request(
            peer ? `PAIR ${peer.mac} ${peer.port}` : "UNPAIR",
          );
          check(
            reply.paired_peer === (peer?.mac ?? "00:00:00:00:00:00"),
            "Peer authorization reply mismatch",
          );
          if (this.snapshot.bridge_info)
            this.snapshot.bridge_info.paired_peer = peer?.mac ?? null;
          this.publish();
        } finally {
          this.operation = null;
        }
        return null as T;
      }
      case "resolve_peer": {
        const peer = this.endpoint(args.peer);
        check(
          !this.operation && this.session?.capabilities?.resolve === true,
          "Name resolution unavailable or an operation is active",
        );
        this.operation = "resolve";
        this.snapshot.resolving_peer = peer.mac;
        this.publish();
        this.running = this.resolve(peer.mac, peer.port);
        return null as T;
      }
      case "send_file": {
        const peer = this.endpoint(args.peer);
        check(
          !this.operation &&
            this.selected &&
            this.selected.id === args.fileId &&
            this.session,
          "File selection expired or another operation is active",
        );
        this.operation = "send";
        this.operationAbort = new AbortController();
        this.cancelRequested = false;
        this.cancelTask = undefined;
        this.nativeStarted = false;
        const file = this.selected.file;
        this.selected = undefined;
        this.running = this.send(file, peer.mac, peer.port);
        return null as T;
      }
      case "cancel_transfer":
        check(
          this.operation === "send" && this.session,
          "No outgoing transfer to cancel",
        );
        if (
          this.cancelRequested ||
          (this.outgoing() && terminal(this.outgoing()!.state))
        )
          return null as T;
        this.cancelRequested = true;
        if (this.outgoing()) {
          this.outgoing()!.state = "cancelling";
          this.outgoing()!.updated = Date.now();
        }
        this.publish();
        if (!this.nativeStarted) this.operationAbort?.abort();
        await this.cancelNative(this.session);
        return null as T;
      case "open_receive_folder": {
        const receipt = this.receipts.get(String(args.transferId));
        check(receipt, "No completed receive receipt is available");
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(receipt, null, 2)], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `AirBridge-${receipt.transfer_id}.receipt.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return null as T;
      }
      default:
        throw new Error(`Unsupported browser command: ${verb}`);
    }
  }
  private endpoint(value: unknown) {
    check(
      this.snapshot.connection === "connected" && typeof value === "string",
      "Connect a bridge first",
    );
    const peer = this.snapshot.peers.find(
      (p) =>
        p.mac === value && p.advertised && Date.now() - p.last_seen < 15000,
    );
    check(
      peer,
      "Recipient advertisement expired; wait for a fresh advertisement",
    );
    return peer;
  }
  private connect() {
    check(
      !this.connecting && !this.cleanup && !this.session && !this.operation,
      "Disconnect and finish port cleanup before reconnecting",
    );
    this.connecting = true;
    const epoch = ++this.epoch;
    const task = this.openConnection(epoch).finally(() => {
      this.connecting = false;
      if (this.opening === task) this.opening = undefined;
    });
    this.opening = task;
    return task;
  }
  private async openConnection(epoch: number) {
    check(!supportIssue(), supportIssue() ?? "Unsupported browser");
    check(
      this.directory,
      "Choose a receive folder before connecting (the button is in Receive or Settings)",
    );
    const api = (navigator as Navigator & { serial: SerialAPI }).serial;
    // Must remain in the initiating click's user-activation scope.
    const port = await api.requestPort({
      filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }],
    });
    check(epoch === this.epoch, "Connection selection was cancelled");
    this.snapshot.connection = "connecting";
    this.snapshot.error = null;
    this.publish();
    const session = new Session(
      port,
      this.directory,
      (e) => {
        if (this.session === session && epoch === this.epoch) this.event(e);
      },
      (error) => {
        if (this.session === session && epoch === this.epoch)
          this.failure(error);
      },
    );
    this.session = session;
    try {
      const caps = await session.open();
      check(epoch === this.epoch, "Connection attempt was cancelled");
      this.names.clear();
      this.snapshot.peers = [];
      this.snapshot.connection = "connected";
      this.snapshot.radio_mac = String(caps.radio_mac);
      this.snapshot.can_resolve = caps.resolve === true;
      this.snapshot.bridge_info = {
        pairing: caps.pairing === true,
        protocol: typeof caps.protocol === "number" ? caps.protocol : null,
        max_file: typeof caps.max_file === "number" ? caps.max_file : null,
        chunk_bytes:
          typeof caps.chunk_bytes === "number" ? caps.chunk_bytes : null,
        hardware_id:
          typeof caps.hardware_id === "string" ? caps.hardware_id : null,
        usb_serial: null,
        port: null,
        paired_peer:
          typeof caps.paired_peer === "string" &&
          caps.paired_peer !== "00:00:00:00:00:00"
            ? caps.paired_peer
            : null,
        connected_at: Date.now(),
      };
      clearInterval(this.expiry);
      this.expiry = setInterval(() => {
        if (
          this.snapshot.peers.some(
            (p) => p.advertised && Date.now() - p.last_seen >= 15000,
          )
        ) {
          this.snapshot.peers = this.snapshot.peers.map((p) => ({
            ...p,
            advertised: p.advertised && Date.now() - p.last_seen < 15000,
          }));
          this.publish();
        }
      }, 1000);
      this.publish();
    } catch (e) {
      if (epoch === this.epoch) {
        this.snapshot.error = e instanceof Error ? e.message : String(e);
        this.retire(this.snapshot.error);
        this.snapshot.connection = "recovering";
        this.publish();
        await this.release("error").catch(() => {});
      }
      throw e;
    }
  }
  private async disconnect() {
    this.epoch++;
    this.retire("Disconnected before native completion");
    this.snapshot.connection = "disconnecting";
    this.publish();
    // If the chooser is still open, its eventual result is invalidated above.
    if (this.opening) {
      if (this.session) await this.release("disconnected");
      await this.opening.catch(() => {});
    }
    await this.release("disconnected");
  }
  private async resolve(peer: string, port: number) {
    const session = this.session!;
    const result = session.watch(
      (e) => e.event === "resolution_complete" && e.mac === peer,
      90000,
    );
    try {
      await session.request(`RESOLVE ${peer} ${port}`);
      const e = await result.promise;
      check(
        e.error === 0 && e.http_status === 200,
        `Name lookup failed (error ${e.error}, HTTP ${e.http_status})`,
      );
    } catch (e) {
      this.snapshot.error = String(e);
    } finally {
      result.dispose();
      this.snapshot.resolving_peer = null;
      this.operation = null;
      this.publish();
    }
  }
  private cancelNative(session: Session) {
    return (this.cancelTask ??= Promise.resolve().then(() =>
      session.request("CANCEL"),
    ));
  }
  private async send(
    file: Blob & { name: string },
    peer: string,
    port: number,
  ) {
    const session = this.session!;
    const id = crypto.randomUUID().toUpperCase();
    this.outgoingId = id;
    let transfer: Transfer | undefined;
    let began = false;
    const signal = this.operationAbort!.signal;
    this.start(
      {
        event: "outgoing_started",
        transfer_id: id,
        name: file.name,
        peer,
        bytes: file.size,
      },
      true,
    );
    transfer = this.outgoing();
    this.publish();
    try {
      const data = new Uint8Array(
        await interruptible(file.arrayBuffer(), signal),
      );
      check(
        data.length <= Number(session.capabilities!.max_file),
        "Source exceeds the connected firmware's staging limit",
      );
      const hash = await interruptible(sha256(data), signal);
      check(this.session === session, "Session ended before source staging");
      const metadata = manifest(
        file.name,
        data.length,
        String(session.capabilities!.radio_mac).replaceAll(":", ""),
        id,
      );
      transfer = this.outgoing();
      check(
        transfer && !terminal(transfer.state),
        "Transfer ended before staging",
      );
      transfer.sha256 = hash;
      this.publish();
      check(!this.cancelRequested, "Staging cancelled");
      await session.request(
        `BEGIN ${data.length} ${metadata.length} ${hash} ${peer} ${port}`,
      );
      began = true;
      for (const [verb, bytes] of [
        ["META", metadata],
        ["DATA", data],
      ] as const) {
        const chunkSize = Number(session.capabilities!.chunk_bytes);
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          check(!this.cancelRequested, "Staging cancelled");
          const chunk = bytes.subarray(offset, offset + chunkSize);
          const ack = await session.request(
            `${verb} ${offset} ${base64(chunk)}`,
          );
          check(
            ack.offset === offset + chunk.length,
            "Staging acknowledgement offset mismatch",
          );
          if (
            verb === "DATA" &&
            (offset === 0 ||
              offset + chunk.length === data.length ||
              (offset % 16384) + chunk.length >= 16384)
          ) {
            transfer = this.outgoing();
            if (transfer) {
              transfer.updated = Date.now();
              transfer.done = offset + chunk.length;
              this.publish();
            }
          }
        }
      }
      check(!this.cancelRequested, "Staging cancelled");
      const completion = session.watch(
        (e) => e.event === "outgoing_complete" && e.transfer_id === id,
        420000,
      );
      this.nativeStarted = true;
      let outcome: Event;
      try {
        await session.request("SEND");
        outcome = await completion.promise;
      } catch (error) {
        // Stop an unresolved native operation cooperatively; never resend it.
        if (this.session === session && !this.cancelRequested) {
          this.cancelRequested = true;
          await this.cancelNative(session).catch(() => {});
        }
        throw error;
      } finally {
        completion.dispose();
      }
      transfer = this.outgoing();
      check(transfer, "Missing outgoing state");
      if (outcome.success !== true || outcome.http_status !== 200) {
        transfer.state = outcome.error === -125 ? "cancelled" : "failed";
        transfer.error = `Native AirDrop failed (error ${outcome.error}, HTTP ${outcome.http_status}); no automatic resend`;
        if (transfer.state === "cancelled") transfer.error = null;
        else this.snapshot.error = transfer.error;
        return;
      }
      check(
        outcome.bytes === data.length &&
          digest(String(outcome.sha256)) &&
          outcome.sha256 === hash,
        "Native completion differs from the staged file",
      );
      transfer.state = "completed";
      transfer.done = transfer.bytes;
      transfer.progress_total = transfer.bytes;
    } catch (e) {
      if (began && !this.nativeStarted && this.session === session)
        await this.cancelNative(session).catch(() => {});
      transfer = this.outgoing();
      if (transfer && !terminal(transfer.state)) {
        transfer.state =
          this.cancelRequested && !this.nativeStarted
            ? "cancelled"
            : !this.nativeStarted
              ? "failed"
              : "uncertain";
        transfer.error = transfer.state === "cancelled" ? null : String(e);
      }
      if (
        transfer?.state !== "cancelled" &&
        this.snapshot.connection === "connected"
      )
        this.snapshot.error = String(e);
    } finally {
      if (transfer) transfer.updated = Date.now();
      this.operation = null;
      this.publish();
    }
  }
}
export const webBridge = new WebBridge();
