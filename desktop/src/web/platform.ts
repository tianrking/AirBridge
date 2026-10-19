// Minimal structural types keep the browser backend independent of native APIs.
export interface DiskWriter {
  write(data: Uint8Array<ArrayBuffer> | string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export interface DiskFile {
  name: string;
  getFile(): Promise<Blob & { name: string }>;
  createWritable(): Promise<DiskWriter>;
}
export interface DiskDirectory {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DiskDirectory>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DiskFile>;
}
export interface SerialPort {
  readable: ReadableStream<Uint8Array<ArrayBuffer>> | null;
  writable: WritableStream<Uint8Array<ArrayBuffer>> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(options: {
    baudRate: number;
    bufferSize: number;
    flowControl: "none";
  }): Promise<void>;
  setSignals(options: {
    dataTerminalReady: boolean;
    requestToSend: boolean;
  }): Promise<void>;
  close(): Promise<void>;
}
export interface SerialAPI {
  requestPort(options: {
    filters: { usbVendorId: number; usbProductId: number }[];
  }): Promise<SerialPort>;
}
export type BrowserPlatform = Window & {
  showDirectoryPicker?: (options: {
    mode: "readwrite";
    id: string;
  }) => Promise<DiskDirectory>;
  showOpenFilePicker?: (options: { multiple: false }) => Promise<DiskFile[]>;
};
export type SupportCode =
  "insecure" | "embedded" | "policy" | "serial" | "storage";
export function supportCode(features: {
  secure: boolean;
  embedded: boolean;
  policy: boolean;
  serial: boolean;
  storage: boolean;
}): SupportCode | null {
  if (!features.secure) return "insecure";
  if (features.embedded) return "embedded";
  if (!features.policy) return "policy";
  if (!features.serial) return "serial";
  if (!features.storage) return "storage";
  return null;
}
export function browserSupport(): SupportCode | null {
  const doc =
    typeof document === "undefined"
      ? undefined
      : (document as Document & {
          permissionsPolicy?: { allowsFeature(name: string): boolean };
          featurePolicy?: { allowsFeature(name: string): boolean };
        });
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
  return supportCode({
    secure: !!window.isSecureContext,
    embedded: window.self !== window.top,
    policy: policy?.allowsFeature("serial") ?? true,
    serial: !!(navigator as Navigator & { serial?: SerialAPI }).serial,
    storage: !!(
      (window as BrowserPlatform).showDirectoryPicker &&
      (window as BrowserPlatform).showOpenFilePicker
    ),
  });
}
const issues: Record<SupportCode, string> = {
  insecure: "Open AirBridge over HTTPS or localhost to use Web Serial.",
  embedded:
    "Open AirBridge directly in a desktop Chrome or Edge tab, outside the embedded preview.",
  policy:
    "Serial access is blocked by this page or browser policy. Open the full page or contact your browser administrator.",
  serial: "Web Serial is unavailable. Use desktop Chrome or Edge.",
  storage:
    "This browser cannot safely save received files. Use desktop Chrome or Edge with file-system access enabled.",
};
export function supportIssue(): string | null {
  const code = browserSupport();
  return code ? issues[code] : null;
}
