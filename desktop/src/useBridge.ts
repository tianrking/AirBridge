import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mergeSnapshot, type Snapshot } from "./types";
const initial: Snapshot = {
  can_resolve: false,
  resolving_peer: null,
  revision: 0,
  connection: "disconnected",
  radio_mac: null,
  peers: [],
  transfers: [],
  receive_directory: "",
  error: null,
};
export function useBridge() {
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const native = isTauri();
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (next: Snapshot) => {
      if (!disposed) setSnapshot((current) => mergeSnapshot(current, next));
    };
    void listen<Snapshot>("bridge-snapshot", (event) => update(event.payload))
      .then(async (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        update(await invoke<Snapshot>("get_snapshot"));
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);
  const call = useCallback(
    async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T | undefined> => {
      if (!native) {
        setError("Open the AirBridge desktop app to connect real hardware.");
        return;
      }
      setError(null);
      setPending(true);
      try {
        return await invoke<T>(command, args);
      } catch (reason) {
        setError(String(reason));
        return;
      } finally {
        setPending(false);
      }
    },
    [native],
  );
  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      const next = await invoke<Snapshot>("get_snapshot");
      setSnapshot((current) => mergeSnapshot(current, next));
    } catch (reason) {
      setError(String(reason));
    }
  }, [native]);
  return {
    snapshot,
    error: error ?? snapshot.error,
    pending,
    native,
    call,
    refresh,
    clearError: () => {
      setError(null);
      if (native)
        void invoke("dismiss_error").catch((reason) =>
          setError(String(reason)),
        );
    },
  };
}
