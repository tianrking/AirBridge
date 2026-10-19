import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscoveryStage } from "../src/DiscoveryStage";
import { TransferRow } from "../src/components";
import { motionStyle } from "../src/motion";
import { translations } from "../src/i18n";
import type { Language, Peer, Transfer } from "../src/types";
import "../src/styles.css";
import "../src/product.css";
import "./motion.css";
const demo = (last: string, name: string): Peer => ({
  mac: `02:00:00:00:00:${last}`,
  name,
  name_source: "fixture_only",
  advertised: true,
  port: 8770,
  rssi: -55,
  last_seen: 0,
});
const mac = demo("01", "Studio MacBook Pro");
const phone = demo("02", "iPhone");
const pad = demo("03", "iPad Pro");
function Preview() {
  const [peers, setPeers] = useState([mac, phone]);
  const [selected, setSelected] = useState<string | null>(mac.mac);
  const [connected, setConnected] = useState(true);
  const [language, setLanguage] = useState<Language>("en");
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("sending");
  const [unknownProgress, setUnknownProgress] = useState(false);
  const [transferPeer, setTransferPeer] = useState<string | null>(mac.mac);
  const [resolving, setResolving] = useState<string | null>(null);
  const add = (peer: Peer) =>
    setPeers((old) =>
      old.some((p) => p.mac === peer.mac) ? old : [...old, peer],
    );
  const transfer: Transfer | undefined =
    progress === null
      ? undefined
      : {
          id: "UI-PREVIEW",
          direction: "send",
          name: "Synthetic preview",
          peer: transferPeer,
          state: phase,
          bytes: 100,
          done: progress,
          progress_total: unknownProgress ? 0 : 100,
          sha256: null,
          directory: null,
          error: null,
          updated: 0,
        };
  return (
    <main className="motion-preview" style={motionStyle}>
      <div className="preview-disclosure">
        <strong>INTERACTION PREVIEW</strong>
        <span>
          Synthetic devices · No serial connection · No AirDrop transfer
        </span>
      </div>
      <div className="preview-heading">
        <div>
          <p className="eyebrow">AIRBRIDGE / DESIGN</p>
          <h1>A little closer.</h1>
          <p>Discovery, selection, and the quiet details in between.</p>
        </div>
        <a href="/">Open AirBridge ↗</a>
      </div>
      <DiscoveryStage
        peers={peers}
        connected={connected}
        selected={selected}
        resolving={resolving}
        transfer={transfer}
        copy={translations[language]}
        onSelect={(peer) => setSelected(peer.mac)}
      />
      {transfer && (
        <TransferRow
          transfer={transfer}
          copy={translations[language]}
          onDetails={() => {}}
        />
      )}
      <div className="preview-controls" aria-label="Synthetic device controls">
        <button onClick={() => add(mac)}>Add Mac</button>
        <button onClick={() => add(phone)}>Add iPhone</button>
        <button onClick={() => add(pad)}>Add iPad</button>
        <button
          onClick={() =>
            setPeers((old) => old.filter((p) => p.mac !== phone.mac))
          }
        >
          Remove iPhone
        </button>
        <button
          onClick={() =>
            setPeers((old) => old.filter((p) => p.mac !== selected))
          }
        >
          Remove selected
        </button>
        <button onClick={() => setPeers((old) => [...old].reverse())}>
          Reorder scanner
        </button>
        <button onClick={() => setResolving((old) => (old ? null : selected))}>
          Toggle name lookup
        </button>
        <button
          onClick={() => {
            setTransferPeer(selected);
            setPhase("sending");
            setUnknownProgress(false);
            setProgress((old) => (old === null ? 62 : null));
          }}
        >
          Toggle transfer ring
        </button>
        <button
          onClick={() => {
            setUnknownProgress(false);
            setPhase("sending");
            setProgress(15);
          }}
        >
          Progress 15%
        </button>
        <button
          onClick={() => {
            setUnknownProgress(false);
            setPhase("sending");
            setProgress(82);
          }}
        >
          Progress 82%
        </button>
        <button
          onClick={() => {
            setUnknownProgress(true);
            setPhase("connecting");
            setProgress(0);
          }}
        >
          Unknown progress
        </button>
        <button
          onClick={() => {
            setUnknownProgress(false);
            setPhase("finishing");
            setProgress(100);
          }}
        >
          Await native confirmation
        </button>
        <button onClick={() => setPhase("completed")}>
          Confirm synthetic completion
        </button>
        <button onClick={() => setConnected((old) => !old)}>
          {connected ? "Disconnect" : "Connect"}
        </button>
        <select
          aria-label="Preview language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          <option value="en">English</option>
          <option value="zh-Hant">繁體中文</option>
          <option value="es">Español</option>
        </select>
      </div>
      <p className="preview-explanation">
        These controls exercise the production discovery component with
        synthetic snapshots. Lost devices become noninteractive immediately;
        their visual exit is retained for 360 ms. Scanner reordering preserves
        the visual order. This page is development-only and excluded from the
        production build.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
