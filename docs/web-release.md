# AirBridge Web · v0.0.1

**[Open the public HTTPS application](https://w0x7ce.eu/AirBridge/)** · **[Try without hardware](https://w0x7ce.eu/AirBridge/?demo=1)**

No account, Gmail login, desktop application, cloud relay or backend server is required. The public site serves static application assets. Real transfers stay on **browser ↔ serial ↔ ESP32-S3 ↔ Apple radio**. The interactive demo uses explicitly labeled sample devices and simulated transfers; it does not open serial ports or file pickers, export activity files or write received files.

## Host this ZIP yourself

Extract all files into a new directory. `MANIFEST.json` lists file sizes, SHA256 and the source commit; compare the ZIP with the release's `SHA256SUMS`. `LICENSE` is the AirBridge project license. Use any static **HTTPS** host, including GitHub Pages or Vercel. Subdirectory hosting is supported by relative entry assets. For loopback-only local use, from the extracted directory:

```sh
python -m http.server 8090 --bind 127.0.0.1
```

Open **http://127.0.0.1:8090/** in desktop Chrome or Edge. Python is only serving static files here; it is not a transfer backend. Do not open `index.html` directly from Explorer or serve the real hardware interface from an insecure LAN HTTP origin. Do not refresh or replace assets during a live serial session.

## Connect and transfer

1. Use **desktop Chrome or Edge** with Web Serial and the file/directory picker APIs. Open a full tab. Safari, Firefox, mobile browsers and embedded previews cannot use the required hardware API set; the UI explains unsupported APIs, insecure contexts and denying policies. Modern browsers can still view the demo.
2. Flash the **ESP32-S3 N16R8 firmware** from the same [release](https://github.com/tianrking/AirBridge/releases/tag/v0.0.1); follow its included README. Use native USB Serial/JTAG, close other serial owners, choose a receive folder and grant read/write access, then explicitly select your bridge. The browser does not enumerate/open a device on page load, persist folder permission, or flash hardware.
3. Unlock the Apple device, enable Wi-Fi/Bluetooth and open AirDrop with **Everyone** enabled. Select an observed Apple device. Names come from successful native queries; unresolved entries remain honestly labeled.
4. To send, choose one file up to **1 MiB**, select the recipient and accept Apple's native prompt. To receive, first click **Allow selected device**, then send to **AirBridge PC** from Apple's native sharing panel. Revoke access after use. Authorization is session-scoped and must be renewed when the Apple address rotates. It is not Contacts Only/account authentication.
5. Keep this tab and computer awake until native completion. The receiver closes/reopens persisted files and checks size/SHA256 before commit and completion. Partial or uncertain results never become successful receipts, and outgoing files are not automatically resent. Release the port before switching to Tauri or a flash tool.

The UI defaults to English and provides Spanish, French, Traditional Chinese and Arabic with RTL. Light/Dark/System appearance, default waves and flowing motion, reduced motion and pause controls are shared with the desktop edition.

## Evidence boundary

Automated tests cover production UI, synthetic serial failures and real Chromium OPFS persistence. They do **not** qualify physical USB, the real Windows folder chooser, radio discovery or native browser AirDrop delivery. Previous development firmware/Rust Mac transfers are separate evidence. The new generic public firmware, first-boot TLS identity and authorization require physical requalification. This is an experimental prerelease.

Source, firmware instructions and status: [tianrking/AirBridge](https://github.com/tianrking/AirBridge/tree/v0.0.1). This ZIP contains static web files only; the release provides separate Windows and firmware packages.
