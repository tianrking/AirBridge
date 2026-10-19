# Web qualification — 2026-10-19

The browser edition shares the existing React interface. Its protocol and file
backend is TypeScript using Web Serial and File System Access; the retained
Tauri application continues to use Rust. No dependency was added for this work.

## Measured results

| Check | Result and boundary |
| --- | --- |
| Frontend/wire tests | 23 tests passed, including 19 browser/backend cases and the 4 retained UI contract cases |
| Independent Ask encoding | Python stdlib decoded the generated binary plist, including Unicode/surrogate pairs, zero bytes, arrays and dictionaries |
| Receive publication | Actual temporary host files; saved-content corruption and close failure withhold commit |
| Serial ownership | Virtual streams verify fragmented replies, one reader/writer, incoming ACKs during an outstanding command and no timeout resend |
| Device identity | Virtual identity mismatch rejected; production firmware now includes factory `hardware_id` |
| Native result model | A source/wire progress total alone does not complete a transfer; mismatched completion hashes remain uncertain |
| Chrome browser UI | Actual page navigation, missing-folder guard, English/Traditional Chinese/Spanish settings verified |
| Chrome storage | Actual origin-private filesystem; 0-, 4,097- and 262,145-byte files closed/reopened with matching destination SHA256 |
| Production assets | TypeScript/Vite build passed; no Rust/Python transfer service required |
| Firmware | ESP-IDF 6.1 native-service candidate compiled; not flashed |
| Existing checks | 346 C++ checks, 20 Python tests and 8 Rust workspace tests passed |

## Actual Chrome storage fingerprints

These are synthetic storage-test inputs, not AirDrop transfers. The production
receiver handled a three-file manifest and real browser writes. The test checked
that no received event existed at `COMMIT`, then supplied a synthetic completion
record and independently reopened the files and saved receipt.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `empty.bin` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `測試-😀.bin` | 4,097 | `e9893c07e509419a1ec218ebbf1c6308bf732248b8cf8cb2d1757e7782b755f1` |
| `binary-262145.bin` | 262,145 | `5d8e5555cdcfb3ece00bfa5de4340b2951a1af92423277c854969b18e03f4759` |

Run the development harness at `/tests/storage.html`. It is excluded from the
production entry point. The browser's private origin storage is **not** a
qualification of a user-selected Windows folder or its permission/revocation UX.

## Firmware candidate

The compiled application is 997,776 bytes, built using ESP-IDF 6.1, native service,
IPv6, directed presence, full RF calibration and the 1 Mbps comparison profile.
IBSS beacon experiments are disabled. The configured peer remains the previous
development peer and must be checked against a fresh advertisement before native
acceptance. No board was connected or flashed in this session.

```text
Application SHA256 (compile only):
f1798807c7774e7021eeddb8c325a7cfb04055148c60f309048d07c4eaa84ce3
```

The build-local TLS identity remains private. The firmware binary is not included
in the static web delivery. Existing native clients ignore the additive hardware
identity field and retain their original USB-serial check.

## Deferred hardware acceptance

Windows enumerated no serial ports. The user explicitly requested completing
the web implementation and tests while hardware was unavailable. Nothing from
the virtual wire, browser storage or earlier native CLI acceptance is counted as
a new hardware result.

- Verify replacement COM4 / USB serial `F0:9E:9E:1E:61:3C` before any open or flash;
  never operate original COM3, and release every other serial owner first.
- Flash/verify the candidate and confirm factory `hardware_id` matches the actual
  USB identity. Reconcile the current AWDL MAC and permitted Apple peer.
- Connect through the real browser chooser and test a user-selected Windows folder.
- Resolve the actual Apple name and retain the advertised/reachable distinction.
- Send Windows → native Mac AirDrop, accept natively, and read actual destination
  size/SHA256 without using SSH as the transfer transport.
- Share that file back through native AirDrop → the web receiver. Compare source,
  Mac destination and the actual saved Windows return hashes.
- Verify disconnect/reopen, interrupted writes, permission revocation, cancellation,
  native refusal, duplicate filenames and idle discovery with real hardware.

Browser directory publication is receipt-based, not a portable atomic directory
rename or an OS `fsync` guarantee. Keep the tab open and the computer awake;
unattended background reception is still a reason to retain the native client.
