import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityPanel } from "../src/ActivityPanel";
import { TransferDetails } from "../src/components";
import { DeviceDetails, BridgeDetails } from "../src/Details";
import { DiscoveryStage } from "../src/DiscoveryStage";
import { translations } from "../src/i18n";
import type { Language, Peer, Snapshot, Transfer } from "../src/types";
import "../src/styles.css";
import "../src/product.css";
import "./motion.css";
const time = Date.now();
const peer: Peer = {
  mac: "02:00:00:00:00:01",
  name: "Studio MacBook Pro",
  name_source: "airdrop_discover",
  advertised: true,
  port: 8770,
  rssi: -67,
  last_seen: time,
  observation: {
    host_label: "synthetic-host.local",
    service_instance: "synthetic._airdrop._tcp.local",
    channel6_mask: 65535,
    root_metric: 0,
    has_sync: true,
    has_election: true,
  },
};
const unknown: Peer = {
  ...peer,
  mac: "02:00:00:00:00:02",
  name: null,
  name_source: null,
  rssi: null,
  observation: undefined,
};
const common = {
  peer: peer.mac,
  peer_name: peer.name,
  bytes: 262145,
  done: 262145,
  progress_total: 262145,
  sha256: "abcdef0123456789".repeat(4),
  directory: null,
  error: null,
  updated: time,
  started: time - 18000,
};
const history: Transfer[] = [
  {
    ...common,
    id: "UI-MULTI",
    name: "Incoming files",
    direction: "receive",
    peer: null,
    peer_name: null,
    file_count: 2,
    state: "completed",
    directory: "Chosen folder / synthetic-transfer",
    sha256: null,
    files: [
      {
        name: "Coastline.jpg",
        bytes: 200000,
        metadata: false,
        sha256: "a".repeat(64),
      },
      {
        name: "Read me.txt",
        bytes: 62145,
        metadata: false,
        sha256: "b".repeat(64),
      },
      {
        name: "._Coastline.jpg",
        bytes: 128,
        metadata: true,
        sha256: "c".repeat(64),
      },
    ],
  },
  {
    ...common,
    id: "UI-SEND",
    name: "Weekend notes.pdf",
    direction: "send",
    state: "completed",
  },
  {
    ...common,
    id: "UI-PROGRESS",
    name: "Design archive.bin",
    direction: "send",
    state: "sending",
    done: 160000,
  },
  {
    ...common,
    id: "UI-UNCERTAIN",
    name: "Field recording.wav",
    direction: "receive",
    state: "uncertain",
    done: 50000,
    error: "Connection ended before native completion; no automatic retry.",
  },
];
function Preview() {
  const [language, setLanguage] = useState<Language>("en");
  const [selected, setSelected] = useState<string | null>(peer.mac);
  const [view, setView] = useState<Peer | Transfer | "bridge" | null>(null);
  const [notice, setNotice] = useState("");
  const copy = translations[language];
  const snapshot: Snapshot = {
    revision: 0,
    connection: "connected",
    can_resolve: true,
    resolving_peer: null,
    radio_mac: "02:00:00:00:00:aa",
    peers: [peer, unknown],
    transfers: history,
    receive_directory: "Synthetic folder",
    error: null,
    bridge_info: {
      protocol: 2,
      max_file: 1048576,
      chunk_bytes: 112,
      hardware_id: "Synthetic factory identity",
      usb_serial: null,
      port: null,
      paired_peer: peer.mac,
      connected_at: time,
    },
  };
  return (
    <main className="motion-preview">
      <div className="preview-disclosure">
        <strong>PRODUCT INTERACTION PREVIEW</strong>
        <span>Synthetic data · No serial connection · No AirDrop transfer</span>
      </div>
      <div className="preview-heading">
        <div>
          <p className="eyebrow">AIRBRIDGE / DETAILS</p>
          <h1>The details make the difference.</h1>
          <p>Devices, transfers, and clear information at every step.</p>
        </div>
        <a href="/">Open AirBridge ↗</a>
      </div>
      <DiscoveryStage
        peers={[peer, unknown]}
        connected={true}
        selected={selected}
        resolving={null}
        copy={copy}
        onSelect={(p) => setSelected(p.mac)}
        onInspect={setView}
      />
      <div className="preview-controls">
        <button onClick={() => setView("bridge")}>
          {copy.connectionDetails}
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
        <span role="status">{notice}</span>
      </div>
      <section style={{ marginTop: 24 }}>
        <ActivityPanel
          transfers={history}
          language={language}
          copy={copy}
          onDetails={(id) => setView(history.find((t) => t.id === id)!)}
        />
      </section>
      {view === "bridge" ? (
        <BridgeDetails
          snapshot={snapshot}
          language={language}
          native={false}
          copy={copy}
          onClose={() => setView(null)}
        />
      ) : view && "direction" in view ? (
        <TransferDetails
          transfer={view}
          copy={copy}
          language={language}
          onClose={() => setView(null)}
          onFolder={() => setNotice("Preview only — no receipt download")}
          folderLabel="Preview receipt"
          onCancel={() => setNotice("Preview only — no command sent")}
        />
      ) : view ? (
        <DeviceDetails
          peer={view}
          connected={true}
          canResolve={true}
          resolving={false}
          pending={false}
          language={language}
          copy={copy}
          onClose={() => setView(null)}
          onResolve={() => setNotice("Preview only — no name request sent")}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
