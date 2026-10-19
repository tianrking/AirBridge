import { useEffect, useState } from "react";
import {
  Activity,
  Info,
  ArrowDownToLine,
  ArrowUpRight,
  Cable,
  ChevronRight,
  CircleHelp,
  File,
  FolderOpen,
  Globe2,
  Laptop,
  LoaderCircle,
  Send,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { TransferDetails, TransferRow } from "./components";
import { ActivityPanel } from "./ActivityPanel";
import { DeviceDetails, BridgeDetails } from "./Details";
import { Dialog } from "./Dialog";
import { DiscoveryStage } from "./DiscoveryStage";
import { readLanguage, translations, webTranslations } from "./i18n";
import {
  formatBytes,
  terminal,
  type Language,
  type Page,
  type Peer,
  type SelectedFile,
} from "./types";
import { useBridge } from "./useBridge";
import brand from "./brand.svg";
export default function App() {
  const bridge = useBridge();
  const { snapshot } = bridge;
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [page, setPage] = useState<Page>("share");
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [inspector, setInspector] = useState<
    "bridge" | "disconnect" | Peer | null
  >(null);
  const copy = translations[language];
  const webCopy = webTranslations[language];
  const connected = snapshot.connection === "connected";
  const peers = snapshot.peers.filter((peer) => peer.advertised);
  const target = peers.find((peer) => peer.mac === selectedPeer);
  const outgoing = snapshot.transfers.find(
    (transfer) => transfer.direction === "send" && !terminal(transfer.state),
  );
  const detail = snapshot.transfers.find(
    (transfer) => transfer.id === detailId,
  );
  const error = bridge.error;
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("airbridge.language.v1", language);
    } catch {
      /* Preference storage is optional. */
    }
  }, [language]);
  const inspectedPeer =
    typeof inspector === "object" && inspector
      ? (snapshot.peers.find((peer) => peer.mac === inspector.mac) ?? {
          ...inspector,
          advertised: false,
        })
      : undefined;
  const activeTransfer = snapshot.transfers.some(
    (transfer) => !terminal(transfer.state),
  );
  function connectAction() {
    if (connected && activeTransfer) {
      setInspector("disconnect");
      return;
    }
    void bridge.call(
      connected
        ? "disconnect_bridge"
        : !bridge.native && !snapshot.receive_directory
          ? "choose_receive_folder"
          : "connect_bridge",
    );
  }
  async function chooseFile() {
    const file = await bridge.call<SelectedFile | null>("choose_file");
    if (file) setSelectedFile(file);
  }
  async function sendFile() {
    if (!target || !selectedFile) return;
    const result = await bridge.call<null>("send_file", {
      fileId: selectedFile.id,
      peer: target.mac,
    });
    if (result !== undefined) setSelectedFile(null);
  }
  const title =
    page === "share"
      ? copy.title
      : page === "activity"
        ? copy.history
        : copy.preferences;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={brand} alt="" />
          <span>AirBridge</span>
        </div>
        <nav aria-label={copy.navigation}>
          {(
            [
              { id: "share", label: copy.share, Icon: Send },
              { id: "activity", label: copy.activity, Icon: Activity },
              { id: "settings", label: copy.settings, Icon: Settings2 },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={18} strokeWidth={1.7} />
              {label}
              {id === "activity" && snapshot.transfers.length ? (
                <span className="count">{snapshot.transfers.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-bridge">
            <Cable size={18} />
            <div>
              <strong>ESP32-S3</strong>
              <span>
                <i className={`dot ${connected ? "green" : "gray"}`} />
                {connected ? copy.connected : copy.disconnected}
              </span>
            </div>
          </div>
          <p>{copy.subtitle}</p>
          <span className="version">AirBridge 0.4.0</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>{copy[page]}</span>
          <div className="topbar-status">
            <i className={`dot ${connected ? "green" : "gray"}`} />
            {connected ? copy.ready : copy.disconnected}
          </div>
        </header>
        <div className={`page-content ${page === "share" ? "share-page" : ""}`}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">AirBridge</p>
              <h1>{title}</h1>
              <p>
                {page === "share"
                  ? copy.description
                  : page === "activity"
                    ? copy.historyHelp
                    : copy.preferencesHelp}
              </p>
            </div>
          </div>
          {error ? (
            <div className="error-banner" role="alert">
              <div>
                <strong>{copy.error}</strong>
                <p>{error}</p>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  bridge.clearError();
                }}
                aria-label={copy.dismiss}
              >
                <X size={17} />
              </button>
            </div>
          ) : null}
          {!bridge.native && (bridge.unsupported || page === "settings") ? (
            <div className="preview-note">
              <CircleHelp size={16} />
              {bridge.unsupported ?? webCopy.help}
            </div>
          ) : null}
          {page === "share" ? (
            <>
              <section className="bridge-strip">
                <span className={`bridge-glyph ${connected ? "online" : ""}`}>
                  <Cable size={23} strokeWidth={1.6} />
                </span>
                <div>
                  <strong>
                    {copy.bridge}
                    <span className="chip">ESP32-S3</span>
                  </strong>
                  <p>{connected ? copy.ready : copy.connectionHelp}</p>
                </div>
                <button
                  className="icon-button bridge-info"
                  aria-label={copy.connectionDetails}
                  title={copy.connectionDetails}
                  onClick={() => setInspector("bridge")}
                >
                  <Info size={17} />
                </button>
                <button
                  className={
                    connected ? "secondary compact" : "primary compact"
                  }
                  disabled={
                    bridge.pending ||
                    Boolean(bridge.unsupported) ||
                    snapshot.connection === "connecting"
                  }
                  onClick={connectAction}
                >
                  {snapshot.connection === "connecting" ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : null}
                  {connected
                    ? copy.disconnect
                    : snapshot.connection === "connecting"
                      ? copy.connecting
                      : !bridge.native && !snapshot.receive_directory
                        ? webCopy.prepare
                        : copy.connect}
                </button>
              </section>
              <DiscoveryStage
                peers={peers}
                connected={connected}
                selected={selectedPeer}
                resolving={snapshot.resolving_peer}
                transfer={outgoing}
                copy={copy}
                onInspect={setInspector}
                onSelect={(peer) => {
                  setSelectedPeer(peer.mac);
                  if (
                    !peer.name &&
                    snapshot.can_resolve &&
                    !snapshot.resolving_peer &&
                    !outgoing
                  )
                    void bridge.call("resolve_peer", { peer: peer.mac });
                }}
              />
              <div className="share-columns">
                <section className="file-panel">
                  <div className="section-heading">
                    <h2>{copy.yourFile}</h2>
                    <File size={14} className="muted" aria-hidden="true" />
                  </div>
                  <div
                    className={`file-drop ${selectedFile ? "has-file" : ""}`}
                  >
                    {selectedFile ? (
                      <>
                        <span className="large-file">
                          <File size={32} strokeWidth={1.3} />
                        </span>
                        <strong>{selectedFile.name}</strong>
                        <span className="muted">
                          {formatBytes(selectedFile.bytes)}
                        </span>
                        <button
                          className="text-button"
                          disabled={bridge.pending || Boolean(outgoing)}
                          onClick={() => void chooseFile()}
                        >
                          {copy.chooseAnother}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="upload-symbol">
                          <Upload size={27} strokeWidth={1.4} />
                        </span>
                        <strong>{copy.fileEmpty}</strong>
                        <p>{copy.fileHint}</p>
                        <button
                          className="secondary"
                          disabled={bridge.pending || Boolean(outgoing)}
                          onClick={() => void chooseFile()}
                        >
                          <File size={15} />
                          {copy.chooseFile}
                        </button>
                      </>
                    )}
                    {selectedFile ? (
                      <button
                        className="icon-button remove-file"
                        disabled={bridge.pending || Boolean(outgoing)}
                        aria-label={copy.remove}
                        onClick={() => setSelectedFile(null)}
                      >
                        <X size={15} />
                      </button>
                    ) : null}
                  </div>
                  <button
                    className="primary send-button"
                    disabled={
                      !connected ||
                      !target ||
                      !selectedFile ||
                      Boolean(outgoing) ||
                      Boolean(snapshot.resolving_peer) ||
                      bridge.pending
                    }
                    onClick={() => void sendFile()}
                  >
                    <ArrowUpRight size={18} />
                    {target
                      ? `${copy.sendTo} ${target.name ?? copy.appleDevice}`
                      : copy.send}
                  </button>
                </section>
                <section className="receive-panel">
                  <span className="receive-symbol">
                    <ArrowDownToLine size={27} strokeWidth={1.3} />
                  </span>
                  <h2>
                    {connected ? copy.receiverLinked : copy.receiverOffline}
                  </h2>
                  <p>{connected ? copy.receiverHelp : copy.connectionHelp}</p>
                  <div className="receive-identity">
                    <Laptop size={18} />
                    <strong>AirBridge PC</strong>
                    <span className={`dot ${connected ? "green" : "gray"}`} />
                  </div>
                  {!bridge.native ? (
                    <p className="browser-location">
                      {snapshot.receive_directory || webCopy.noFolder}
                    </p>
                  ) : null}
                  <button
                    className="text-button"
                    disabled={
                      !bridge.native &&
                      (connected ||
                        bridge.pending ||
                        Boolean(bridge.unsupported))
                    }
                    onClick={() =>
                      void bridge.call(
                        bridge.native
                          ? "open_receive_folder"
                          : "choose_receive_folder",
                        {
                          transferId: null,
                        },
                      )
                    }
                  >
                    <FolderOpen size={16} />
                    {bridge.native ? copy.openFolder : copy.changeFolder}
                    <ChevronRight size={14} />
                  </button>
                </section>
              </div>
              <section className="recent-section">
                <div className="section-heading">
                  <h2>{copy.recent}</h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("activity")}
                  >
                    {copy.allActivity}
                    <ChevronRight size={14} />
                  </button>
                </div>
                {snapshot.transfers.length ? (
                  snapshot.transfers
                    .slice(0, 3)
                    .map((transfer) => (
                      <TransferRow
                        key={transfer.id}
                        transfer={transfer}
                        copy={copy}
                        language={language}
                        onDetails={() => setDetailId(transfer.id)}
                      />
                    ))
                ) : (
                  <p className="empty-recent">{copy.emptyActivityHelp}</p>
                )}
              </section>
            </>
          ) : page === "activity" ? (
            <ActivityPanel
              transfers={snapshot.transfers}
              language={language}
              copy={copy}
              onDetails={setDetailId}
            />
          ) : (
            <div className="settings-stack">
              <section className="setting-card">
                <div className="setting-icon">
                  <Globe2 size={21} />
                </div>
                <div className="setting-copy">
                  <h2>{copy.language}</h2>
                  <p>{copy.languageHelp}</p>
                </div>
                <select
                  aria-label={copy.language}
                  value={language}
                  onChange={(event) =>
                    setLanguage(event.target.value as Language)
                  }
                >
                  <option value="en">English</option>
                  <option value="zh-Hant">繁體中文</option>
                  <option value="es">Español</option>
                </select>
              </section>
              <section className="setting-card folder-setting">
                <div className="setting-icon">
                  <FolderOpen size={21} />
                </div>
                <div className="setting-copy">
                  <h2>{copy.receiveFolder}</h2>
                  <p className="folder-path">
                    {snapshot.receive_directory || webCopy.noFolder}
                  </p>
                  {connected ? <p>{copy.disconnectFolder}</p> : null}
                  {!bridge.native ? <p>{copy.folderBrowserHint}</p> : null}
                </div>
                <button
                  className="secondary compact"
                  disabled={connected || bridge.pending}
                  onClick={async () => {
                    const folder = await bridge.call<string | null>(
                      "choose_receive_folder",
                    );
                    if (folder) await bridge.refresh();
                  }}
                >
                  {copy.changeFolder}
                </button>
              </section>
              <section className="setting-card">
                <span className="setting-icon">
                  <Cable size={21} />
                </span>
                <div className="setting-copy">
                  <h2>{copy.connectionDetails}</h2>
                  <p>{connected ? copy.ready : copy.disconnected}</p>
                </div>
                <button
                  className="secondary compact"
                  onClick={() => setInspector("bridge")}
                >
                  <Info size={14} />
                  {copy.viewDetails}
                </button>
              </section>
              <section className="about-card">
                <span className="setting-icon">
                  <ShieldCheck size={23} />
                </span>
                <h2>{copy.about}</h2>
                <p>{copy.privacy}</p>
                <dl>
                  <div>
                    <dt>{copy.version}</dt>
                    <dd>0.4.0</dd>
                  </div>
                  <div>
                    <dt>{copy.hardware}</dt>
                    <dd>ESP32-S3 · PSRAM</dd>
                  </div>
                  <div>
                    <dt>{copy.transport}</dt>
                    <dd>
                      {bridge.native
                        ? "USB Serial/JTAG"
                        : "Web Serial · USB Serial/JTAG"}
                    </dd>
                  </div>
                </dl>
                <div className="compatibility">
                  <h3>{copy.currentLimits}</h3>
                  <p>{copy.limits}</p>
                  <p>{copy.reliability}</p>
                  <p>{copy.receivingAuto}</p>
                </div>
              </section>
            </div>
          )}
          <footer>
            <span className="footer-mark" />
            AirBridge
            <span className="footer-divider" />
            {copy.help}
          </footer>
        </div>
      </main>
      {inspector === "bridge" ? (
        <BridgeDetails
          snapshot={snapshot}
          language={language}
          native={bridge.native}
          copy={copy}
          onClose={() => setInspector(null)}
        />
      ) : inspector === "disconnect" ? (
        <Dialog
          title={copy.disconnectTitle}
          icon={<Cable size={29} />}
          copy={copy}
          onClose={() => setInspector(null)}
        >
          <p className="dialog-description">{copy.disconnectHint}</p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setInspector(null)}>
              {copy.keepConnected}
            </button>
            <button
              className="primary danger"
              disabled={bridge.pending}
              onClick={() => {
                setInspector(null);
                void bridge.call("disconnect_bridge");
              }}
            >
              {copy.disconnectNow}
            </button>
          </div>
        </Dialog>
      ) : inspectedPeer ? (
        <DeviceDetails
          peer={inspectedPeer}
          connected={connected}
          canResolve={snapshot.can_resolve}
          resolving={Boolean(snapshot.resolving_peer)}
          pending={bridge.pending || Boolean(outgoing)}
          language={language}
          copy={copy}
          onClose={() => setInspector(null)}
          onResolve={() =>
            void bridge.call("resolve_peer", { peer: inspectedPeer.mac })
          }
        />
      ) : null}
      {detail ? (
        <TransferDetails
          transfer={detail}
          copy={copy}
          language={language}
          pending={bridge.pending}
          folderLabel={bridge.native ? copy.openFolder : webCopy.receipt}
          onClose={() => setDetailId(null)}
          onFolder={() =>
            void bridge.call("open_receive_folder", { transferId: detail.id })
          }
          onCancel={() => void bridge.call("cancel_transfer")}
        />
      ) : null}
    </div>
  );
}
