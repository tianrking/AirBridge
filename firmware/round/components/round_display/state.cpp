// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <new>

#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_idf_version.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "mbedtls/base64.h"
#include "nvs.h"
#include "round_board.h"
#include "round_internal.hpp"
namespace airbridge::round_display {
round_ui::State *shared_state, *ui_snapshot, *diagnostic_snapshot;
SemaphoreHandle_t state_mutex;
QueueHandle_t actions;
Record output;
std::atomic<int> requested_view{-1}, requested_brightness{-1};
std::atomic<unsigned> frames{}, touch_samples{}, touch_errors{}, touches{}, display_errors{};
std::atomic<int> touch_x{}, touch_y{};
std::atomic<bool> touch_down{};
namespace {
std::uint64_t now() { return std::uint64_t(esp_timer_get_time()); }
const char* text(cJSON* object, const char* key) {
    const auto* value = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(value) ? value->valuestring : "";
}
std::uint64_t number(cJSON* object, const char* key) {
    const auto* value = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(value) && value->valuedouble >= 0 && value->valuedouble < 1.0e15
               ? std::uint64_t(value->valuedouble)
               : 0;
}
bool flag(cJSON* object, const char* key) {
    return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(object, key));
}
bool read_mac(const char* text, awdl::Mac& result) {
    unsigned b[6]{};
    char suffix{};
    if (std::sscanf(text, "%2x:%2x:%2x:%2x:%2x:%2x%c", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5],
                    &suffix) != 6)
        return false;
    for (unsigned i = 0; i < 6; ++i)
        result[i] = std::uint8_t(b[i]);
    return true;
}
void decode_name(cJSON* object, char* destination, std::size_t capacity) {
    const auto* encoded = text(object, "name_b64");
    std::size_t used{};
    if (*encoded && mbedtls_base64_decode(
                        reinterpret_cast<unsigned char*>(destination), capacity - 1, &used,
                        reinterpret_cast<const unsigned char*>(encoded), std::strlen(encoded)) == 0)
        destination[used] = 0;
}
}  // namespace
esp_err_t begin(Record record) {
    if (state_mutex || !record)
        return ESP_ERR_INVALID_STATE;
    for (auto** slot : {&shared_state, &ui_snapshot, &diagnostic_snapshot}) {
        void* memory =
            heap_caps_malloc(sizeof(round_ui::State), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!memory)
            return ESP_ERR_NO_MEM;
        *slot = new (memory) round_ui::State{};
    }
    state_mutex = xSemaphoreCreateMutex();
    actions = xQueueCreate(8, sizeof(round_ui::Action));
    if (!state_mutex || !actions)
        return ESP_ERR_NO_MEM;
    Guard startup_guard;
    output = record;
    nvs_handle_t handle;
    if (nvs_open("airbridge_round", NVS_READONLY, &handle) == ESP_OK) {
        std::uint8_t brightness = 65;
        if (nvs_get_u8(handle, "brightness", &brightness) == ESP_OK && brightness >= 10 &&
            brightness <= 85)
            shared_state->brightness = brightness;
        nvs_close(handle);
    }
    shared_state->message("Connect a PC to transfer files");
    return screen_begin();
}
void set_brightness(unsigned percent) {
    if (percent < 10 || percent > 85)
        return;
    if (round_board_backlight_set(percent) != ESP_OK) {
        Guard guard;
        shared_state->message("Backlight update failed");
        return;
    }
    bool saved = false;
    nvs_handle_t handle;
    if (nvs_open("airbridge_round", NVS_READWRITE, &handle) == ESP_OK) {
        saved = nvs_set_u8(handle, "brightness", std::uint8_t(percent)) == ESP_OK &&
                nvs_commit(handle) == ESP_OK;
        nvs_close(handle);
    }
    Guard guard;
    shared_state->brightness = percent;
    shared_state->message(saved ? "Brightness saved" : "Brightness changed; save failed");
}
void observe(const awdl::PeerTable& peers, std::uint64_t time) {
    if (state_mutex) {
        Guard guard;
        shared_state->observe(peers, time);
    }
}
void radio_ready(const awdl::Mac& mac) {
    if (state_mutex) {
        Guard guard;
        shared_state->radio_ready = true;
        shared_state->radio_mac = mac;
        ++shared_state->revision;
    }
}
void host_activity() {
    if (state_mutex) {
        Guard guard;
        shared_state->host_activity = now();
    }
}
void receive_bytes(std::size_t size) {
    if (!state_mutex)
        return;
    Guard guard;
    auto& incoming = shared_state->transfers[0];
    if (incoming.active()) {
        incoming.done += size;
        incoming.updated = now();
        ++shared_state->revision;
    }
}
void stage_outgoing(std::size_t written, std::size_t total, const char* name) {
    if (!state_mutex)
        return;
    Guard guard;
    auto& outgoing = shared_state->transfers[1];
    if (!outgoing.active() || written == 0)
        outgoing = {};
    outgoing.phase = round_ui::Phase::preparing;
    outgoing.done = written;
    outgoing.total = total;
    outgoing.updated = now();
    if (name && *name)
        std::snprintf(outgoing.name.data(), outgoing.name.size(), "%s", name);
    ++shared_state->revision;
}
bool next_action(round_ui::Action& action) {
    return actions && xQueueReceive(actions, &action, 0) == pdTRUE;
}
void action_result(const round_ui::Action& action, bool okay, const char* reason) {
    if (!state_mutex)
        return;
    Guard guard;
    if (okay && action.kind == round_ui::ActionKind::cancel &&
        !std::strcmp(reason, "Staging cancelled")) {
        shared_state->transfers[1].phase = round_ui::Phase::uncertain;
    }
    if (okay && action.kind == round_ui::ActionKind::allow)
        shared_state->allowed = action.peer;
    if (okay && action.kind == round_ui::ActionKind::revoke)
        shared_state->allowed = {};
    shared_state->message(reason);
}
void serial_event(const char* bytes, std::size_t length) {
    if (!state_mutex || !bytes || !length || length >= 1024)
        return;
    // File chunks stay on the existing bounded USB path. Never parse/copy their contents for the
    // UI.
    constexpr const char* kinds[] = {
        "command_reply",  "peer_resolved",     "transfer_begin",      "file_begin",
        "transfer_ready", "transfer_complete", "outgoing_progress",   "outgoing_complete",
        "outgoing_stage", "resolve_stage",     "resolution_complete", "native_receiver_failed"};
    bool relevant = false;
    for (const auto* kind : kinds) {
        char prefix[72];
        std::snprintf(prefix, sizeof(prefix), "{\"event\":\"%s\"", kind);
        if (length >= std::strlen(prefix) && !std::memcmp(bytes, prefix, std::strlen(prefix))) {
            relevant = true;
            break;
        }
    }
    if (!relevant)
        return;
    auto* object = cJSON_ParseWithLength(bytes, length);
    if (!object)
        return;
    {
        Guard guard;
        const auto* kind = text(object, "event");
        auto& incoming = shared_state->transfers[0];
        auto& outgoing = shared_state->transfers[1];
        if (!std::strcmp(kind, "command_reply")) {
            if (flag(object, "ok")) {
                read_mac(text(object, "paired_peer"), shared_state->allowed);
            }
            shared_state->host_reply(flag(object, "ok"), text(object, "reason"), now());
        } else if (!std::strcmp(kind, "peer_resolved")) {
            awdl::Mac peer{};
            std::array<char, 256> name{};
            decode_name(object, name.data(), name.size());
            if (read_mac(text(object, "mac"), peer))
                shared_state->set_name(peer, name.data());
        } else if (!std::strcmp(kind, "transfer_begin")) {
            incoming = {};
            incoming.phase = round_ui::Phase::receiving;
            incoming.total = number(object, "total_bytes");
            incoming.files = unsigned(number(object, "files"));
            std::snprintf(incoming.id.data(), incoming.id.size(), "%s",
                          text(object, "transfer_id"));
            incoming.updated = now();
        } else if (!std::strcmp(kind, "file_begin")) {
            decode_name(object, incoming.name.data(), incoming.name.size());
            incoming.updated = now();
        } else if (!std::strcmp(kind, "transfer_ready")) {
            if (!std::strcmp(incoming.id.data(), text(object, "transfer_id")))
                incoming.phase = round_ui::Phase::verifying;
            incoming.updated = now();
        } else if (!std::strcmp(kind, "transfer_complete")) {
            if (!std::strcmp(incoming.id.data(), text(object, "transfer_id")))
                shared_state->finish_receive(flag(object, "host_committed"),
                                             flag(object, "response_written"), now());
        } else if (!std::strcmp(kind, "outgoing_progress")) {
            outgoing.phase = round_ui::Phase::sending;
            outgoing.done = number(object, "wire_bytes");
            outgoing.total = number(object, "wire_total");
            outgoing.updated = now();
        } else if (!std::strcmp(kind, "outgoing_complete")) {
            outgoing.phase = flag(object, "success") && number(object, "http_status") == 200
                                 ? round_ui::Phase::complete
                                 : round_ui::Phase::uncertain;
            outgoing.updated = now();
        } else if (!std::strcmp(kind, "outgoing_stage")) {
            outgoing.phase = round_ui::Phase::sending;
            outgoing.updated = now();
            shared_state->message("Secure native AirDrop transfer");
        } else if (!std::strcmp(kind, "resolution_complete")) {
            shared_state->message(
                cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(object, "error")) &&
                        cJSON_GetObjectItemCaseSensitive(object, "error")->valuedouble == 0 &&
                        number(object, "http_status") == 200
                    ? "Device name resolved"
                    : "Name lookup failed; try again");
        } else if (!std::strcmp(kind, "native_receiver_failed"))
            shared_state->message("AirDrop service unavailable");
        ++shared_state->revision;
    }
    cJSON_Delete(object);
}
bool diagnostic_command(const char* command) {
    if (std::strncmp(command, "ROUND ", 6))
        return false;
    if (!state_mutex || !output)
        return true;
    if (!std::strcmp(command, "ROUND STATUS")) {
        auto& snapshot = *diagnostic_snapshot;
        {
            Guard guard;
            snapshot = *shared_state;
        }
        const auto main_task = xTaskGetHandle("main");
        const auto ui_task = xTaskGetHandle("airbridge_round");
        char line[1000];
        const int size = std::snprintf(
            line, sizeof(line),
            "{\"event\":\"round_status\",\"board\":\"spotpear-s3-180-v1\",\"idf\":\"%s\",\"radio_"
            "ready\":%s,\"peers\":%u,\"brightness\":%u,\"flushes\":%u,\"display_errors\":%u,"
            "\"touch_samples\":%u,\"touch_errors\":%u,\"touches\":%u,\"touch_x\":%d,\"touch_y\":%d,"
            "\"pressed\":%s,\"receive_phase\":%u,\"send_phase\":%u,\"internal_free\":%u,\"internal_"
            "largest\":%u,\"internal_min\":%u,\"psram_free\":%u,\"uptime_ms\":%llu,\"reset_"
            "reason\":%u,\"main_stack_free\":%u,\"ui_stack_free\":%u}\n",
            esp_get_idf_version(), snapshot.radio_ready ? "true" : "false", snapshot.count(now()),
            snapshot.brightness, frames.load(), display_errors.load(), touch_samples.load(),
            touch_errors.load(), touches.load(), touch_x.load(), touch_y.load(),
            touch_down ? "true" : "false", unsigned(snapshot.transfers[0].phase),
            unsigned(snapshot.transfers[1].phase),
            unsigned(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
            unsigned(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)),
            unsigned(heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL)),
            unsigned(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)),
            static_cast<unsigned long long>(now() / 1000), unsigned(esp_reset_reason()),
            main_task ? unsigned(uxTaskGetStackHighWaterMark(main_task)) : 0,
            ui_task ? unsigned(uxTaskGetStackHighWaterMark(ui_task)) : 0);
        if (size > 0 && std::size_t(size) < sizeof(line))
            output(line, std::size_t(size));
    } else if (!std::strcmp(command, "ROUND SCREEN")) {
        const bool accepted = capture_screen();
        const char* line = accepted ? "{\"event\":\"round_capture_started\"}\n"
                                    : "{\"event\":\"round_capture_busy\"}\n";
        output(line, std::strlen(line));
    } else if (!std::strncmp(command, "ROUND VIEW ", 11)) {
        const char* names[] = {"home", "devices", "transfer", "settings", "peer"};
        bool found = false;
        for (int i = 0; i < 5; ++i)
            if (!std::strcmp(command + 11, names[i])) {
                requested_view = i;
                found = true;
                break;
            }
        const char* line = found ? "{\"event\":\"round_view_queued\"}\n"
                                 : "{\"event\":\"round_command_invalid\"}\n";
        output(line, std::strlen(line));
    } else if (!std::strncmp(command, "ROUND BRIGHTNESS ", 17)) {
        unsigned value{};
        char extra{};
        const bool okay =
            std::sscanf(command + 17, "%u%c", &value, &extra) == 1 && value >= 10 && value <= 85;
        if (okay)
            requested_brightness = int(value);
        const char* line = okay ? "{\"event\":\"round_brightness_queued\"}\n"
                                : "{\"event\":\"round_command_invalid\"}\n";
        output(line, std::strlen(line));
    } else {
        const char* line = "{\"event\":\"round_command_invalid\"}\n";
        output(line, std::strlen(line));
    }
    return true;
}
}  // namespace airbridge::round_display
