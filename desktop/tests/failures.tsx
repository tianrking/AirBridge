import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BridgeApp } from "../src/App";
import { useBridgeCommands } from "../src/useBridge";
import { WebBridge } from "../src/web/bridge";
import { check, base64, sha256 } from "../src/web/protocol";
import type { DiskDirectory, DiskFile } from "../src/web/platform";
import { deferred, VirtualPort } from "./virtual-port";
import "../src/styles.css";
import "../src/product.css";

const mount = document.querySelector<HTMLDivElement>("#fixture")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLPreElement>("#result")!;
const peer = "02:00:00:00:00:01";
const source = new File(
  [new Uint8Array(4097).fill(73)],
  "Browser-failure-source.bin",
);
async function until(test: () => unknown, description: string, timeout = 6000) {
  const end = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > end) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}
function click(text: string, root: ParentNode = mount) {
  const target = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  check(target && !target.disabled, `Button unavailable: ${text}`);
  target.click();
}
function clickLabel(label: string) {
  const target = [...mount.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  check(target && !target.disabled, `Control unavailable: ${label}`);
  target.click();
}
function Fixture({ client }: { client: WebBridge }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const commands = useBridgeCommands(false, client);
  return (
    <BridgeApp
      bridge={{
        ...commands,
        error: commands.error ?? snapshot.error,
        snapshot,
        native: false,
        unsupported: null,
        refresh: async () => {},
      }}
    />
  );
}
function inject(target: object, name: string, value: unknown) {
  const old = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (old) Object.defineProperty(target, name, old);
    else Reflect.deleteProperty(target, name);
  };
}
// Wrap only this fixture's real OPFS handles to inject a final receipt-close error.
function failFinalReceipt(
  inner: DiskDirectory,
  count = { value: 0 },
): DiskDirectory {
  return {
    name: inner.name,
    async getDirectoryHandle(name, opts) {
      return failFinalReceipt(
        await inner.getDirectoryHandle(name, opts),
        count,
      );
    },
    async getFileHandle(name, opts): Promise<DiskFile> {
      const handle = await inner.getFileHandle(name, opts);
      return {
        name,
        getFile: () => handle.getFile(),
        async createWritable() {
          const stream = await handle.createWritable();
          return {
            write: (data) => stream.write(data),
            async close() {
              if (name === "airbridge-receipt.json" && ++count.value === 3)
                throw new Error("Injected final receipt close failure");
              await stream.close();
            },
            abort: () => stream.abort(),
          };
        },
      };
    },
  };
}
button.onclick = async () => {
  button.disabled = true;
  const checks: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const originalLanguage = localStorage.getItem("airbridge.language.v1");
  localStorage.setItem("airbridge.language.v1", "en");
  try {
    const storage = await navigator.storage.getDirectory();
    const work = await storage.getDirectoryHandle(
      `airbridge-failure-qa-${crypto.randomUUID()}`,
      { create: true },
    );
    async function scenario(
      name: string,
      run: (c: {
        client: WebBridge;
        port: VirtualPort;
        next: (p: VirtualPort) => void;
        folder: FileSystemDirectoryHandle;
      }) => Promise<void>,
      receiptFault = false,
    ) {
      const folder = await work.getDirectoryHandle(`case-${checks.length}`, {
        create: true,
      });
      const disk = folder as unknown as DiskDirectory;
      const port = new VirtualPort();
      let selected = port;
      const undo = [
        inject(navigator, "serial", { requestPort: async () => selected }),
        inject(window, "showDirectoryPicker", async () =>
          receiptFault ? failFinalReceipt(disk) : disk,
        ),
        inject(window, "showOpenFilePicker", async () => [
          { getFile: async () => source },
        ]),
      ];
      const client = new WebBridge();
      const root = createRoot(mount);
      try {
        root.render(<Fixture client={client} />);
        await until(
          () => mount.textContent?.includes("Choose receive folder"),
          "initial UI",
        );
        click("Choose receive folder");
        await until(
          () =>
            mount
              .querySelector(".bridge-strip")
              ?.textContent?.includes("Connect bridge"),
          "folder prepared",
        );
        click("Connect bridge");
        await until(
          () => client.snapshot.connection === "connected",
          "connected UI",
        );
        await run({
          client,
          port,
          next: (p) => {
            selected = p;
          },
          folder,
        });
        checks.push(name);
        rows.push({ name, passed: true });
        result.textContent = JSON.stringify(
          { status: "running", passed: checks.length, checks },
          null,
          2,
        );
      } finally {
        await client.call("disconnect_bridge").catch(() => {});
        root.unmount();
        undo.reverse().forEach((restore) => restore());
      }
    }
    async function recipient(client: WebBridge, port: VirtualPort) {
      port.emit({
        event: "scanner_status",
        peers: [
          {
            mac: peer,
            airdrop_advertised: true,
            airdrop_port: 8770,
            rssi: -60,
          },
        ],
      });
      port.emit({
        event: "peer_identity",
        error: 0,
        mac: peer,
        display_name: "Synthetic Studio Mac",
      });
      await until(
        () => mount.textContent?.includes("Synthetic Studio Mac"),
        "native name label",
      );
      clickLabel("Choose a recipient: Synthetic Studio Mac");
      click("Choose a file");
      await until(
        () =>
          mount
            .querySelector(".send-button")
            ?.textContent?.includes("Synthetic Studio Mac") &&
          !(mount.querySelector(".send-button") as HTMLButtonElement).disabled,
        "send enabled",
      );
      check(
        client.snapshot.peers[0].name_source === "airdrop_discover",
        "Name provenance lost",
      );
    }
    await scenario(
      "cancel staging: duplicate clicks, pending controls and no replay",
      async ({ client, port }) => {
        const gate = deferred();
        port.beforeWrite = (record) =>
          record.includes(" DATA ") ? gate.promise : Promise.resolve();
        await recipient(client, port);
        click("Send to Synthetic Studio Mac");
        await until(
          () => port.records.some((r) => r.includes(" DATA ")),
          "staging blocked",
        );
        clickLabel("Transfer details: Browser-failure-source.bin");
        await until(
          () => mount.querySelector("dialog[open]"),
          "transfer dialog",
        );
        click("Cancel", mount.querySelector("dialog")!);
        await until(
          () => client.snapshot.transfers[0].state === "cancelling",
          "cancel pending",
        );
        const cancel = [
          ...mount.querySelectorAll<HTMLButtonElement>("dialog button"),
        ].find((b) => b.textContent?.includes("Cancelling"));
        check(cancel?.disabled, "Cancel remains enabled while pending");
        gate.resolve();
        await until(
          () => client.snapshot.transfers[0].state === "cancelled",
          "cancelled result",
        );
        check(
          port.records.filter((r) => r.includes(" CANCEL ")).length === 1,
          "Duplicate cancellation command",
        );
        check(
          !port.records.some((r) => r.includes(" SEND ")),
          "Cancelled source was sent",
        );
        check(
          !mount.querySelector('[role="alert"]'),
          "Successful cancellation presented as a global error",
        );
      },
    );
    await scenario(
      "active disconnect confirmation and uncertain history",
      async ({ client, port }) => {
        await recipient(client, port);
        click("Send to Synthetic Studio Mac");
        await until(
          () => port.records.some((r) => r.includes(" SEND ")),
          "native wait",
        );
        click("Disconnect");
        await until(
          () => mount.querySelector("dialog[open]"),
          "disconnect confirmation",
        );
        click("Stay connected");
        await until(
          () => !mount.querySelector("dialog"),
          "confirmation dismissed",
        );
        check(!port.closed, "Stay connected closed serial");
        click("Disconnect");
        await until(
          () => mount.querySelector("dialog[open]"),
          "confirmation again",
        );
        click("Disconnect anyway");
        await until(
          () => client.snapshot.connection === "disconnected",
          "disconnect settled",
        );
        check(
          client.snapshot.transfers[0].state === "uncertain",
          "Interrupted result not uncertain",
        );
        check(
          !mount.querySelector(".peer-card:not(:disabled)"),
          "Departed card remains actionable",
        );
        check(
          port.closed && !port.readable.locked && !port.writable.locked,
          "Serial owner not released",
        );
      },
    );
    await scenario(
      "cleanup failure blocks connect and provides an explicit retry",
      async ({ client, port, next }) => {
        port.closeFailures = 1;
        click("Disconnect");
        await until(
          () => client.snapshot.connection === "cleanup_failed",
          "cleanup failure",
        );
        await until(
          () => mount.textContent?.includes("Retry disconnect"),
          "retry action",
        );
        check(
          (mount.querySelector(".receive-panel button") as HTMLButtonElement)
            .disabled,
          "Folder can change before cleanup",
        );
        click("Retry disconnect");
        await until(
          () => client.snapshot.connection === "disconnected",
          "cleanup retried",
        );
        const wrong = new VirtualPort();
        wrong.hardware = "00:00:00:00:00:00";
        next(wrong);
        click("Connect bridge");
        await until(
          () => client.snapshot.connection === "error",
          "wrong identity rejected",
        );
        check(
          wrong.closed && !!mount.querySelector('[role="alert"]'),
          "Rejected port was not closed or reported",
        );
        clickLabel("Dismiss message");
        const good = new VirtualPort();
        next(good);
        click("Connect bridge");
        await until(
          () => client.snapshot.connection === "connected",
          "fresh handshake",
        );
        check(
          client.snapshot.peers.length === 0 &&
            !good.records.some((r) => r.includes(" SEND ")),
          "Reconnect reused stale recipients or sent a file",
        );
      },
    );
    async function receive(
      client: WebBridge,
      port: VirtualPort,
      folder: FileSystemDirectoryHandle,
      corrupt = false,
    ) {
      const id = "BROWSER-FAILURE-RECEIVE",
        hash = await sha256(new TextEncoder().encode("abc"));
      port.emit({
        event: "transfer_begin",
        transfer_id: id,
        files: 1,
        total_bytes: 3,
      });
      port.emit({
        event: "manifest_file",
        index: 0,
        size: 3,
        name_b64: base64(new TextEncoder().encode("payload.bin")),
      });
      port.emit({
        event: "file_begin",
        index: 0,
        size: 3,
        name_b64: base64(new TextEncoder().encode("payload.bin")),
        metadata: false,
      });
      port.emit({ event: "file_chunk", index: 0, offset: 0, data: "YWJj" });
      port.emit({
        event: "file_end",
        index: 0,
        bytes: 3,
        sha256: corrupt ? "0".repeat(64) : hash,
      });
      if (corrupt) {
        await until(
          () => client.snapshot.connection === "error",
          "receive failure surfaced",
        );
        return;
      }
      await until(
        () => client.snapshot.transfers[0]?.done === 3,
        "receive bytes",
      );
      port.emit({
        event: "transfer_ready",
        transfer_id: id,
        files: 1,
        total_bytes: 3,
        nonce: "a".repeat(32),
      });
      await until(
        () => port.records.some((r) => r.startsWith("COMMIT ")),
        "verified commit",
      );
      check(
        client.snapshot.transfers[0].state === "finishing",
        "COMMIT incorrectly marked completed",
      );
      port.emit({
        event: "transfer_complete",
        transfer_id: id,
        host_committed: true,
        response_written: true,
      });
      await until(
        () =>
          ["completed", "uncertain"].includes(
            client.snapshot.transfers[0].state,
          ),
        "completion state",
      );
      const saved = await folder.getDirectoryHandle(
        client.snapshot.transfers[0].directory!.split("/").pop()!,
      );
      check(
        (await sha256(
          new Uint8Array(
            await (
              await (await saved.getFileHandle("payload.bin")).getFile()
            ).arrayBuffer(),
          ),
        )) === hash,
        "Independent destination hash differs",
      );
      return saved;
    }
    await scenario(
      "receive SHA256 failure stays failed and cannot save a success receipt",
      async ({ client, port, folder }) => {
        await receive(client, port, folder, true);
        check(
          client.snapshot.transfers[0].state === "failed",
          "Hash rejection not failed",
        );
        check(
          !port.records.some((r) => r.startsWith("COMMIT ")),
          "Hash mismatch was committed",
        );
        clickLabel("Transfer details: payload.bin");
        await until(() => mount.querySelector("dialog[open]"), "failed detail");
        check(
          ![...mount.querySelectorAll("dialog button")].some((b) =>
            b.textContent?.includes("Save receipt"),
          ),
          "Failed receive offers success receipt",
        );
      },
    );
    await scenario(
      "final receipt failure remains uncertain with verified files preserved",
      async ({ client, port, folder }) => {
        const saved = await receive(client, port, folder);
        check(saved, "Missing saved directory");
        check(
          client.snapshot.transfers[0].state === "uncertain",
          "Receipt failure claimed completed",
        );
        const receipt = JSON.parse(
          await (
            await (
              await saved.getFileHandle("airbridge-receipt.json")
            ).getFile()
          ).text(),
        );
        check(
          receipt.status === "files_verified",
          "Prior checked receipt was lost",
        );
      },
      true,
    );
    await scenario(
      "receive success requires native confirmation and saved readback",
      async ({ client, port, folder }) => {
        const saved = await receive(client, port, folder);
        check(saved, "Missing saved directory");
        check(
          client.snapshot.transfers[0].state === "completed",
          "Successful receive missing",
        );
        const receipt = JSON.parse(
          await (
            await (
              await saved.getFileHandle("airbridge-receipt.json")
            ).getFile()
          ).text(),
        );
        check(receipt.status === "completed", "Final receipt missing");
        clickLabel("Transfer details: payload.bin");
        await until(
          () => mount.querySelector("dialog[open]"),
          "completed detail",
        );
        check(
          mount
            .querySelector("dialog")
            ?.textContent?.includes("File size and SHA256 checked"),
          "Verified detail missing",
        );
      },
    );
    result.textContent = JSON.stringify(
      {
        status: "passed",
        checks: rows,
        serial: "synthetic only",
        storage: "real browser OPFS",
        hardware: false,
        native_airdrop: false,
      },
      null,
      2,
    );
  } catch (error) {
    result.textContent = JSON.stringify(
      { status: "failed", passed: checks, error: String(error) },
      null,
      2,
    );
  } finally {
    if (originalLanguage === null)
      localStorage.removeItem("airbridge.language.v1");
    else localStorage.setItem("airbridge.language.v1", originalLanguage);
    button.disabled = false;
  }
};
