# New IPv6 data-plane qualification

Author: tianrking <10758833+tianrking@users.noreply.github.com>

The new ESP-IDF backend creates a native lwIP IPv6 interface over the newly
implemented AWDL frame encoder/decoder. It feeds received IPv6 into lwIP, maps
link-local destinations to radio addresses, schedules unicast against the peer's
actual channel-6 availability and owns a bounded sixteen-slot TX queue.

On 2026-10-16 a real Mac `awdl0` UDP diagnostic completed:

```text
event: awdl_ipv6_echo_pass
bytes: 70
sha256: 1a67c4b6dc477424eb3632703d18592d4716fc733c4b70ce586330594ee1667a0
interface: awdl0
```

The script bound the source to the Mac's AWDL link-local address, used the AWDL
scope index for the literal destination, compared every returned byte and checked
the return endpoint and scope. It used neither localhost nor the LAN for the
diagnostic payload. The SSH connection only launched the test and read its result.
The board recorded one IPv6 receive, five completed transmissions including
startup control traffic, and zero remaining in-flight ownership slots.

## Callback and queue behavior

The private generic Wi-Fi callback did not report these raw-frame completions.
The implementation uses the public `esp_wifi_register_80211_tx_cb` instead.
Its `data_len` field is an eight-bit value and cannot express a full IPv6 MTU;
the callback reads only the fixed header of own-source frames and matches the
owned AWDL sequence. It releases ownership for both multicast and unicast,
including failures. TCP, rather than an unbounded raw-frame loop, owns unicast
retransmission. Queue entries also have a bounded lifetime.

One startup control packet with an unspecified IPv6 source was rejected by the
own-source guard. The test does not count it as successful. Native data traffic
and the diagnostic response use the assigned link-local source.

## Reproduce

```powershell
.\scripts\build-firmware.ps1 -PresenceTx -Ipv6Link
```

After explicitly flashing the verified test board, on the test Mac:

```sh
sudo python3 scripts/mac-ipv6-echo.py --target <bridge-link-local-address>
```

The script does not switch channels or disconnect Wi-Fi. Darwin socket-option
values are verified against Apple's
[socket_private.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/socket_private.h).
The test's UDP port 8779 is a diagnostic echo endpoint, not an AirDrop service.

The exact flashed hash and counters are in
[ipv6-qualification.json](ipv6-qualification.json). This qualifies a new IPv6
payload roundtrip, not TLS, `/Discover`, friendly names or native files. The
known-working firmware was restored after the bounded comparison.
