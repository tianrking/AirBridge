import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { PeerCard } from "./components";
import type { Copy } from "./i18n";
import {
  DEPARTURE_MS,
  reconcilePresence,
  type PresentedPeer,
} from "./presence";
import type { Peer, Transfer } from "./types";
import brand from "./brand.svg";
import "./discovery.css";

export function DiscoveryStage({
  peers,
  connected,
  selected,
  resolving,
  transfer,
  copy,
  onSelect,
}: {
  peers: Peer[];
  connected: boolean;
  selected: string | null;
  resolving: string | null;
  transfer?: Transfer;
  copy: Copy;
  onSelect: (peer: Peer) => void;
}) {
  const [presented, setPresented] = useState<PresentedPeer[]>(() =>
    reconcilePresence([], connected ? peers : [], performance.now()),
  );
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const grid = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // Reconcile before paint so a new advertisement does not flash the empty state.
  useLayoutEffect(() => {
    setPresented((previous) =>
      reconcilePresence(
        previous,
        connected ? peers : [],
        performance.now(),
        reduced ? 0 : DEPARTURE_MS,
      ),
    );
  }, [peers, connected, reduced]);
  useEffect(() => {
    const deadlines = presented.flatMap((p) =>
      p.leavingAt === null ? [] : [p.leavingAt + DEPARTURE_MS],
    );
    if (!deadlines.length) return;
    const timer = setTimeout(
      () =>
        setPresented((previous) =>
          reconcilePresence(
            previous,
            connected ? peers : [],
            performance.now(),
            reduced ? 0 : DEPARTURE_MS,
          ),
        ),
      Math.max(0, Math.min(...deadlines) - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [presented, peers, connected, reduced]);
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) {
      positions.current.clear();
      return;
    }
    const next = new Map<string, { x: number; y: number }>();
    for (const node of root.querySelectorAll<HTMLElement>("[data-peer]")) {
      const at = { x: node.offsetLeft, y: node.offsetTop };
      const key = node.dataset.peer!;
      const old = positions.current.get(key);
      if (reduced)
        node.getAnimations?.().forEach((animation) => animation.cancel());
      if (
        old &&
        !reduced &&
        node.animate &&
        (Math.abs(old.x - at.x) > 1 || Math.abs(old.y - at.y) > 1)
      ) {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          [
            { transform: `translate(${old.x - at.x}px, ${old.y - at.y}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" },
        );
      }
      next.set(key, at);
    }
    positions.current = next;
  }, [presented, reduced]);
  const count = connected ? peers.filter((p) => p.advertised).length : 0;
  const live = new Set(
    connected ? peers.filter((p) => p.advertised).map((p) => p.mac) : [],
  );
  return (
    <section
      className={`discovery-stage ${connected ? "is-listening" : "is-idle"}`}
      aria-label={copy.nearby}
    >
      <div className="discovery-header">
        <div className="discovery-label">
          <Radio size={15} strokeWidth={1.7} />
          <h2>{copy.nearby}</h2>
          <span className="device-count">{count}</span>
        </div>
        <span className="discovery-status">
          <i className={`dot ${connected ? "blue" : "gray"}`} />
          {connected ? copy.scanning : copy.discoveryIdle}
        </span>
      </div>
      <div className="discovery-space">
        <div className="discovery-rings" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        {presented.length ? (
          <div className="peer-grid" ref={grid}>
            {presented.map((row) => {
              const available = live.has(row.peer.mac);
              return (
                <div
                  className={`peer-slot ${available ? "" : "is-leaving"}`}
                  key={row.peer.mac}
                  data-peer={row.peer.mac}
                  aria-hidden={!available || undefined}
                >
                  <PeerCard
                    peer={{ ...row.peer, advertised: available }}
                    selected={selected === row.peer.mac && available}
                    resolving={resolving === row.peer.mac && available}
                    copy={copy}
                    transfer={
                      transfer?.peer === row.peer.mac ? transfer : undefined
                    }
                    onSelect={() => {
                      if (available) onSelect(row.peer);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="discovery-empty">
            <span className="discovery-symbol">
              <Radio size={30} strokeWidth={1.25} />
            </span>
            <h3>{connected ? copy.nearbyEmpty : copy.discoveryWelcome}</h3>
            <p>{connected ? copy.nearbyHelp : copy.discoveryConnect}</p>
          </div>
        )}
        <div className="discovery-hub">
          <span className="hub-icon">
            <img src={brand} alt="" />
          </span>
          <strong>AirBridge PC</strong>
          <span>{copy.yourBridge}</span>
        </div>
      </div>
      <div className="discovery-footer">
        <span className="discovery-lock" aria-hidden="true">
          ↗
        </span>
        {copy.discoveryHint}
      </div>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {connected ? `${copy.nearby}: ${count}` : copy.disconnected}
      </span>
    </section>
  );
}
