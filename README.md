<div align="center">

# AirBridge

**An experimental AirDrop bridge for Windows, powered by ESP32-S3.**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge puts Wi-Fi and Bluetooth on an ESP32-S3 and connects it to Windows over serial. A portable C++17 core implements AWDL framing, synchronization and protocol parsing; ESP-IDF 6.1 provides the radio backend. A Tauri 2 desktop application is planned.

> This README describes the capabilities available at this point in the repository history. Later transfer results do not qualify this revision.

## Project status

Native binary receiving passed SHA256 verification. The Windows receiver now preserves fragmented serial records and supports resident operation. Long-term discoverability and independent sending remain open.

| Capability | Status |
| :--- | :--- |
| AWDL parsing, clocks and topology | Implemented |
| Apple peer admission | Hardware verified |
| IPv6 over AWDL | Hardware verified |
| Native device names | Verified through TLS `/Discover` |
| Mac → Windows files | Text and 262,145-byte binary verified |
| Windows → Mac files | Not yet implemented |
| Desktop application | Tauri 2 · React · TypeScript · Rust — planned |

<details>
<summary>Verified binary fingerprint</summary>

`AirBridge-native-receive-262145.bin` · 262,145 bytes

```text
eb3ddcc7caeb6bef3d10eacdfc07ce0a89997ae4741711c528cce1402d65596c
```

</details>

> Development status: long-term visibility, repeated reconnects, larger transfers, iPhone interoperability, contact-only authentication and folder transfer remain unqualified. A discovered MAC or a successful TX callback does not prove file delivery.

## Hardware & prerequisites

| Item | Details |
| :--- | :--- |
| Development target | ESP32-S3 · 16 MiB flash · 8 MiB octal PSRAM |
| Firmware SDK | ESP-IDF 6.1 |
| Windows link | Native USB Serial/JTAG; external USB–UART is a separate, unqualified transport |
| Apple acceptance target | A Mac with Wi-Fi and Bluetooth enabled; AirDrop set to Everyone |
| Host tools | Python with pyserial; Visual Studio C++ tools or CMake for protocol checks |

The receiver uses PSRAM for bounded archive buffers. Earlier scanner-only revisions do not require those receive buffers.

## Quick start

### 1. Prepare the board and SDK

Activate an ESP-IDF 6.1 environment, connect the intended board and inspect its serial identity. Use one process to own the port.

```powershell
python -m pip install -r scripts/requirements.txt
python -m serial.tools.list_ports -v
```

The current host CLI validates one development board on **COM4**, including its USB serial. Review the binding in `scripts/receive-native.py` before adapting it to another board.

### 2. Build the firmware

Replace the example MAC with a fresh, advertised Apple AWDL peer from the scanner. The native receiver currently permits that explicitly configured peer.

```powershell
$peer = 'aa:bb:cc:dd:ee:ff'
idf.py -C firmware -B work/native `
  -D AIRBRIDGE_PRESENCE_TX=ON `
  -D AIRBRIDGE_IPV6_LINK=ON `
  -D AIRBRIDGE_NATIVE_SERVICE=ON `
  -D "AIRBRIDGE_PROBE_PEER=$peer" build
```

### 3. Flash the verified board

Flashing replaces the active application. Preserve a working image and confirm the board identity first. The project reserves a 2 MiB application at `0x10000`, NVS at `0x9000` and PHY data at `0xf000`; keep that layout when comparing firmware.

```powershell
idf.py -C firmware -B work/native -p COM4 flash
```

### 4. Start the Windows receiver

```powershell
python scripts/receive-native.py --directory received/inbox --log work/receive.jsonl --seconds 0
```

Keep the CLI running. Unlock the Mac, enable Everyone in AirDrop, then share a file from Finder to **AirBridge PC**. Compare the source SHA256 with the receipt and the actual Windows file. Close any old Waiting dialog before retrying.

Each serial chunk must be acknowledged. Windows checks sizes and SHA256, flushes files and publishes the temporary directory before confirming the transfer. Receipts sit beside completed directories; failed `.partial` output is retained for diagnosis.

## Verification

**Portable protocol assertions: 277.** **Windows receiver tests: 12.**

The portable suite covers malformed frames, bounds, synchronization and protocol wire data. Host tests exercise offset, digest and durable-publication failures. Hardware evidence is recorded separately.

```powershell
cmd /c scripts\test-native.cmd
```

```powershell
python -m unittest discover -s tests -p test_receiver.py -q
```

## Architecture

```mermaid
flowchart LR
  Apple["Apple device"] <-->|"AWDL · IPv6 · TLS"| ESP["ESP32-S3 / ESP-IDF 6.1"]
  ESP <-->|"Serial"| PC["Windows host"]
  PC -.-> UI["Tauri 2 desktop · planned"]
```

AWDL carries IPv6; mDNS locates the AirDrop service, and TLS carries discovery and transfer requests. Bluetooth provides a nonconnectable wake advertisement. The Windows Wi-Fi adapter does not need AWDL injection support.

AWDL MAC, DNS service instance, host label and AirDrop display name are different identities. Friendly names come from the native `/Discover` response when the peer provides one.

## Repository layout

| Item | Details |
| :--- | :--- |
| `core/` | Portable C++17 protocol core |
| `firmware/` | ESP-IDF radio backend |
| `scripts/` | Host and development tools |
| `tests/` | Protocol and host verification |
| `docs/` | Measured acceptance and reference notes |

## Documentation & evidence

- [Protocol references](docs/protocol-references.md)
- [AWDL neighbor admission](docs/awdl-qualification.md)
- [IPv6 payload roundtrip](docs/ipv6-qualification.md)
- [Native names through Discover](docs/discover-qualification.md)
- [Streaming archive core](docs/transfer-core.md)
- [Native receiving and file hashes](docs/native-receiving.md)

## Roadmap

- [ ] Independent Windows → Apple sending and verified roundtrips
- [ ] Stable discovery, reconnect recovery and clearer failure states
- [ ] Broader peer selection, real names and transfer progress
- [ ] Tauri 2 desktop application with React, TypeScript and Rust
- [ ] Expanded device, file-size and transport qualification

## Acknowledgments

The principal Linux reference is [t4t5/omdrop-owl](https://github.com/t4t5/omdrop-owl). Its fixed-channel strategy, synchronization selection and receive-padding work inform the interoperability requirements. Thanks also to [OWL](https://github.com/seemoo-lab/owl) and [OpenDrop](https://github.com/seemoo-lab/opendrop) for their AWDL and AirDrop research. Reference use and pinned revisions are documented in [protocol references](docs/protocol-references.md); this tree contains no vendored protocol source from these projects.

## License

[MIT](LICENSE). AirDrop is Apple’s technology. AirBridge is an independent experimental project, with no Apple affiliation or endorsement.
