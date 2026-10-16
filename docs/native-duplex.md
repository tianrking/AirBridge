# Independent native duplex acceptance

On 2026-10-16, the independent ESP-IDF 6.1 sender delivered
`AirBridge-native-send-65537.bin` from Windows through the ESP32-S3 to native
macOS AirDrop. The user accepted the native invitation. The Mac saved 65,537 bytes
in Downloads. SSH read the actual destination size and SHA256; SSH did not carry
the file payload. Finder then shared that Mac copy back to **AirBridge PC**.
Windows durably published the return and the board wrote the native HTTP response.

| Actual copy | Bytes | SHA256 |
| --- | ---: | --- |
| Windows source | 65,537 | `79a270a3d8772b20bcfd151c835afe2853483336ff82fee0b7a706924c47d88d` |
| Mac Downloads destination | 65,537 | `79a270a3d8772b20bcfd151c835afe2853483336ff82fee0b7a706924c47d88d` |
| Windows native return | 65,537 | `79a270a3d8772b20bcfd151c835afe2853483336ff82fee0b7a706924c47d88d` |

## Exact qualification

- Application SHA256: `d10b0b293e25edbba744e156d8c297b4ee6141b1babd7357db1b4b23fb307024`.
- ESP32-S3, 16 MiB flash, 8 MiB octal PSRAM; ESP-IDF 6.1.
- Serial-verified replacement COM4, USB serial `F0:9E:9E:1E:61:3C`; native USB
  Serial/JTAG. The original COM3 was not operated.
- Directed presence, 1 Mbps raw rate, full RF calibration; same boot-local AWDL
  identity `ce:f8:6b:4a:61:22` for both transfer directions.
- Native `/Discover`, fresh TLS for `/Ask` and `/Upload`, explicit user consent,
  native upload HTTP 200 and actual destination hash verification.
- Outgoing TransferID `AB3595DF-C732-4A4A-8623-AF10635C77B0`.
- Return TransferID `DB08E877-47FB-44C8-B56B-6F7F0AB96177`;
  `host_committed=true` and `response_written=true`.
- No firmware restart occurred between sending and receiving. The same host
  process retained the serial port and serviced incoming acknowledgements.
- Outgoing elapsed time was 184,080 ms, including roughly 132 seconds waiting
  for native user consent. This is not a throughput measurement.
- A 214-byte AppleDouble metadata sidecar was retained separately.

The machine-readable evidence is [native-duplex-2026-10-16.json](native-duplex-2026-10-16.json).
Private captures, passwords, private keys and local diagnostic streams are excluded.

## Failures addressed before this acceptance

### Serial reopen

A closed host left a truncated scanner JSON record. A later control reply could
be appended to that partial record and discarded by the host JSON parser, making
a real HELLO reply look like a device timeout. The raw byte stream established
this failure; replacing stdin alone did not solve it.

Scanner diagnostics are now assembled in a bounded buffer and written through
the same driver and output mutex as control replies. Each write establishes a
newline boundary. Diagnostic congestion drops a batch without blocking the radio
loop; control and transfer writes have bounded waits. Input uses a bounded direct
driver decoder and resynchronizes after oversized records.

The record-serialization image `154117e8d22924f1927cf35310491045e02bf8e6a9bf450da96686ffc228755e`
passed four close/reopen cycles without reset, with 18 rejection/replay checks per
cycle and an unchanged radio identity. The final image passed those protocol
checks and reopened successfully for native sending. These runs do not establish
arbitrary physical unplug recovery or external UART operation.

### TLS memory

An earlier sender returned `PSA_ERROR_INSUFFICIENT_MEMORY` on its second attempt.
The SDK had confined Mbed TLS allocations to internal RAM. The firmware now selects
the SDK-supported PSRAM allocator and records bounded stage/memory diagnostics.
The application still needs internal RAM for task stacks, radio and network state;
PSRAM does not remove those constraints.

### Apple receive service lifetime

An air-interface capture showed the Mac returning TCP RST from port 8770 before
TLS. Its native log separately showed the Bonjour AirDrop server starting and then
stopping about 15 seconds later. A repeated unchanged startup BLE advertisement
was insufficient in that observation.

An explicit outgoing send now refreshes the bridge's own nonconnectable BLE
advertisement and random advertiser address before starting Discover. The following
attempt reached the Mac's native TLS, decoded its real name, presented the native
consent prompt and completed a checked file roundtrip. This is evidence for the
recorded Mac and sequence, not a universal Apple wake/visibility guarantee.

## Reproduction and limits

Build with the settings in [native receiving](native-receiving.md) and use
`scripts/send-native.py` as documented in the README. Stop separate serial owners
before starting it. `--listen-after` keeps the receiver running after sending.

The independent sender stages one file up to 1 MiB, validates the binary-plist
manifest and source SHA256 before native requests, and uses the project's own
CPIO/DvZip writer. It does not automatically retry uncertain native deliveries.
Friendly names come from native Discover, not from MAC-derived aliases.

This run qualifies one Mac, one binary size and the recorded image. iPhone,
contact-only authentication, folders, larger files, sustained load, lifetime
visibility and the Tauri desktop workflow remain separate release gates.
