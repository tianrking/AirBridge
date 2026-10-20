// Pinned public v0.0.1 bytes are checked before every development/build run.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("src/web/firmware-release.json", root), "utf8"));
for (const part of catalog.segments) {
  const bytes = await readFile(new URL(`public/firmware/v${catalog.version}/${part.path}`, root));
  if (bytes.length !== part.bytes || createHash("sha256").update(bytes).digest("hex") !== part.sha256)
    throw new Error(`Pinned release firmware is missing or corrupt: ${part.path}`);
}
console.log(`Verified ${catalog.segments.length} immutable v${catalog.version} firmware segments`);
