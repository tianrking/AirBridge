import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mergeSnapshot, type Snapshot } from "./types";
import { webBridge } from "./web/bridge";
import { ownsConnection } from "./presentation";
import { supportIssue } from "./web/platform";
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
  const inFlight = useRef(new Set<string>());
  const native = isTauri();
  const unsupported = native ? null : supportIssue();
  useEffect(() => {
    if (native || !ownsConnection(snapshot.connection)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [native, snapshot.connection]);
  useEffect(() => {
    if (!native) {
      setSnapshot(webBridge.getSnapshot());
      return webBridge.subscribe(() => setSnapshot(webBridge.getSnapshot()));
    }
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
      if (inFlight.current.has(command)) return;
      inFlight.current.add(command);
      setError(null);
      setPending(true);
      try {
        return native
          ? await invoke<T>(command, args)
          : await webBridge.call<T>(command, args);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(String(reason));
        return;
      } finally {
        inFlight.current.delete(command);
        setPending(inFlight.current.size > 0);
      }
    },
    [native],
  );
  const refresh = useCallback(async () => {
    if (!native) {
      setSnapshot(webBridge.getSnapshot());
      return;
    }
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
    unsupported,
    call,
    refresh,
    clearError: () => {
      setError(null);
      if (native)
        void invoke("dismiss_error").catch((reason) =>
          setError(String(reason)),
        );
      else void webBridge.call("dismiss_error");
    },
  };
}
