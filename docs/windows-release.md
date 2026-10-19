# AirBridge for Windows · v0.0.1

An experimental native AirDrop bridge using **your ESP32-S3 N16R8**. This Tauri 2 application runs the React interface with a Rust serial/file backend. No Python transfer process, cloud account or Gmail login is required.

## Install or run portable

Download from the [official v0.0.1 release](https://github.com/tianrking/AirBridge/releases/tag/v0.0.1) and compare the file with `SHA256SUMS`. This package targets **Windows x64** and requires Microsoft Edge WebView2 Runtime. The NSIS installer can download WebView2 if it is missing; the portable application needs it installed already.

- **Installer:** run `AirBridge-v0.0.1-windows-x64-setup.exe` and follow its prompts.
- **Portable:** extract the entire `AirBridge-windows-x64-v0.0.1.zip` into a new folder, then run `AirBridge.exe`. Do not run the application inside the ZIP preview.

The binaries are **unsigned developer prereleases**. The included `MANIFEST.json` records the portable files' size, SHA256 and source commit. `LICENSE` is the AirBridge project license. Source and dependency declarations are available in [the repository](https://github.com/tianrking/AirBridge/tree/v0.0.1).

## Use your bridge

1. Flash the matching **ESP32-S3 N16R8** firmware from the same release. Follow its included README. Use the native USB Serial/JTAG connector; external USB–UART is not qualified. Close flash tools, browser sessions and serial monitors before connecting here.
2. Click **Connect bridge**, explicitly select the intended port and its USB serial identity, then connect. The application revalidates that selection before opening and checks the firmware factory ID. There is no fixed developer COM number or factory ID requirement, and no automatic connection on startup.
3. Unlock the Apple device, enable Wi-Fi/Bluetooth and open AirDrop with **Everyone** enabled. Select a freshly advertised recipient; a successful native name query replaces its unresolved label. An advertisement alone does not prove file reachability.
4. **Send:** choose one file up to **1 MiB**, select the Apple device and send. Accept Apple's native prompt. Preparation/upload progress is separate from native delivery confirmation; an uncertain result is never automatically resent.
5. **Receive:** select the Apple sender in AirBridge and click **Allow selected device**. Then choose **AirBridge PC** in Apple's native sharing panel. The default location is your **Downloads/AirBridge** folder; Settings can change it while disconnected. Received files are closed, reopened and SHA256 checked before commit and native completion are published.
6. Revoke receiving access when finished. One incoming peer is allowed per public serial session; reconnecting clears authorization. If the Apple AWDL address changes, select and authorize the new entry. This is an address allowlist, not Apple-account/contact authentication.

Keep the application and computer awake through completion. Cancellation is cooperative. Partial/uncertain data remains separate from completed files; activity is session-scoped. Settings offers English, Spanish, French, Traditional Chinese and Arabic/RTL, Light/Dark/System themes and motion controls.

## Qualification

Earlier development hardware and the Rust backend passed scoped native Mac binary roundtrips with matching destination SHA256. **The generic public firmware, per-board first-boot identity and new selection/authorization path still require physical requalification.** CI compiles the actual Windows application and installer and tests the protocol/host/browser layers without a board. Clean-system installer UX, arbitrary boards, iPhone interoperability, Contacts Only, folders and long-duration RF reliability are unqualified.

Prefer a browser? Open [AirBridge Web](https://w0x7ce.eu/AirBridge/) in desktop Chrome/Edge, or [try the clearly simulated demo without hardware](https://w0x7ce.eu/AirBridge/?demo=1). Only one application may own the serial port at a time.
