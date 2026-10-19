import { isTauri } from "@tauri-apps/api/core";
import { useDemoBridge } from "./demo";
import { useState } from "react";
import {
  Activity,
  Info,
  ArrowDownToLine,
  ArrowUpRight,
  Cable,
  ChevronRight,
  File,
  FolderOpen,
  Globe2,
  Sun,
  Moon,
  Monitor,
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
import { BrowserAccess, permissionHelp } from "./BrowserAccess";
import { locales, isLanguage, translations, webTranslations } from "./i18n";
import {
  formatBytes,
  terminal,
  type Page,
  type Peer,
  type SelectedFile,
} from "./types";
import { usePreferences } from "./usePreferences";
import { useBridge } from "./useBridge";
import {
  connectionBusy,
  connectionLabel,
  ownsConnection,
} from "./presentation";
import { APP_VERSION } from "./version";
import brand from "./brand.svg";
import { motionStyle } from "./motion";
export default function App() {
  return !isTauri() &&
    new URLSearchParams(window.location.search).get("demo") === "1" ? (
    <DemoApp />
  ) : (
    <LiveApp />
  );
}
function LiveApp() {
  return <BridgeApp bridge={useBridge()} />;
}
function DemoApp() {
  return <BridgeApp bridge={useDemoBridge()} demo />;
}
export function BridgeApp({
  bridge,
  demo = false,
}: {
  bridge: ReturnType<typeof useBridge>;
  demo?: boolean;
}) {
  const { snapshot } = bridge;
  const { language, setLanguage, theme, setTheme, resolvedTheme } =
    usePreferences();
  const [page, setPage] = useState<Page>("share");
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bridgePorts, setBridgePorts] = useState<
    { port: string; usb_serial: string }[]
  >([]);
  const [portChoice, setPortChoice] = useState("");
  const [inspector, setInspector] = useState<
    "bridge" | "disconnect" | "port" | Peer | null
  >(null);
  const baseCopy = translations[language];
  const copy = demo
    ? {
        ...baseCopy,
        nativeConfirmed: baseCopy.demoComplete,
        hashChecked: baseCopy.demoComplete,
        nativeName: baseCopy.demoLabel,
        advertised: baseCopy.demoLabel,
        advertisementOnly: baseCopy.demoDisclosure,
        identitySource: baseCopy.demoDisclosure,
        sent: `${baseCopy.sent} · ${baseCopy.demoLabel}`,
        received: `${baseCopy.received} · ${baseCopy.demoLabel}`,
      }
    : baseCopy;
  const webCopy = webTranslations[language];
  const connected = snapshot.connection === "connected";
  const busyConnection = connectionBusy(snapshot.connection);
  const ownsPort = ownsConnection(snapshot.connection);
  const peers = snapshot.peers.filter((peer) => peer.advertised);
  const target = peers.find((peer) => peer.mac === selectedPeer);
  const outgoing = snapshot.transfers.find(
    (transfer) => transfer.direction === "send" && !terminal(transfer.state),
  );
  const detail = snapshot.transfers.find(
    (transfer) => transfer.id === detailId,
  );
  const error = bridge.error;
  const permissionHint = bridge.native ? null : permissionHelp(error, language);
  const inspectedPeer =
    typeof inspector === "object" && inspector
      ? (snapshot.peers.find((peer) => peer.mac === inspector.mac) ?? {
          ...inspector,
          advertised: false,
        })
      : undefined;
  const authorizedPeer =
    snapshot.bridge_info?.paired_peer &&
    snapshot.bridge_info.paired_peer !== "00:00:00:00:00:00"
      ? snapshot.bridge_info.paired_peer
      : null;
  const activeTransfer = snapshot.transfers.some(
    (transfer) => !terminal(transfer.state),
  );
  async function connectAction() {
    if (connected && activeTransfer) {
      setInspector("disconnect");
      return;
    }
    if (
      bridge.native &&
      !connected &&
      !busyConnection &&
      snapshot.connection !== "cleanup_failed"
    ) {
      const ports =
        await bridge.call<{ port: string; usb_serial: string }[]>(
          "list_bridges",
        );
      if (ports) {
        setBridgePorts(ports);
        setPortChoice(ports[0]?.port ?? "");
        setInspector("port");
      }
      return;
    }
    void bridge.call(
      connected || snapshot.connection === "cleanup_failed"
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
    <div className="app-shell" style={motionStyle}>
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
                {connectionLabel(snapshot.connection, copy)}
              </span>
            </div>
          </div>
          <p>{copy.subtitle}</p>
          <span className="version">AirBridge {APP_VERSION}</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>{copy[page]}</span>
          {demo && <span className="demo-pill">{copy.demoLabel}</span>}
          <div className="topbar-status">
            <i className={`dot ${connected ? "green" : "gray"}`} />
            {connected
              ? copy.ready
              : connectionLabel(snapshot.connection, copy)}
          </div>
        </header>
        <div className={`page-content ${page === "share" ? "share-page" : ""}`}>
          {demo && (
            <section className="demo-banner" aria-label={copy.demoLabel}>
              <div>
                <strong>{copy.demoLabel}</strong>
                <p>{copy.demoDisclosure}</p>
              </div>
              <a className="secondary compact" href="./">
                {copy.exitDemo}
              </a>
            </section>
          )}
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
                <p>{permissionHint ?? error}</p>
                {permissionHint && (
                  <details>
                    <summary>{copy.details}</summary>
                    <p>{error}</p>
                  </details>
                )}
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
          {!demo && !bridge.native && (!connected || page === "settings") && (
            <BrowserAccess language={language} />
          )}
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
                  <p>
                    {connected
                      ? copy.ready
                      : ownsPort
                        ? copy.releaseHint
                        : copy.connectionHelp}
                  </p>
                </div>
                {!connected && !demo && (
                  <a className="text-button demo-link" href="?demo=1">
                    {copy.tryDemo}
                  </a>
                )}
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
                    busyConnection
                  }
                  onClick={connectAction}
                >
                  {busyConnection ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : null}
                  {connected
                    ? copy.disconnect
                    : snapshot.connection === "cleanup_failed"
                      ? copy.retryRelease
                      : busyConnection
                        ? connectionLabel(snapshot.connection, copy)
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
                transferring={activeTransfer}
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
                        <strong>
                          <bdi dir="auto">{selectedFile.name}</bdi>
                        </strong>
                        <span className="muted">
                          {formatBytes(selectedFile.bytes, language)}
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
                    {target ? (
                      <>
                        {copy.sendTo}{" "}
                        <bdi dir="auto">{target.name ?? copy.appleDevice}</bdi>
                      </>
                    ) : (
                      copy.send
                    )}
                  </button>
                </section>
                <section className="receive-panel">
                  <span className="receive-symbol">
                    <ArrowDownToLine size={27} strokeWidth={1.3} />
                  </span>
                  <h2>
                    {connected
                      ? authorizedPeer
                        ? copy.receiverLinked
                        : copy.authorizeToReceive
                      : copy.receiverOffline}
                  </h2>
                  <p>
                    {connected
                      ? authorizedPeer
                        ? copy.receiverHelp
                        : copy.authorizeHelp
                      : copy.connectionHelp}
                  </p>
                  {connected && snapshot.bridge_info?.pairing && (
                    <div className="receive-permissions">
                      <button
                        className="secondary compact"
                        disabled={!target || bridge.pending || activeTransfer}
                        onClick={() =>
                          target &&
                          void bridge.call("pair_peer", {
                            peer: target.mac,
                            port: target.port,
                          })
                        }
                      >
                        {copy.authorizePeer}
                      </button>
                      {authorizedPeer && (
                        <button
                          className="text-button"
                          disabled={bridge.pending || activeTransfer}
                          onClick={() => void bridge.call("unpair_peer")}
                        >
                          {copy.revokePeer}
                        </button>
                      )}
                      {authorizedPeer && (
                        <p>
                          {copy.authorizedPeer}:{" "}
                          <bdi dir="auto">
                            {peers.find((p) => p.mac === authorizedPeer)
                              ?.name ?? authorizedPeer}
                          </bdi>
                        </p>
                      )}
                    </div>
                  )}
                  <div className="receive-identity">
                    <Laptop size={18} />
                    <strong>AirBridge PC</strong>
                    <span className={`dot ${connected ? "green" : "gray"}`} />
                  </div>
                  {!bridge.native ? (
                    <p className="browser-location">
                      {snapshot.receive_directory ? (
                        <bdi dir="auto">{snapshot.receive_directory}</bdi>
                      ) : (
                        webCopy.noFolder
                      )}
                    </p>
                  ) : null}
                  <button
                    className="text-button"
                    disabled={
                      !bridge.native &&
                      (ownsPort ||
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
                    <ChevronRight className="directional-icon" size={14} />
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
                    <ChevronRight className="directional-icon" size={14} />
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
                    isLanguage(event.target.value) &&
                    setLanguage(event.target.value)
                  }
                >
                  {locales.map((locale) => (
                    <option key={locale.id} value={locale.id} lang={locale.id}>
                      {locale.name}
                    </option>
                  ))}
                </select>
              </section>
              <section className="setting-card appearance-card">
                <span className="setting-icon">
                  <Sun size={21} />
                </span>
                <div className="setting-copy">
                  <h2 id="appearance-heading">{copy.appearance}</h2>
                  <p>{copy.appearanceHelp}</p>
                  <p className="theme-status" aria-live="polite">
                    {theme === "system"
                      ? resolvedTheme === "dark"
                        ? copy.systemDark
                        : copy.systemLight
                      : copy[theme]}
                  </p>
                </div>
                <div
                  className="theme-choices"
                  role="group"
                  aria-labelledby="appearance-heading"
                >
                  {(
                    [
                      { id: "light", Icon: Sun },
                      { id: "dark", Icon: Moon },
                      { id: "system", Icon: Monitor },
                    ] as const
                  ).map(({ id, Icon }) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={theme === id}
                      onClick={() => setTheme(id)}
                    >
                      <Icon size={18} />
                      <span>{copy[id]}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="setting-card folder-setting">
                <div className="setting-icon">
                  <FolderOpen size={21} />
                </div>
                <div className="setting-copy">
                  <h2>{copy.receiveFolder}</h2>
                  <p className="folder-path">
                    {snapshot.receive_directory ? (
                      <bdi dir="auto">{snapshot.receive_directory}</bdi>
                    ) : (
                      webCopy.noFolder
                    )}
                  </p>
                  {ownsPort ? <p>{copy.disconnectFolder}</p> : null}
                  {!bridge.native ? <p>{copy.folderBrowserHint}</p> : null}
                </div>
                <button
                  className="secondary compact"
                  disabled={ownsPort || bridge.pending}
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
                  <p>
                    {connected
                      ? copy.ready
                      : connectionLabel(snapshot.connection, copy)}
                  </p>
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
                    <dd>{APP_VERSION}</dd>
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
            <a
              className="release-link"
              href={
                "https://github.com/tianrking/AirBridge/releases/tag/v" +
                APP_VERSION
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.downloads}
            </a>
          </footer>
        </div>
      </main>
      {inspector === "port" ? (
        <Dialog
          title={copy.selectBridge}
          copy={copy}
          onClose={() => setInspector(null)}
          icon={<Cable size={29} />}
        >
          <p className="dialog-description">
            {bridgePorts.length ? copy.bridgePortHelp : copy.noBridges}
          </p>
          {bridgePorts.length > 0 && (
            <select
              className="port-select"
              aria-label={copy.serialPort}
              value={portChoice}
              onChange={(e) => setPortChoice(e.target.value)}
            >
              {bridgePorts.map((p) => (
                <option value={p.port} key={p.port}>
                  {p.port} · {p.usb_serial}
                </option>
              ))}
            </select>
          )}
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={!portChoice || bridge.pending}
              onClick={async () => {
                const selection = bridgePorts.find(
                  (p) => p.port === portChoice,
                );
                if (selection) {
                  const result = await bridge.call("connect_bridge", {
                    selection,
                  });
                  if (result !== undefined) setInspector(null);
                }
              }}
            >
              {copy.connect}
            </button>
          </div>
        </Dialog>
      ) : inspector === "bridge" ? (
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
