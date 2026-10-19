import { unbase64, type Event } from "../src/web/protocol";
import type { SerialPort } from "../src/web/platform";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Development/test transport only. Never imported by the production entry.
export class VirtualPort implements SerialPort {
  readable!: ReadableStream<Uint8Array<ArrayBuffer>>;
  writable!: WritableStream<Uint8Array<ArrayBuffer>>;
  private controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  records: string[] = [];
  closed = false;
  openCalls = 0;
  closeCalls = 0;
  closeFailures = 0;
  hardware = "a0:b7:65:12:34:56";
  respond = true;
  pairing = true;
  signals?: { dataTerminalReady: boolean; requestToSend: boolean };
  openGate?: Promise<void>;
  closeGate?: Promise<void>;
  beforeWrite?: (record: string, signal: AbortSignal) => Promise<void>;
  reply?: (record: string, sequence: number) => Event;
  onCommand?: (record: string, sequence: number) => void;
  constructor() {
    this.streams();
  }
  private streams() {
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream({
      write: async (bytes, controller) => {
        const record = new TextDecoder().decode(bytes);
        this.records.push(record);
        await this.beforeWrite?.(record, controller.signal);
        if (!record.startsWith("AB2 ")) return;
        const sequence = Number(record.split(" ")[1]);
        const words = record.trim().split(" ");
        const offset = ["META", "DATA"].includes(words[3])
          ? Number(words[4]) + unbase64(words[5]).length
          : 0;
        if (this.respond)
          this.emit(
            this.reply?.(record, sequence) ?? {
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
              pairing: this.pairing,
              paired_peer: words[3] === "PAIR" ? words[4] : "00:00:00:00:00:00",
            },
          );
        this.onCommand?.(record, sequence);
      },
    });
  }
  getInfo() {
    return { usbVendorId: 0x303a, usbProductId: 0x1001 };
  }
  async open() {
    this.openCalls++;
    await this.openGate;
    if (this.closed) this.streams();
    this.closed = false;
  }
  async setSignals(signals: {
    dataTerminalReady: boolean;
    requestToSend: boolean;
  }) {
    this.signals = signals;
  }
  async close() {
    this.closeCalls++;
    await this.closeGate;
    if (this.readable.locked || this.writable.locked)
      throw new Error("Closing a port with owned locks");
    if (this.closeFailures-- > 0)
      throw new Error("Injected port close failure");
    this.closed = true;
  }
  end() {
    this.controller.close();
  }
  breakRead() {
    this.controller.error(new Error("Injected serial read error"));
  }
  emit(event: Event) {
    const bytes = new TextEncoder().encode(JSON.stringify(event) + "\n");
    this.controller.enqueue(bytes.slice(0, 9));
    this.controller.enqueue(bytes.slice(9));
  }
}
