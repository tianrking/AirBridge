# Protocol references and verification boundaries

Author: tianrking <10758833+tianrking@users.noreply.github.com>

Primary reference: `https://github.com/t4t5/omdrop-owl`, inspected local revision
`2b45e615f5e25c855374a46ab59612011878bc2e`.
Its `pins` selects OWL revision `832d70f815c3d4a06a02117bf0fc5e868daa1ff0`.

The reference is a Linux integration: monitor injection, radio configuration and
userspace services do not become an ESP-IDF backend simply by replacing an API.
The S3 implementation must separately account for one fixed 2.4 GHz channel,
wireless driver admission, completion ownership, queue bounds and local clocks.

## Wire facts used by the new core

- Apple vendor action prefix, action subtypes and little-endian TLV lengths.
- Synchronization field locations, 16 TU AW periods and four-AW extended windows.
- Election v1/v2 field locations and distinct root/parent/transmitter identities.
- Channel encodings 0/1/3 and sixteen-entry availability sequences.
- ARPA host labels with the compressed `.local` suffix.
- SNAP/AWDL data headers, IPv6 lengths and EUI-64 link-local addresses.

The core uses its own immutable announcement model, bounded parsing and table
operations. No Linux source files are copied into this repository. The Linux
projects retain their own licenses; links here do not relicense their code.

## Design decisions requiring separate validation

The parser rejects inconsistent roots, duplicate identity fields, ambiguous channel
plans and unsupported aggregated frames. The clock anchors to local receive time
and preserves the original timestamp across partial peer updates. Master selection
orders by metric, counter, path length and transmitter address. These are testable
implementation choices, not proof that every Apple device will accept this bridge.

AWDL host names and native AirDrop display names are different protocol facts.
The former may be read from management announcements. The latter is parsed by
the bounded TLS `/Discover` client and binary-plist reader; a real UTF-8 display
name has been verified on macOS. Neither MAC addresses nor RSSI prove identity.

Hardware captures and earlier firmware results are not committed as qualifications
for this new implementation. Native transfer success will be recorded only after
re-testing the actual flashed image and comparing both endpoint file hashes.
