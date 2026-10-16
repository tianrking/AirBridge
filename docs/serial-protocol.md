# Serial control protocol, version 2

The development sender and receiver share one serial owner. The firmware runs
native TLS and AWDL; Windows stages outgoing bytes and durably publishes incoming
files. This contract currently covers the authorized ESP32-S3 native USB
Serial/JTAG transport. External UART is not qualified by these tests.

## Connection and framing

Validate the USB hardware serial before opening the port. Send a newline to end
an abandoned command, then establish a fresh session with `HELLO`. Do not reset
the radio as a side effect of opening the port. Each command is ASCII:

```text
AB2 <uint32 sequence> <body> *<8 hexadecimal CRC32 digits>\n
```

IEEE CRC32 covers `<sequence> <body>` exactly. The physical record, including
newline, is at most 224 bytes; the body is at most 192 bytes. A fragmented record
is retained. An oversized record is discarded through its newline before parsing
resumes. Embedded control bytes and invalid checksums are rejected.

Firmware events are newline-delimited UTF-8 JSON. A leading empty line is a
record boundary, including after host disconnection. Scanner diagnostics are
assembled into a bounded buffer and queued as a batch under the same output
mutex as control replies. Diagnostic congestion may drop a complete batch;
it must not indefinitely block the radio loop. Transfer/control writes have a
bounded wait and must report failure rather than silently publish success.

## Sessions and replay

`HELLO <16 hexadecimal nonce>` establishes a session and returns protocol version,
maximum file size, chunk size and the current boot-local AWDL identity. Other
bodies start with `<nonce> `. A new nonce clears idle staging; an active native
send rejects a replacement session. A stale session cannot mutate current data.

Sequences increase within a session. Repeating the most recent identical command
returns its cached acknowledgement without applying the mutation again. A stale
sequence or conflicting payload is rejected. This is not permission for the host
to automatically resend a command after a timeout: a disconnected operation can
have an uncertain result. Reconcile status or start a fresh idle session first.

## Commands

| Verb | Arguments | Result |
| --- | --- | --- |
| `HELLO` | session nonce | Negotiate a session while idle |
| `RESOLVE` | peer AWDL MAC, advertised port | Read-only native TLS `/Discover`; no file offer |
| `BEGIN` | file bytes, manifest bytes, SHA256, peer AWDL MAC, port | Allocate bounded PSRAM staging |
| `META` | exact offset, Base64 bytes | Stage a binary-plist Ask manifest |
| `DATA` | exact offset, Base64 bytes | Stage source file bytes |
| `STATUS` | none | Report idle, staging or sending and source offset |
| `SEND` | none | Check completeness, SHA256 and manifest, then start native sending |
| `CANCEL` | none | Release idle staging or request cooperative native cancellation |

Chunks contain at most 112 decoded bytes. File staging is at most 1 MiB and
manifest staging at most 128 KiB. The sender accepts one regular file. The configured
Apple peer remains the qualified recipient; the new development resolver and sender
can also target a recently observed AirDrop offer with its matching advertised port.
Those additional devices are not file-qualified. Incoming access remains restricted
to the configured peer. Larger sources are rejected before
native file requests. Streaming beyond these limits is future qualification.

A `command_reply` includes `sequence`, `ok`, `reason`, `offset`, `protocol`,
`max_file`, `chunk_bytes` and `radio_mac`. New resolver-capable builds additionally
return `resolve:true` and `paired_peer`; the host checks this capability before
issuing `RESOLVE`. Connecting USB does not initiate a manual network query.
Wrong offsets, bad digests, mismatched
manifest sizes and incomplete staging never initiate native file delivery.

## Native events and incoming acknowledgements

`resolve_stage` reports read-only connection stages. `peer_resolved` carries the
selected MAC and native UTF-8 name as Base64. `resolution_complete` reports MAC,
error and HTTP status. A failed name lookup must not be presented as a resolved
device name or successful file transfer.

Discovery may retry a failed connection at most twice, refreshing BLE wake presence
between attempts. This applies only before the file offer; `/Ask` and `/Upload`
are not automatically repeated. Directed presence follows the selected endpoint,
while the AWDL clock still uses the validated metric-based election policy.

`outgoing_stage` distinguishes Discover connection, Ask connection, waiting for
native consent, accepted and uploading. `outgoing_peer` carries the UTF-8 native
display name as Base64. `outgoing_progress` counts archive wire bytes, including
DvZip framing; source staging progress counts file bytes separately.

`outgoing_complete` includes result, error, HTTP status, TransferID, source size,
source SHA256 and elapsed milliseconds. Native HTTP completion is a runtime
protocol result. Acceptance additionally reads the actual Apple destination and
compares its SHA256; it cannot be inferred from a TX callback or source digest.

Incoming `file_chunk` records retain the existing per-512-byte `CHUNK` stop/wait
acknowledgement. A host `COMMIT` nonce is sent only after file checks, flush and
publication. These acknowledgements use the same serial connection and parser
as outgoing commands. They must continue to be serviced during a native send.

## Validation

Run `python scripts/check-serial-contract.py --peer <fresh AWDL MAC>` for hardware
staging/replay rejection checks. This script does not send a native file. Close
and reopen the port between runs without resetting the board and compare radio
identities to establish session recovery. Portable and Python tests are separate
from these hardware checks and from native Apple file acceptance.
