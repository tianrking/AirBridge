import { Receiver } from "../src/web/receiver";
import { base64, check, sha256, type Event } from "../src/web/protocol";
import type { DiskDirectory } from "../src/web/platform";
const button = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLElement>("#result")!;
button.onclick = async () => {
  button.disabled = true;
  result.textContent = "Running real browser storage checks…";
  try {
    const root = await navigator.storage.getDirectory();
    const output = await root.getDirectoryHandle(
      `airbridge-qualification-${crypto.randomUUID()}`,
      { create: true },
    );
    const events: Event[] = [];
    const receiver = new Receiver(output as unknown as DiskDirectory, (e) =>
      events.push(e),
    );
    const sizes = [0, 4097, 262145],
      names = ["empty.bin", "測試-😀.bin", "binary-262145.bin"];
    const total = sizes.reduce((a, b) => a + b, 0),
      id = "BROWSER-STORAGE-1";
    await receiver.handle({
      event: "transfer_begin",
      transfer_id: id,
      files: sizes.length,
      total_bytes: total,
    });
    for (let index = 0; index < sizes.length; index++)
      await receiver.handle({
        event: "manifest_file",
        index,
        size: sizes[index],
        name_b64: base64(new TextEncoder().encode(names[index])),
      });
    const expected: { name: string; bytes: number; sha256: string }[] = [];
    for (let index = 0; index < sizes.length; index++) {
      const data = Uint8Array.from(
        { length: sizes[index] },
        (_, n) => (n * 17 + index) % 251,
      );
      const hash = await sha256(data);
      expected.push({ name: names[index], bytes: data.length, sha256: hash });
      await receiver.handle({
        event: "file_begin",
        index,
        size: data.length,
        name_b64: base64(new TextEncoder().encode(names[index])),
        metadata: false,
      });
      for (let offset = 0; offset < data.length; offset += 512) {
        const chunk = data.slice(offset, offset + 512);
        const ack = await receiver.handle({
          event: "file_chunk",
          index,
          offset,
          data: base64(chunk),
        });
        check(
          ack === `CHUNK ${id} ${index} ${offset + chunk.length}\n`,
          "Chunk ACK mismatch",
        );
      }
      await receiver.handle({
        event: "file_end",
        index,
        bytes: data.length,
        sha256: hash,
      });
    }
    const ack = await receiver.handle({
      event: "transfer_ready",
      transfer_id: id,
      files: sizes.length,
      total_bytes: total,
      nonce: "a".repeat(32),
    });
    check(
      ack === `COMMIT ${"a".repeat(32)}\n` &&
        !events.some((e) => e.event === "received"),
      "Premature native completion",
    );
    // This is a synthetic protocol completion for storage validation only.
    await receiver.handle({
      event: "transfer_complete",
      transfer_id: id,
      host_committed: true,
      response_written: true,
    });
    const completed = events.find((e) => e.event === "received")!;
    const savedDir = await output.getDirectoryHandle(
      String(completed.directory).split("/").pop()!,
    );
    for (const file of expected) {
      const actual = await (await savedDir.getFileHandle(file.name)).getFile();
      check(
        actual.size === file.bytes &&
          (await sha256(new Uint8Array(await actual.arrayBuffer()))) ===
            file.sha256,
        "Independent destination check failed",
      );
    }
    const receipt = JSON.parse(
      await (
        await (await savedDir.getFileHandle("airbridge-receipt.json")).getFile()
      ).text(),
    );
    check(receipt.status === "completed", "Missing saved receipt");
    result.textContent = JSON.stringify(
      {
        status: "passed",
        storage: "real Chrome origin-private file system",
        files: expected,
        closes_and_reopens_checked: true,
        commit_after_hash: true,
        waits_for_completion_record: true,
        serial_hardware_tested: false,
        native_airdrop_tested: false,
        directory: `${output.name}/${savedDir.name}`,
      },
      null,
      2,
    );
  } catch (e) {
    result.textContent = JSON.stringify(
      { status: "failed", error: String(e) },
      null,
      2,
    );
  } finally {
    button.disabled = false;
  }
};
