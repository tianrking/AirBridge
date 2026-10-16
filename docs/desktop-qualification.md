# Desktop qualification — 2026-10-16

## Verified independently

The Rust backend delivered and received a real 4,097-byte binary through native
AirDrop. Windows source, actual Mac destination and actual Windows return SHA256:

```text
f884c184250242865af438f9aeceac67b2941b74eec91df25863a5ccd931676f
```

The native transfer IDs and exact qualified firmware fingerprint are recorded in
[the duplex receipt](native-duplex-2026-10-16.json). This transfer used no Python
file transport. The board was the authorized replacement ESP32-S3 with 8 MiB PSRAM.

## Actual desktop observations

- Offline Tauri executable starts using bundled React assets, without Vite.
- The Rust serial owner validates COM4 and the authorized USB serial.
- Real nearby AirDrop advertisements appear as selectable device cards.
- The configured Mac's actual Unicode name appeared from native TLS `/Discover`.
  Host labels and MAC addresses were not substituted for a device name.
- Windows' native file picker selected an 8,193-byte binary. Its SHA256 was
  `ea16bd5999fc7d7457e79736015fa28b027b046dfc51fedad6d24484dc80c0bc`.
- Explicit desktop sends reached source staging but failed before native consent
  with firmware error `-116` and HTTP status zero. The interface showed failure;
  no successful desktop delivery or return is claimed.
- Mac logs showed presence followed by absence about forty seconds later for one
  verified bridge identity. An earlier native name connection was captured, but
  later timed-out sends did not appear as TCP traffic on the Mac's `awdl0` capture.

The qualified duplex firmware was restored during these comparisons. The same
failure with the qualified image means the new read-only resolver alone has not
been established as the cause. Fresh identity generation is not a stability fix.
Do not describe these observations as a completed packaged desktop duplex test.

## Checks

- Portable C++ protocol checks and existing Python receiver checks remain required.
- Rust backend and desktop model tests cover real-file publication, malformed
  acknowledgements, completion state and native names.
- TypeScript build and frontend tests cover stale snapshot ordering, uncertain
  outcomes and supported-language fallback.
- Rust Clippy runs with warnings denied. Dependency lockfiles are included.

## Open release gates

Native GUI send and receive, sustained neighbor presence, refusal and cancellation
on hardware, installer validation, iPhone, broader peer selection, local incoming
consent, device-local identity provisioning and files beyond staged-send limits
remain unqualified. See [product acceptance](product-acceptance.md).
