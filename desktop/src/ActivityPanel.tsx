import { useState } from "react";
import { Activity, Download, Search, X } from "lucide-react";
import { TransferRow } from "./components";
import { filteredTransfers, type ActivityFilter } from "./presentation";
import type { Copy } from "./i18n";
import type { Language, Transfer } from "./types";

export function ActivityPanel({
  transfers,
  language,
  copy,
  onDetails,
  allowExport = true,
}: {
  transfers: Transfer[];
  language: Language;
  copy: Copy;
  onDetails: (id: string) => void;
  allowExport?: boolean;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");
  const visible = filteredTransfers(transfers, filter, query);
  function exportActivity() {
    if (!allowExport) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "airbridge-activity-v1",
              exported_at: new Date().toISOString(),
              scope: "current session, filtered selection",
              transfers: visible,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `AirBridge-activity-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="activity-panel">
      <div className="activity-toolbar">
        <div className="segmented" role="group" aria-label={copy.history}>
          {(
            [
              ["all", copy.allTransfers],
              ["send", copy.outgoingTransfers],
              ["receive", copy.incomingTransfers],
              ["active", copy.inProgress],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="secondary compact"
          disabled={!allowExport || !visible.length}
          onClick={exportActivity}
        >
          <Download size={14} />
          {copy.exportActivity}
        </button>
      </div>
      <label className="activity-search">
        <Search size={16} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchTransfers}
          aria-label={copy.searchTransfers}
        />
        {query ? (
          <button
            className="icon-button"
            aria-label={copy.clearSearch}
            onClick={() => setQuery("")}
          >
            <X size={14} />
          </button>
        ) : null}
        <span>{visible.length}</span>
      </label>
      {visible.length ? (
        visible.map((transfer) => (
          <TransferRow
            key={transfer.id}
            transfer={transfer}
            language={language}
            copy={copy}
            onDetails={() => onDetails(transfer.id)}
          />
        ))
      ) : (
        <div className="empty-activity">
          <Activity size={37} strokeWidth={1} />
          <h2>{transfers.length ? copy.noMatches : copy.emptyActivity}</h2>
          <p>
            {transfers.length ? copy.searchTransfers : copy.emptyActivityHelp}
          </p>
          {transfers.length ? (
            <button
              className="text-button"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              {copy.clearSearch}
            </button>
          ) : null}
        </div>
      )}
      <p className="session-note">{copy.sessionOnly}</p>
    </section>
  );
}
