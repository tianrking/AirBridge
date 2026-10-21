// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
#include "esp_err.h"
esp_err_t native_receiver_begin(const airbridge::awdl::Mac& own,const airbridge::awdl::Mac& allowed_peer);

bool native_receiver_set_peer(const airbridge::awdl::Mac& peer);

#ifdef AIRBRIDGE_ROUND_DISPLAY
// Reserve the unchanged native server stack before radio heap fragmentation.
esp_err_t native_receiver_reserve();
#endif
