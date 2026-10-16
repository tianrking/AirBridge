// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "serial_channel.hpp"

#include <cstdio>

#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
namespace {
SemaphoreHandle_t output;
}
esp_err_t serial_channel_begin() {
    output = xSemaphoreCreateMutex();
    if (!output)
        return ESP_ERR_NO_MEM;
    usb_serial_jtag_driver_config_t config{8192, 1024};
    const auto error = usb_serial_jtag_driver_install(&config);
    if (error != ESP_OK)
        return error;
    usb_serial_jtag_vfs_set_rx_line_endings(ESP_LINE_ENDINGS_LF);
    usb_serial_jtag_vfs_set_tx_line_endings(ESP_LINE_ENDINGS_LF);
    usb_serial_jtag_vfs_use_driver();
    return ESP_OK;
}
bool serial_diagnostic_lock(unsigned milliseconds) {
    return output && xSemaphoreTake(output, pdMS_TO_TICKS(milliseconds)) == pdTRUE;
}
void serial_diagnostic_unlock() { xSemaphoreGive(output); }
int serial_read(char* bytes, std::size_t capacity, unsigned timeout_ms) {
    return usb_serial_jtag_read_bytes(bytes, capacity, pdMS_TO_TICKS(timeout_ms));
}
bool serial_record(const char* bytes, std::size_t length) {
    if (!bytes || !length || length > 1024 || !serial_diagnostic_lock(5000))
        return false;
    const bool written = serial_diagnostic_write(bytes, length, 5000);
    serial_diagnostic_unlock();
    return written;
}
bool serial_diagnostic_write(const char* bytes, std::size_t length, unsigned timeout_ms) {
    const auto wait = pdMS_TO_TICKS(timeout_ms);
    if (!bytes || !length || length >= 8192)
        return false;
    if (usb_serial_jtag_write_bytes("\n", 1, wait) != 1)
        return false;
    return usb_serial_jtag_write_bytes(bytes, length, wait) == int(length);
}
