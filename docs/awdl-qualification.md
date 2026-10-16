# New AWDL core hardware qualification

Author: tianrking <10758833+tianrking@users.noreply.github.com>

On 2026-10-16, the new ESP-IDF 6.1 diagnostic ran on the serial-verified replacement
ESP32-S3. The receive-only configuration decoded three real AWDL neighbors and
two AirDrop service advertisements with actual SRV port 8770. Their ARPA host
labels were UUIDs: no friendly AirDrop name is inferred from them.

The optional presence configuration emitted newly encoded PSF/MIF frames using
the same local clock, explicit root/parent/transmitter state and pinned channel-6
plan. In a 25-second observation it accepted 418 received management frames,
rejected three malformed frames and dropped no receive-queue entries. The driver
admitted 888 presence submissions and rejected none. Submission acceptance alone
would not qualify Apple admission.

The Mac independently recorded, at 15:33:34.429 Asia/Shanghai:

```text
wifip2pd: Post peer presence for [this bridge]
kernel: Posted Peer Presence for [this bridge]
wifip2pd: Posted peer presence for [this bridge] on awdl0
```

Thus the new management implementation passed actual Apple neighbor admission.
The Mac recorded absence after the bounded diagnostic stopped and the board was
restored. This is expected and is not a disconnection during a claimed file transfer.
Private raw frames and Mac logs are not included in the repository.

## Findings and fixes

The default main-task stack is 3,584 bytes. A twelve-row peer table initially
consumed too much of that stack. Moving the table and working observation into
static storage removed the observed reboot loop. A subsequent bounded scanner
run started normally and decoded live frames.

Apple's sync TLV may contain a legacy channel plan naming a 5 GHz center channel,
while the explicit operating-class TLV names the primary channel. Comparing those
numbers literally rejected valid frames. The new parser now prefers the explicit
plan, in line with the Linux reference's handling, while still rejecting conflicting
repeated explicit plans. A synthetic regression fixture covers 151 versus 149.

Service records use AWDL's fixed suffix dictionary, not DNS packet-offset pointers.
The new decoder validates owner lengths, RDATA lengths, PTR/SRV/TXT records and
the big-endian SRV port. Unknown dictionary codes are not guessed. Ordinary
management traffic cannot refresh the last observed service timestamp.

## Reproduction and limits

```powershell
cmd /c scripts\test-native.cmd
.\scripts\build-firmware.ps1
# A separate diagnostic build, never enabled by default:
.\scripts\build-firmware.ps1 -PresenceTx
```

The presence diagnostic retains the current board's assigned experimental address.
Do not flash that identity onto simultaneous boards. The SDK raw-frame ABI adapter
is restricted to own-source AWDL announcements and valid own-source IPv6 frames.
It is specific to the tested ESP-IDF 6.1/S3 environment.

The tested application hash and scoped counters are recorded in
[awdl-qualification.json](awdl-qualification.json). Native IPv6 exchange, mDNS,
TLS, `/Discover`, friendly names, files and the desktop application are still
unqualified in this implementation. Earlier file-transfer success is not inherited.
