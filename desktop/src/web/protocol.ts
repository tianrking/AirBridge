// Copyright (c) 2026 tianrking
export const MAX_SEND = 1024 * 1024;
export const MAX_RECEIVE = 64 * 1024 * 1024;
export type Event = Record<string, unknown> & { event: string };
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function text(e: Record<string, unknown>, key: string): string {
  check(typeof e[key] === "string", `Invalid ${key}`);
  return e[key];
}
export function number(e: Record<string, unknown>, key: string): number {
  const n = e[key];
  check(
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
    `Invalid ${key}`,
  );
  return n;
}
export const mac = (s: string) => /^(?:[a-f\d]{2}:){5}[a-f\d]{2}$/i.test(s);
export const identity = (s: string) => /^[a-z\d-]{1,64}$/i.test(s);
export const digest = (s: string) => /^[a-f\d]{64}$/i.test(s);
export function safeName(s: string): boolean {
  if (
    !s ||
    new TextEncoder().encode(s).length > 240 ||
    /[\x00-\x1f\x7f/\\:<>"|?*]/.test(s) ||
    /[. ]$/.test(s)
  )
    return false;
  const stem = s.split(".")[0].trimEnd();
  return !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(
    stem,
  );
}
export function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unbase64(s: string): Uint8Array<ArrayBuffer> {
  check(
    s.length <= 2048 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        s,
      ),
    "Invalid Base64",
  );
  const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  check(base64(b) === s, "Noncanonical Base64");
  return b;
}
export function nativeName(s: string): string {
  const bytes = unbase64(s);
  check(bytes.length > 0 && bytes.length <= 256, "Native name exceeds bound");
  const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  check(!/[\x00-\x1f\x7f]/.test(name), "Invalid native name");
  return name;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function command(
  sequence: number,
  body: string,
): Uint8Array<ArrayBuffer> {
  check(
    Number.isInteger(sequence) && sequence > 0 && sequence <= 0xffffffff,
    "Serial sequence exhausted; reconnect required",
  );
  check(
    body.length > 0 &&
      body.length <= 192 &&
      /^[\x20-\x29\x2b-\x7e]+$/.test(body),
    "Invalid command body",
  );
  const payload = `${sequence} ${body}`;
  let crc = 0xffffffff;
  for (const c of payload) {
    crc ^= c.charCodeAt(0);
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const record = `AB2 ${payload} *${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0")}\n`;
  check(record.length <= 224, "Command exceeds physical bound");
  return new TextEncoder().encode(record);
}
export class Lines {
  private pending: number[] = [];
  feed(bytes: Uint8Array): Event[] {
    const events: Event[] = [];
    for (const b of bytes) {
      if (b === 10) {
        const line = new Uint8Array(this.pending);
        this.pending = [];
        let e: unknown;
        try {
          e = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(line),
          );
        } catch {
          continue;
        } // ESP-IDF diagnostics share the port.
        if (
          e &&
          typeof e === "object" &&
          "event" in e &&
          typeof e.event === "string"
        )
          events.push(e as Event);
      } else {
        check(
          this.pending.length < 16384,
          "Serial line exceeds 16 KiB; disconnect required",
        );
        this.pending.push(b);
      }
    }
    return events;
  }
}

// Small independent binary-plist encoder for the bounded native Ask schema.
type Plist = string | number | boolean | Plist[] | { [key: string]: Plist };
function width(n: number) {
  return n <= 255 ? 1 : n <= 65535 ? 2 : 4;
}
function uint(n: number, size: number): number[] {
  const out = new Array<number>(size).fill(0);
  for (let i = size - 1; i >= 0; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  check(n === 0, "Integer overflow");
  return out;
}
export function binaryPlist(root: Plist): Uint8Array<ArrayBuffer> {
  type Node = { value: Plist; refs?: number[]; keys?: number[] };
  const nodes: Node[] = [];
  function add(value: Plist): number {
    const id = nodes.length;
    const node: Node = { value };
    nodes.push(node);
    if (Array.isArray(value)) node.refs = value.map(add);
    else if (value !== null && typeof value === "object") {
      node.keys = Object.keys(value).map(add);
      node.refs = Object.values(value).map(add);
    }
    return id;
  }
  add(root);
  const refWidth = width(nodes.length - 1);
  const out = [...new TextEncoder().encode("bplist00")];
  const offsets: number[] = [];
  function length(tag: number, n: number) {
    if (n < 15) out.push(tag | n);
    else {
      const w = width(n);
      out.push(tag | 15, 0x10 | Math.log2(w), ...uint(n, w));
    }
  }
  for (const { value, refs, keys } of nodes) {
    offsets.push(out.length);
    if (typeof value === "boolean") out.push(value ? 9 : 8);
    else if (typeof value === "number") {
      check(
        Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff,
        "Unsupported plist integer",
      );
      const w = width(value);
      out.push(0x10 | Math.log2(w), ...uint(value, w));
    } else if (typeof value === "string") {
      const ascii = /^[\x00-\x7f]*$/.test(value);
      length(ascii ? 0x50 : 0x60, value.length);
      for (let i = 0; i < value.length; i++)
        out.push(...uint(value.charCodeAt(i), ascii ? 1 : 2));
    } else {
      length(keys ? 0xd0 : 0xa0, refs!.length);
      for (const ref of [...(keys ?? []), ...refs!])
        out.push(...uint(ref, refWidth));
    }
  }
  const table = out.length;
  const offsetWidth = width(table);
  for (const offset of offsets) out.push(...uint(offset, offsetWidth));
  out.push(
    0,
    0,
    0,
    0,
    0,
    0,
    offsetWidth,
    refWidth,
    ...uint(nodes.length, 8),
    ...uint(0, 8),
    ...uint(table, 8),
  );
  check(out.length <= 131072, "Manifest exceeds bound");
  return new Uint8Array(out);
}
export function manifest(
  name: string,
  size: number,
  sender: string,
  id: string,
) {
  check(
    safeName(name) &&
      Number.isSafeInteger(size) &&
      size >= 0 &&
      size <= MAX_SEND &&
      /^[a-f\d]{12}$/i.test(sender) &&
      identity(id),
    "Invalid source metadata",
  );
  return binaryPlist({
    TransferID: { id },
    TransferType: { files: {} },
    SenderID: sender,
    BundleID: "com.apple.finder",
    SenderComputerName: "AirBridge PC",
    SenderModelName: "Windows",
    Items: [],
    ConvertMediaFormats: false,
    Files: [
      {
        FileName: name,
        FileSize: size,
        FileType: "public.data",
        FileBomPath: `./${name}`,
        FileIsDirectory: false,
        ConvertMediaFormats: false,
      },
    ],
  });
}

export function factoryIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    mac(value) &&
    !(parseInt(value.slice(0, 2), 16) & 1) &&
    !/^00(?::00){5}$/.test(value) &&
    !/^ff(?::ff){5}$/i.test(value)
  );
}
