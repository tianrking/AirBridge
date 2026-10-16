export type Language = "en" | "zh-Hant" | "es";
export type Page = "share" | "activity" | "settings";
export interface Peer {
  mac: string;
  name: string | null;
  name_source: string | null;
  advertised: boolean;
  port: number;
  rssi: number;
  last_seen: number;
}
export interface Transfer {
  id: string;
  name: string;
  direction: "send" | "receive";
  peer: string | null;
  state: string;
  bytes: number;
  done: number;
  progress_total: number;
  sha256: string | null;
  directory: string | null;
  error: string | null;
  updated: number;
}
export interface Snapshot {
  can_resolve: boolean;
  resolving_peer: string | null;
  revision: number;
  connection: string;
  radio_mac: string | null;
  peers: Peer[];
  transfers: Transfer[];
  receive_directory: string;
  error: string | null;
}
export interface SelectedFile {
  id: string;
  name: string;
  bytes: number;
}
// A late initial IPC snapshot must never replace newer serial events.
export function mergeSnapshot(current: Snapshot, next: Snapshot): Snapshot {
  return next.revision >= current.revision ? next : current;
}
export const terminal = (state: string) =>
  ["completed", "failed", "cancelled", "uncertain"].includes(state);
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
