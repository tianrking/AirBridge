# Round display source provenance

- `components/st77916`: Espressif ST77916 Apache-2.0 driver, obtained through the Spotpear manufacturer demo and the previously verified local `muse_idf` bring-up. Original copyright headers and full Apache license retained. Controller initialization is unchanged.
- `components/lvgl`: LVGL **8.3.11**, MIT; the complete library sources, headers, Kconfig and license from that same local bring-up. Manufacturer demo assets (`src/demos`) and unrelated GIF/TTF assets are excluded. No runtime dependency on the original directory or Arduino.
- `components/round_display/board_display.c`, `board_input.c`, `pins.h`: board wiring/IDF driver adaptation from the user's local `muse_idf` project, with API names scoped to this board. No Muse network, credentials, audio, pairing, relay or provisioning source is copied.
- Board: Spotpear ESP32-S3R8 1.8-inch 360x360 Round V1, ST77916 QSPI + CST816S touch. Hardware reference: https://spotpear.cn/wiki/EPS32-S3R8-1.8inch-360x360-Round-LCD-Display-WIFI-Secondary-TouchScreen-AIDA64-Arduino-LVGL-WirelessAida64-Wireless-Power-Video-Electronic-Photo-Frame-MP3.html

AirBridge's AWDL, AirDrop, USB framing and host transfer implementation remain this repository's own existing core. Vendor license obligations apply to the separately identified display dependencies.

- `components/cjson`: upstream cJSON v1.7.19 (MIT), pinned source and license from the official DaveGamble/cJSON tag. Per-file SHA-256 is recorded in UPSTREAM.json. IDF 6.1 no longer includes the old `json` component; this local dependency keeps the round profile build self-contained.

- LVGL compatibility edit: cast the two selectors in `lv_obj_remove_style_all` to `lv_style_selector_t` before OR, avoiding a GCC 15 / C++23 enum-conversion diagnostic without weakening compiler error checks.

- LVGL memory adaptation: project-local `round_memory.c/h` allocates LVGL objects and non-DMA rendering scratch in PSRAM. The display draw buffer remains explicitly internal/DMA-capable. Upstream LVGL allocation interfaces and vendor licensing remain intact.
