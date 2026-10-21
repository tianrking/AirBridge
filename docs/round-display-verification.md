# Round display verification

Date: 2026-10-21. This is a bounded hardware acceptance record for the **Spotpear ESP32-S3R8 1.8-inch Round V1**, not a guarantee for every ESP32-S3/display combination.

## Installed profile

- ESP-IDF **v6.1**, ESP32-S3 revision 0.2, 16 MiB flash, 8 MiB octal PSRAM at 40 MHz.
- ST77916 QSPI 360×360 RGB565, CST816S I2C touch, native USB Serial/JTAG.
- Public firmware, presence TX, IPv6 link, native service and 1 Mbps raw-rate flags enabled; no developer peer embedded. The display flag is isolated from the standard build.
- The existing 32 KiB native receiver stack is reserved before radio initialization; command and sender stacks are not reduced. LVGL, UI state and snapshots use PSRAM. A 10-row internal DMA buffer and an 8 KiB UI task leave room for the wireless service. Main task remains 12 KiB.

## Measured results

| Check | Result |
| --- | --- |
| Full preflash backup | 16,777,216 bytes retained privately; SHA-256 `4217fec89e88ab0ce9276569f311f6dc1772af8283087f662ea71fbbdd249c31` |
| Program verification | Bootloader, partition table and application independently read back and byte-compared; all match |
| NVS preservation during programming | 24,576 bytes read before/after and equal |
| Current application | 1,565,984 bytes; SHA-256 `9abafa73776e42b4ba598e33623882048104694157db13cc3f20d44647f75138` |
| Wireless startup | `radio_ready=true`; Wi-Fi, BLE, native command/server/mDNS tasks started |
| Nearby services | Two fresh AirDrop advertisements observed during bring-up; presence expires when advertisements stop |
| Host protocol | Real AB2 HELLO and STATUS accepted; protocol 2 and 112-byte chunk capability returned |
| UI navigation | Final 200-page cycle passed with zero observed restart, zero display errors and zero I2C touch errors |
| Memory after final cycle | Internal free 36,715 bytes; largest block 23,552 bytes; minimum free 23,436 bytes |
| Stack low-water marks | Main 8,640 bytes free; UI at least 5,148 bytes free in the measured navigation run |
| Serial staging and refusal | 262,145 bytes ACKed, duplicate DATA replay did not advance offset, wrong SHA-256 refused before radio upload; cancellation returned to idle |
| Reconnect and settings | Three port reopenings without reset; brightness 55% survived a deliberate reset, invalid 100% refused; restored to 65% |
| Physical LCD and touch | User confirmed correct display, orientation/colors and accurate Devices/Settings interaction |
| Real render capture | Complete 259,200-byte RGB565 frames received from MCU and converted to validated PNGs |
| Automatic tests | 47 Python tests; protocol and round-policy C++ test suites passed |

The screenshots come from the running MCU's framebuffer. They are not photos of the glass, and do not prove backlight, orientation or physical touch alignment.

## Fixes verified during bring-up

The first build overflowed the standard main-task stack during screen initialization. The round profile now reserves 12 KiB. Subsequent startup failed to allocate the native receiver's 32 KiB stack despite around 80 KiB total internal free memory: the largest contiguous block was only 31,744 bytes. Reserving that unchanged stack before Wi-Fi/BLE initialization, moving UI state and LVGL allocations to PSRAM, and reducing the DMA draw chunk fixed startup. The final build retains the receiver rather than trading it for the screen.

## Acceptance still required

- Physical LCD and touch were confirmed by the user. BOOT-button navigation still needs a physical press check.
- Native `/Discover` name resolution was attempted against a real observed peer, but timed out (`-116`, HTTP status 0). The UI must retain an unverified host hint and a failure notice in that case.
- The user subsequently confirmed that no test Mac is currently running. Prior attempts to the old SSH address did not respond. **This round/public profile has not yet passed a fresh native Apple→Windows→Apple file transfer with SHA-256 comparison.** Earlier development-profile transfer evidence is not transferred to this build.
- No SD, audio, battery, standalone on-board storage, electrical measurements, long-duration soak or power-loss-during-transfer qualification was performed.

The Linux/GCC policy build additionally found a pre-existing `snprintf` truncation warning in mDNS hostname formatting. The hostname now explicitly uses the 12 hexadecimal identity characters; regression checks cover the exact normal and maximum-octet labels. Compiler warnings remain errors. The final firmware was rebuilt, flashed and independently read back after this change.

Private NVS/full-flash backups, nearby addresses and raw session logs are kept under ignored `work/round-display/`; they are not published. The dedicated round CI produces a distinct firmware artifact and cannot qualify hardware. Standard Pages deployment remains restricted to `main`.

## Normal-use handoff

After the bounded bench navigation tests, the board was restored to its normal home page and all automated page switching/captures stopped. Physical display and touch were confirmed by the user. The diagnostic monitor defaults to passive status checks; visible navigation requires the explicit `--exercise-navigation` option. Native Apple interoperability remains deferred until a test Mac is available.
