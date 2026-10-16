# Native receiving development qualification

The independent ESP-IDF 6.1 receiver implements BLE presence, AWDL mDNS,
TLS 1.2 and `/Discover`, `/Ask`, `/Upload`. It streams Apple DvZip/CPIO to
Windows over serial, retaining partial output until the complete archive and
every offered file have passed size and SHA256 checks. Everyone mode is the
development target; contact authentication is not implemented. The firmware
currently permits one explicitly configured Apple AWDL peer.

## Measured native transfer

On 2026-10-16, macOS Finder displayed **AirBridge PC** and transferred
`AirBridge-native-transfer.txt` through the native AirDrop sharing interface.
The independent development image had SHA256
`ad810c7bcf23ac2a819071a3cd43f329d35e4d59d664c9e8b891af398d6ebad8`.

| Property | Verified value |
| --- | --- |
| Original file bytes | 22,656 |
| Mac source SHA256 | `191eb28026c072899bcdf243601c5c3e65e19a4088b2dd23139afba50e0178aa` |
| Windows received SHA256 | `191eb28026c072899bcdf243601c5c3e65e19a4088b2dd23139afba50e0178aa` |
| Host commit / HTTP response written | Both true |

This proves native receiving for that development image and file. It does not
qualify subsequent changes, all file types, sustained throughput or bidirectional
transfer. The previous prototype's duplex results are not this implementation's
acceptance evidence. Credentials, private traces and local rollback images are
not distributed.

## Larger-file failure and repair under test

A subsequent native 262,145-byte binary upload reached `/Ask` and `/Upload`,
but the host detected a serial offset jump from 10,240 to 19,968. It rejected
the transfer without sending COMMIT. No successful large-file receipt was issued.

The current repair uses the USB Serial/JTAG interrupt driver, serialized output,
checked writes and a matching host acknowledgement after each 512-byte chunk.
The firmware waits up to five seconds for that acknowledgement. After complete
archive validation, Windows flushes each file, publishes the temporary directory
and acknowledges a fresh commit nonce; only then does the device send HTTP 200.
An HTTP write result alone does not prove the Apple UI completed delivery.

The retry has also encountered native discovery/connectivity stalling before
`/Ask`. Large-file receiving and reconnect stability remain under hardware test.
The current independent implementation does not yet provide file sending.

## Reproduce on the authorized development board

Install `scripts/requirements.txt` into the selected Python environment. Build
with presence, IPv6, native service and the current Apple peer's AWDL MAC:

```powershell
.\scripts\build-firmware.ps1 -PresenceTx -Ipv6Link -NativeService -ProbePeer 'aa:bb:cc:dd:ee:ff'
python scripts/receive-native.py --directory received/test --log work/receive.jsonl --seconds 300
```

The MAC above is a placeholder. The host CLI currently requires the explicitly
authorized replacement COM4 and verifies its USB serial before opening it. It
must be the only serial owner. The development build uses 16 MiB flash and
8 MiB octal PSRAM; the archive workspace needs PSRAM. Native USB and UART
are different transports; current receiving evidence covers native USB only.

`-FullCalibration` selects the SDK's complete RF calibration for a controlled
comparison without erasing NVS. It has not been established as a connectivity
fix. A normal build selects partial calibration again.

Select a file in Finder, share through AirDrop to AirBridge PC, and compare the
Mac source SHA256 with both the Windows receipt and the actual received file.
Failed `.partial` directories are retained for diagnosis and are not completed
deliveries. Receipts are stored beside completed directories, avoiding collisions
with payload filenames.
