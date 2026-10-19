import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  File,
  FolderOpen,
  Laptop,
  LoaderCircle,
  Smartphone,
  Tablet,
  MonitorSmartphone,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { Copy } from "./i18n";
import { formatBytes, terminal, type Peer, type Transfer } from "./types";
export function PeerCard({
  peer,
  selected,
  onSelect,
  copy,
  resolving = false,
  transfer,
}: {
  peer: Peer;
  selected: boolean;
  onSelect: () => void;
  copy: Copy;
  resolving?: boolean;
  transfer?: Transfer;
}) {
  const deviceName = peer.name ?? copy.appleDevice;
  const kind = peer.name?.toLowerCase() ?? "";
  const Icon = kind.includes("mac")
    ? Laptop
    : kind.includes("ipad")
      ? Tablet
      : kind.includes("iphone")
        ? Smartphone
        : MonitorSmartphone;
  const progress =
    transfer && transfer.progress_total > 0
      ? Math.min(
          100,
          Math.max(0, (100 * transfer.done) / transfer.progress_total),
        )
      : 0;
  return (
    <button
      className={`peer-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      disabled={!peer.advertised || !peer.port}
      aria-pressed={selected}
      aria-label={`${copy.selectDevice}: ${deviceName}`}
      title={`${copy.deviceDetails}: ${peer.mac} · ${peer.rssi} dBm`}
    >
      <span className={`peer-orbit ${transfer ? "has-progress" : ""}`}>
        <span className="peer-icon">
          <Icon size={35} strokeWidth={1.35} />
        </span>
        {resolving ? (
          <span className="peer-query-ring" aria-hidden="true" />
        ) : null}
        {transfer ? (
          <svg
            className={`peer-progress ${transfer.progress_total === 0 ? "indeterminate" : ""}`}
            viewBox="0 0 112 112"
            aria-hidden="true"
          >
            <circle
              cx="56"
              cy="56"
              r="52"
              pathLength="100"
              strokeDasharray={`${transfer.progress_total === 0 ? 23 : progress} 100`}
            />
          </svg>
        ) : null}
        {selected ? (
          <span className="peer-selected">
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className="peer-name">{deviceName}</span>
      <span className="peer-subtitle">
        {peer.name
          ? copy.nativeName
          : resolving
            ? copy.connecting
            : copy.resolving}
      </span>
      <span className="peer-foot">
        <i className="dot green" />
        {peer.advertised ? copy.advertised : copy.deviceDeparted}
      </span>
    </button>
  );
}
export function TransferRow({
  transfer,
  copy,
  onDetails,
}: {
  transfer: Transfer;
  copy: Copy;
  onDetails: () => void;
}) {
  const completed = transfer.state === "completed";
  const state = completed
    ? transfer.direction === "send"
      ? copy.sent
      : copy.received
    : (copy[transfer.state as keyof Copy] ?? transfer.state);
  const progress =
    transfer.progress_total > 0
      ? Math.min(100, (transfer.done / transfer.progress_total) * 100)
      : 0;
  return (
    <button
      className="transfer-row"
      onClick={onDetails}
      aria-label={`${copy.details}: ${transfer.name}`}
    >
      <span className="file-icon">
        <File size={22} strokeWidth={1.5} />
      </span>
      <span className="transfer-content">
        <strong>{transfer.name}</strong>
        <span className="transfer-meta">
          {transfer.direction === "send" ? (
            <ArrowUpRight size={13} />
          ) : (
            <ArrowDownLeft size={13} />
          )}
          {formatBytes(transfer.bytes)}
          <span>·</span>
          {state}
        </span>
        {!terminal(transfer.state) ? (
          <span
            role="progressbar"
            aria-label={state}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={transfer.progress_total ? progress : undefined}
            className={`progress ${transfer.progress_total === 0 ? "indeterminate" : ""}`}
          >
            <span style={{ width: `${progress}%` }} />
          </span>
        ) : null}
      </span>
      {completed ? (
        <CheckCircle2 size={18} className="success-icon" />
      ) : !terminal(transfer.state) ? (
        <LoaderCircle size={17} className="spin muted" />
      ) : (
        <span className="status-dot" />
      )}
      <ChevronRight size={16} className="muted" />
    </button>
  );
}
export function TransferDetails({
  transfer,
  copy,
  onClose,
  onFolder,
  onCancel,
  folderLabel,
}: {
  transfer: Transfer;
  copy: Copy;
  onClose: () => void;
  onFolder: () => void;
  onCancel: () => void;
  folderLabel?: string;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  const state =
    transfer.state === "completed"
      ? transfer.direction === "send"
        ? copy.sent
        : copy.received
      : (copy[transfer.state as keyof Copy] ?? transfer.state);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = dialog.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          );
          if (!items?.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label={copy.close}
        >
          <X size={20} />
        </button>
        <span className="large-file">
          <File size={34} strokeWidth={1.3} />
        </span>
        <p className="eyebrow">{copy.details}</p>
        <h2 id="transfer-title">{transfer.name}</h2>
        <p className="muted">
          {formatBytes(transfer.bytes)} · {state}
        </p>
        {transfer.state === "completed" ? (
          <div className="confirmation">
            <CheckCircle2 size={18} />
            {transfer.direction === "send"
              ? copy.nativeConfirmed
              : copy.hashChecked}
          </div>
        ) : null}
        {transfer.sha256 ? (
          <div className="hash-block">
            <label>
              {transfer.direction === "send"
                ? copy.sourceHash
                : copy.receivedHash}
            </label>
            <code>{transfer.sha256}</code>
            <p>
              {transfer.direction === "send"
                ? copy.outcomeHint
                : copy.incomingHint}
            </p>
          </div>
        ) : null}
        {transfer.error ? (
          <p className="detail-error">{transfer.error}</p>
        ) : null}
        {transfer.directory ? (
          <p className="folder-path">{transfer.directory}</p>
        ) : null}
        {transfer.directory && transfer.state === "completed" ? (
          <button className="primary" onClick={onFolder}>
            <FolderOpen size={17} />
            {folderLabel ?? copy.openFolder}
          </button>
        ) : null}
        {transfer.direction === "send" && !terminal(transfer.state) ? (
          <button className="secondary" onClick={onCancel}>
            {copy.cancel}
          </button>
        ) : null}
      </section>
    </div>
  );
}
