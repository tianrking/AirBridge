import { useEffect, useState } from "react";
import type { useBridge } from "./useBridge";
import type { SelectedFile, Snapshot, Transfer } from "./types";

// Deliberately separate from WebBridge: the public tour never constructs a
// serial session or asks for a file/directory handle. All state is disposable.
function initialDemo(): Snapshot {
  return {
    revision: 0,
    connection: "connected",
    can_resolve: false,
    resolving_peer: null,
    radio_mac: "02:00:00:00:00:aa",
    receive_directory: "Demo folder · no disk access",
    error: null,
    bridge_info: {
      pairing: true,
      protocol: 2,
      max_file: 1048576,
      chunk_bytes: 112,
      hardware_id: null,
      usb_serial: null,
      port: null,
      paired_peer: null,
      connected_at: Date.now(),
    },
    peers: [
      {
        mac: "02:00:00:00:00:01",
        name: "Studio MacBook Pro",
        name_source: "demo",
        advertised: true,
        port: 8770,
        rssi: null,
        last_seen: Date.now(),
      },
      {
        mac: "02:00:00:00:00:02",
        name: "iPhone",
        name_source: "demo",
        advertised: true,
        port: 8770,
        rssi: null,
        last_seen: Date.now(),
      },
    ],
    transfers: [
      {
        id: "DEMO-RECEIVE",
        name: "Example photo.jpg",
        direction: "receive",
        state: "completed",
        peer: null,
        peer_name: "iPhone",
        bytes: 262145,
        done: 262145,
        progress_total: 262145,
        sha256: null,
        directory: null,
        error: null,
        started: Date.now() - 30000,
        updated: Date.now() - 25000,
      },
    ],
  };
}
export function useDemoBridge(): ReturnType<typeof useBridge> {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialDemo);
  const active = snapshot.transfers.some((t) => t.state === "sending");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () =>
        setSnapshot((s) => ({
          ...s,
          revision: s.revision + 1,
          transfers: s.transfers.map((t) => {
            if (t.state !== "sending") return t;
            const done = Math.min(t.bytes, t.done + 16384);
            return {
              ...t,
              done,
              state: done === t.bytes ? "completed" : "sending",
              updated: Date.now(),
            };
          }),
        })),
      160,
    );
    return () => clearInterval(timer);
  }, [active]);
  const call = async <T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T | undefined> => {
    let result: unknown = null;
    if (command === "connect_bridge") setSnapshot(initialDemo());
    if (command === "choose_file")
      result = {
        id: "DEMO-SOURCE",
        name: "Sample document.pdf",
        bytes: 262145,
      } satisfies SelectedFile;
    if (command === "choose_receive_folder")
      result = snapshot.receive_directory;
    if (command === "pair_peer" || command === "unpair_peer")
      setSnapshot((s) => ({
        ...s,
        bridge_info: s.bridge_info
          ? {
              ...s.bridge_info,
              paired_peer: command === "pair_peer" ? String(args.peer) : null,
            }
          : null,
      }));
    if (command === "send_file") {
      const transfer: Transfer = {
        id: `DEMO-${crypto.randomUUID()}`,
        name: "Sample document.pdf",
        direction: "send",
        state: "sending",
        peer: String(args.peer),
        peer_name: snapshot.peers.find((p) => p.mac === args.peer)?.name,
        bytes: 262145,
        done: 0,
        progress_total: 262145,
        sha256: null,
        directory: null,
        error: null,
        started: Date.now(),
        updated: Date.now(),
      };
      setSnapshot((s) => ({
        ...s,
        revision: s.revision + 1,
        transfers: [transfer, ...s.transfers].slice(0, 20),
      }));
    }
    if (command === "cancel_transfer")
      setSnapshot((s) => ({
        ...s,
        transfers: s.transfers.map((t) =>
          t.state === "sending"
            ? { ...t, state: "cancelled", updated: Date.now() }
            : t,
        ),
      }));
    if (command === "disconnect_bridge")
      setSnapshot((s) => ({
        ...s,
        connection: "disconnected",
        peers: [],
        transfers: s.transfers.map((t) =>
          t.state === "sending" ? { ...t, state: "uncertain" } : t,
        ),
      }));
    return result as T;
  };
  return {
    snapshot,
    native: false,
    unsupported: null,
    error: null,
    pending: false,
    call,
    refresh: async () => {},
    clearError: () => {},
  };
}
