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
  ShieldCheck,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { CopyValue, DetailRow } from "./Details";
import { progressOf, timeLabel, transferName } from "./presentation";
import type { Copy } from "./i18n";
import {
  formatBytes,
  terminal,
  type Language,
  type Peer,
  type Transfer,
} from "./types";
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
      title={`${copy.deviceDetails}: ${peer.mac} · ${peer.rssi === null ? copy.unknownValue : `${peer.rssi} dBm`}`}
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
  language = "en",
}: {
  transfer: Transfer;
  copy: Copy;
  onDetails: () => void;
  language?: Language;
}) {
  const completed = transfer.state === "completed";
  const state = transferState(transfer, copy);
  const progress = progressOf(transfer);
  return (
    <button
      className={`transfer-row state-${transfer.state}`}
      onClick={onDetails}
      aria-label={`${copy.details}: ${transferName(transfer, copy)}`}
    >
      <span
        className={`file-icon ${transfer.direction === "receive" ? "is-incoming" : ""}`}
      >
        <File size={22} strokeWidth={1.5} />
      </span>
      <span className="transfer-content">
        <strong>{transferName(transfer, copy)}</strong>
        <span className="transfer-meta">
          {transfer.direction === "send" ? (
            <ArrowUpRight size={13} />
          ) : (
            <ArrowDownLeft size={13} />
          )}
          {transfer.peer_name ??
            (transfer.direction === "send"
              ? (transfer.peer ?? copy.appleDevice)
              : copy.senderUnknown)}
          <span>·</span>
          {formatBytes(transfer.bytes)}
        </span>
        {!terminal(transfer.state) ? (
          <span
            role="progressbar"
            aria-label={state}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
            className={`progress ${progress === null ? "indeterminate" : ""}`}
          >
            <span style={{ width: `${progress ?? 0}%` }} />
          </span>
        ) : null}
      </span>
      <span className="transfer-outcome">
        <span
          className={
            completed
              ? "success-text"
              : !terminal(transfer.state)
                ? "active-text"
                : "muted"
          }
        >
          {completed ? (
            <CheckCircle2 size={14} />
          ) : !terminal(transfer.state) ? (
            <LoaderCircle size={14} className="spin" />
          ) : null}
          {state}
        </span>
        <time
          dateTime={
            Number.isFinite(transfer.updated)
              ? new Date(transfer.updated).toISOString()
              : undefined
          }
        >
          {timeLabel(transfer.updated, language, copy.unknownValue)}
        </time>
      </span>
      <ChevronRight size={15} className="muted" />
    </button>
  );
}
function transferState(t: Transfer, copy: Copy): string {
  return t.state === "completed"
    ? t.direction === "send"
      ? copy.sent
      : copy.received
    : (copy[t.state as keyof Copy] ?? t.state);
}
export function TransferDetails({
  transfer,
  copy,
  onClose,
  onFolder,
  onCancel,
  folderLabel,
  language = "en",
  pending = false,
}: {
  transfer: Transfer;
  copy: Copy;
  onClose: () => void;
  onFolder: () => void;
  onCancel: () => void;
  folderLabel?: string;
  language?: Language;
  pending?: boolean;
}) {
  const state = transferState(transfer, copy);
  const progress = progressOf(transfer);
  const completed = transfer.state === "completed";
  const progressLabel =
    transfer.direction === "receive"
      ? copy.receiveProgress
      : transfer.state === "preparing"
        ? copy.sourcePreparation
        : copy.archiveProgress;
  return (
    <Dialog
      title={transferName(transfer, copy)}
      eyebrow={copy.details}
      icon={<File size={29} strokeWidth={1.4} />}
      onClose={onClose}
      copy={copy}
    >
      <p
        className={`status-pill ${completed ? "is-success" : terminal(transfer.state) ? "is-muted" : "is-available"}`}
      >
        {completed ? (
          <CheckCircle2 size={14} />
        ) : !terminal(transfer.state) ? (
          <LoaderCircle size={14} className="spin" />
        ) : null}
        {state}
      </p>
      {completed ? (
        <div className="confirmation">
          <ShieldCheck size={17} />
          {transfer.direction === "send"
            ? copy.nativeConfirmed
            : copy.hashChecked}
        </div>
      ) : null}
      {!terminal(transfer.state) ? (
        <div className="detail-progress">
          <div>
            <span>{progressLabel}</span>
            <strong>
              {progress === null ? "—" : `${Math.floor(progress)}%`}
            </strong>
          </div>
          <div
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
            className={`progress ${progress === null ? "indeterminate" : ""}`}
          >
            <span style={{ width: `${progress ?? 0}%` }} />
          </div>
        </div>
      ) : null}
      <dl className="detail-list">
        <DetailRow label={copy.byteCount}>
          {formatBytes(transfer.bytes)}{" "}
          <span className="muted">
            ({transfer.bytes.toLocaleString(language)} B)
          </span>
        </DetailRow>
        <DetailRow
          label={transfer.direction === "send" ? copy.recipient : copy.sender}
        >
          {transfer.peer_name ?? transfer.peer ?? copy.senderUnknown}
        </DetailRow>
        <DetailRow label={copy.startedAt}>
          {timeLabel(transfer.started, language, copy.unknownValue)}
        </DetailRow>
        <DetailRow label={copy.updatedAt}>
          {timeLabel(transfer.updated, language, copy.unknownValue)}
        </DetailRow>
      </dl>
      {transfer.error ? (
        <p className="detail-error" role="status">
          {transfer.error}
        </p>
      ) : null}
      {transfer.direction === "receive" &&
      completed &&
      transfer.files?.length ? (
        <section className="verified-list">
          <h3>
            <ShieldCheck size={15} />
            {copy.verifiedFiles}
          </h3>
          {transfer.files.map((file) => (
            <details key={file.name} className="verified-file">
              <summary>
                <span>
                  {file.name}
                  <small>
                    {file.metadata
                      ? copy.metadataFile
                      : formatBytes(file.bytes)}
                  </small>
                </span>
                <CheckCircle2 size={15} />
              </summary>
              <CopyValue value={file.sha256} copy={copy} />
            </details>
          ))}
        </section>
      ) : transfer.sha256 ? (
        <div className="hash-block">
          <label>
            {transfer.direction === "send"
              ? copy.sourceHash
              : copy.receivedHash}
          </label>
          <CopyValue value={transfer.sha256} copy={copy} />
          <p>
            {transfer.direction === "send"
              ? copy.outcomeHint
              : completed
                ? copy.incomingHint
                : copy.hashPending}
          </p>
        </div>
      ) : null}
      <details className="technical-details">
        <summary>{copy.operationDetails}</summary>
        <dl className="detail-list">
          <DetailRow label={copy.transferId}>
            <CopyValue value={transfer.id} copy={copy} />
          </DetailRow>
          {transfer.peer ? (
            <DetailRow label={copy.awdlAddress}>
              <CopyValue value={transfer.peer} copy={copy} />
            </DetailRow>
          ) : null}
          {transfer.directory ? (
            <DetailRow label={copy.receiveFolder}>
              {transfer.directory}
            </DetailRow>
          ) : null}
        </dl>
      </details>
      <div className="dialog-actions">
        {transfer.directory && completed ? (
          <button className="primary" onClick={onFolder} disabled={pending}>
            <FolderOpen size={16} />
            {folderLabel ?? copy.openFolder}
          </button>
        ) : null}
        {transfer.direction === "send" && !terminal(transfer.state) ? (
          <button
            className="secondary"
            onClick={onCancel}
            disabled={pending || transfer.state === "cancelling"}
          >
            {transfer.state === "cancelling" ? (
              <LoaderCircle size={15} className="spin" />
            ) : null}
            {transfer.state === "cancelling" ? copy.cancelling : copy.cancel}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
