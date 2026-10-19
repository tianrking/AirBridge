import {
  check,
  digest,
  identity,
  MAX_RECEIVE,
  nativeName,
  number,
  safeName,
  sha256,
  text,
  unbase64,
  type Event,
} from "./protocol";
import type { DiskDirectory, DiskFile, DiskWriter } from "./platform";
type Offer = { name: string; size: number };
type Part = Offer & {
  metadata: boolean;
  offset: number;
  handle: DiskFile;
  stream?: DiskWriter;
  sha256?: string;
};
type Job = {
  id: string;
  count: number;
  total: number;
  directory: DiskDirectory;
  offers: Map<number, Offer>;
  parts: Map<number, Part>;
  committed: boolean;
  complete: boolean;
  failed: boolean;
};
export const receiveEvents = new Set([
  "transfer_begin",
  "manifest_file",
  "file_begin",
  "file_chunk",
  "file_end",
  "transfer_ready",
  "transfer_complete",
]);
export class Receiver {
  private job?: Job;
  private closed = false;
  private phase = "offer";
  constructor(
    private root: DiskDirectory,
    private emit: (e: Event) => void,
  ) {}
  get active() {
    return !!this.job && !this.job.complete && !this.job.failed;
  }
  interrupt(message: string, uncertain = true) {
    const job = this.job;
    if (!job || job.complete || job.failed) return;
    job.failed = true;
    this.emit({
      event: "incoming_failed",
      transfer_id: job.id,
      bytes: job.total,
      files: job.count,
      directory: `${this.root.name}/${job.directory.name}`,
      message,
      phase: this.phase,
      uncertain,
    });
  }
  async stop() {
    this.closed = true;
    this.interrupt("Receive interrupted; incomplete files were not confirmed");
    await Promise.allSettled(
      [...(this.job?.parts.values() ?? [])].map(async (part) => {
        const stream = part.stream;
        part.stream = undefined;
        if (stream) await stream.abort();
      }),
    );
  }
  private alive() {
    check(!this.closed && this.active, "Receive job is stopped or failed");
  }
  private async verifyFiles() {
    this.alive();
    for (const part of this.job!.parts.values()) {
      check(part.sha256 && !part.stream, "File verification incomplete");
      const file = await part.handle.getFile();
      check(
        file.size === part.size &&
          (await sha256(new Uint8Array(await file.arrayBuffer()))) ===
            part.sha256,
        "Saved file SHA256 or size changed; completion withheld",
      );
      this.alive();
    }
  }
  private async receipt(status: string) {
    const job = this.job!;
    const record = {
      status,
      transfer_id: job.id,
      total_bytes: job.total,
      native_confirmed: status === "completed",
      files: [...job.parts.values()].map((f) => ({
        name: f.name,
        bytes: f.size,
        metadata: f.metadata,
        sha256: f.sha256 ?? null,
      })),
    };
    this.alive();
    const handle = await job.directory.getFileHandle("airbridge-receipt.json", {
      create: true,
    });
    this.alive();
    const output = await handle.createWritable();
    const payload = JSON.stringify(record, null, 2);
    try {
      this.alive();
      await output.write(payload);
      this.alive();
      await output.close();
      this.alive();
      const saved = await handle.getFile();
      check(
        (await saved.text()) === payload,
        "Saved receipt readback differs; completion withheld",
      );
      this.alive();
    } catch (e) {
      await output.abort().catch(() => {});
      throw e;
    }
    return record;
  }
  async handle(e: Event): Promise<string | undefined> {
    if (!receiveEvents.has(e.event)) return;
    check(
      !this.closed && !this.job?.failed,
      "Receive job is stopped or failed",
    );
    this.phase = e.event;
    try {
      return await this.process(e);
    } catch (error) {
      this.interrupt(
        error instanceof Error ? error.message : String(error),
        this.job?.committed === true,
      );
      throw error;
    }
  }
  private async process(e: Event): Promise<string | undefined> {
    if (e.event === "transfer_begin") {
      check(!this.active, "Previous incoming transfer is unresolved");
      const id = text(e, "transfer_id"),
        count = number(e, "files"),
        total = number(e, "total_bytes");
      check(
        identity(id) && count > 0 && count <= 16 && total <= MAX_RECEIVE,
        "Incoming offer exceeds bounds",
      );
      // Browser directories have no portable atomic rename. A private random
      // directory plus an explicit receipt separates checked/native-complete data.
      const name = `AirBridge-${crypto.randomUUID()}`;
      try {
        await this.root.getDirectoryHandle(name);
        throw new Error("Receive directory collision");
      } catch (error) {
        check(
          error instanceof Error && error.name === "NotFoundError",
          "Receive directory exists or cannot be checked",
        );
      }
      const directory = await this.root.getDirectoryHandle(name, {
        create: true,
      });
      check(!this.closed, "Receiver stopped during directory creation");
      this.job = {
        id,
        count,
        total,
        directory,
        offers: new Map(),
        parts: new Map(),
        committed: false,
        complete: false,
        failed: false,
      };
      this.emit({
        event: "incoming_started",
        transfer_id: id,
        bytes: total,
        files: count,
        directory: `${this.root.name}/${name}`,
      });
      await this.receipt("receiving");
      return;
    }
    if (
      ![
        "manifest_file",
        "file_begin",
        "file_chunk",
        "file_end",
        "transfer_ready",
        "transfer_complete",
      ].includes(e.event)
    )
      return;
    const job = this.job;
    check(
      job && !job.complete && !job.failed,
      "Incoming record without an active transfer",
    );
    check(
      !job.committed || e.event === "transfer_complete",
      "Incoming mutation after commit",
    );
    if (e.transfer_id !== undefined)
      check(e.transfer_id === job.id, "Incoming transfer identity mismatch");
    switch (e.event) {
      case "manifest_file": {
        const index = number(e, "index"),
          size = number(e, "size"),
          name = nativeName(text(e, "name_b64"));
        check(
          safeName(name) &&
            name.toLowerCase() !== "airbridge-receipt.json" &&
            job.parts.size === 0 &&
            index < job.count &&
            !job.offers.has(index) &&
            size <= job.total,
          "Invalid manifest file",
        );
        check(
          ![...job.offers.values()].some(
            (f) => f.name.toLowerCase() === name.toLowerCase(),
          ),
          "Duplicate filename",
        );
        job.offers.set(index, { name, size });
        this.emit({
          event: "incoming_file",
          transfer_id: job.id,
          name,
          bytes: size,
        });
        break;
      }
      case "file_begin": {
        check(
          job.offers.size === job.count &&
            [...job.offers.values()].reduce((n, f) => n + f.size, 0) ===
              job.total,
          "Incomplete manifest",
        );
        const index = number(e, "index"),
          size = number(e, "size"),
          name = nativeName(text(e, "name_b64"));
        check(typeof e.metadata === "boolean", "Invalid metadata flag");
        const metadata = e.metadata;
        const offer = job.offers.get(metadata ? index - 16 : index);
        check(
          index < 32 &&
            (!metadata || index >= 16) &&
            offer &&
            name === (metadata ? `._${offer.name}` : offer.name) &&
            (metadata ? size <= 131072 : size === offer.size) &&
            !job.parts.has(index),
          "File differs from offer",
        );
        check(
          ![...job.parts.values()].some(
            (f) => f.name.toLowerCase() === name.toLowerCase(),
          ),
          "Duplicate file",
        );
        const handle = await job.directory.getFileHandle(name, {
          create: true,
        });
        this.alive();
        const stream = await handle.createWritable();
        if (this.closed || job.failed) {
          await stream.abort();
          this.alive();
        }
        job.parts.set(index, {
          name,
          size,
          metadata,
          offset: 0,
          handle,
          stream,
        });
        break;
      }
      case "file_chunk": {
        const index = number(e, "index"),
          offset = number(e, "offset"),
          data = unbase64(text(e, "data"));
        const part = job.parts.get(index);
        check(
          part?.stream &&
            !part.sha256 &&
            offset === part.offset &&
            data.length > 0 &&
            data.length <= 512 &&
            data.length <= part.size - offset,
          "Chunk offset or length mismatch",
        );
        await part.stream.write(data);
        this.alive();
        part.offset += data.length;
        if (
          !part.metadata &&
          (part.offset === part.size || part.offset % 16384 < data.length)
        )
          this.emit({
            event: "incoming_progress",
            transfer_id: job.id,
            name: part.name,
            bytes: part.offset,
            total_bytes: part.size,
          });
        return `CHUNK ${job.id} ${index} ${part.offset}\n`;
      }
      case "file_end": {
        const part = job.parts.get(number(e, "index"));
        const expected = text(e, "sha256").toLowerCase();
        check(
          part?.stream &&
            !part.sha256 &&
            part.offset === part.size &&
            number(e, "bytes") === part.size &&
            digest(expected),
          "Incomplete incoming file",
        );
        await part.stream.close();
        part.stream = undefined;
        // Reopen the actual published file, rather than hashing only serial RAM.
        const saved = await part.handle.getFile();
        check(
          saved.size === part.size &&
            (await sha256(new Uint8Array(await saved.arrayBuffer()))) ===
              expected,
          "Saved file SHA256 or size mismatch; commit withheld",
        );
        this.alive();
        part.sha256 = expected;
        break;
      }
      case "transfer_ready": {
        const nonce = text(e, "nonce");
        const regular = [...job.parts.values()].filter((f) => !f.metadata);
        check(
          /^[a-f\d]{32}$/i.test(nonce) &&
            regular.length === job.count &&
            regular.reduce((n, f) => n + f.size, 0) === job.total &&
            [...job.parts.values()].every((f) => !!f.sha256 && !f.stream) &&
            number(e, "files") === job.parts.size &&
            number(e, "total_bytes") ===
              [...job.parts.values()].reduce((n, f) => n + f.size, 0),
          "Cannot commit incomplete transfer",
        );
        await this.verifyFiles();
        await this.receipt("files_verified");
        job.committed = true;
        this.emit({ event: "incoming_verifying", transfer_id: job.id });
        return `COMMIT ${nonce}\n`;
      }
      case "transfer_complete": {
        check(
          job.committed &&
            e.host_committed === true &&
            e.response_written === true,
          "Native receiver did not confirm delivery",
        );
        await this.verifyFiles();
        const record = await this.receipt("completed");
        job.complete = true;
        this.emit({
          event: "received",
          ...record,
          directory: `${this.root.name}/${job.directory.name}`,
        });
        break;
      }
    }
  }
}
