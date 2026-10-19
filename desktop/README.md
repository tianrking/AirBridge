# AirBridge desktop

The browser edition reuses this React application and now has a direct Web Serial
backend. See [AirBridge Web](README.web.md). The Tauri/Rust path below remains
available in the same repository; it is not replaced or launched by the browser.

Tauri 2, React, TypeScript and Rust. The application talks directly to the ESP32-S3;
it does not launch a Python transfer process or use the PC's Wi-Fi adapter for AWDL.

## Install v0.0.1

Download the **Windows x64 installer** or **portable ZIP** from the
[official release](https://github.com/tianrking/AirBridge/releases/tag/v0.0.1).
Compare the download with `SHA256SUMS`. Extract the whole portable ZIP and run
`AirBridge.exe`; it requires Microsoft WebView2. The NSIS installer can download
WebView2 if it is absent. Packages are unsigned developer prereleases. No Gmail
login or cloud account is required. The application does not start a serial
connection automatically.

## Build on Windows

Install the Rust MSVC toolchain, Visual Studio C++ build tools, Node.js 22 or newer
and WebView2. The firmware requires its separate ESP-IDF 6.1 environment.

```powershell
cd desktop
npm ci
npm test
npm run build
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
npm run tauri -- build --bundles nsis
```

For an offline development executable with bundled assets:

```powershell
cargo build -p airbridge-desktop --features custom-protocol --locked
```

Without `custom-protocol`, a debug build expects the Vite development server.
Use `npm run tauri -- dev` for that workflow. Keep build paths short on Windows;
`CARGO_TARGET_DIR` can select a short absolute output directory.

## Use real hardware

1. Close other serial receivers, terminals and flash tools.
2. Connect your ESP32-S3 N16R8 via native USB Serial/JTAG, using the
   [public firmware](../docs/firmware-release.md). Click Connect and explicitly
   select its port and USB identity. The choice is revalidated before opening;
   its firmware-reported factory ID must match the selected USB descriptor.
3. Unlock the Apple device and enable AirDrop Everyone mode.
4. Open AirBridge and choose **Connect bridge**. A connected indicator proves the
   USB session; the device card separately shows an observed AirDrop advertisement.
5. Select a recipient, choose an actual file and press **Send**. Accept Apple's
   native prompt. Sending is currently bounded to one file of at most 1 MiB.
6. To receive, select the Apple peer in AirBridge and click **Allow selected device**,
   then select **AirBridge PC** in Apple's native sharing panel. Keep the
   desktop app connected. Completed files appear under **Downloads/AirBridge**.
   Settings can change this directory while disconnected.

The public firmware starts with no authorized incoming peer. Authorization is
session-scoped, can be revoked, and cannot change during a transfer. Rotating Apple
AWDL addresses need a new selection. This is a local peer allowlist, not Apple
account authentication. Unknown names remain unresolved until a native query
succeeds. The new generic firmware and desktop selection/authorization path are
build/test covered but not physically requalified. Prior development-board
results are documented separately. The development CLI retains its intentionally
fixed board guard; it is not the desktop's device picker.

## Progress and recovery

Preparation means staging the source, not delivery. Upload progress reaching 100%
means finishing; only native completion can mark the outgoing transfer sent.
Receiving additionally validates lengths and SHA256, flushes data to disk and
waits for host commit and the native HTTP response before publishing a receipt.

A failed or uncertain outgoing result never causes an automatic file resend.
Reconnecting ends the previous serial owner before another owner starts. Incomplete
receive directories remain separate from completed files. Activity is scoped to the
current application session; it is not a persistent transfer-history database.

## Languages and diagnostics

English is the default. Settings offers Spanish, French, Traditional Chinese and
Arabic, plus Light, Dark and System appearance. Both preferences are local and
do not restart the radio or serial session. Arabic includes RTL layout and
isolated technical values; see [languages and appearance](../docs/localization-and-appearance.md). Native Windows
file dialogs follow the Windows display language.

Curated local events are logged under the app log directory as `session.jsonl`,
bounded to 8 MiB. They can contain filenames, paths, device names, hashes and error
codes. They contain no file bodies, serial chunks or TLS private keys. Logs are never
uploaded automatically. Avoid publishing private diagnostic logs.

The interface has no renderer filesystem or serial permissions. Native Rust commands
own file selection tokens and restrict opening receive folders to completed receipts.

## Qualification

[Measured desktop status](../docs/desktop-qualification.md) records real hardware
observations and failures. The Rust CLI's verified roundtrip does not automatically
qualify the GUI or installer. Long idle discovery, iPhone, external UART and large
streaming transfers remain separate acceptance gates.
