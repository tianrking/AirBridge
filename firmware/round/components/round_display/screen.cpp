// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include <algorithm>
#include <cstdio>
#include <cstring>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "mbedtls/base64.h"
#include "round_board.h"
#include "round_internal.hpp"
namespace airbridge::round_display {
namespace {
constexpr unsigned width = 360, height = 360, image_bytes = width * height * 2;
constexpr std::uint32_t ink = 0xeaf4ff, muted = 0x8aabc2, accent = 0x63dfca, blue = 0x253e55,
                        background = 0x081521;
lv_disp_drv_t display_driver;
lv_disp_draw_buf_t draw_buffer;
lv_font_t title_font, body_font;
lv_obj_t *page_root, *heading, *caption, *subcaption, *notice, *pulse;
lv_obj_t *rows[2], *names[2], *addresses[2], *pager, *allow_button, *name_button, *revoke_button,
    *cancel_button;
lv_obj_t *transfer_name[2], *transfer_state[2], *bars[2];
lv_obj_t* brightness_label;
round_ui::State* snapshot;
awdl::Mac row_macs[2]{};
unsigned page{}, offset{};
std::uint64_t last_tick{}, last_update{};
std::uint8_t* framebuffer;
SemaphoreHandle_t framebuffer_mutex;
std::atomic<bool> capture_busy{};
void label_text(lv_obj_t* label, const char* text) {
    if (label && std::strcmp(lv_label_get_text(label), text))
        lv_label_set_text(label, text);
}
lv_obj_t* label(const char* text, int x, int y, int w,
                const lv_font_t* font = &lv_font_montserrat_14, std::uint32_t color = ink) {
    auto* object = lv_label_create(page_root);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_width(object, w);
    lv_obj_set_height(object, font->line_height + 2);
    lv_label_set_long_mode(object, LV_LABEL_LONG_DOT);
    lv_label_set_text(object, text);
    lv_obj_set_style_text_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_text_font(object, font, 0);
    lv_obj_set_style_text_align(object, LV_TEXT_ALIGN_CENTER, 0);
    return object;
}
void change_page(unsigned target);
void navigate(lv_event_t* event) {
    change_page(unsigned(reinterpret_cast<std::uintptr_t>(lv_event_get_user_data(event))));
}
lv_obj_t* button(const char* text, int x, int y, int w, int h, lv_event_cb_t callback,
                 std::uintptr_t data = 0) {
    auto* object = lv_btn_create(page_root);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, w, h);
    lv_obj_set_style_radius(object, 18, 0);
    lv_obj_set_style_bg_color(object, lv_color_hex(blue), 0);
    lv_obj_set_style_bg_color(object, lv_color_hex(0x366179), LV_STATE_PRESSED);
    lv_obj_set_style_shadow_width(object, 0, 0);
    lv_obj_set_style_border_width(object, 1, 0);
    lv_obj_set_style_border_color(object, lv_color_hex(0x355368), 0);
    lv_obj_add_event_cb(object, callback, LV_EVENT_CLICKED, reinterpret_cast<void*>(data));
    auto* title = lv_label_create(object);
    lv_label_set_text(title, text);
    lv_obj_center(title);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(ink), 0);
    return object;
}
void enabled(lv_obj_t* object, bool value) {
    if (!object)
        return;
    if (value)
        lv_obj_clear_state(object, LV_STATE_DISABLED);
    else
        lv_obj_add_state(object, LV_STATE_DISABLED);
    lv_obj_set_style_opa(object, value ? LV_OPA_COVER : LV_OPA_40, 0);
}
void peer_click(lv_event_t* event) {
    const unsigned index =
        unsigned(reinterpret_cast<std::uintptr_t>(lv_event_get_user_data(event)));
    {
        Guard guard;
        if (index >= 2 ||
            !shared_state->select(row_macs[index], std::uint64_t(esp_timer_get_time()))) {
            shared_state->message("Device expired; wait for discovery");
            return;
        }
    }
    change_page(4);
}
void action_click(lv_event_t* event) {
    const auto kind =
        round_ui::ActionKind(reinterpret_cast<std::uintptr_t>(lv_event_get_user_data(event)));
    round_ui::Action action{};
    Guard guard;
    if (!shared_state->action(kind, std::uint64_t(esp_timer_get_time()), action)) {
        shared_state->message("Device expired or action unavailable");
        return;
    }
    if (xQueueSend(actions, &action, 0) != pdTRUE)
        shared_state->message("Control queue busy; try again");
    else
        shared_state->message("Request queued");
}
void page_devices(lv_event_t* event) {
    const bool next = reinterpret_cast<std::uintptr_t>(lv_event_get_user_data(event)) != 0;
    if (next)
        offset = std::min(offset + 2, 10u);
    else
        offset = offset >= 2 ? offset - 2 : 0;
    last_update = 0;
}
void brightness_click(lv_event_t* event) {
    const bool increase = reinterpret_cast<std::uintptr_t>(lv_event_get_user_data(event)) != 0;
    const int value = int(snapshot->brightness) + (increase ? 10 : -10);
    requested_brightness = std::max(10, std::min(85, value));
}
void change_page(unsigned target) {
    page = target < 5 ? target : 0;
    if (page_root)
        lv_obj_del(page_root);
    page_root = lv_obj_create(lv_scr_act());
    lv_obj_set_size(page_root, 360, 360);
    lv_obj_set_pos(page_root, 0, 0);
    lv_obj_set_style_bg_opa(page_root, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(page_root, 0, 0);
    lv_obj_set_style_pad_all(page_root, 0, 0);
    lv_obj_clear_flag(page_root, LV_OBJ_FLAG_SCROLLABLE);
    heading = caption = subcaption = notice = pulse = nullptr;
    allow_button = name_button = revoke_button = cancel_button = brightness_label = pager = nullptr;
    for (unsigned i = 0; i < 2; ++i)
        rows[i] = names[i] = addresses[i] = transfer_name[i] = transfer_state[i] = bars[i] =
            nullptr;
    if (page) {
        button(LV_SYMBOL_LEFT, 70, 42, 48, 32, navigate, 0);
        constexpr const char* titles[] = {"", "Nearby devices", "Activity", "Settings",
                                          "Apple device"};
        label(titles[page], 118, 48, 170, &lv_font_montserrat_20);
    }
    if (page == 0) {
        pulse = lv_arc_create(page_root);
        lv_obj_set_size(pulse, 318, 318);
        lv_obj_center(pulse);
        lv_arc_set_bg_angles(pulse, 0, 360);
        lv_arc_set_angles(pulse, 0, 60);
        lv_obj_remove_style(pulse, nullptr, LV_PART_KNOB);
        lv_obj_set_style_arc_width(pulse, 1, LV_PART_MAIN);
        lv_obj_set_style_arc_color(pulse, lv_color_hex(0x1b3e4d), LV_PART_MAIN);
        lv_obj_set_style_arc_width(pulse, 3, LV_PART_INDICATOR);
        lv_obj_set_style_arc_color(pulse, lv_color_hex(accent), LV_PART_INDICATOR);
        lv_obj_clear_flag(pulse, LV_OBJ_FLAG_CLICKABLE);
        heading = label("STARTING", 95, 73, 170, &lv_font_montserrat_14, accent);
        label("AirBridge", 60, 119, 240, &lv_font_montserrat_36);
        caption = label("Your round bridge", 60, 169, 240, &lv_font_montserrat_20, muted);
        subcaption =
            label("Connect a PC to transfer files", 53, 202, 254, &lv_font_montserrat_14, muted);
        button("Devices", 72, 239, 104, 39, navigate, 1);
        button("Activity", 184, 239, 104, 39, navigate, 2);
        button(LV_SYMBOL_SETTINGS, 147, 290, 66, 30, navigate, 3);
    } else if (page == 1) {
        caption = label("Listening for AirDrop", 65, 95, 230, &lv_font_montserrat_14, muted);
        for (unsigned i = 0; i < 2; ++i) {
            rows[i] = button("", 57, 123 + int(i) * 67, 246, 59, peer_click, i);
            names[i] = lv_label_create(rows[i]);
            lv_obj_set_pos(names[i], -3, -4);
            lv_obj_set_width(names[i], 213);
            lv_obj_set_height(names[i], body_font.line_height + 2);
            lv_label_set_long_mode(names[i], LV_LABEL_LONG_DOT);
            lv_obj_set_style_text_font(names[i], &body_font, 0);
            addresses[i] = lv_label_create(rows[i]);
            lv_obj_set_pos(addresses[i], -3, 23);
            lv_obj_set_width(addresses[i], 213);
            lv_obj_set_style_text_color(addresses[i], lv_color_hex(muted), 0);
            lv_obj_set_style_text_font(addresses[i], &lv_font_montserrat_14, 0);
        }
        button(LV_SYMBOL_LEFT, 82, 272, 55, 31, page_devices, 0);
        button(LV_SYMBOL_RIGHT, 223, 272, 55, 31, page_devices, 1);
        pager = label("1 / 1", 141, 278, 78, &lv_font_montserrat_14, muted);
    } else if (page == 4) {
        heading = label("Apple device", 50, 103, 260, &body_font);
        caption = label("", 55, 136, 250, &lv_font_montserrat_14, muted);
        subcaption = label("Observed advertisement", 57, 163, 246, &lv_font_montserrat_14, muted);
        notice = label("", 60, 188, 240, &lv_font_montserrat_14, accent);
        allow_button = button("Allow sender", 62, 225, 116, 39, action_click,
                              std::uintptr_t(round_ui::ActionKind::allow));
        name_button = button("Read name", 184, 225, 114, 39, action_click,
                             std::uintptr_t(round_ui::ActionKind::resolve));
        revoke_button = button("Revoke access", 90, 276, 180, 31, action_click,
                               std::uintptr_t(round_ui::ActionKind::revoke));
    } else if (page == 2) {
        for (unsigned i = 0; i < 2; ++i) {
            label(i ? "TO APPLE" : "FROM APPLE", 78, 101 + int(i) * 72, 204, &lv_font_montserrat_14,
                  accent);
            transfer_name[i] = label("No transfer yet", 55, 123 + int(i) * 72, 250, &body_font);
            transfer_state[i] =
                label("", 61, 147 + int(i) * 72, 238, &lv_font_montserrat_14, muted);
            bars[i] = lv_bar_create(page_root);
            lv_obj_set_pos(bars[i], 72, 169 + int(i) * 72);
            lv_obj_set_size(bars[i], 216, 5);
            lv_bar_set_range(bars[i], 0, 1000);
            lv_obj_set_style_bg_color(bars[i], lv_color_hex(blue), LV_PART_MAIN);
            lv_obj_set_style_bg_color(bars[i], lv_color_hex(accent), LV_PART_INDICATOR);
        }
        cancel_button = button("Cancel outgoing", 85, 273, 190, 34, action_click,
                               std::uintptr_t(round_ui::ActionKind::cancel));
    } else if (page == 3) {
        label("DISPLAY BRIGHTNESS", 75, 99, 210, &lv_font_montserrat_14, muted);
        brightness_label = label("65%", 100, 129, 160, &lv_font_montserrat_36);
        button(LV_SYMBOL_MINUS, 83, 181, 85, 39, brightness_click, 0);
        button(LV_SYMBOL_PLUS, 192, 181, 85, 39, brightness_click, 1);
        label("SPOTPEAR ROUND V1", 58, 244, 244, &lv_font_montserrat_14, accent);
        label("ESP-IDF 6.1 / AirBridge 0.0.1", 48, 266, 264, &lv_font_montserrat_14, muted);
        label("USB host needed for files", 70, 290, 220, &lv_font_montserrat_14, muted);
    }
    last_update = 0;
}
const char* phase_name(round_ui::Phase phase, bool send) {
    switch (phase) {
        case round_ui::Phase::preparing:
            return "Preparing in Windows";
        case round_ui::Phase::sending:
            return "Sending / waiting for Apple";
        case round_ui::Phase::receiving:
            return "Receiving to Windows";
        case round_ui::Phase::verifying:
            return "Verifying saved bytes on PC";
        case round_ui::Phase::complete:
            return send ? "Native send completed" : "Saved and confirmed by PC";
        case round_ui::Phase::failed:
            return "Failed / retry from the PC";
        case round_ui::Phase::uncertain:
            return "Not confirmed / check PC";
        default:
            return "Ready when you are";
    }
}
void update(std::uint64_t now) {
    {
        Guard guard;
        auto& incoming = shared_state->transfers[0];
        if (incoming.active() && now >= incoming.updated && now - incoming.updated > 125'000'000)
            shared_state->receive_closed(now);
        *snapshot = *shared_state;
    }
    char buffer[300];
    if (page == 0) {
        label_text(heading, snapshot->radio_ready ? "AWDL / CHANNEL 6" : "STARTING WIRELESS");
        std::snprintf(buffer, sizeof(buffer), "%u nearby / %u ready", snapshot->count(now),
                      snapshot->ready_count(now));
        label_text(caption, buffer);
        const bool active = snapshot->host_activity && now >= snapshot->host_activity &&
                            now - snapshot->host_activity < 30'000'000;
        label_text(subcaption,
                   active ? "USB host recently active" : "Connect a PC to transfer files");
        const int angle = int((now / 18000) % 360);
        lv_arc_set_angles(pulse, angle, angle + 62);
    } else if (page == 1 && !touch_down) {
        const round_ui::Peer* visible[12]{};
        unsigned count = 0;
        for (const auto& peer : snapshot->peers)
            if (snapshot->observed(peer, now))
                visible[count++] = &peer;
        if (offset >= count)
            offset = count ? ((count - 1) / 2) * 2 : 0;
        for (unsigned i = 0; i < 2; ++i) {
            if (offset + i >= count) {
                lv_obj_add_flag(rows[i], LV_OBJ_FLAG_HIDDEN);
                continue;
            }
            lv_obj_clear_flag(rows[i], LV_OBJ_FLAG_HIDDEN);
            const auto& peer = *visible[offset + i];
            row_macs[i] = peer.mac;
            label_text(names[i], peer.resolved       ? peer.name.data()
                                 : *peer.host.data() ? peer.host.data()
                                                     : "Apple device");
            std::snprintf(buffer, sizeof(buffer), "%02x:%02x:%02x:%02x:%02x:%02x   %d dBm",
                          peer.mac[0], peer.mac[1], peer.mac[2], peer.mac[3], peer.mac[4],
                          peer.mac[5], int(peer.rssi));
            label_text(addresses[i], buffer);
        }
        std::snprintf(buffer, sizeof(buffer), "%u seen / %u AirDrop ready", count,
                      snapshot->ready_count(now));
        label_text(caption, count ? buffer : "Listening for AWDL on channel 6");
        std::snprintf(buffer, sizeof(buffer), "%u / %u", offset / 2 + 1,
                      std::max(1u, (count + 1) / 2));
        label_text(pager, buffer);
    } else if (page == 4) {
        const auto* peer = snapshot->find(snapshot->selected);
        const bool seen = peer && snapshot->observed(*peer, now);
        const bool valid = peer && snapshot->eligible(*peer, now);
        label_text(heading, peer ? (peer->resolved       ? peer->name.data()
                                    : *peer->host.data() ? peer->host.data()
                                                         : "Apple device")
                                 : "Device expired");
        const auto& mac = snapshot->selected;
        std::snprintf(buffer, sizeof(buffer), "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1],
                      mac[2], mac[3], mac[4], mac[5]);
        label_text(caption, buffer);
        label_text(subcaption, !seen    ? "Device no longer nearby"
                               : !valid ? (peer->port ? "AirDrop announcement expired"
                                                      : "AWDL seen / AirDrop not announced")
                               : snapshot->allowed == snapshot->selected
                                   ? "Allowed sender / this session"
                               : peer->resolved ? "Name from native AirDrop"
                                                : "AWDL host hint / name unverified");
        label_text(notice, snapshot->notice.data());
        enabled(allow_button, valid);
        enabled(name_button, valid);
        enabled(revoke_button, snapshot->allowed != awdl::Mac{});
    } else if (page == 2) {
        for (unsigned i = 0; i < 2; ++i) {
            const auto& transfer = snapshot->transfers[i];
            label_text(transfer_name[i], *transfer.name.data() ? transfer.name.data()
                                         : transfer.phase == round_ui::Phase::idle
                                             ? "No transfer yet"
                                             : "File transfer");
            label_text(transfer_state[i], phase_name(transfer.phase, i != 0));
            lv_bar_set_value(bars[i], int(transfer.progress()), LV_ANIM_OFF);
        }
        if (snapshot->transfers[1].active())
            lv_obj_clear_flag(cancel_button, LV_OBJ_FLAG_HIDDEN);
        else
            lv_obj_add_flag(cancel_button, LV_OBJ_FLAG_HIDDEN);
    } else if (page == 3) {
        std::snprintf(buffer, sizeof(buffer), "%u%%", snapshot->brightness);
        label_text(brightness_label, buffer);
    }
}
bool transfer_done(esp_lcd_panel_io_handle_t, esp_lcd_panel_io_event_data_t*, void* context) {
    frames.fetch_add(1, std::memory_order_relaxed);
    lv_disp_flush_ready(static_cast<lv_disp_drv_t*>(context));
    return false;
}
void flush(lv_disp_drv_t* display, const lv_area_t* area, lv_color_t* pixels) {
    if (area->x1 < 0 || area->y1 < 0 || area->x2 >= 360 || area->y2 >= 360) {
        ++display_errors;
        lv_disp_flush_ready(display);
        return;
    }
    xSemaphoreTake(framebuffer_mutex, portMAX_DELAY);
    const unsigned stride = unsigned(area->x2 - area->x1 + 1) * 2;
    for (int y = area->y1; y <= area->y2; ++y)
        std::memcpy(framebuffer + (y * 360 + area->x1) * 2,
                    reinterpret_cast<const std::uint8_t*>(pixels) + (y - area->y1) * stride,
                    stride);
    xSemaphoreGive(framebuffer_mutex);
    if (esp_lcd_panel_draw_bitmap(round_board_display_panel(), area->x1, area->y1, area->x2 + 1,
                                  area->y2 + 1, pixels) != ESP_OK) {
        ++display_errors;
        lv_disp_flush_ready(display);
    }
}
void read_touch(lv_indev_drv_t*, lv_indev_data_t* data) {
    std::uint16_t x{}, y{};
    bool pressed{};
    const auto error = round_board_touch_read(&x, &y, &pressed);
    ++touch_samples;
    if (error != ESP_OK) {
        ++touch_errors;
        pressed = false;
    }
    if (pressed && !touch_down.load())
        ++touches;
    if (pressed) {
        touch_x = x;
        touch_y = y;
        data->point.x = x;
        data->point.y = y;
    }
    touch_down = pressed;
    data->state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}
void ui_task(void*) {
    bool old_boot = false;
    std::uint64_t last_button{};
    for (;;) {
        const auto time = std::uint64_t(esp_timer_get_time());
        lv_tick_inc(std::uint32_t((time - last_tick) / 1000));
        last_tick = time;
        const int desired = requested_view.exchange(-1);
        if (desired >= 0)
            change_page(unsigned(desired));
        const int brightness = requested_brightness.exchange(-1);
        if (brightness >= 0)
            set_brightness(unsigned(brightness));
        const bool boot = round_board_button_pressed();
        if (boot && !old_boot && time - last_button > 200000) {
            change_page(0);
            last_button = time;
        }
        old_boot = boot;
        if (time - last_update >= 160000) {
            update(time);
            last_update = time;
        }
        lv_timer_handler();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
void capture_task(void* context) {
    auto* copy = static_cast<std::uint8_t*>(context);
    xSemaphoreTake(framebuffer_mutex, portMAX_DELAY);
    std::memcpy(copy, framebuffer, image_bytes);
    xSemaphoreGive(framebuffer_mutex);
    char line[900];
    unsigned offset = 0;
    bool okay = true;
    const auto id = static_cast<unsigned long long>(esp_timer_get_time());
    int size = std::snprintf(line, sizeof(line),
                             "{\"event\":\"round_frame_begin\",\"id\":%llu,\"width\":360,"
                             "\"height\":360,\"format\":\"rgb565be\",\"bytes\":%u}\n",
                             id, image_bytes);
    okay = output(line, std::size_t(size));
    while (okay && offset < image_bytes) {
        const auto count = std::min(384u, image_bytes - offset);
        unsigned char encoded[516]{};
        std::size_t used{};
        if (mbedtls_base64_encode(encoded, sizeof(encoded), &used, copy + offset, count)) {
            okay = false;
            break;
        }
        size = std::snprintf(
            line, sizeof(line),
            "{\"event\":\"round_frame_chunk\",\"id\":%llu,\"offset\":%u,\"data\":\"%s\"}\n", id,
            offset, encoded);
        okay = size > 0 && std::size_t(size) < sizeof(line) && output(line, std::size_t(size));
        offset += count;
        vTaskDelay(1);
    }
    size =
        std::snprintf(line, sizeof(line),
                      "{\"event\":\"round_frame_end\",\"id\":%llu,\"complete\":%s,\"bytes\":%u}\n",
                      id, okay ? "true" : "false", offset);
    output(line, std::size_t(size));
    free(copy);
    capture_busy = false;
    vTaskDelete(nullptr);
}
}  // namespace
esp_err_t screen_begin() {
    snapshot = ui_snapshot;
    const auto touch = round_board_input_init();
    if (touch != ESP_OK)
        return touch;
    framebuffer_mutex = xSemaphoreCreateMutex();
    framebuffer = static_cast<std::uint8_t*>(
        heap_caps_calloc(1, image_bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    auto* pixels = static_cast<lv_color_t*>(
        heap_caps_malloc(360 * 10 * sizeof(lv_color_t), MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL));
    if (!framebuffer_mutex || !framebuffer || !pixels)
        return ESP_ERR_NO_MEM;
    lv_init();
    title_font = lv_font_montserrat_24;
    title_font.fallback = &lv_font_simsun_16_cjk;
    body_font = lv_font_montserrat_20;
    body_font.fallback = &lv_font_simsun_16_cjk;
    lv_disp_draw_buf_init(&draw_buffer, pixels, nullptr, 360 * 10);
    lv_disp_drv_init(&display_driver);
    display_driver.hor_res = 360;
    display_driver.ver_res = 360;
    display_driver.draw_buf = &draw_buffer;
    display_driver.flush_cb = flush;
    auto error = round_board_display_init(transfer_done, &display_driver);
    if (error != ESP_OK)
        return error;
    if (!lv_disp_drv_register(&display_driver))
        return ESP_ERR_NO_MEM;
    static lv_indev_drv_t input;
    lv_indev_drv_init(&input);
    input.type = LV_INDEV_TYPE_POINTER;
    input.read_cb = read_touch;
    if (!lv_indev_drv_register(&input))
        return ESP_ERR_NO_MEM;
    lv_obj_clear_flag(lv_scr_act(), LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(background), 0);
    change_page(0);
    *snapshot = *shared_state;
    last_tick = std::uint64_t(esp_timer_get_time());
    lv_refr_now(nullptr);
    error = round_board_backlight_set(shared_state->brightness);
    if (error != ESP_OK)
        return error;
    if (xTaskCreatePinnedToCore(ui_task, "airbridge_round", 8192, nullptr, 1, nullptr, 1) != pdPASS)
        return ESP_ERR_NO_MEM;
    ESP_LOGI("airbridge_round", "ST77916 360x360 + CST816S ready; LVGL %d.%d.%d",
             LVGL_VERSION_MAJOR, LVGL_VERSION_MINOR, LVGL_VERSION_PATCH);
    return ESP_OK;
}
bool capture_screen() {
    bool idle = false;
    if (!framebuffer || !capture_busy.compare_exchange_strong(idle, true))
        return false;
    auto* copy = static_cast<std::uint8_t*>(
        heap_caps_malloc(image_bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!copy || xTaskCreatePinnedToCore(capture_task, "round_capture", 8192, copy, 1, nullptr,
                                         1) != pdPASS) {
        free(copy);
        capture_busy = false;
        return false;
    }
    return true;
}
}  // namespace airbridge::round_display
