import { describe, expect, it } from "vitest";
import { DEPARTURE_MS, reconcilePresence } from "./presence";
import type { Peer } from "./types";
const peer = (mac: string): Peer => ({
  mac,
  name: "Mac",
  name_source: "airdrop_discover",
  advertised: true,
  port: 8770,
  rssi: -60,
  last_seen: 1,
});
describe("discovery presentation eligibility", () => {
  it("retains stable ordering when scanner order changes and updates native names", () => {
    const first = reconcilePresence([], [peer("a"), peer("b")], 0);
    const next = reconcilePresence(
      first,
      [peer("b"), { ...peer("a"), name: "New name" }, peer("c")],
      100,
    );
    expect(next.map((p) => p.peer.mac)).toEqual(["a", "b", "c"]);
    expect(next[0].peer.name).toBe("New name");
  });
  it("disables a lost device immediately and removes it after the bounded exit", () => {
    const first = reconcilePresence([], [peer("a")], 0);
    const gone = reconcilePresence(first, [], 10);
    expect(gone[0].peer.advertised).toBe(false);
    expect(gone[0].leavingAt).toBe(10);
    expect(reconcilePresence(gone, [], 100)[0].leavingAt).toBe(10);
    expect(reconcilePresence(gone, [], 10 + DEPARTURE_MS)).toEqual([]);
  });
  it("cancels departure if the same identity reappears without adding a duplicate", () => {
    const gone = reconcilePresence(
      reconcilePresence([], [peer("a")], 0),
      [],
      10,
    );
    const back = reconcilePresence(gone, [{ ...peer("a"), name: "Back" }], 50);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      leavingAt: null,
      peer: { name: "Back", advertised: true },
    });
  });
  it("removes lost entries immediately for reduced motion and ignores unadvertised peers", () => {
    const first = reconcilePresence(
      [],
      [peer("a"), { ...peer("b"), advertised: false }],
      0,
    );
    expect(first).toHaveLength(1);
    expect(reconcilePresence(first, [], 10, 0)).toEqual([]);
  });
});
