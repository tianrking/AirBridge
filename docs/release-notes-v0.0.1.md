# AirBridge v0.0.1 · public prerelease

**[Open the HTTPS web app](https://w0x7ce.eu/AirBridge/)** · **[Try the interactive demo without hardware](https://w0x7ce.eu/AirBridge/?demo=1)**

The web app is a static site: no account, Gmail login, cloud relay or separate desktop installation is required. Actual AirDrop transfers require a supported ESP32-S3 connected to desktop Chrome/Edge or the Windows application. Safari, Firefox and mobile browsers can view the demo but cannot use this hardware transport. File payloads stay on the local serial/radio links.

## Choose a download

| Asset | Purpose |
| --- | --- |
| `AirBridge-esp32s3-v0.0.1.zip` | ESP-IDF 6.1 firmware for **ESP32-S3 N16R8**, merged image, individual images, verified explicit-port flashing helper and instructions |
| `AirBridge-v0.0.1-windows-x64-setup.exe` | Tauri 2 Windows x64 installer; requires WebView2 (installer can download it if missing) |
| `AirBridge-windows-x64-v0.0.1.zip` | Portable Windows x64 application, manifest and usage guide; requires installed WebView2 |
| `AirBridge-web-v0.0.1.zip` | Self-hostable static React application; serve over HTTPS or localhost |
| `SHA256SUMS` / `RELEASE-MANIFEST.json` | Exact asset sizes, SHA256 and source commit |

Windows packages are **unsigned**. This release does not claim an Authenticode signature. Review the source and verify downloads against the release manifest.

## Included

- Five complete UI languages: English by default, Spanish, French, Traditional Chinese and Arabic with RTL; Light/Dark/System themes.
- Default ambient waves and flowing motion; device appearance/departure/selection and transfer transitions respect reduced motion and pause controls.
- Explicit selection of the user's own compatible USB bridge, without a developer COM-number/factory-ID binding.
- Session-scoped incoming peer authorization, native name queries, recipient/file selection, duplex progress, cancellation and disconnect recovery.
- Checked receive publication: close, reopen, validate size and SHA256, commit, then await native completion. Uncertain transfers are never automatically resent.
- Unique per-board first-boot TLS identity persisted in NVS. No shared private key or private Apple peer in the firmware package.
- CI gates on frontend/browser, protocol/Windows tests, actual ESP-IDF firmware compilation and Windows installer construction. The desktop and web packages reuse the exact browser-tested frontend. Every archive is reopened and checked before publication; missing components block release.

## Evidence boundary

Earlier development firmware and Rust backend achieved native Mac discovery and SHA256-matched binary roundtrips. The **new generic public firmware, first-boot identity and authorization changes are not physically requalified**, and the browser-native serial/AirDrop path remains pending real hardware acceptance. Automated checks use synthetic wire input and real Chromium OPFS, not a physical board or Apple radio. Sending is bounded to one file up to **1 MiB**. iPhone interoperability, Contacts Only, folder transfers, arbitrary board profiles and long-duration RF reliability are unqualified.

See the included guides for board requirements and permissions. A device advertisement or a completed simulation is never presented as real file delivery.

Protocol research acknowledges [omdrop-owl](https://github.com/t4t5/omdrop-owl), Linux OWL and OpenDrop. AirBridge is independent and not affiliated with Apple.
