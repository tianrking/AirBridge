# Product acceptance

AirBridge is a Windows application and an ESP32-S3 wireless bridge. The product
must expose real Apple discovery, checked file delivery and recoverable failure
states through a single serial owner. A build, mocked UI, TX callback or HTTP
diagnostic does not substitute for native file acceptance.

## Release gates

| Area | Required behavior | Acceptance evidence |
| --- | --- | --- |
| Board identity | Match the authorized USB serial before opening or flashing; retain the original COM3 exclusion during development | Port selection and identity-mismatch rejection |
| Discovery | Display names obtained through native Discover; distinguish advertised, reachable and expired peers | Apple Finder appearance and name-source evidence |
| Receiving | Validate manifests, offsets, archive completion and file hashes before host commit | Native Apple → Windows files with source/destination SHA256 |
| Sending | Validate source data before native requests; use one TransferID for Ask/Upload and fresh TLS after Discover | Native Windows → Apple files, native consent and destination SHA256 |
| Duplex | Keep the receiver available after sending without opening the serial device twice | Same-image file roundtrip and unchanged boot/radio identity |
| Serial recovery | Reject stale sessions, conflicting sequences, CRC damage and oversized records; reopen without unsafe resend | Hardware close/reopen tests and rejection tests |
| Failure recovery | Report disconnect, restart, declined consent, timeout, unsupported size and disk failure; keep incomplete files distinct | Injected failures followed by a successful native retry |
| Desktop | Tauri 2, React, TypeScript and Rust; English default with Traditional Chinese and Spanish | Real backend-connected UI walkthrough and keyboard operation |
| Web | Shared React interface, one Web Serial owner, explicit directory access and saved-file readback hashes | Real browser COM4 handshake, selected-directory publication and native Apple file roundtrip |
| File UX | Select an actual peer, choose files, show preparation/consent/transfer/completion and receive location | Native send/receive from the packaged application |
| Delivery | Versioned builds, dependency locks, documented flashing and startup, local diagnostics with private data excluded | Clean-machine build/package checks and release manifest |

## Development milestones

1. Native receiver and durable host commit: scoped text and 262,145-byte binary
   acceptance exists. Lifetime discoverability remains open.
2. Independent sender and session-aware serial control: a native 65,537-byte binary
   roundtrip passed on the same image and serial owner.
   Initial staging is explicitly bounded to 1 MiB. Larger files must be rejected
   before network transmission until streaming is implemented and qualified.
3. One Rust serial actor for commands, incoming records and outgoing operations.
   The Tauri renderer delegates serial ownership to Rust and never handles private
   keys. The browser build uses one direct Web Serial session; it does not invoke
   Rust and never handles the firmware's private TLS identity.
4. Native duplex acceptance on the same image, followed by the desktop workflow.
5. Release qualification: repeated boots, idle discovery, cancellation, refusal,
   reconnect, Unicode names, binary data and zero-byte files.

## Reliability evidence

Record the exact firmware SHA256, SDK version, transport, native Apple device,
file sizes and both endpoint hashes. Keep previous failures alongside successful
retries. Initial reliability targets are three cold boots, at least thirty minutes
of idle discovery and ten sequential native transfers. These are release gates,
not claims that the current development image has passed them.

The first shipped transport must be identified explicitly. Native USB Serial/JTAG
qualification does not establish external USB–UART compatibility. Native Apple
HTTP completion is the normal runtime delivery result; release tests additionally
read the actual Apple destination file and compare SHA256.

## User-visible states

Device: disconnected → identifying → ready → reconnecting / error.

Peer: advertised → resolving → available → expired / unavailable.

Outgoing: queued → preparing → awaiting consent → sending → completed / declined /
cancelled / failed / outcome uncertain.

Incoming: offered → awaiting local consent → receiving → checking → publishing →
completed / declined / cancelled / failed.

An uncertain outgoing result must not trigger an automatic resend. The UI must
keep the completed-file location separate from diagnostic and partial output.
Known development limits belong near the relevant action rather than hidden
behind a success badge.

## Security and scope

Everyone-mode interoperability is the current target. Contact-only authentication
and iPhone compatibility remain separate qualification work. The development
receiver is restricted to one configured peer; broader incoming access requires
an explicit local acceptance policy. A redistributable firmware image must not
ship a shared private TLS identity; device-local identity provisioning is a
release requirement. Existing local test-image keys and private captures remain
excluded from the repository and release artifacts.
