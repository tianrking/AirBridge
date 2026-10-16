// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include <cstddef>

#include "esp_err.h"
esp_err_t serial_channel_begin();
bool serial_record(const char* bytes, std::size_t length);
int serial_read(char* bytes, std::size_t capacity, unsigned timeout_ms);
bool serial_diagnostic_lock(unsigned milliseconds = 0);
void serial_diagnostic_unlock();
// Caller holds the diagnostic lock. A leading boundary repairs a truncated
// record left by a disconnected host; chunks stay serialized under that lock.
bool serial_diagnostic_write(const char* bytes, std::size_t length, unsigned timeout_ms = 0);
