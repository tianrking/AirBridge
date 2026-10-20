# AirBridge ESP32-S3 firmware · v0.0.1

Download the firmware from [the official release](https://github.com/tianrking/AirBridge/releases/tag/v0.0.1). This public prerelease targets **ESP32-S3 N16R8: 16 MiB flash and 8 MiB octal PSRAM**. Other memory layouts, ESP32 variants and external USB–UART connections are not qualified by this package. Use the board's **native USB Serial/JTAG** connector and a data cable.

## Verify and flash

Extract the entire ZIP into a new folder. Python 3.11 or newer is required for the flashing helper. No developer toolchain is needed to use the prebuilt image.

```sh
python flash.py --verify-only
python -m pip install esptool==5.5.0
python flash.py --port COM7
```

Replace `COM7` with **your board's** native USB port (for example `/dev/ttyACM0` on Linux). The helper never enumerates or automatically selects a device. It verifies every packaged file before opening the explicitly chosen port, then asks you to type `FLASH`. Close all applications using that port first. If the board cannot enter its bootloader automatically, use its BOOT/RESET sequence according to the board's documentation.

The image writes the bootloader at `0x0`, partition table at `0x8000`, and application at `0x10000`, with DIO / 80 MHz / 16 MiB flash settings. It replaces existing firmware. The current helper writes three separate segments without a whole-chip erase, preserving NVS. The immutable v0.0.1 archive helper instead writes a merged image whose padding crosses NVS: use the [browser installer](https://w0x7ce.eu/AirBridge/) or explicitly write the raw segments when preservation matters. Never flash it to a board with a different memory configuration. `BUILD.json` records the profile and `MANIFEST.json` records each file's size and SHA256; compare the downloaded ZIP with the release's `SHA256SUMS` too.

## Connect and share

1. Open [AirBridge Web](https://w0x7ce.eu/AirBridge/) in desktop Chrome or Edge, or install the Windows desktop application from the same release.
2. Choose a receive folder, then click **Connect bridge** and explicitly select your native USB device. Allow only the intended board. The host checks the firmware-reported factory identity; public builds are not tied to a developer's COM number or serial number.
3. On the Apple device, enable Wi-Fi and Bluetooth, unlock it, and open AirDrop with **Everyone** enabled. The ESP32 supplies the wireless link; the PC does not need an AWDL-capable Wi-Fi adapter.
4. Select the observed Apple device. For incoming files, click **Allow selected device** before sharing to **AirBridge PC** from the Apple device. Only this session's selected sender is allowed into the native receive service. Revoke it when finished. An Apple AWDL address can rotate: select and authorize its new entry if necessary. This is a local peer allowlist, not verified Apple-account/contact authentication.
5. For outgoing files, select a recipient and a file of at most **1 MiB**, then send and accept Apple's native prompt. Keep the application/tab open through native completion. Receiving verifies persisted bytes before committing and publishing a completion receipt.

One application owns the serial port at a time. A new public serial session clears the incoming allowlist. Disconnect/reconnect when ownership changes; no transfer is automatically resent after an uncertain result.

## Identity and qualification

Each board generates its own P-256 private key and self-signed TLS certificate at first service startup, saved atomically in its NVS. The release image contains no shared TLS private key, NVS dump or fixed Apple peer. Flashing a newer application normally retains this identity. Corrupt identity storage fails closed instead of silently replacing the key. NVS is not flash-encrypted by this development profile; physical access to the board remains trusted.

ESP-IDF **v6.1** is pinned in CI. Previous development hardware verified Mac discovery and native binary transfers, including SHA256-matched roundtrips. **This new public profile, runtime authorization and first-boot identity have build/automated coverage, but have not yet been physically requalified.** Browser Web Serial native AirDrop acceptance also remains pending. CI does not connect a board, operate an Apple device or prove RF compatibility. This is an experimental prerelease; iPhone interoperability, Contacts Only, folder transfers, large files and long-duration reliability are unqualified.

Protocol research acknowledges [omdrop-owl](https://github.com/t4t5/omdrop-owl), Linux OWL and OpenDrop. AirBridge is an independent project and is not affiliated with Apple.

Browser installation and detailed recovery: [Browser firmware installation](browser-flashing.md).
