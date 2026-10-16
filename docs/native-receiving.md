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

The retry initially stalled before `/Ask`. Complete SDK RF calibration alone
did not restore the fixed identity's route. Correcting the single-band datapath
profile also did not restore that identity's route. A subsequent boot with a
fresh locally administered AWDL identity was accepted by macOS with
`Posted Peer Presence`; native TLS and `/Discover` resumed. This supports testing
stale identity state, but does not prove Apple's cache was the sole cause.

## Binary receiving after backpressure repair

The subsequent native Finder retry received `AirBridge-native-receive-262145.bin`,
**262,145 bytes**, plus its 220-byte AppleDouble sidecar. Both the Mac source and
actual Windows file were rehashed after delivery and matched:

`eb3ddcc7caeb6bef3d10eacdfc07ce0a89997ae4741711c528cce1402d65596c`

Windows published the directory and acknowledged the commit nonce. The device
recorded `host_committed: true` and `response_written: true`. Exact image SHA256:

`ac3db69e668ca0e363c705f2b7826cf7eac55732f76509f88d28f1d96e3f6b41`

Its configuration used BLE, channel 6, 6 Mbps raw TX, 20 dBm configured ceiling,
full calibration and the single-band datapath profile. The image is retained
locally; private captures and TLS keys are not published.

This qualifies that native binary receive, not general reconnect reliability,
maximum-size transfer or sending. Each boot now generates a unicast AWDL
identity: read `radio_identity` and derive the current IPv6 address rather than
using an old MAC. The independent implementation does not yet send files.

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
