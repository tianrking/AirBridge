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
export function supportIssue(): string | null {
  if (!window.isSecureContext)
    return "Open AirBridge over HTTPS or localhost to use Web Serial.";
  if (!(navigator as Navigator & { serial?: SerialAPI }).serial)
    return "Web Serial is unavailable. Use desktop Chrome or Edge.";
  if (
    !(window as BrowserPlatform).showDirectoryPicker ||
    !(window as BrowserPlatform).showOpenFilePicker
  )
    return "This browser cannot safely save received files. Use desktop Chrome or Edge with file-system access enabled.";
  return null;
}
