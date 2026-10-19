import type { Peer } from "./types";

export const DEPARTURE_MS = 360;
export interface PresentedPeer {
  peer: Peer;
  leavingAt: number | null;
}

// Presentation-only retention. Eligibility always comes from the live snapshot.
export function reconcilePresence(
  previous: PresentedPeer[],
  live: Peer[],
  now: number,
  retention = DEPARTURE_MS,
): PresentedPeer[] {
  const current = new Map(
    live.filter((p) => p.advertised).map((p) => [p.mac, p]),
  );
  const next: PresentedPeer[] = [];
  for (const old of previous) {
    const peer = current.get(old.peer.mac);
    if (peer) {
      next.push({ peer, leavingAt: null });
      current.delete(peer.mac);
    } else {
      const leavingAt = old.leavingAt ?? now;
      if (now - leavingAt < retention)
        next.push({ peer: { ...old.peer, advertised: false }, leavingAt });
    }
  }
  for (const peer of current.values()) next.push({ peer, leavingAt: null });
  return next;
}
