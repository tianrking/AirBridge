import { createRoot } from "react-dom/client";
import { FirmwareSetup } from "../src/FirmwareSetup";
import { FirmwareInstaller } from "../src/web/flasher";
import { isLanguage, applyLanguage } from "../src/i18n";
import "../src/styles.css";
import "../src/product.css";
import "../src/theme.css";
const query = new URLSearchParams(location.search);
const language = query.get("lang");
applyLanguage(isLanguage(language) ? language : "en");
document.documentElement.dataset.theme =
  query.get("theme") === "dark" ? "dark" : "light";
let writes = 0,
  closes = 0,
  connects = 0,
  releaseBlocked = query.get("case") === "cleanup";
const fixture = document.getElementById("fixture")!;
function report() {
  fixture.dataset.writes = String(writes);
  fixture.dataset.closes = String(closes);
  fixture.dataset.connects = String(connects);
}
const installer = new FirmwareInstaller({
  hostIdle: () => true,
  choose: async () => {
    if (query.get("case") === "dismiss")
      throw new DOMException("Cancelled", "NotFoundError");
    return {};
  },
  async device() {
    return {
      async inspect() {
        return {
          chip: query.get("case") === "chip" ? "ESP32-C3" : "ESP32-S3",
          flashBytes: 16777216,
          protected: false,
          features: ["Embedded PSRAM 8MB"],
        };
      },
      async write(_, progress) {
        writes++;
        report();
        progress(0, 0.5);
        await new Promise((r) =>
          setTimeout(r, query.get("case") === "cancel" ? 2000 : 120),
        );
        progress(2, 1);
      },
      async verify() {
        return query.get("case") !== "verify";
      },
      async reset() {
        if (query.get("case") === "reset") throw Error("Reset failed");
      },
      async close() {
        closes++;
        report();
        if (releaseBlocked) {
          releaseBlocked = false;
          throw Error("Release failed once");
        }
      },
    };
  },
  async fetchPart(path) {
    const r = await fetch(`/${path}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (query.get("case") === "tamper") b[0] ^= 1;
    return b;
  },
  async hash(data) {
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  },
});
report();
createRoot(fixture).render(
  <FirmwareSetup
    language={isLanguage(language) ? language : "en"}
    hostIdle
    onConnect={() => {
      connects++;
      report();
    }}
    installer={installer}
  />,
);
