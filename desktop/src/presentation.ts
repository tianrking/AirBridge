import { terminal, type Transfer } from "./types";
import type { Copy } from "./i18n";
export type ActivityFilter = "all" | "send" | "receive" | "active";
export function progressOf(t: Transfer): number | null {
  if (t.state === "completed") return 100;
  if (
    !Number.isFinite(t.progress_total) ||
    t.progress_total <= 0 ||
    !Number.isFinite(t.done)
  )
    return null;
  return Math.max(0, Math.min(100, (t.done / t.progress_total) * 100));
}
export function transferName(t: Transfer, copy: Copy): string {
  const count = t.file_count ?? t.files?.filter((f) => !f.metadata).length ?? 1;
  return count > 1
    ? `${count} ${copy.filesLabel}`
    : t.name === "Incoming files"
      ? copy.incomingFiles
      : t.name;
}
export function filteredTransfers(
  items: Transfer[],
  filter: ActivityFilter,
  query: string,
): Transfer[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(
    (t) =>
      (filter === "all" ||
        (filter === "active" ? !terminal(t.state) : t.direction === filter)) &&
      (!needle ||
        [
          t.name,
          t.peer_name,
          t.peer,
          t.id,
          t.native_id,
          ...(t.files ?? []).map((f) => f.name),
        ].some((s) => s?.toLocaleLowerCase().includes(needle))),
  );
}
export function timeLabel(
  value: number | undefined,
  language: string,
  fallback: string,
): string {
  if (
    !value ||
    !Number.isFinite(value) ||
    !Number.isFinite(new Date(value).getTime())
  )
    return fallback;
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export const connectionBusy = (state: string) =>
  ["connecting", "disconnecting", "recovering"].includes(state);
export const ownsConnection = (state: string) =>
  connectionBusy(state) || state === "connected" || state === "cleanup_failed";
export function connectionLabel(state: string, copy: Copy): string {
  return [
    "connecting",
    "disconnecting",
    "recovering",
    "cleanup_failed",
    "connected",
  ].includes(state)
    ? copy[state as keyof Copy]
    : copy.disconnected;
}
