# AirBridge desktop

Tauri 2, React, TypeScript and Rust. The application talks directly to the ESP32-S3;
it does not launch a Python transfer process or use the PC's Wi-Fi adapter for AWDL.

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
2. Connect the authorized development board. This build deliberately requires
   COM4 and USB serial `F0:9E:9E:1E:61:3C`; it never probes COM3.
3. Unlock the Apple device and enable AirDrop Everyone mode.
4. Open AirBridge and choose **Connect bridge**. A connected indicator proves the
   USB session; the device card separately shows an observed AirDrop advertisement.
5. Select a recipient, choose an actual file and press **Send**. Accept Apple's
   native prompt. Sending is currently bounded to one file of at most 1 MiB.
6. To receive, select **AirBridge PC** in Apple's native sharing panel. Keep the
   desktop app connected. Completed files appear under **Downloads/AirBridge**.
   Settings can change this directory while disconnected.

The qualified development firmware accepts its explicitly configured Apple peer
automatically. Manual local incoming consent and unrestricted peer selection are
not release-qualified. Unknown names remain labeled as unresolved; MAC addresses
and RSSI are available in device details. A read-only manual name query is offered
only when firmware capabilities advertise support.

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

English is the default. Settings offers Traditional Chinese and Spanish; language
preference is local and does not restart the radio or serial session. Native Windows
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
