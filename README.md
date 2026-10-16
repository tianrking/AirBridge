<div align="center">

# AirBridge

**An experimental AirDrop bridge for Windows, powered by ESP32-S3.**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge puts Wi-Fi and Bluetooth on an ESP32-S3 and connects it to Windows over serial. A portable C++17 core implements AWDL framing, synchronization and protocol parsing; ESP-IDF 6.1 provides the radio backend. A Tauri 2 desktop application is planned.

> This README describes the capabilities available at this point in the repository history. Later transfer results do not qualify this revision.

## Project status

A real Mac `awdl0` interface completed a byte-checked IPv6 UDP roundtrip through the new wireless backend. Native file transfer remains unqualified.

| Capability | Status |
| :--- | :--- |
| AWDL parsing, clocks and topology | Implemented |
| Apple peer admission | Hardware verified |
| IPv6 over AWDL | Hardware verified |
| Native device names | Planned |
| Mac → Windows files | Planned |
| Windows → Mac files | Not yet implemented |
| Desktop application | Tauri 2 · React · TypeScript · Rust — planned |

> Development status: long-term visibility, repeated reconnects, larger transfers, iPhone interoperability, contact-only authentication and folder transfer remain unqualified. A discovered MAC or a successful TX callback does not prove file delivery.

## Hardware & prerequisites

| Item | Details |
| :--- | :--- |
| Development target | ESP32-S3 · 16 MiB flash · 8 MiB octal PSRAM |
| Firmware SDK | ESP-IDF 6.1 |
| Windows link | Native USB Serial/JTAG; external USB–UART is a separate, unqualified transport |
| Apple acceptance target | A Mac with Wi-Fi and Bluetooth enabled; AirDrop set to Everyone |
| Host tools | Python with pyserial; Visual Studio C++ tools or CMake for protocol checks |

PSRAM is part of the development target for later transfer work. This scanner revision does not need receive-service archive buffers.

## Quick start

### 1. Prepare the board and SDK

Activate an ESP-IDF 6.1 environment, connect the intended board and inspect its serial identity. Use one process to own the port.

### 2. Build the firmware

The default firmware listens on channel 6 and emits JSON observations. Start with the scanner to inspect available AWDL peers.

```powershell
idf.py -C firmware -B work/scanner build
```

### 3. Flash the verified board

Flashing replaces the active application. Preserve a working image and confirm the board identity first. The project reserves a 2 MiB application at `0x10000`, NVS at `0x9000` and PHY data at `0xf000`; keep that layout when comparing firmware.

```powershell
idf.py -C firmware -B work/scanner -p COM4 flash
```

At this revision, the scanner and protocol probes are development tools. They do not provide a native file receive service.

## Verification

**Portable protocol assertions: 117.**

The portable suite covers malformed frames, bounds, synchronization and protocol wire data. Hardware evidence is recorded separately as it becomes available.

```powershell
cmd /c scripts\test-native.cmd
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
