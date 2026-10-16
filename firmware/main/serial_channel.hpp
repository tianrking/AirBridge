// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "esp_err.h"
#include <cstddef>
esp_err_t serial_channel_begin();
bool serial_record(const char* bytes,std::size_t length);
bool serial_diagnostic_lock(unsigned milliseconds=0);
void serial_diagnostic_unlock();
