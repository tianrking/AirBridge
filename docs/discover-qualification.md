# Real native AirDrop name qualification

Author: tianrking <10758833+tianrking@users.noreply.github.com>

On 2026-10-16 the new AWDL/lwIP backend, new Mbed TLS 4 client and new HTTP/plist
parsers completed native `/Discover` against the authorized Mac. The response
was HTTP 200 with `IsAirDropable=true`. `ReceiverComputerName` contained the real
Mac display name, including a Chinese character, and decoded correctly as UTF-8.
The private machine name and response body are excluded from the public receipt.

This name was not inferred from a MAC, UUID, ARPA host label, DHCP hostname, SSH
computer name or a manually configured alias. It came from the native AirDrop
response over the new AWDL data plane. The name source is `airdrop_discover`.

## Implementation

- The client initializes PSA, offers TLS 1.2 without an own contact certificate,
  and bounds TCP connect, TLS, HTTP write and HTTP read stages separately.
- A fresh advertised AirDrop peer and its actual SRV port are used explicitly.
- The 72-byte binary-plist request carries `DeviceSupportFlags`; HTTP chunk
  lengths are generated independently.
- The response parser validates chunk boundaries and length headers before
  modifying a complete buffer. Binary data resembling `0\r\n\r\n` cannot end a
  response prematurely. Ambiguous HTTP framing is rejected.
- The binary-plist reader bounds offsets, references, object count, dictionary
  size and output buffers. UTF-16, including surrogate pairs, converts to UTF-8.
- Task, socket and TLS allocations are released after each attempt. Structured
  results are returned to the controller task for serial output.

The bounded diagnostic retried read-only Discover operations after two cold-start
TCP connect timeouts. The third attempt completed. This is recorded, not hidden
as an unconditional first-attempt reliability result. No `/Ask` or `/Upload` was
issued by the name diagnostic, so it did not request a file-acceptance decision.

The board recorded 29 IPv6 receives, 35 completed transmissions and zero remaining
in-flight entries. The exact flashed hash and scoped result are in
[discover-qualification.json](discover-qualification.json). 166 native checks pass,
including a synthetic Python `plistlib` fixture with Chinese and an emoji.

## Run a bounded qualification

```powershell
.\scripts\build-firmware.ps1 -PresenceTx -Ipv6Link -ProbePeer <authorized-peer-mac>
```

The target is explicit; the build does not quietly choose a nearby device. The
diagnostic retains this board's experimental radio identity and must not be used
on simultaneous boards with that same identity. The receive-only default remains
unchanged. The known-working firmware was restored after the comparison.

Everyone-mode service discovery is not authenticated contact identity. Friendly
names are observed presentation data. Native receiving, Ask/Upload, actual files
and the desktop application are still unqualified in this new implementation.
