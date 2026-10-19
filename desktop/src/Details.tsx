import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Cable,
  Check,
  Copy as CopyIcon,
  MonitorSmartphone,
  RefreshCw,
} from "lucide-react";
import { Dialog } from "./Dialog";
import type { Copy } from "./i18n";
import { formatBytes, type Language, type Peer, type Snapshot } from "./types";
import { timeLabel, connectionLabel } from "./presentation";
export function CopyValue({ value, copy }: { value: string; copy: Copy }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="copy-value">
      <code dir="ltr">{value}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={state === "done" ? copy.copied : copy.copyValue}
        title={state === "error" ? copy.copyFailed : copy.copyValue}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("done");
          } catch {
            setState("error");
          }
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), 2000);
        }}
      >
        {state === "done" ? <Check size={14} /> : <CopyIcon size={14} />}
      </button>
      <span className="sr-only" role="status">
        {state === "done"
          ? copy.copied
          : state === "error"
            ? copy.copyFailed
            : ""}
      </span>
    </span>
  );
}
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>
        <bdi dir="auto">{children}</bdi>
      </dd>
    </div>
  );
}
export function DeviceDetails({
  peer,
  connected,
  canResolve,
  resolving,
  pending,
  language,
  copy,
  onClose,
  onResolve,
}: {
  peer: Peer;
  connected: boolean;
  canResolve: boolean;
  resolving: boolean;
  pending: boolean;
  language: Language;
  copy: Copy;
  onClose: () => void;
  onResolve: () => void;
}) {
  const available = connected && peer.advertised;
  const observation = peer.observation;
  const boolean = (value: boolean | null | undefined) =>
    typeof value === "boolean"
      ? value
        ? copy.yes
        : copy.no
      : copy.unknownValue;
  return (
    <Dialog
      title={peer.name ?? copy.appleDevice}
      eyebrow={copy.deviceDetails}
      icon={<MonitorSmartphone size={30} />}
      onClose={onClose}
      copy={copy}
    >
      <p className={`status-pill ${available ? "is-available" : "is-muted"}`}>
        <i className={`dot ${available ? "blue" : "gray"}`} />
        {available ? copy.advertised : copy.deviceDeparted}
      </p>
      <p className="dialog-description">
        {available ? copy.advertisementOnly : copy.addressHint}
      </p>
      <dl className="detail-list">
        <DetailRow label={copy.nativeNameSource}>
          {peer.name && peer.name_source === "airdrop_discover"
            ? "AirDrop TLS /Discover"
            : copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.awdlAddress}>
          <CopyValue value={peer.mac} copy={copy} />
        </DetailRow>
        <DetailRow label={copy.signalReading}>
          {peer.rssi !== null && Number.isFinite(peer.rssi)
            ? `${peer.rssi} dBm`
            : copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.servicePort}>
          {peer.port > 0 && peer.port <= 65535 ? peer.port : copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.reportedAt}>
          {timeLabel(peer.last_seen, language, copy.unknownValue)}
        </DetailRow>
      </dl>
      <p className="field-hint">
        {copy.signalHint} {copy.nameCacheHint}
      </p>
      <details className="technical-details">
        <summary>{copy.moreDetails}</summary>
        <dl className="detail-list">
          <DetailRow label={copy.hostLabel}>
            {observation?.host_label || copy.unknownValue}
          </DetailRow>
          <DetailRow label={copy.serviceInstance}>
            {observation?.service_instance || copy.unknownValue}
          </DetailRow>
          <DetailRow label={copy.channelMask}>
            {typeof observation?.channel6_mask === "number"
              ? `0x${observation.channel6_mask.toString(16).padStart(4, "0")}`
              : copy.unknownValue}
          </DetailRow>
          <DetailRow label={copy.electionMetric}>
            {observation?.root_metric ?? copy.unknownValue}
          </DetailRow>
          <DetailRow label={copy.syncSeen}>
            {boolean(observation?.has_sync)}
          </DetailRow>
          <DetailRow label={copy.electionSeen}>
            {boolean(observation?.has_election)}
          </DetailRow>
        </dl>
      </details>
      {canResolve ? (
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={!available || pending || resolving}
            onClick={onResolve}
          >
            <RefreshCw size={15} className={resolving ? "spin" : ""} />
            {resolving ? copy.connecting : copy.resolveName}
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
export function BridgeDetails({
  snapshot,
  language,
  native,
  copy,
  onClose,
}: {
  snapshot: Snapshot;
  language: Language;
  native: boolean;
  copy: Copy;
  onClose: () => void;
}) {
  const info = snapshot.bridge_info;
  return (
    <Dialog
      title="AirBridge PC"
      eyebrow={copy.connectionDetails}
      icon={<Cable size={30} />}
      onClose={onClose}
      copy={copy}
    >
      <p
        className={`status-pill ${snapshot.connection === "connected" ? "is-available" : "is-muted"}`}
      >
        {connectionLabel(snapshot.connection, copy)}
      </p>
      <p className="dialog-description">{copy.identitySource}</p>
      <dl className="detail-list">
        <DetailRow label={copy.transport}>
          {native ? "USB Serial/JTAG" : "Web Serial · USB Serial/JTAG"}
        </DetailRow>
        <DetailRow label={copy.bridgeIdentity}>
          {info?.hardware_id ? (
            <CopyValue value={info.hardware_id} copy={copy} />
          ) : (
            copy.unknownValue
          )}
        </DetailRow>
        <DetailRow label={copy.serialPort}>
          {info?.port ?? copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.usbSerial}>
          {info?.usb_serial ?? copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.awdlAddress}>
          {snapshot.radio_mac ? (
            <CopyValue value={snapshot.radio_mac} copy={copy} />
          ) : (
            copy.unknownValue
          )}
        </DetailRow>
        <DetailRow label={copy.protocolVersion}>
          {info?.protocol ?? copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.sendLimit}>
          {info?.max_file
            ? formatBytes(info.max_file, language)
            : copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.chunkSize}>
          {info?.chunk_bytes
            ? formatBytes(info.chunk_bytes, language)
            : copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.permittedPeer}>
          {info?.paired_peer ?? copy.unknownValue}
        </DetailRow>
        <DetailRow label={copy.connectedAt}>
          {timeLabel(info?.connected_at, language, copy.unknownValue)}
        </DetailRow>
      </dl>
      <p className="field-hint">
        {snapshot.connection !== "connected" && info
          ? copy.lastConnection
          : copy.addressHint}
      </p>
    </Dialog>
  );
}
