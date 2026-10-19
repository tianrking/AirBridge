import {
  check,
  command,
  Lines,
  mac,
  MAX_SEND,
  BOARD_ID,
  type Event,
} from "./protocol";
import type { DiskDirectory, SerialPort } from "./platform";
import { Receiver } from "./receiver";
type Waiter = {
  resolve: (e: Event) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
// One byte reader and one serialized writer serve replies AND incoming ACKs.
export class Session {
  capabilities?: Event;
  receiver: Receiver;
  private reader?: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
  private writer?: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>;
  private readTask?: Promise<void>;
  private lines = new Lines();
  private sequence = 0;
  private nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  private writeTail = Promise.resolve();
  private requestTail: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, Waiter>();
  private waiting = new Set<{ test: (e: Event) => boolean; waiter: Waiter }>();
  private closing = false;
  private closed?: Promise<void>;
  constructor(
    private port: SerialPort,
    directory: DiskDirectory,
    private emit: (e: Event) => void,
    private fail: (error: Error) => void,
  ) {
    this.receiver = new Receiver(directory, emit);
  }
  async open() {
    const info = this.port.getInfo();
    check(
      info.usbVendorId === 0x303a && info.usbProductId === 0x1001,
      "Select the ESP32-S3 native USB Serial/JTAG port",
    );
    await this.port.open({
      baudRate: 115200,
      bufferSize: 65536,
      flowControl: "none",
    });
    try {
      await this.port.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });
      check(
        this.port.readable && this.port.writable,
        "Serial streams unavailable",
      );
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      this.readTask = this.readLoop();
      await this.write("\n");
      const hello = await this.requestBody(`HELLO ${this.nonce}`);
      check(
        hello.protocol === 2 &&
          typeof hello.max_file === "number" &&
          Number.isInteger(hello.max_file) &&
          hello.max_file > 0 &&
          hello.max_file <= MAX_SEND &&
          typeof hello.chunk_bytes === "number" &&
          Number.isInteger(hello.chunk_bytes) &&
          hello.chunk_bytes > 0 &&
          hello.chunk_bytes <= 112 &&
          mac(String(hello.radio_mac)),
        "Unsupported bridge capabilities",
      );
      check(
        typeof hello.hardware_id === "string" &&
          hello.hardware_id.toLowerCase() === BOARD_ID,
        "Board identity missing or different. Use the verified replacement COM4 and firmware with hardware_id support",
      );
      this.capabilities = hello;
      return hello;
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  write(data: string | Uint8Array<ArrayBuffer>): Promise<void> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const task = this.writeTail.then(async () => {
      check(!this.closing && this.writer, "Serial session closed");
      await this.writer.write(bytes);
    });
    this.writeTail = task;
    return task;
  }
  request(body: string) {
    return this.requestBody(`${this.nonce} ${body}`);
  }
  private requestBody(body: string): Promise<Event> {
    const task = this.requestTail.then(async () => {
      check(!this.closing, "Serial session closed");
      const sequence = ++this.sequence;
      const bytes = command(sequence, body);
      return new Promise<Event>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(sequence);
          const error = new Error(
            "Serial acknowledgement timed out; result uncertain. No automatic resend",
          );
          reject(error);
          this.fail(error);
          void this.close();
        }, 5000);
        this.pending.set(sequence, { resolve, reject, timer });
        void this.write(bytes).catch((error) => {
          clearTimeout(timer);
          this.pending.delete(sequence);
          reject(error);
        });
      });
    });
    this.requestTail = task.catch(() => {});
    return task;
  }
  watch(test: (e: Event) => boolean, timeout: number) {
    let dispose = () => {};
    const promise = new Promise<Event>((resolve, reject) => {
      const item = {
        test,
        waiter: {
          resolve,
          reject,
          timer: setTimeout(() => {
            this.waiting.delete(item);
            reject(
              new Error(
                "Native operation timed out; destination result uncertain",
              ),
            );
          }, timeout),
        },
      };
      this.waiting.add(item);
      dispose = () => {
        clearTimeout(item.waiter.timer);
        this.waiting.delete(item);
      };
    });
    // A device can fail/close while the command acknowledgement is pending.
    void promise.catch(() => {});
    return { promise, dispose: () => dispose() };
  }
  private async readLoop() {
    try {
      while (!this.closing) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        for (const e of this.lines.feed(value)) {
          if (this.closing) break;
          if (e.event === "command_reply") {
            check(
              typeof e.sequence === "number" && typeof e.ok === "boolean",
              "Malformed command acknowledgement",
            );
            const waiter = this.pending.get(e.sequence);
            check(waiter, "Unexpected command acknowledgement");
            this.pending.delete(e.sequence);
            clearTimeout(waiter.timer);
            if (e.ok) waiter.resolve(e);
            else
              waiter.reject(new Error(`Bridge rejected command: ${e.reason}`));
          } else {
            if (this.capabilities)
              check(
                e.event !== "qualification_boot" &&
                  e.event !== "command_invalid",
                "Bridge restarted or rejected serial framing",
              );
            // Native reception must not publish unverified-device output during HELLO.
            if (!this.capabilities) continue;
            const ack = await this.receiver.handle(e);
            if (ack) await this.write(ack);
            this.emit(e);
            for (const item of [...this.waiting])
              if (item.test(e)) {
                this.waiting.delete(item);
                clearTimeout(item.waiter.timer);
                item.waiter.resolve(e);
              }
          }
        }
      }
      if (!this.closing)
        throw new Error(
          "Serial device disconnected; incomplete result uncertain",
        );
    } catch (error) {
      if (!this.closing) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        // Avoid awaiting close() from the reader that close() waits for.
        void this.close();
      }
    } finally {
      this.reader?.releaseLock();
      this.reader = undefined;
    }
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.closing = true;
    this.closed = (async () => {
      const error = new Error(
        "Serial session closed; incomplete result uncertain",
      );
      for (const w of this.pending.values()) {
        clearTimeout(w.timer);
        w.reject(error);
      }
      for (const { waiter: w } of this.waiting) {
        clearTimeout(w.timer);
        w.reject(error);
      }
      this.pending.clear();
      this.waiting.clear();
      await this.reader?.cancel().catch(() => {});
      await this.readTask;
      await this.receiver.stop();
      // abort releases a blocked pending write before releasing the port lock.
      await this.writer?.abort().catch(() => {});
      await this.writeTail.catch(() => {});
      this.writer?.releaseLock();
      this.writer = undefined;
      await this.port.close();
    })();
    return this.closed;
  }
}
