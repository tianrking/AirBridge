# Discovery stability comparisons

Native file delivery and stable discoverability are separate acceptance gates.
The independent 262,145-byte receive in `native-receiving.md` remains valid, but
the Mac later lost that identity's route while the device continued running.
Do not describe this as sustained discovery qualification.

## Controlled development profiles, 2026-10-16

- Full SDK RF calibration alone did not restore the fixed identity's route.
- The single-band datapath correction alone did not restore that fixed identity.
- A fresh identity was admitted and completed the recorded native binary receive.
  Its later route loss means identity refresh is not a complete stability fix.
- A 6 Mbps profile with directed PSF/MIF announcements initially received Apple's
  `rssi:-73 ... outside bubble` rejection. Native TLS and `/Discover` later resumed.
  This profile was not qualified by a file transfer.
- A 1 Mbps comparison with directed announcements obtained Peer Presence, TLS,
  `/Discover` and an actual Finder AirDrop recipient named AirBridge PC. About
  five minutes after boot, the same native 262,145-byte binary was transferred
  successfully; Mac source and actual Windows SHA256 again matched
  `eb3ddcc7caeb6bef3d10eacdfc07ce0a89997ae4741711c528cce1402d65596c`.
  Host commit and HTTP response completion were both true. Exact image SHA256:
  `b227eb669fa05034d00ad933e1d039704dabc4a93185fe99e134a8a24cd90010`.
  Longer idle visibility, repeated reconnects and lifetime stability remain open.

These observations do not isolate a single cause: RF conditions, topology and
Apple neighbor state can change between boots. In particular, the log's 5 GHz
label does not prove that an ESP32-S3 transmitted on 5 GHz. The configured TX
ceiling is not an on-air power measurement.

Directed announcements use only the explicitly configured peer, its fresh
channel plan and computed channel-6 window, with a 500 ms minimum interval.
The broadcast announcements continue. Driver admission is not peer acceptance.

Build the optional rate comparison with `-LegacyRate1M`; omission explicitly
selects the default 6 Mbps profile. SDK configuration is applied before Wi-Fi
starts, as required by `esp_wifi_config_80211_tx_rate`. Both configurations retain
the SDK-supported 20 dBm ceiling, BLE and the existing NVS/PHY data. No Mac driver
threshold, Wi-Fi association or channel is changed by these comparisons.

Development harness rollback must use a preserved, hash-checked qualified image.
Never leave a timed experiment that silently replaces the chosen production
candidate. Keep one Windows receiver running for host acknowledgements; device
advertising alone cannot complete a Windows file receive.

The accepted 1 Mbps image is currently retained locally as
`work/native-receiver-directed-1m.bin`. Its resident Windows receiver uses
`--seconds 0`; the temporary timed flash/rollback harness was stopped without
rebooting the board, preserving the accepted current identity. The 6 Mbps binary
receive image is retained separately. Neither includes qualification for sending.
